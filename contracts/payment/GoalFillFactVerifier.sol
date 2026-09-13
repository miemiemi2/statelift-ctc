// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {RootInbox} from "../proof/RootInbox.sol";
import {StateProofVerifier} from "../proof/StateProofVerifier.sol";
import {NativeReceiptPolicy} from "./NativeReceiptPolicy.sol";

/// @title GoalFillFactVerifier — turns an anchored source-chain receipt into the
/// single fact the CTC side settles against.
///
/// @notice The fact answers exactly two questions: *which round* filled the goal
/// and *who* the winner is. That is what decides which pool pays whom: a fact
/// naming round N lets round N's winner be paid, and simultaneously proves every
/// other round can never win, so their guarantee capital can be released.
///
/// The verifier is bound at construction to one source-chain router address and
/// one RootInbox. It refuses receipts that were not anchored, receipts that
/// failed, and receipts that contain anything other than exactly one GoalFilled
/// log from that router — ambiguity is rejected rather than guessed.
contract GoalFillFactVerifier {
    using NativeReceiptPolicy for bytes;

    struct FillFact {
        bytes32 goalId;
        uint32 roundNumber;
        address winner;
        address recipient;
        uint256 amount;
        address payer;
        uint64 payBy;
        uint64 sourceTimestamp;
    }

    struct Evidence {
        bytes32 blockHash;
        uint256 transactionIndex;
        bytes[] receiptProof;
    }

    /// Proves the goal was STILL UNFILLED at an anchored source block.
    struct UnfilledEvidence {
        bytes32 goalId;
        bytes32 blockHash;
        bytes[] accountProof;
        bytes[] slotProof;
    }

    struct UnfilledFact {
        bytes32 goalId;
        uint64 sourceTimestamp;
        uint64 sourceHeight;
    }

    /// keccak256("GoalFilled(bytes32,uint32,address,address,uint256,address,uint64)")
    bytes32 public constant GOAL_FILLED_TOPIC =
        keccak256(
            "GoalFilled(bytes32,uint32,address,address,uint256,address,uint64)"
        );

    /// Storage slot of GoalRouter's `fills` mapping. The base slot of a Fill packs
    /// roundNumber | payBy | filledAt, so a zero base slot means "never filled".
    uint256 public constant FILLS_SLOT = 0;

    RootInbox public immutable inbox;
    StateProofVerifier public immutable stateVerifier;
    /// The one source-chain GoalRouter whose facts this verifier will accept.
    address public immutable router;
    /// Expected code hash of that router. Checked on negative proofs so that
    /// "the slot is zero" cannot be proven against a block in which the address
    /// held no code, or different code, than the router this verifier trusts.
    bytes32 public immutable routerCodeHash;

    error NotAnchored();
    error ReceiptFailed();
    error NoFillLog();
    error AmbiguousFillLog();
    error MalformedFillLog();
    error WrongInbox();
    error InvalidConfiguration();
    error RouterAccountMissing();
    error RouterCodeMismatch();
    error GoalWasAlreadyFilled();

    constructor(
        address rootInbox,
        address genericStateVerifier,
        address goalRouter,
        bytes32 expectedRouterCodeHash
    ) {
        if (
            rootInbox == address(0) ||
            goalRouter == address(0) ||
            expectedRouterCodeHash == bytes32(0)
        ) revert InvalidConfiguration();
        inbox = RootInbox(rootInbox);
        stateVerifier = StateProofVerifier(genericStateVerifier);
        if (address(stateVerifier.inbox()) != rootInbox) revert WrongInbox();
        router = goalRouter;
        routerCodeHash = expectedRouterCodeHash;
    }

    /// Identifies the source chain + inbox + prover this verifier trusts.
    function sourceDomain() external view returns (bytes32) {
        return inbox.sourceDomain();
    }

    function verifyFill(
        bytes calldata encoded
    ) external view returns (FillFact memory) {
        return proveFill(abi.decode(encoded, (Evidence)));
    }

    function verifyUnfilled(
        bytes calldata encoded
    ) external view returns (UnfilledFact memory) {
        return proveUnfilled(abi.decode(encoded, (UnfilledEvidence)));
    }

    /// Storage slot holding the base word of `fills[goalId]`.
    function fillSlot(bytes32 goalId) public pure returns (bytes32) {
        return keccak256(abi.encode(goalId, FILLS_SLOT));
    }

    /// Proves the goal had NOT been filled as of an anchored source block.
    ///
    /// Combined with a round's immutable payment deadline `T`, a timestamp at or
    /// after `T` rules that round out forever, because the router refuses to fill
    /// once `T` has passed. That lets a guarantor reclaim committed capacity
    /// without waiting for the clearing deadline — and, unlike a winner proof, it
    /// leaves the GOAL open, because nobody has been paid yet.
    function proveUnfilled(
        UnfilledEvidence memory e
    ) public view returns (UnfilledFact memory f) {
        StateProofVerifier.StorageFact memory sf = stateVerifier.storageFact(
            e.blockHash,
            router,
            fillSlot(e.goalId),
            e.accountProof,
            e.slotProof
        );
        // Absence of the account would make a zero slot meaningless.
        if (!sf.accountPresent) revert RouterAccountMissing();
        if (sf.codeHash != routerCodeHash) revert RouterCodeMismatch();
        if (sf.value != 0) revert GoalWasAlreadyFilled();

        f.goalId = e.goalId;
        f.sourceTimestamp = sf.timestamp;
        f.sourceHeight = sf.height;
    }

    function proveFill(
        Evidence memory e
    ) public view returns (FillFact memory f) {
        // Reverts unless the header was anchored through the RootInbox, so the
        // timestamp and receipts root cannot be supplied by the caller.
        (bytes memory raw, uint64 timestamp) = stateVerifier.receipt(
            e.blockHash,
            e.transactionIndex,
            e.receiptProof
        );
        f.sourceTimestamp = timestamp;

        (uint256 status, NativeReceiptPolicy.Log[] memory logs) = NativeReceiptPolicy
            .decode(raw);
        if (status != 1) revert ReceiptFailed();

        uint256 matches;
        uint256 selected;
        for (uint256 i; i < logs.length; ++i) {
            NativeReceiptPolicy.Log memory l = logs[i];
            if (
                l.emitter == router &&
                l.topics.length == 4 &&
                l.topics[0] == GOAL_FILLED_TOPIC
            ) {
                ++matches;
                selected = i;
            }
        }
        if (matches == 0) revert NoFillLog();
        if (matches > 1) revert AmbiguousFillLog();

        NativeReceiptPolicy.Log memory fill = logs[selected];
        if (fill.data.length != 128) revert MalformedFillLog();

        f.goalId = fill.topics[1];
        uint256 round = uint256(fill.topics[2]);
        uint256 winner = uint256(fill.topics[3]);
        // Indexed values must be canonically padded; anything else is malformed.
        if (round == 0 || round > type(uint32).max) revert MalformedFillLog();
        if (winner == 0 || winner > type(uint160).max) revert MalformedFillLog();
        f.roundNumber = uint32(round);
        f.winner = address(uint160(winner));

        (
            address recipient,
            uint256 amount,
            address payer,
            uint64 payBy
        ) = abi.decode(fill.data, (address, uint256, address, uint64));
        if (
            recipient == address(0) ||
            amount == 0 ||
            payer == address(0) ||
            payBy == 0 ||
            f.goalId == bytes32(0)
        ) revert MalformedFillLog();
        f.recipient = recipient;
        f.amount = amount;
        f.payer = payer;
        f.payBy = payBy;
    }
}
