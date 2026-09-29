// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ISupraSValueFeed.sol";

/// @notice Bounded group purchases for individually delivered digital entitlements.
/// @dev A buyer must explicitly accept delivery before their escrow goes to the provider.
contract Hillcash {
    uint256 public constant HBAR_USD_PAIR = 432;
    uint256 public constant MAX_MEMBERS = 32;
    uint256 public constant MAX_ORACLE_AGE = 2 hours;

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
        bytes32 entitlementHash;
    }
    mapping(uint256 => Offer) public offers;
    mapping(uint256 => mapping(address => Order)) public orders;
    mapping(uint256 => address[]) private participants;

    event OfferCreated(uint256 indexed offerId, address indexed provider, bytes32 indexed serviceId, uint256 unitUsdCents);
    event Joined(uint256 indexed offerId, address indexed buyer, uint256 deposited);
    event Activated(uint256 indexed offerId, uint256 price, uint256 decimals);
    event DeliveryCommitted(uint256 indexed offerId, address indexed buyer, bytes32 entitlementHash);
    event Accepted(uint256 indexed offerId, address indexed buyer, uint256 paid, uint256 returned);
    event Refunded(uint256 indexed offerId, address indexed buyer, uint256 amount);
    event Cancelled(uint256 indexed offerId);

    error InvalidOffer();
    error Unauthorized();
    error InvalidState();
    error InvalidPrice();
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

    function join(uint256 id, uint256 maxUsdCents) external payable {
        Offer storage offer = offers[id];
        if (offer.provider == address(0)) revert InvalidOffer();
        if (offer.state != State.Open || block.timestamp >= offer.joinDeadline || offer.members >= MAX_MEMBERS) revert InvalidState();
        if (msg.sender == offer.provider || orders[id][msg.sender].deposited != 0 || maxUsdCents < offer.unitUsdCents) revert InvalidOffer();
        uint256 requiredWei = quoteWei(offer.unitUsdCents);
        if (msg.value < requiredWei) revert InvalidOffer();
        orders[id][msg.sender].deposited = msg.value;
        participants[id].push(msg.sender);
        ++offer.members;
        emit Joined(id, msg.sender, msg.value);
    }

    /// @dev Converts USD cents into wei, rounding up so a deposit never underpays.
    function quoteWei(uint256 usdCents) public view returns (uint256) {
        ISupraSValueFeed.PriceFeed memory feed = oracle.getSvalue(HBAR_USD_PAIR);
        if (feed.price == 0 || feed.decimals > 18 || feed.time > block.timestamp ||
            block.timestamp - feed.time > MAX_ORACLE_AGE) revert InvalidPrice();
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
        uint256 due = quoteWei(offer.unitUsdCents);
        address[] storage buyers = participants[id];
        for (uint256 i; i < buyers.length; ++i) {
            if (orders[id][buyers[i]].deposited < due) revert InvalidPrice();
        }
        // All orders lock to the same rate; the oracle cannot vary between calls in one transaction.
        for (uint256 i; i < buyers.length; ++i) orders[id][buyers[i]].due = due;
        offer.state = State.Active;
        ISupraSValueFeed.PriceFeed memory feed = oracle.getSvalue(HBAR_USD_PAIR);
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
