// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ISupraSValueFeed.sol";

/// @notice Bounded group purchases for individually delivered digital entitlements.
/// @dev A buyer must explicitly accept delivery before their escrow goes to the provider.
contract Hillcash {
    uint256 public constant HBAR_USD_PAIR = 432;
    uint256 public constant MAX_MEMBERS = 32;
    uint256 public constant MAX_ORACLE_AGE = 2 hours;
    uint16 public constant MAX_MOVEMENT_BPS = 2_000;

    ISupraSValueFeed public immutable oracle;
    uint256 public nextOfferId;
    uint256 private entered;

    enum State { Open, Active, Cancelled }
    struct Offer {
        address payable provider;
        bytes32 serviceId;
        uint64 joinDeadline;
        uint64 deliveryDeadline;
        uint32 minimum;
        uint32 members;
        uint256 unitUsdCents;
        State state;
    }
    struct Order {
        uint256 deposited;
        uint256 due;
        bool delivered;
        bool resolved;
        bool accepted;
        bytes32 entitlementHash;
        uint256 joinPriceE18;
        uint16 maxMovementBps;
    }
    mapping(uint256 => Offer) public offers;
    mapping(uint256 => mapping(address => Order)) public orders;
    mapping(uint256 => address[]) private participants;

    event OfferCreated(uint256 indexed offerId, address indexed provider, bytes32 indexed serviceId, uint256 unitUsdCents);
    event Joined(uint256 indexed offerId, address indexed buyer, uint256 deposited, uint256 marketPriceE18, uint16 maxMovementBps);
    event Activated(uint256 indexed offerId, uint256 price, uint256 decimals);
    event DeliveryCommitted(uint256 indexed offerId, address indexed buyer, bytes32 entitlementHash);
    event Accepted(uint256 indexed offerId, address indexed buyer, uint256 paid, uint256 returned);
    event Refunded(uint256 indexed offerId, address indexed buyer, uint256 amount);
    event Cancelled(uint256 indexed offerId);

    error InvalidOffer();
    error Unauthorized();
    error InvalidState();
    error InvalidPrice();
    error MarketMoved();
    error TransferFailed();

    modifier nonReentrant() {
        if (entered != 0) revert InvalidState();
        entered = 1;
        _;
        entered = 0;
    }

    constructor(address supraOracle) {
        if (supraOracle == address(0) || supraOracle.code.length == 0) revert InvalidOffer();
        oracle = ISupraSValueFeed(supraOracle);
    }

    function createOffer(
        bytes32 serviceId,
        uint256 unitUsdCents,
        uint32 minimum,
        uint64 joinDeadline,
        uint64 deliveryDeadline
    ) external returns (uint256 id) {
        if (serviceId == 0 || unitUsdCents == 0 || minimum < 2 || minimum > MAX_MEMBERS ||
            joinDeadline <= block.timestamp || deliveryDeadline <= joinDeadline) revert InvalidOffer();
        id = ++nextOfferId;
        offers[id] = Offer(payable(msg.sender), serviceId, joinDeadline, deliveryDeadline, minimum, 0, unitUsdCents, State.Open);
        emit OfferCreated(id, msg.sender, serviceId, unitUsdCents);
    }

    function join(uint256 id, uint256 maxUsdCents, uint16 maxMovementBps) external payable {
        Offer storage offer = offers[id];
        if (offer.provider == address(0)) revert InvalidOffer();
        if (offer.state != State.Open || block.timestamp >= offer.joinDeadline || offer.members >= MAX_MEMBERS) revert InvalidState();
        if (msg.sender == offer.provider || orders[id][msg.sender].deposited != 0 || maxUsdCents < offer.unitUsdCents) revert InvalidOffer();
        if (maxMovementBps == 0 || maxMovementBps > MAX_MOVEMENT_BPS) revert InvalidOffer();
        ISupraSValueFeed.PriceFeed memory feed = _freshFeed();
        uint256 requiredWei = _quote(offer.unitUsdCents, feed);
        if (msg.value < requiredWei) revert InvalidOffer();
        Order storage order = orders[id][msg.sender];
        order.deposited = msg.value;
        order.joinPriceE18 = _normalize(feed);
        order.maxMovementBps = maxMovementBps;
        participants[id].push(msg.sender);
        ++offer.members;
        emit Joined(id, msg.sender, msg.value, order.joinPriceE18, maxMovementBps);
    }

    /// @dev Converts USD cents into wei, rounding up so a deposit never underpays.
    function quoteWei(uint256 usdCents) public view returns (uint256) {
        return _quote(usdCents, _freshFeed());
    }

    function marketPriceE18() external view returns (uint256 price, uint256 timeMs) {
        ISupraSValueFeed.PriceFeed memory feed = _freshFeed();
        return (_normalize(feed), feed.time);
    }

    function _freshFeed() private view returns (ISupraSValueFeed.PriceFeed memory feed) {
        feed = oracle.getSvalue(HBAR_USD_PAIR);
        // Supra's Hedera push feed timestamps are Unix milliseconds. Reject seconds-format
        // or malformed values rather than silently treating a stale feed as fresh.
        if (feed.price == 0 || feed.decimals > 18 || feed.time < 1_000_000_000_000) revert InvalidPrice();
        uint256 observedAt = feed.time / 1000;
        if (observedAt > block.timestamp || block.timestamp - observedAt > MAX_ORACLE_AGE) revert InvalidPrice();
    }

    function _normalize(ISupraSValueFeed.PriceFeed memory feed) private pure returns (uint256) {
        return feed.price * (10 ** (18 - feed.decimals));
    }

    function _quote(uint256 usdCents, ISupraSValueFeed.PriceFeed memory feed) private pure returns (uint256) {
        // USD cents / (USD per HBAR): cents * 10^decimals * 10^18 / (100 * price).
        // Bound the user input before multiplication. Commercial offers need no more than $1m.
        if (usdCents == 0 || usdCents > 100_000_000) revert InvalidPrice();
        uint256 numerator = usdCents * (10 ** feed.decimals) * 1 ether;
        uint256 denominator = 100 * feed.price;
        return numerator / denominator + (numerator % denominator == 0 ? 0 : 1);
    }

    function activate(uint256 id) external {
        Offer storage offer = offers[id];
        if (offer.provider == address(0)) revert InvalidOffer();
        if (offer.state != State.Open || block.timestamp >= offer.joinDeadline || offer.members < offer.minimum) revert InvalidState();
        ISupraSValueFeed.PriceFeed memory feed = _freshFeed();
        uint256 due = _quote(offer.unitUsdCents, feed);
        uint256 currentPrice = _normalize(feed);
        address[] storage buyers = participants[id];
        for (uint256 i; i < buyers.length; ++i) {
            Order storage order = orders[id][buyers[i]];
            if (order.deposited < due) revert InvalidPrice();
            uint256 movement = currentPrice > order.joinPriceE18 ? currentPrice - order.joinPriceE18 : order.joinPriceE18 - currentPrice;
            if (movement * 10_000 > order.joinPriceE18 * order.maxMovementBps) revert MarketMoved();
        }
        // All orders lock to the same rate; the oracle cannot vary between calls in one transaction.
        for (uint256 i; i < buyers.length; ++i) orders[id][buyers[i]].due = due;
        offer.state = State.Active;
        emit Activated(id, feed.price, feed.decimals);
    }

    function commitDelivery(uint256 id, address buyer, bytes32 entitlementHash) external {
        Offer storage offer = offers[id];
        Order storage order = orders[id][buyer];
        if (offer.provider != msg.sender) revert Unauthorized();
        if (offer.state != State.Active || block.timestamp >= offer.deliveryDeadline ||
            order.due == 0 || order.delivered || entitlementHash == 0) revert InvalidState();
        order.entitlementHash = entitlementHash;
        order.delivered = true;
        emit DeliveryCommitted(id, buyer, entitlementHash);
    }

    function accept(uint256 id) external nonReentrant {
        Offer storage offer = offers[id];
        Order storage order = orders[id][msg.sender];
        if (offer.state != State.Active || !order.delivered || order.resolved ||
            block.timestamp >= offer.deliveryDeadline) revert InvalidState();
        order.resolved = true;
        order.accepted = true;
        uint256 returned = order.deposited - order.due;
        _send(offer.provider, order.due);
        if (returned != 0) _send(payable(msg.sender), returned);
        emit Accepted(id, msg.sender, order.due, returned);
    }

    function refund(uint256 id) external nonReentrant {
        Offer storage offer = offers[id];
        Order storage order = orders[id][msg.sender];
        if (order.deposited == 0 || order.resolved) revert InvalidState();
        bool openExpired = offer.state == State.Open && block.timestamp >= offer.joinDeadline;
        bool deliveryExpired = offer.state == State.Active && block.timestamp >= offer.deliveryDeadline;
        if (!openExpired && !deliveryExpired && offer.state != State.Cancelled) revert InvalidState();
        order.resolved = true;
        _send(payable(msg.sender), order.deposited);
        emit Refunded(id, msg.sender, order.deposited);
    }

    function cancel(uint256 id) external {
        Offer storage offer = offers[id];
        if (offer.provider != msg.sender) revert Unauthorized();
        if (offer.state != State.Open) revert InvalidState();
        offer.state = State.Cancelled;
        emit Cancelled(id);
    }

    function participantsOf(uint256 id) external view returns (address[] memory) { return participants[id]; }

    function _send(address payable recipient, uint256 amount) private {
        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
