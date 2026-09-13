// Shared two-chain fixture for the StateLift product path.
//
// Source chain (its own ganache): MockUSDC3009 test-double token + the real
// GoalRouter. CTC chain (a second ganache): the real proof stack
// (HeaderAnchor / RootInbox / StateProofVerifier) plus GoalFillFactVerifier and,
// once it exists, StateLiftGoalEscrow.
//
// The only test double in the trust path is MockAttestcoinProver, standing in for
// the Attestcoin native block prover. Header RLP parsing, state/storage/receipt
// MPT verification and all payment logic are the real contracts.

const { AbiCoder, keccak256, toUtf8Bytes } = require("ethers");
const { compile, environment, deploy } = require("../helpers.cjs");
const {
  MOCK_PROVER_SOURCE,
  sourceEnvironment,
  anchorSourceBlock,
  deployTo,
  fixtureSources,
  signReceiveWithAuthorization,
} = require("./source-chain.cjs");

const coder = AbiCoder.defaultAbiCoder();

const SOURCE_CHAIN_ID = 31337;
const CTC_CHAIN_ID = 1337;
const CHAIN_KEY = 3;
/// 5,000 tdUSDC at 6 decimals. Demo parameter, see PRODUCT-SLICE.md.
const AMOUNT = 5_000_000_000n;
/// Minimum D - T enforced by the escrow. Short in tests so deadlines can be
/// crossed with time travel instead of real waiting; the demo uses 5,400s.
const MIN_CLEARING_WINDOW = 60;
/// Demo quote from PRODUCT-SLICE.md, in the local chain's native unit.
const DEMO_R = 5_150n;
const DEMO_B = 5_150n;
const DEMO_PREMIUM = 31n;

const EVIDENCE_TUPLE =
  "tuple(bytes32 blockHash,uint256 transactionIndex,bytes[] receiptProof)";
const UNFILLED_TUPLE =
  "tuple(bytes32 goalId,bytes32 blockHash,bytes[] accountProof,bytes[] slotProof)";

function compileAll(extra = {}) {
  return compile({
    ...MOCK_PROVER_SOURCE,
    ...fixtureSources("MockUSDC3009.sol"),
    ...extra,
  });
}

