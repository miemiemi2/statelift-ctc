// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IERC3009 {
    function balanceOf(address account) external view returns (uint256);
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external;
    function transfer(address to, uint256 value) external returns (bool);
}

/// @title GoalRouter — source-chain at-most-once gate for a payment goal.
///
/// @notice This is the contract that makes "the same payment goal is paid at most
/// once" true rather than merely asserted. Every compliant execution for a goal
/// `G` must go through `fill`, and `fills[G]` can only move from empty to set,
/// exactly once, ever. A second executor arriving on a later round reverts here
/// and spends no tokens, which is what allows the CTC side to hand a goal to a
/// replacement executor without risking a second real payment.
///
/// The goal id is derived from terms that both chains can compute independently,
/// so no cross-chain read is needed to agree on identity. Round number and the
/// source payment deadline `T` are bound into the ERC-3009 nonce, so a signed
/// authorization cannot be replayed onto a different goal, a different round, a
/// different winner or a different deadline, and cannot be redirected to pay the
/// final recipient outside this router.
///
/// Scope: one immutable recipient and exact amount per goal. Nothing here stops a
/// third party from gifting tokens to the recipient directly; the guarantee is
/// about compliant executions of `G`, not about the recipient's balance.
contract GoalRouter {
    /// Terms that identify a payment goal. Must be byte-identical to the terms
    /// the CTC-side escrow hashes, or the produced fact will not match any goal.
    struct GoalRef {
        uint256 ctcChainId;
        address escrow;
        address owner;
        bytes32 businessRef;
        address token;
        address recipient;
        uint256 amount;
    }

    struct Authorization {
        address from;
        uint256 validAfter;
        uint256 validBefore;
        bytes signature;
    }

    struct Fill {
        uint32 roundNumber;
        uint64 payBy;
        uint64 filledAt;
        address winner;
        address payer;
    }

    bytes32 public constant FILL_NONCE_DOMAIN =
        keccak256("StateLift.GoalRouter.fillNonce.v1");

    /// The one-shot record. Empty `filledAt` means the goal is still unfilled.
    mapping(bytes32 => Fill) private fills;

    error AlreadyFilled();
    error RoundExpired();
    error InvalidTerms();
    error ExactAmountRequired();

    /// The single fact the CTC side settles against.
    event GoalFilled(
        bytes32 indexed goalId,
        uint32 indexed roundNumber,
        address indexed winner,
        address recipient,
        uint256 amount,
        address payer,
        uint64 payBy
    );

    function goalIdOf(GoalRef calldata g) public pure returns (bytes32) {
        return keccak256(abi.encode(g));
    }

    /// Deterministic ERC-3009 nonce. Binding these fields means the executor's
    /// signature is only usable for this goal, this round, this winner and this
    /// deadline, through this router.
    function fillNonce(
        bytes32 goalId,
        uint32 roundNumber,
        address winner,
        uint64 payBy
    ) public view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    FILL_NONCE_DOMAIN,
                    block.chainid,
                    address(this),
                    goalId,
                    roundNumber,
                    winner,
                    payBy
                )
            );
    }

    function fillOf(bytes32 goalId) external view returns (Fill memory) {
        return fills[goalId];
    }

    function isFilled(bytes32 goalId) external view returns (bool) {
        return fills[goalId].filledAt != 0;
    }

    /// Executes the one compliant payment for `g`. Reverts entirely — spending no
    /// tokens — if the goal was already filled or the round deadline has passed.
    function fill(
        GoalRef calldata g,
        uint32 roundNumber,
        uint64 payBy,
        address winner,
        Authorization calldata auth
    ) external returns (bytes32 goalId) {
        goalId = goalIdOf(g);

        // Order matters: the one-shot gate is checked before any token movement,
        // so a relay attempt on an already-filled goal costs gas and nothing else.
        if (fills[goalId].filledAt != 0) revert AlreadyFilled();
        if (block.timestamp >= payBy) revert RoundExpired();
        if (
            roundNumber == 0 ||
            winner == address(0) ||
            auth.from == address(0) ||
            g.token == address(0) ||
            g.recipient == address(0) ||
            g.escrow == address(0) ||
            g.owner == address(0) ||
            g.ctcChainId == 0 ||
            g.businessRef == bytes32(0) ||
            g.amount == 0 ||
            g.recipient == g.token ||
            g.recipient == address(this) ||
            auth.from == g.recipient
        ) revert InvalidTerms();

        IERC3009 token = IERC3009(g.token);
        uint256 routerBefore = token.balanceOf(address(this));
        uint256 recipientBefore = token.balanceOf(g.recipient);

        token.receiveWithAuthorization(
            auth.from,
            address(this),
            g.amount,
            auth.validAfter,
            auth.validBefore,
            fillNonce(goalId, roundNumber, winner, payBy),
            auth.signature
        );
        // Exact-amount discipline: a token that delivers less (or more) than the
        // goal amount must not be reported as a compliant payment.
        if (token.balanceOf(address(this)) != routerBefore + g.amount)
            revert ExactAmountRequired();

        token.transfer(g.recipient, g.amount);
        if (token.balanceOf(g.recipient) != recipientBefore + g.amount)
            revert ExactAmountRequired();
        if (token.balanceOf(address(this)) != routerBefore)
            revert ExactAmountRequired();

        fills[goalId] = Fill({
            roundNumber: roundNumber,
            payBy: payBy,
            filledAt: uint64(block.timestamp),
            winner: winner,
            payer: auth.from
        });

        emit GoalFilled(
            goalId,
            roundNumber,
            winner,
            g.recipient,
            g.amount,
            auth.from,
            payBy
        );
    }
}
