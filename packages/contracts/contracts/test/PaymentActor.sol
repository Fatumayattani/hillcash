// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "../Hillcash.sol";

/// @dev Test-only receiver with unrestricted controls. Never deploy for users.
contract PaymentActor {
    Hillcash public immutable escrow;
    bool public rejectPayments;
    uint256 public callbackOffer;
    bool public attackAcceptance;
    bool public lastCallbackSucceeded;
    uint256 public callbackAttempts;

    constructor(Hillcash target) { escrow = target; }

    function configure(bool reject, uint256 callback, bool acceptAttack) external {
        rejectPayments = reject;
        callbackOffer = callback;
        attackAcceptance = acceptAttack;
    }
    function create(bytes32 service, uint256 cents, uint64 joinBy, uint64 deliverBy) external {
        escrow.createOffer(service, cents, 2, joinBy, deliverBy);
    }
    function join(uint256 offer) external payable {
        escrow.join{value: msg.value}(offer, 100, 500);
    }
    function accept(uint256 offer) external { escrow.accept(offer); }
    function refund(uint256 offer) external { escrow.refund(offer); }
    function deliver(uint256 offer, address buyer, bytes32 commitment) external {
        escrow.commitDelivery(offer, buyer, commitment);
    }
    receive() external payable {
        require(!rejectPayments, "test receiver rejects payment");
        if (callbackOffer != 0) {
            ++callbackAttempts;
            (bool success,) = address(escrow).call(abi.encodeWithSignature(
                attackAcceptance ? "accept(uint256)" : "refund(uint256)",
                callbackOffer
            ));
            lastCallbackSucceeded = success;
        }
    }
}