async function twoChain(compiled) {
  const src = await sourceEnvironment({ chainId: SOURCE_CHAIN_ID });
  const ctc = await environment();

  const [srcDeployer] = src.signers;
  const [ctcDeployer] = ctc.signers;

  const token = await deployTo(
    compiled["tests/fixtures/MockUSDC3009.sol"].MockUSDC3009,
    srcDeployer,
  );
  const router = await deployTo(
    compiled["contracts/source/GoalRouter.sol"].GoalRouter,
    srcDeployer,
  );

  const prover = await deploy(
    compiled["tests/fixtures/MockAttestcoinProver.sol"].MockAttestcoinProver,
    ctcDeployer,
    [CHAIN_KEY],
  );
  const headerAnchor = await deploy(
    compiled["contracts/proof/HeaderAnchor.sol"].HeaderAnchor,
    ctcDeployer,
  );
  const inbox = await deploy(
    compiled["contracts/proof/RootInbox.sol"].RootInbox,
    ctcDeployer,
    [
      await prover.getAddress(),
      CHAIN_KEY,
      SOURCE_CHAIN_ID,
      await headerAnchor.getAddress(),
    ],
  );
  const stateVerifier = await deploy(
    compiled["contracts/proof/StateProofVerifier.sol"].StateProofVerifier,
    ctcDeployer,
    [await inbox.getAddress()],
  );
  // The verifier is pinned to the router's real deployed code hash, read off the
  // source chain. This is what makes a "still unfilled" proof meaningful.
  const routerCodeHash = (
    await src.rpc.request({
      method: "eth_getProof",
      params: [await router.getAddress(), [], "latest"],
    })
  ).codeHash;
  const fillVerifier = await deploy(
    compiled["contracts/payment/GoalFillFactVerifier.sol"].GoalFillFactVerifier,
    ctcDeployer,
    [
      await inbox.getAddress(),
      await stateVerifier.getAddress(),
      await router.getAddress(),
      routerCodeHash,
    ],
  );
  const escrow = await deploy(
    compiled["contracts/payment/StateLiftGoalEscrow.sol"].StateLiftGoalEscrow,
    ctcDeployer,
    [await fillVerifier.getAddress(), MIN_CLEARING_WINDOW],
  );

  const anchorAddress = await headerAnchor.getAddress();
  const tokenAddress = await token.getAddress();
  const routerAddress = await router.getAddress();

  /// Funds a source-chain executor with test-double tokens.
  async function fundExecutor(index, multiple = 10n) {
    await (
      await token.mintForTest(
        await src.signers[index].getAddress(),
        AMOUNT * multiple,
      )
    ).wait();
  }

  /// Builds the GoalRef that both chains must hash identically.
  async function goalRef({
    escrow,
    owner,
    businessRef = keccak256(toUtf8Bytes("invoice-2026-0042")),
    recipientIndex = 3,
    amount = AMOUNT,
  }) {
    return {
      ctcChainId: CTC_CHAIN_ID,
      escrow,
      owner,
      businessRef,
      token: tokenAddress,
      recipient: await src.signers[recipientIndex].getAddress(),
      amount,
    };
  }

  /// Executes one real fill on the source chain.
  async function executeFill({
    goal,
    roundNumber,
    payBy,
    executorIndex = 1,
    winnerIndex = executorIndex,
    validAfter = 0,
    validBefore,
  }) {
    const executor = src.signers[executorIndex];
    const from = await executor.getAddress();
    const winner = await src.signers[winnerIndex].getAddress();
    const goalId = await router.goalIdOf(goal);
    const nonce = await router.fillNonce(goalId, roundNumber, winner, payBy);
    const signature = await signReceiveWithAuthorization({
      wallet: src.wallets[executorIndex],
      token: tokenAddress,
      chainId: SOURCE_CHAIN_ID,
      from,
      to: routerAddress,
      value: goal.amount,
      validAfter,
      validBefore: validBefore ?? payBy + 3600,
      nonce,
    });
    const receipt = await (
      await router
        .connect(executor)
        .fill(goal, roundNumber, payBy, winner, {
          from,
          validAfter,
          validBefore: validBefore ?? payBy + 3600,
          signature,
        })
    ).wait();
    return { receipt, goalId, winner, payer: from };
  }

  /// Anchors the block containing a fill and packs the CTC-side evidence blob.
  async function anchorAndPack(receipt) {
    const block = await src.block(receipt.blockNumber);
    const blockHash = await anchorSourceBlock({
      inbox,
      anchorAddress,
      sourceChainId: SOURCE_CHAIN_ID,
      block,
    });
    const rp = await src.receiptProof(receipt.blockNumber, receipt.index);
    const evidence = {
      blockHash,
      transactionIndex: receipt.index,
      receiptProof: rp.proof,
    };
    return {
      block,
      blockHash,
      evidence,
      encoded: encodeEvidence(evidence),
      rawReceipt: rp.rawReceipt,
    };
  }

  /// One-shot helper: real payment on the source chain, then anchored evidence.
  async function fillAndProve(args) {
    const filled = await executeFill(args);
    const proved = await anchorAndPack(filled.receipt);
    return { ...filled, ...proved };
  }

  // ---- CTC-side helpers ----

  const escrowAddress = await escrow.getAddress();

  async function ctcNow() {
    // Read straight from the node: the ethers provider caches "latest", which
    // silently returns a stale timestamp right after time travel.
    const b = await ctc.rpc.request({
      method: "eth_getBlockByNumber",
      params: ["latest", false],
    });
    return Number(BigInt(b.timestamp));
  }

  /// Advances the CTC chain clock. Deadlines are judged by chain-accepted time,
  /// so crossing D must be done by moving the chain, never by moving a client.
  async function ctcTravel(seconds) {
    const before = await ctcNow();
    await ctc.rpc.request({ method: "evm_increaseTime", params: [seconds] });
    await ctc.rpc.request({ method: "evm_mine", params: [] });
    const after = await ctcNow();
    if (after < before + seconds)
      throw Error(
        `CTC time travel failed: ${before} + ${seconds} expected, got ${after}`,
      );
    return after;
  }

  async function srcTravel(seconds) {
    const before = await src.rpc.request({
      method: "eth_getBlockByNumber",
      params: ["latest", false],
    });
    await src.rpc.request({ method: "evm_increaseTime", params: [seconds] });
    await src.rpc.request({ method: "evm_mine", params: [] });
    const after = await src.rpc.request({
      method: "eth_getBlockByNumber",
      params: ["latest", false],
    });
    if (Number(BigInt(after.timestamp)) < Number(BigInt(before.timestamp)) + seconds)
      throw Error("source time travel failed");
    return Number(BigInt(after.timestamp));
  }

  /// Moves the CTC clock so that the NEXT mined block lands at or after `target`.
  /// Used to sit precisely on either side of a clearing deadline.
  async function ctcTravelTo(target) {
    const now = await ctcNow();
    if (now >= target) return now;
    return ctcTravel(target - now);
  }

  /// Guarantor's EIP-712 consent to underwrite one round.
  async function signQuote(quote, guarantorIndex) {
    return ctc.wallets[guarantorIndex].signTypedData(
      {
        name: "StateLiftGoalEscrow",
        version: "1",
        chainId: CTC_CHAIN_ID,
        verifyingContract: escrowAddress,
      },
      {
        RoundQuote: [
          { name: "goalId", type: "bytes32" },
          { name: "roundNumber", type: "uint32" },
          { name: "guarantor", type: "address" },
          { name: "payBy", type: "uint64" },
          { name: "clearBy", type: "uint64" },
          { name: "principal", type: "uint256" },
          { name: "guarantee", type: "uint256" },
          { name: "premium", type: "uint256" },
          { name: "acceptBefore", type: "uint64" },
          { name: "guarantorNonce", type: "uint256" },
        ],
      },
      quote,
    );
  }

  /// Creates a goal on the CTC side and returns the matching source-chain GoalRef.
  /// Asserting these two ids equal is what proves the two chains agree on identity.
  async function escrowGoal({
    ownerIndex = 1,
    businessRef = keccak256(toUtf8Bytes("invoice-2026-0042")),
    recipientIndex = 3,
    amount = AMOUNT,
    maxRounds = 8,
  } = {}) {
    const owner = ctc.signers[ownerIndex];
    const ownerAddress = await owner.getAddress();
    const terms = {
      businessRef,
      token: tokenAddress,
      recipient: await src.signers[recipientIndex].getAddress(),
      amount,
    };
    await (await escrow.connect(owner).createGoal(terms, maxRounds)).wait();
    const goalId = await escrow.goalIdOf(ownerAddress, terms);
    const ref = {
      ctcChainId: CTC_CHAIN_ID,
      escrow: escrowAddress,
      owner: ownerAddress,
      businessRef,
      token: tokenAddress,
      recipient: terms.recipient,
      amount,
    };
    return { owner, ownerAddress, terms, goalId, ref };
  }

  async function depositCapital(guarantorIndex, amount) {
    await (
      await escrow
        .connect(ctc.signers[guarantorIndex])
        .depositCapital({ value: amount })
    ).wait();
  }

  let quoteNonce = 0;

  /// Opens one round with demo-shaped terms. `payBy` / `clearBy` are CTC-chain
  /// timestamps; the same `payBy` value must be quoted on the source chain.
  async function openRound({
    goalId,
    roundNumber = 1,
    ownerIndex = 1,
    guarantorIndex = 4,
    principal = DEMO_R,
    guarantee = DEMO_B,
    premium = DEMO_PREMIUM,
    payByOffset = 600,
    clearByOffset = 600 + MIN_CLEARING_WINDOW,
    payBy,
    clearBy,
    acceptBefore,
    guarantorNonce,
  }) {
    const now = await ctcNow();
    const quote = {
      goalId,
      roundNumber,
      guarantor: await ctc.signers[guarantorIndex].getAddress(),
      payBy: payBy ?? now + payByOffset,
      clearBy: clearBy ?? now + clearByOffset,
      principal,
      guarantee,
      premium,
      acceptBefore: acceptBefore ?? now + 300,
      guarantorNonce: guarantorNonce ?? ++quoteNonce,
    };
    const signature = await signQuote(quote, guarantorIndex);
    await (
      await escrow
        .connect(ctc.signers[ownerIndex])
        .openRound(quote, signature, { value: principal + premium })
    ).wait();
    return { quote, roundId: await escrow.roundIdOf(goalId, roundNumber) };
  }

  /// Reads the four-account decomposition and asserts it sums to the balance.
  async function invariant() {
    const [balance, held, available, locked, creditsTotal] =
      await escrow.invariant();
    if (balance !== held + available + locked + creditsTotal)
      throw Error(
        `escrow invariant broken: balance ${balance} != held ${held} + available ${available} + locked ${locked} + credits ${creditsTotal}`,
      );
    return { balance, held, available, locked, creditsTotal };
  }

  /// Settles with an explicit generous gas limit.
  ///
  /// Necessary, not cosmetic: settleRound takes a cheaper branch before D and a
  /// more expensive one at/after D. ethers estimates gas against the current
  /// block and sends with no buffer, so a settlement that estimates just inside
  /// the window but mines just outside it runs out of gas and fails with no
  /// revert reason. A fixed limit keeps the test measuring the contract's
  /// behaviour rather than the estimator's timing.
  async function settle(roundId, encoded, { signerIndex = 0 } = {}) {
    const tx = await escrow
      .connect(ctc.signers[signerIndex])
      .settleRound(roundId, encoded, { gasLimit: 6_000_000 });
    return tx.wait();
  }

  async function releaseByWinner(roundId, encoded, { signerIndex = 0 } = {}) {
    const tx = await escrow
      .connect(ctc.signers[signerIndex])
      .releaseGuaranteeByWinner(roundId, encoded, { gasLimit: 6_000_000 });
    return tx.wait();
  }

  async function releaseByExpiry(roundId, encoded, { signerIndex = 0 } = {}) {
    const tx = await escrow
      .connect(ctc.signers[signerIndex])
      .releaseGuaranteeByExpiry(roundId, encoded, { gasLimit: 6_000_000 });
    return tx.wait();
  }

  /// Builds a REAL "still unfilled" proof: advances the source chain past
  /// `untilTimestamp`, mines a block, then exports the router's account proof and
  /// the (absent) fills[goalId] slot proof from that block, and anchors the header.
  async function proveUnfilledAt(goalId, untilTimestamp) {
    const current = Number(
      BigInt(
        (
          await src.rpc.request({
            method: "eth_getBlockByNumber",
            params: ["latest", false],
          })
        ).timestamp,
      ),
    );
    if (current < untilTimestamp) await srcTravel(untilTimestamp - current + 1);
    else await src.rpc.request({ method: "evm_mine", params: [] });

    const latest = await src.rpc.request({
      method: "eth_getBlockByNumber",
      params: ["latest", false],
    });
    const number = Number(BigInt(latest.number));
    const block = await src.block(number);
    const blockHash = await anchorSourceBlock({
      inbox,
      anchorAddress,
      sourceChainId: SOURCE_CHAIN_ID,
      block,
    });
    const slot = await fillVerifier.fillSlot(goalId);
    const proof = await src.stateProof(routerAddress, [slot], number);
    const evidence = {
      goalId,
      blockHash,
      accountProof: proof.accountProof,
      slotProof: proof.storageProof[0].proof,
    };
    return {
      block,
      blockHash,
      slot,
      evidence,
      encoded: encodeUnfilled(evidence),
      sourceTimestamp: Number(BigInt(block.timestamp)),
    };
  }

  return {
    src,
    ctc,
    token,
    router,
    prover,
    headerAnchor,
    inbox,
    stateVerifier,
    fillVerifier,
    escrow,
    anchorAddress,
    tokenAddress,
    routerAddress,
    fundExecutor,
    goalRef,
    executeFill,
    anchorAndPack,
    fillAndProve,
    escrowAddress,
    ctcNow,
    ctcTravel,
    ctcTravelTo,
    srcTravel,
    signQuote,
    escrowGoal,
    depositCapital,
    openRound,
    invariant,
    settle,
    releaseByWinner,
    releaseByExpiry,
    proveUnfilledAt,
    routerCodeHash,
    close: async () => {
      await Promise.all([src.close(), ctc.close()]);
    },
  };
}

function encodeEvidence(e) {
  return coder.encode(
    [EVIDENCE_TUPLE],
    [[e.blockHash, e.transactionIndex, e.receiptProof]],
  );
}

function encodeUnfilled(e) {
  return coder.encode(
    [UNFILLED_TUPLE],
    [[e.goalId, e.blockHash, e.accountProof, e.slotProof]],
  );
}

module.exports = {
  SOURCE_CHAIN_ID,
  CTC_CHAIN_ID,
  CHAIN_KEY,
  AMOUNT,
  MIN_CLEARING_WINDOW,
  DEMO_R,
  DEMO_B,
  DEMO_PREMIUM,
  EVIDENCE_TUPLE,
  UNFILLED_TUPLE,
  compileAll,
  twoChain,
  encodeEvidence,
  encodeUnfilled,
};
