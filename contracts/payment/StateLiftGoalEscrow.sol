// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {GoalFillFactVerifier} from "./GoalFillFactVerifier.sol";

/// @title StateLiftGoalEscrow — budget recovery with a clearing deadline, and safe
/// relay on the same payment goal.
///
/// @notice What the payment operator buys, in one sentence: when a cross-chain
/// payment's outcome is unknown, the budget is not frozen indefinitely and the
/// payment is never made twice; if the executor disappears the goal can be handed
/// to someone else, and a late-arriving old payment is settled by that round's own
/// dedicated guarantee capital.
///
/// Two layers of identity:
///  - `G` (goal) never changes. Recipient, exact amount and business reference are
///    fixed at creation. Every retry reuses the same `G`, which is what the
///    source-chain GoalRouter uses as its at-most-once key.
///  - `E` (round) is one priced commitment: its own budget `R`, its own dedicated
///    guarantee capital `B >= R`, its own source payment deadline `T` and clearing
///    deadline `D`. A round's deadlines are immutable once opened.
///
/// Four separately tracked pools, never commingled: round principal `R`, guarantee
/// capital `B` (available vs locked), the guarantee premium `π`, and withdrawable
/// credits. `invariant()` exposes the decomposition so tests can assert that the
/// contract balance is exactly the sum of the four.
///
/// The load-bearing rule: at `D` the ownership of `R` is fixed to the operator by
/// chain-accepted time, not by who sends a transaction first. A success proof that
/// lands at or after `D` can only draw on `B`. Without that, an executor could
/// simply wait past `D` and race the operator for `R`, and the deadline promise
/// would degrade into a transaction-ordering contest.
///
/// Honest cost: if the recipient really was paid and the proof only lands after
/// `D`, the operator keeps `R` and the guarantor is out `R`. This is a priced,
/// pre-funded clearing-deadline liability, not risk-free float.
contract StateLiftGoalEscrow {
    // ---------------------------------------------------------------- identity

    /// Byte-identical to GoalRouter.GoalRef so both chains derive the same id
    /// without any cross-chain read. Asserted equal by test.
    struct GoalRef {
        uint256 ctcChainId;
        address escrow;
        address owner;
        bytes32 businessRef;
        address token;
        address recipient;
        uint256 amount;
    }

    /// The identity-bearing terms an operator supplies. Deliberately excludes
    /// anything that varies per retry.
    struct GoalTerms {
        bytes32 businessRef;
        address token;
        address recipient;
        uint256 amount;
    }

    enum GoalState {
        Absent,
        Open,
        Paid
    }

    struct Goal {
        address owner;
        GoalTerms terms;
        uint32 roundCount;
        uint32 maxRounds;
        GoalState state;
        /// Source-chain round that actually filled the goal; 0 while unknown.
        uint32 filledRound;
        /// Non-zero once a winner has actually been paid. Paid at most once, ever.
        address winnerPaid;
    }

    // ------------------------------------------------------------------ rounds

    enum RoundState {
        Absent,
        /// Not cleared. The payment may or may not have happened — the CTC side
        /// genuinely does not know, and must not pretend otherwise.
        Pending,
        /// Proven successful before D: winner paid from this round's R.
        SettledFromPrincipal,
        /// D passed without clearing: R belongs to the operator. B stays liable.
        Refunded,
        /// Proven successful at or after D: winner paid from this round's B.
        SettledFromGuarantee,
        /// Proven this round can never win: B released, R returned.
        Released
    }

    struct Round {
        bytes32 goalId;
        uint32 roundNumber;
        address guarantor;
        uint64 payBy; // T
        uint64 clearBy; // D
        uint256 principal; // R
        uint256 guarantee; // B
        uint256 premium; // pi
        RoundState state;
        /// True once R has been credited to the operator.
        bool principalReturned;
    }

    /// Terms the guarantor signs. Signing is what makes the liability voluntary
    /// and priced rather than imposed.
    struct RoundQuote {
        bytes32 goalId;
        uint32 roundNumber;
        address guarantor;
        uint64 payBy;
        uint64 clearBy;
        uint256 principal;
        uint256 guarantee;
        uint256 premium;
        uint64 acceptBefore;
        uint256 guarantorNonce;
    }

    // ------------------------------------------------------------------ storage

    GoalFillFactVerifier public immutable verifier;
    /// Minimum D - T. Stops a participant from opening a round whose clearing
    /// deadline expires while the source payment window is still open, which
    /// would let them refund at D and then pay inside T to drain B on purpose.
    uint64 public immutable minClearingWindow;
    bytes32 public immutable DOMAIN_SEPARATOR;

    bytes32 public constant ROUND_QUOTE_TYPEHASH =
        keccak256(
            "RoundQuote(bytes32 goalId,uint32 roundNumber,address guarantor,uint64 payBy,uint64 clearBy,uint256 principal,uint256 guarantee,uint256 premium,uint64 acceptBefore,uint256 guarantorNonce)"
        );

    mapping(bytes32 => Goal) private goals;
    mapping(bytes32 => Round) private rounds;

    /// Guarantee capital, split so under-collateralised quotes are impossible.
    mapping(address => uint256) public capitalAvailable;
    mapping(address => uint256) public capitalLocked;
    mapping(address => uint256) public credits;
    mapping(address => mapping(uint256 => bool)) public usedGuarantorNonce;

    /// Aggregate counters backing the four-account invariant.
    uint256 public totalPrincipalHeld;
    uint256 public totalCapitalAvailable;
    uint256 public totalCapitalLocked;
    uint256 public totalCredits;

    uint256 private entered;

    // ------------------------------------------------------------------- errors

    error Reentrancy();
    error InvalidTerms();
    error Unauthorized();
    error GoalUnknown();
    error GoalAlreadyPaid();
    error RoundUnknown();
    error RoundNotPending();
    error WrongRoundNumber();
    error PreviousRoundStillLive();
    error TooManyRounds();
    error UnderCollateralised();
    error InsufficientGuaranteeCapital();
    error WrongPayment();
    error DeadlineWindowTooShort();
    error DeadlinePassed();
    error QuoteExpired();
    error NonceUsed();
    error BadSignature();
    error NotYetClearingDeadline();
    error FactGoalMismatch();
    error FactRoundMismatch();
    error FactDeadlineMismatch();
    error FactTermsMismatch();
    error WinnerAlreadyPaid();
    error ThisRoundStillCouldWin();
    error RoundCouldStillBeFilled();
    error NothingToWithdraw();
    error TransferFailed();

    // ------------------------------------------------------------------- events

    event GoalCreated(
        bytes32 indexed goalId,
        address indexed owner,
        bytes32 businessRef,
        address token,
        address recipient,
        uint256 amount,
        uint32 maxRounds
    );
    event CapitalDeposited(address indexed guarantor, uint256 amount);
    event RoundOpened(
        bytes32 indexed goalId,
        bytes32 indexed roundId,
        uint32 indexed roundNumber,
        address guarantor,
        uint256 principal,
        uint256 guarantee,
        uint256 premium,
        uint64 payBy,
        uint64 clearBy
    );
    /// `fromGuarantee` is the whole product in one boolean: false means the proof
    /// arrived in time and the operator's budget paid; true means the operator had
    /// already recovered the budget and the guarantor covered the late payment.
    event RoundSettled(
        bytes32 indexed roundId,
        address indexed winner,
        uint256 amount,
        bool fromGuarantee,
        uint64 sourceTimestamp
    );
    event PrincipalRefunded(
        bytes32 indexed roundId,
        address indexed owner,
        uint256 amount
    );
    event GuaranteeReleased(
        bytes32 indexed roundId,
        address indexed guarantor,
        uint256 amount,
        uint32 winningRound
    );
    event CreditWithdrawn(
        address indexed account,
        address indexed to,
        uint256 amount
    );

    modifier nonReentrant() {
        if (entered != 0) revert Reentrancy();
        entered = 1;
        _;
        entered = 0;
    }

    constructor(address fillVerifier, uint64 clearingWindow) {
        if (fillVerifier == address(0) || clearingWindow == 0)
            revert InvalidTerms();
        verifier = GoalFillFactVerifier(fillVerifier);
        minClearingWindow = clearingWindow;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("StateLiftGoalEscrow"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    // ------------------------------------------------------------------ reading

    function goalIdOf(
        address owner,
        GoalTerms memory t
    ) public view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    GoalRef({
                        ctcChainId: block.chainid,
                        escrow: address(this),
                        owner: owner,
                        businessRef: t.businessRef,
                        token: t.token,
                        recipient: t.recipient,
                        amount: t.amount
                    })
                )
            );
    }

    function roundIdOf(
        bytes32 goalId,
        uint32 roundNumber
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(goalId, roundNumber));
    }

    function getGoal(bytes32 goalId) external view returns (Goal memory) {
        return goals[goalId];
    }

    function getRound(bytes32 roundId) external view returns (Round memory) {
        return rounds[roundId];
    }

    /// The four-account decomposition. `held` is round principal still escrowed,
    /// `available` + `locked` is guarantee capital, `creditsTotal` includes premium
    /// already earned by guarantors and every amount awaiting withdrawal.
    function invariant()
        external
        view
        returns (
            uint256 balance,
            uint256 held,
            uint256 available,
            uint256 locked,
            uint256 creditsTotal
        )
    {
        return (
            address(this).balance,
            totalPrincipalHeld,
            totalCapitalAvailable,
            totalCapitalLocked,
            totalCredits
        );
    }

    function roundQuoteHash(
        RoundQuote memory q
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(ROUND_QUOTE_TYPEHASH, q));
    }

    function roundQuoteDigest(
        RoundQuote memory q
    ) public view returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(hex"1901", DOMAIN_SEPARATOR, roundQuoteHash(q))
            );
    }

    // -------------------------------------------------------------------- goals

    function createGoal(
        GoalTerms calldata terms,
        uint32 maxRounds
    ) external returns (bytes32 goalId) {
        if (
            terms.businessRef == bytes32(0) ||
            terms.token == address(0) ||
            terms.recipient == address(0) ||
            terms.recipient == terms.token ||
            terms.amount == 0 ||
            maxRounds == 0 ||
            maxRounds > 64
        ) revert InvalidTerms();

        goalId = goalIdOf(msg.sender, terms);
        if (goals[goalId].state != GoalState.Absent) revert InvalidTerms();

        Goal storage g = goals[goalId];
        g.owner = msg.sender;
        g.terms = terms;
        g.maxRounds = maxRounds;
        g.state = GoalState.Open;

        emit GoalCreated(
            goalId,
            msg.sender,
            terms.businessRef,
            terms.token,
            terms.recipient,
            terms.amount,
            maxRounds
        );
    }

    // ---------------------------------------------------------- guarantee capital

    function depositCapital() external payable nonReentrant {
        if (msg.value == 0) revert WrongPayment();
        capitalAvailable[msg.sender] += msg.value;
        totalCapitalAvailable += msg.value;
        emit CapitalDeposited(msg.sender, msg.value);
    }

    /// Only unlocked capital can leave. Capital backing a live round cannot be
    /// withdrawn, which is what makes "fully funded guarantee" more than a label.
    function withdrawCapital(uint256 amount) external nonReentrant {
        if (amount == 0 || amount > capitalAvailable[msg.sender])
            revert InsufficientGuaranteeCapital();
        capitalAvailable[msg.sender] -= amount;
        totalCapitalAvailable -= amount;
        credits[msg.sender] += amount;
        totalCredits += amount;
    }

    // ------------------------------------------------------------------- rounds

    /// Opens one priced round. The operator sends `R + pi`; the guarantor's signed
    /// quote locks `B` out of their available capital.
    function openRound(
        RoundQuote calldata q,
        bytes calldata guarantorSignature
    ) external payable nonReentrant returns (bytes32 roundId) {
        Goal storage g = goals[q.goalId];
        if (g.state == GoalState.Absent) revert GoalUnknown();
        if (msg.sender != g.owner) revert Unauthorized();
        if (g.state == GoalState.Paid || g.winnerPaid != address(0))
            revert GoalAlreadyPaid();
        if (q.roundNumber != g.roundCount + 1) revert WrongRoundNumber();
        if (q.roundNumber > g.maxRounds) revert TooManyRounds();

        // The previous round must no longer be fillable on the source chain before
        // a replacement round is opened. The source-side one-shot gate already
        // makes a second payment impossible, so this is a budget-safety rail
        // rather than the correctness mechanism.
        //
        // A round already proven retired needs no wait at all: `Released` is only
        // reachable from a source-chain proof that the round can never win, which
        // is strictly stronger evidence than this chain's clock.
        if (g.roundCount != 0) {
            Round storage prev = rounds[roundIdOf(q.goalId, g.roundCount)];
            if (
                prev.state != RoundState.Released &&
                block.timestamp < prev.payBy
            ) revert PreviousRoundStillLive();
        }

        if (q.principal == 0 || q.guarantor == address(0))
            revert InvalidTerms();
        if (q.guarantee < q.principal) revert UnderCollateralised();
        if (q.payBy <= block.timestamp) revert DeadlinePassed();
        if (q.clearBy < q.payBy + minClearingWindow)
            revert DeadlineWindowTooShort();
        if (block.timestamp >= q.acceptBefore) revert QuoteExpired();
        if (msg.value != q.principal + q.premium) revert WrongPayment();
        if (capitalAvailable[q.guarantor] < q.guarantee)
            revert InsufficientGuaranteeCapital();
        if (usedGuarantorNonce[q.guarantor][q.guarantorNonce])
            revert NonceUsed();
        if (recover(roundQuoteDigest(q), guarantorSignature) != q.guarantor)
            revert BadSignature();

        usedGuarantorNonce[q.guarantor][q.guarantorNonce] = true;

        capitalAvailable[q.guarantor] -= q.guarantee;
        totalCapitalAvailable -= q.guarantee;
        capitalLocked[q.guarantor] += q.guarantee;
        totalCapitalLocked += q.guarantee;

        totalPrincipalHeld += q.principal;
        // The premium is earned at open and is not refunded by any later path.
        credits[q.guarantor] += q.premium;
        totalCredits += q.premium;

        roundId = roundIdOf(q.goalId, q.roundNumber);
        rounds[roundId] = Round({
            goalId: q.goalId,
            roundNumber: q.roundNumber,
            guarantor: q.guarantor,
            payBy: q.payBy,
            clearBy: q.clearBy,
            principal: q.principal,
            guarantee: q.guarantee,
            premium: q.premium,
            state: RoundState.Pending,
            principalReturned: false
        });
        g.roundCount = q.roundNumber;

        emit RoundOpened(
            q.goalId,
            roundId,
            q.roundNumber,
            q.guarantor,
            q.principal,
            q.guarantee,
            q.premium,
            q.payBy,
            q.clearBy
        );
    }

    /// Settles a round against an anchored source-chain fill fact. Callable by
    /// anyone: the guarantor must be able to complete this path themselves, and
    /// neither the operator nor the winner may hold the proof switch.
    function settleRound(
        bytes32 roundId,
        bytes calldata evidence
    ) external nonReentrant {
        Round storage r = rounds[roundId];
        if (r.state == RoundState.Absent) revert RoundUnknown();
        if (r.state != RoundState.Pending && r.state != RoundState.Refunded)
            revert RoundNotPending();

        Goal storage g = goals[r.goalId];
        if (g.winnerPaid != address(0)) revert WinnerAlreadyPaid();

        GoalFillFactVerifier.FillFact memory f = verifier.verifyFill(evidence);
        if (f.goalId != r.goalId) revert FactGoalMismatch();
        if (f.roundNumber != r.roundNumber) revert FactRoundMismatch();
        // The fill must have been executed against THIS round's payment deadline.
        // Without this, an executor could fill quoting a deadline of their own
        // choosing and T would not actually bind.
        if (f.payBy != r.payBy) revert FactDeadlineMismatch();
        // Defence in depth: the goal id already commits to these.
        if (f.recipient != g.terms.recipient || f.amount != g.terms.amount)
            revert FactTermsMismatch();

        // The deadline decision uses this chain's accepted time for THIS call.
        // A proof merely sitting in the inbox does not count as cleared.
        bool late = block.timestamp >= r.clearBy;

        g.state = GoalState.Paid;
        g.filledRound = f.roundNumber;
        g.winnerPaid = f.winner;

        capitalLocked[r.guarantor] -= r.guarantee;
        totalCapitalLocked -= r.guarantee;

        if (!late) {
            // Cleared in time: the operator's budget pays, guarantee is released.
            totalPrincipalHeld -= r.principal;
            credits[f.winner] += r.principal;
            totalCredits += r.principal;

            capitalAvailable[r.guarantor] += r.guarantee;
            totalCapitalAvailable += r.guarantee;
            r.state = RoundState.SettledFromPrincipal;
        } else {
            // Late: R is the operator's by deadline, so the winner is paid out of
            // this round's dedicated guarantee capital instead.
            if (!r.principalReturned) {
                r.principalReturned = true;
                totalPrincipalHeld -= r.principal;
                credits[g.owner] += r.principal;
                totalCredits += r.principal;
                emit PrincipalRefunded(roundId, g.owner, r.principal);
            }
            credits[f.winner] += r.principal;
            totalCredits += r.principal;

            uint256 remainder = r.guarantee - r.principal;
            if (remainder != 0) {
                capitalAvailable[r.guarantor] += remainder;
                totalCapitalAvailable += remainder;
            }
            r.state = RoundState.SettledFromGuarantee;
        }

        emit RoundSettled(
            roundId,
            f.winner,
            r.principal,
            late,
            f.sourceTimestamp
        );
    }

    /// Returns `R` to the operator once the clearing deadline has passed without
    /// settlement. Permissionless and always credits the operator, so calling it
    /// early or late cannot change who owns the budget.
    function claimRefund(bytes32 roundId) external nonReentrant {
        Round storage r = rounds[roundId];
        if (r.state == RoundState.Absent) revert RoundUnknown();
        if (r.state != RoundState.Pending) revert RoundNotPending();
        if (block.timestamp < r.clearBy) revert NotYetClearingDeadline();

        Goal storage g = goals[r.goalId];
        r.state = RoundState.Refunded;
        r.principalReturned = true;
        totalPrincipalHeld -= r.principal;
        credits[g.owner] += r.principal;
        totalCredits += r.principal;

        emit PrincipalRefunded(roundId, g.owner, r.principal);
    }

    /// Releases a round's guarantee capital once a fact proves a DIFFERENT round
    /// filled the goal, so this round can never win. Also returns `R` immediately,
    /// because waiting for `D` would serve no purpose once the outcome is known.
    function releaseGuaranteeByWinner(
        bytes32 roundId,
        bytes calldata evidence
    ) external nonReentrant {
        Round storage r = rounds[roundId];
        if (r.state == RoundState.Absent) revert RoundUnknown();
        if (r.state != RoundState.Pending && r.state != RoundState.Refunded)
            revert RoundNotPending();

        GoalFillFactVerifier.FillFact memory f = verifier.verifyFill(evidence);
        if (f.goalId != r.goalId) revert FactGoalMismatch();
        if (f.roundNumber == r.roundNumber) revert ThisRoundStillCouldWin();

        Goal storage g = goals[r.goalId];
        // The goal is filled on the source chain even if the winning round was
        // never registered here. Record that, but never pay an unregistered round.
        g.state = GoalState.Paid;
        g.filledRound = f.roundNumber;

        capitalLocked[r.guarantor] -= r.guarantee;
        totalCapitalLocked -= r.guarantee;
        capitalAvailable[r.guarantor] += r.guarantee;
        totalCapitalAvailable += r.guarantee;

        if (!r.principalReturned) {
            r.principalReturned = true;
            totalPrincipalHeld -= r.principal;
            credits[g.owner] += r.principal;
            totalCredits += r.principal;
            emit PrincipalRefunded(roundId, g.owner, r.principal);
        }
        r.state = RoundState.Released;

        emit GuaranteeReleased(
            roundId,
            r.guarantor,
            r.guarantee,
            f.roundNumber
        );
    }

    /// Releases a round's guarantee capital once a fact proves the goal was still
    /// unfilled at or after that round's payment deadline `T`. The round can then
    /// never be filled, so the guarantee and the budget are both freed.
    ///
    /// Unlike `releaseGuaranteeByWinner`, this does NOT close the goal: nobody has
    /// been paid, so the operator may still relay. What expires is the round `E`,
    /// not the goal `G`.
    function releaseGuaranteeByExpiry(
        bytes32 roundId,
        bytes calldata evidence
    ) external nonReentrant {
        Round storage r = rounds[roundId];
        if (r.state == RoundState.Absent) revert RoundUnknown();
        if (r.state != RoundState.Pending && r.state != RoundState.Refunded)
            revert RoundNotPending();

        GoalFillFactVerifier.UnfilledFact memory f = verifier.verifyUnfilled(
            evidence
        );
        if (f.goalId != r.goalId) revert FactGoalMismatch();
        // Before T the round could still be filled, so nothing is proven.
        if (f.sourceTimestamp < r.payBy) revert RoundCouldStillBeFilled();

        Goal storage g = goals[r.goalId];

        capitalLocked[r.guarantor] -= r.guarantee;
        totalCapitalLocked -= r.guarantee;
        capitalAvailable[r.guarantor] += r.guarantee;
        totalCapitalAvailable += r.guarantee;

        if (!r.principalReturned) {
            r.principalReturned = true;
            totalPrincipalHeld -= r.principal;
            credits[g.owner] += r.principal;
            totalCredits += r.principal;
            emit PrincipalRefunded(roundId, g.owner, r.principal);
        }
        r.state = RoundState.Released;

        emit GuaranteeReleased(roundId, r.guarantor, r.guarantee, 0);
    }

    // --------------------------------------------------------------- withdrawal

    function withdraw(address payable to) external nonReentrant {
        if (to == address(0)) revert InvalidTerms();
        uint256 amount = credits[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        credits[msg.sender] = 0;
        totalCredits -= amount;
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit CreditWithdrawn(msg.sender, to, amount);
    }

    function recover(
        bytes32 digest,
        bytes calldata signature
    ) private pure returns (address signer) {
        if (signature.length != 65) revert BadSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (
            uint256(s) >
            0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0 ||
            v < 27 ||
            v > 28
        ) revert BadSignature();
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert BadSignature();
    }
}
