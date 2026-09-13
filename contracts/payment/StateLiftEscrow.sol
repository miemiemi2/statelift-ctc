// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IFactVerifier {
    struct Fact {
        bytes32 termsHash;
        uint8 outcome;
        uint64 sourceTimestamp;
    }
    function verify(
        bytes calldata evidence
    ) external view returns (Fact memory);
}

/// @notice Local engineering implementation. No admin settlement or timeout refund path.
contract StateLiftEscrow {
    enum GoalState {
        Absent,
        Ready,
        Active,
        Paid,
        Closed,
        Exception
    }
    enum AttemptState {
        Absent,
        Active,
        Paid,
        ExpiredUnused,
        Cancelled,
        Mismatched
    }
    struct GoalInput {
        bytes32 sourceDomain;
        bytes32 manifestId;
        address token;
        address recipient;
        uint256 usdcAmount;
        uint256 principalCap;
        uint256 serviceCap;
        uint32 maxAttempts;
        bool automaticRetry;
    }
    struct Goal {
        address owner;
        bytes32 contextHash;
        GoalInput terms;
        uint256 principalAvailable;
        uint256 serviceAvailable;
        uint32 attemptCount;
        GoalState state;
        bytes32 activeAttempt;
    }
    struct Quote {
        bytes32 goalId;
        uint32 attemptNumber;
        address solver;
        address authorizer;
        uint64 validAfter;
        uint64 validBefore;
        uint64 acceptBefore;
        uint256 principal;
        uint256 serviceCap;
        uint256 proofReward;
        uint256 bond;
        uint256 nonfulfillmentPenalty;
        uint256 solverNonce;
    }
    struct Attempt {
        Quote quote;
        bytes32 termsHash;
        bytes32 sourceNonce;
        AttemptState state;
    }
    IFactVerifier public immutable verifier;
    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant QUOTE_TYPEHASH =
        keccak256(
            "Quote(bytes32 goalContextHash,bytes32 goalId,uint32 attemptNumber,address solver,address authorizer,uint64 validAfter,uint64 validBefore,uint64 acceptBefore,uint256 principal,uint256 serviceCap,uint256 proofReward,uint256 bond,uint256 nonfulfillmentPenalty,uint256 solverNonce)"
        );
    bytes32 public constant NONCE_DOMAIN =
        keccak256("StateLift.sourceNonce.v1");
    mapping(bytes32 => Goal) private goals;
    mapping(bytes32 => Attempt) private attempts;
    mapping(address => uint256) public goalNonce;
    mapping(address => mapping(uint256 => bool)) public usedQuoteNonce;
    mapping(address => uint256) public bondAvailable;
    mapping(address => uint256) public credits;
    uint256 public totalLiability;
    uint256 private entered;
    error Invalid();
    error Unauthorized();
    error Funds();
    error Reentrancy();
    error TransferFailed();
    event GoalCreated(
        bytes32 indexed goalId,
        address indexed owner,
        bytes encodedTerms,
        bytes32 contextHash
    );
    event AttemptActivated(
        bytes32 indexed goalId,
        bytes32 indexed attemptId,
        bytes32 indexed termsHash,
        bytes32 sourceNonce,
        bytes encodedQuote
    );
    event AttemptResolved(
        bytes32 indexed attemptId,
        uint8 outcome,
        uint64 sourceTimestamp,
        address proofSubmitter
    );
    event CreditWithdrawn(
        address indexed owner,
        address indexed to,
        uint256 amount
    );
    modifier nonReentrant() {
        if (entered != 0) revert Reentrancy();
        entered = 1;
        _;
        entered = 0;
    }
    constructor(address factVerifier) {
        if (factVerifier == address(0)) revert Invalid();
        verifier = IFactVerifier(factVerifier);
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("StateLift"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }
    function createGoal(
        GoalInput calldata input
    ) external payable nonReentrant returns (bytes32 id) {
        if (
            input.sourceDomain == 0 ||
            input.manifestId == 0 ||
            input.token == address(0) ||
            input.recipient == address(0) ||
            input.recipient == input.token ||
            input.usdcAmount == 0 ||
            input.principalCap == 0 ||
            input.maxAttempts == 0 ||
            input.maxAttempts > 1000
        ) revert Invalid();
        if (msg.value != input.principalCap + input.serviceCap) revert Funds();
        id = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                msg.sender,
                goalNonce[msg.sender]++
            )
        );
        Goal storage g = goals[id];
        g.owner = msg.sender;
        g.terms = input;
        g.contextHash = keccak256(
            abi.encode(block.chainid, address(this), id, msg.sender, input)
        );
        g.principalAvailable = input.principalCap;
        g.serviceAvailable = input.serviceCap;
        g.state = GoalState.Ready;
        totalLiability += msg.value;
        emit GoalCreated(id, msg.sender, abi.encode(input), g.contextHash);
    }
    function depositBond() external payable nonReentrant {
        if (msg.value == 0) revert Funds();
        bondAvailable[msg.sender] += msg.value;
        totalLiability += msg.value;
    }
    function releaseAvailableBond(uint256 amount) external nonReentrant {
        if (amount == 0 || amount > bondAvailable[msg.sender]) revert Funds();
        bondAvailable[msg.sender] -= amount;
        credits[msg.sender] += amount;
    }
    function quoteTermsHash(Quote memory q) public view returns (bytes32) {
        Goal storage g = goals[q.goalId];
        if (g.state == GoalState.Absent) revert Invalid();
        return keccak256(abi.encode(QUOTE_TYPEHASH, g.contextHash, q));
    }
    function quoteDigest(Quote memory q) public view returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(hex"1901", DOMAIN_SEPARATOR, quoteTermsHash(q))
            );
    }
    function activate(
        Quote calldata q,
        bytes calldata signature
    ) external nonReentrant returns (bytes32 attemptId) {
        Goal storage g = goals[q.goalId];
        if (
            g.state != GoalState.Ready ||
            q.attemptNumber != g.attemptCount + 1 ||
            q.attemptNumber > g.terms.maxAttempts
        ) revert Invalid();
        // First activation always requires owner; later attempts may use explicit standing authorization.
        if (
            msg.sender != g.owner &&
            !(g.attemptCount > 0 && g.terms.automaticRetry)
        ) revert Unauthorized();
        if (
            q.solver == address(0) ||
            q.authorizer == address(0) ||
            q.authorizer == g.terms.recipient ||
            q.authorizer == g.terms.token ||
            q.validBefore <= q.validAfter ||
            block.timestamp >= q.acceptBefore ||
            q.principal == 0 ||
            q.proofReward > q.serviceCap ||
            q.nonfulfillmentPenalty > q.bond
        ) revert Invalid();
        if (
            q.principal > g.principalAvailable ||
            q.serviceCap > g.serviceAvailable ||
            q.bond > bondAvailable[q.solver]
        ) revert Funds();
        if (
            usedQuoteNonce[q.solver][q.solverNonce] ||
            recover(quoteDigest(q), signature) != q.solver
        ) revert Unauthorized();
        usedQuoteNonce[q.solver][q.solverNonce] = true;
        bytes32 termsHash = quoteTermsHash(q);
        attemptId = keccak256(abi.encode(q.goalId, q.attemptNumber));
        bytes32 sourceNonce = keccak256(abi.encode(NONCE_DOMAIN, termsHash));
        attempts[attemptId] = Attempt(
            q,
            termsHash,
            sourceNonce,
            AttemptState.Active
        );
        g.principalAvailable -= q.principal;
        g.serviceAvailable -= q.serviceCap;
        bondAvailable[q.solver] -= q.bond;
        g.attemptCount = q.attemptNumber;
        g.activeAttempt = attemptId;
        g.state = GoalState.Active;
        emit AttemptActivated(
            q.goalId,
            attemptId,
            termsHash,
            sourceNonce,
            abi.encode(q)
        );
    }
    function resolve(
        bytes32 attemptId,
        bytes calldata evidence
    ) external nonReentrant {
        Attempt storage a = attempts[attemptId];
        Goal storage g = goals[a.quote.goalId];
        if (
            a.state != AttemptState.Active ||
            g.state != GoalState.Active ||
            g.activeAttempt != attemptId
        ) revert Invalid();
        IFactVerifier.Fact memory f = verifier.verify(evidence);
        if (f.termsHash != a.termsHash || f.outcome < 1 || f.outcome > 4)
            revert Invalid();
        if (
            f.outcome == 1 &&
            (f.sourceTimestamp <= a.quote.validAfter ||
                f.sourceTimestamp >= a.quote.validBefore)
        ) revert Invalid();
        if (f.outcome == 2 && f.sourceTimestamp < a.quote.validBefore)
            revert Invalid();
        g.activeAttempt = 0;
        credits[msg.sender] += a.quote.proofReward;
        g.serviceAvailable += a.quote.serviceCap - a.quote.proofReward;
        if (f.outcome == 1) {
            a.state = AttemptState.Paid;
            g.state = GoalState.Paid;
            credits[a.quote.solver] += a.quote.principal;
            bondAvailable[a.quote.solver] += a.quote.bond;
            refundAvailable(g);
        } else {
            a.state = f.outcome == 2
                ? AttemptState.ExpiredUnused
                : f.outcome == 3
                    ? AttemptState.Cancelled
                    : AttemptState.Mismatched;
            g.principalAvailable += a.quote.principal;
            bondAvailable[a.quote.solver] +=
                a.quote.bond -
                a.quote.nonfulfillmentPenalty;
            credits[g.owner] += a.quote.nonfulfillmentPenalty;
            if (f.outcome == 4) {
                g.state = GoalState.Exception;
                refundAvailable(g);
            } else if (
                g.terms.automaticRetry && g.attemptCount < g.terms.maxAttempts
            ) {
                g.state = GoalState.Ready;
            } else {
                g.state = GoalState.Closed;
                refundAvailable(g);
            }
        }
        emit AttemptResolved(
            attemptId,
            f.outcome,
            f.sourceTimestamp,
            msg.sender
        );
    }
    function closeReadyGoal(bytes32 id) external nonReentrant {
        Goal storage g = goals[id];
        if (msg.sender != g.owner || g.state != GoalState.Ready)
            revert Unauthorized();
        g.state = GoalState.Closed;
        refundAvailable(g);
    }
    function refundAvailable(Goal storage g) private {
        credits[g.owner] += g.principalAvailable + g.serviceAvailable;
        g.principalAvailable = 0;
        g.serviceAvailable = 0;
    }
    function withdraw(address payable to) external nonReentrant {
        if (to == address(0)) revert Invalid();
        uint256 amount = credits[msg.sender];
        if (amount == 0) revert Funds();
        credits[msg.sender] = 0;
        totalLiability -= amount;
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit CreditWithdrawn(msg.sender, to, amount);
    }
    function getGoal(bytes32 id) external view returns (Goal memory) {
        return goals[id];
    }
    function getAttempt(bytes32 id) external view returns (Attempt memory) {
        return attempts[id];
    }
    function recover(
        bytes32 digest,
        bytes calldata signature
    ) private pure returns (address signer) {
        if (signature.length != 65) revert Unauthorized();
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
        ) revert Unauthorized();
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert Unauthorized();
    }
}
