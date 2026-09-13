#!/usr/bin/env node
// StateLift operator console — local demo.
//
// This is the entry a payment operator uses. It talks to two local chains over
// JSON-RPC: a source chain (stand-in for Ethereum) and a Creditcoin-side chain.
//
// Start the local world first:   npm run local:up
// Stop it when you are done:     npm run local:down
//
// Two components in this local world are TEST DOUBLES and are labelled as such in
// every command's output: the source-chain token (MockUSDC3009, not real USDC) and
// the Attestcoin block prover (MockAttestcoinProver). This is NOT a real
// Attestcoin testnet integration and must not be reported as one.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  AbiCoder,
  Contract,
  Interface,
  JsonRpcProvider,
  ZeroAddress,
  keccak256,
  toUtf8Bytes,
} from "ethers";

const require = createRequire(import.meta.url);
const proofs = require("../lib/local/proofs.cjs");
const {
  ROOT,
  ROLES,
  compileAll,
  hdWallet,
  walletFor,
} = require("../lib/local/deployment.cjs");

const STATE_DIR = path.join(ROOT, ".statelift-local");
const DEPLOYMENT = path.join(STATE_DIR, "deployment.json");
const EVIDENCE_DIR = path.join(ROOT, "evidence", "cli");

const TEST_DOUBLE_BANNER =
  "TEST-DOUBLE: source token is MockUSDC3009 (not real USDC); " +
  "Attestcoin prover is MockAttestcoinProver. Local demo only, not a testnet integration.";

// ---------------------------------------------------------------- plumbing

function loadDeployment() {
  if (!fs.existsSync(DEPLOYMENT))
    fail(
      `no local deployment found at ${path.relative(ROOT, DEPLOYMENT)}.\n` +
        `Start the local world first:  npm run local:up`,
    );
  return JSON.parse(fs.readFileSync(DEPLOYMENT, "utf8"));
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

// ABIs are cached into the deployment record by `up`, so a normal command never
// pays the cost of running solc.
let abiCache;
function abiOf(file, name) {
  abiCache ??= loadDeployment().abis;
  const abi = abiCache?.[`${file}#${name}`];
  if (!abi)
    fail(
      `missing cached ABI for ${name}. The local world may predate this build; ` +
        `run "npm run local:down" then "npm run local:up" again.`,
    );
  return abi;
}

function connect(d) {
  // batchMaxCount: 1 — ganache does not handle ethers' JSON-RPC batching, which
  // surfaces as an opaque "could not coalesce error".
  const src = new JsonRpcProvider(d.sourceUrl, undefined, {
    staticNetwork: true,
    pollingInterval: 20,
    // batchMaxCount: 1 — ganache does not handle ethers' JSON-RPC batching.
    batchMaxCount: 1,
    // cacheTimeout: -1 — ethers caches eth_getTransactionCount for 250ms by
    // default, which hands out a stale nonce to back-to-back transactions and
    // silently lands them all at the same address.
    cacheTimeout: -1,
  });
  const ctc = new JsonRpcProvider(d.ctcUrl, undefined, {
    staticNetwork: true,
    pollingInterval: 20,
    // batchMaxCount: 1 — ganache does not handle ethers' JSON-RPC batching.
    batchMaxCount: 1,
    // cacheTimeout: -1 — ethers caches eth_getTransactionCount for 250ms by
    // default, which hands out a stale nonce to back-to-back transactions and
    // silently lands them all at the same address.
    cacheTimeout: -1,
  });
  const srcCall = (m, p) => src.send(m, p ?? []);
  const ctcCall = (m, p) => ctc.send(m, p ?? []);
  const as = (role, provider) => walletFor(role, provider);
  const escrow = (role = "prover") =>
    new Contract(
      d.contracts.escrow,
      abiOf(
        "contracts/payment/StateLiftGoalEscrow.sol",
        "StateLiftGoalEscrow",
      ),
      as(role, ctc),
    );
  const router = (role = "prover") =>
    new Contract(
      d.contracts.router,
      abiOf("contracts/source/GoalRouter.sol", "GoalRouter"),
      as(role, src),
    );
  const token = (role = "prover") =>
    new Contract(
      d.contracts.token,
      abiOf("tests/fixtures/MockUSDC3009.sol", "MockUSDC3009"),
      as(role, src),
    );
  const verifier = () =>
    new Contract(
      d.contracts.fillVerifier,
      abiOf(
        "contracts/payment/GoalFillFactVerifier.sol",
        "GoalFillFactVerifier",
      ),
      as("prover", ctc),
    );
  const inbox = () =>
    new Contract(
      d.contracts.inbox,
      abiOf("contracts/proof/RootInbox.sol", "RootInbox"),
      as("prover", ctc),
    );
  return { src, ctc, srcCall, ctcCall, escrow, router, token, verifier, inbox };
}

/// Turns an opaque "unknown custom error" into the actual contract error name, by
/// trying every interface in the deployment. Without this a failed step just says
/// "execution reverted", which is useless to an operator.
function describeError(e) {
  const data =
    e?.data ??
    e?.info?.error?.data ??
    e?.error?.data ??
    e?.info?.error?.data?.data;
  const hex = typeof data === "string" ? data : data?.data;
  if (typeof hex === "string" && hex.startsWith("0x") && hex.length >= 10) {
    for (const [file, name] of [
      ["contracts/payment/StateLiftGoalEscrow.sol", "StateLiftGoalEscrow"],
      ["contracts/payment/GoalFillFactVerifier.sol", "GoalFillFactVerifier"],
      ["contracts/proof/RootInbox.sol", "RootInbox"],
      ["contracts/proof/StateProofVerifier.sol", "StateProofVerifier"],
      ["contracts/source/GoalRouter.sol", "GoalRouter"],
      ["tests/fixtures/MockUSDC3009.sol", "MockUSDC3009"],
    ]) {
      try {
        const iface = new Interface(abiOf(file, name));
        const parsed = iface.parseError(hex);
        if (parsed) return `${parsed.name} (from ${name})`;
      } catch {}
    }
    return `unrecognised revert data ${hex.slice(0, 10)}`;
  }
  return e?.shortMessage || e?.message || String(e);
}

const flags = (argv) => {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
};

const need = (f, name) => {
  if (f[name] === undefined) fail(`missing --${name}`);
  return f[name];
};

const businessRefOf = (s) =>
  /^0x[0-9a-fA-F]{64}$/.test(s) ? s : keccak256(toUtf8Bytes(s));

const GAS = { gasLimit: 6_000_000 };

/// Sends a state-changing call, but does a read-only preflight first.
///
/// The preflight is what turns "transaction execution reverted" into the contract's
/// actual error name. It is needed because we send with an explicit gas limit (the
/// settle path costs different amounts either side of D, and estimation is
/// unreliable), which means ethers never runs estimation and never sees revert data.
async function submit(contract, method, args, overrides = GAS) {
  try {
    await contract[method].staticCall(...args, overrides);
  } catch (e) {
    fail(describeError(e));
  }
  const tx = await contract[method](...args, overrides);
  const receipt = await tx.wait();
  if (receipt.status !== 1) fail(`${method} reverted on chain`);
  return receipt;
}

function print(obj) {
  console.log(
    JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2),
  );
}

function saveEvidence(name, data) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = path.join(EVIDENCE_DIR, name);
  fs.writeFileSync(
    file,
    JSON.stringify(
      data,
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    ) + "\n",
  );
  return path.relative(ROOT, file);
}

/// Rebuilds the source-chain GoalRef from what the escrow stores, so the operator
/// never has to keep goal terms in a local file.
async function goalRefOf(d, c, goalId) {
  const g = await c.escrow().getGoal(goalId);
  if (g.state === 0n) fail(`unknown goal ${goalId}`);
  return {
    goal: g,
    ref: {
      ctcChainId: BigInt(d.ctcChainId),
      escrow: d.contracts.escrow,
      owner: g.owner,
      businessRef: g.terms.businessRef,
      token: g.terms.token,
      recipient: g.terms.recipient,
      amount: g.terms.amount,
    },
  };
}

const ROUND_STATE = [
  "Absent",
  "Pending",
  "SettledFromPrincipal",
  "Refunded",
  "SettledFromGuarantee",
  "Released",
];
const GOAL_STATE = ["Absent", "Open", "Paid"];

// ---------------------------------------------------------------- commands

const commands = {};

commands["demo-quote"] = async () => {
  console.log(`
StateLift demo quote — every number below is a DEMO PARAMETER.
Not a market price, not an existing customer, not committed liquidity.

  What you are paying for a cross-chain payment goal G:

    R  budget            5150 local units   (includes the winner's full reward)
    B  dedicated guarantee 5150 local units (B >= R, reserved for THIS round only)
    T  source pay-by      opening + 600 s   (demo; product doc uses 1800 s)
    D  clearing deadline  opening + 900 s   (demo; product doc uses 7200 s)
    pi guarantee premium    31 local units  (~0.6% of R, earned at open, never refunded)

  What you get:
    1. The same goal G is paid AT MOST ONCE, enforced on the source chain.
       So if your executor vanishes you can hand G to someone else without
       ever risking a second real payment.
    2. If nothing has cleared by D, R becomes yours by chain-accepted time.
       Not by asking anyone, and not by winning a race to send a transaction.
    3. If the old payment turns out to have happened and the proof only lands
       after D, the winner is paid from B. You keep R.

  What the guarantor is on the hook for:
    Worst case they lose R (5150) and keep only pi (31). That happens exactly when
    the recipient really was paid and the proof was late. This is a priced,
    pre-funded liability, not risk-free float.

  Not covered: purchasing power of R, wall-clock withdrawal if the CTC chain halts,
  gas already spent, pi itself, or gifts sent straight to the recipient.

  Why a simpler tool is not the same thing:
    * Your own reserve fund     -> gives you cash, does NOT make retry safe.
    * A normal solver retry     -> can swap executors, but refund timing stays
                                   at someone's discretion and late payments have
                                   no funded backstop.
    * A plain timeout refunder  -> returns money, but after the refund a late
                                   payment has no source of funds, so you still
                                   dare not relay.
`);
};

commands.up = async (f) => {
  const { startChains, deployAll } = require("../lib/local/deployment.cjs");
  const sourcePort = Number(f["source-port"] ?? 18545);
  const ctcPort = Number(f["ctc-port"] ?? 18546);
  if (fs.existsSync(DEPLOYMENT))
    fail(
      `a local deployment already exists at ${path.relative(ROOT, DEPLOYMENT)}.\n` +
        `Run "npm run local:down" first.`,
    );

  console.log("compiling contracts (done once, here only)...");
  const c = compileAll();
  console.log("starting local chains...");
  const servers = await startChains({ sourcePort, ctcPort });
  console.log("deploying...");
  const d = await deployAll({
    sourceUrl: `http://127.0.0.1:${sourcePort}`,
    ctcUrl: `http://127.0.0.1:${ctcPort}`,
    compiled: c,
  });
  d.pid = process.pid;
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(DEPLOYMENT, JSON.stringify(d, null, 2) + "\n");

  console.log("");
  console.log(TEST_DOUBLE_BANNER);
  console.log("");
  console.log(`source chain (Ethereum stand-in): ${d.sourceUrl}`);
  console.log(`creditcoin-side chain:            ${d.ctcUrl}`);
  console.log("");
  console.log("addresses:");
  for (const [role, address] of Object.entries(d.addresses))
    console.log(`  ${role.padEnd(10)} ${address}`);
  console.log("");
  console.log("contracts:");
  for (const [name, address] of Object.entries(d.contracts))
    console.log(`  ${name.padEnd(14)} ${address}`);
  console.log("");
  console.log("Local world is running. Leave this process alive.");
  console.log("In another terminal, start with:");
  console.log("  node cli/operator.mjs demo-quote");
  console.log("  node cli/operator.mjs create-goal --ref invoice-2026-0042");

  const shutdown = async () => {
    try {
      fs.rmSync(DEPLOYMENT, { force: true });
    } catch {}
    await Promise.allSettled([servers.source.close(), servers.ctc.close()]);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await new Promise(() => {});
};

commands["create-goal"] = async (f) => {
  const d = loadDeployment();
  const c = connect(d);
  const terms = {
    businessRef: businessRefOf(String(need(f, "ref"))),
    token: f.token ?? d.contracts.token,
    recipient: f.recipient ?? d.addresses.recipient,
    amount: BigInt(f.amount ?? 5_000_000_000n),
  };
  const maxRounds = Number(f["max-rounds"] ?? 8);
  const escrow = c.escrow("operator");
  await submit(escrow, "createGoal", [terms, maxRounds]);
  const goalId = await escrow.goalIdOf(d.addresses.operator, terms);
  const onSource = await c.router().goalIdOf({
    ctcChainId: BigInt(d.ctcChainId),
    escrow: d.contracts.escrow,
    owner: d.addresses.operator,
    ...terms,
  });
  print({
    testDouble: TEST_DOUBLE_BANNER,
    goalId,
    sourceChainDerivesSameId: onSource === goalId,
    owner: d.addresses.operator,
    recipient: terms.recipient,
    amount: terms.amount,
    maxRounds,
    note: "Recipient and amount are now fixed for this goal. Every retry reuses this goalId.",
  });
};

commands["deposit-capital"] = async (f) => {
  const d = loadDeployment();
  const c = connect(d);
  const amount = BigInt(need(f, "amount"));
  const escrow = c.escrow("guarantor");
  await submit(escrow, "depositCapital", [], { value: amount, ...GAS });
  print({
    guarantor: d.addresses.guarantor,
    available: await escrow.capitalAvailable(d.addresses.guarantor),
    locked: await escrow.capitalLocked(d.addresses.guarantor),
    note: "Only unlocked capital can be withdrawn. Capital backing a live round cannot.",
  });
};

commands["open-round"] = async (f) => {
  const d = loadDeployment();
  const c = connect(d);
  const goalId = need(f, "goal");
  const { goal } = await goalRefOf(d, c, goalId);
  const escrow = c.escrow("operator");

  const principal = BigInt(f.principal ?? 5150n);
  const guarantee = BigInt(f.guarantee ?? principal);
  const premium = BigInt(f.premium ?? 31n);
  const now = await proofs.blockTimestamp(c.ctcCall);
  const payBy = Number(f["pay-by"] ?? now + Number(f["pay-in"] ?? 600));
  const clearBy = Number(f["clear-by"] ?? now + Number(f["clear-in"] ?? 900));
  const roundNumber = Number(f.round ?? Number(goal.roundCount) + 1);

  const quote = {
    goalId,
    roundNumber,
    guarantor: d.addresses.guarantor,
    payBy,
    clearBy,
    principal,
    guarantee,
    premium,
    acceptBefore: now + 300,
    guarantorNonce: BigInt(f.nonce ?? Date.now()),
  };
  const signature = await walletFor("guarantor", c.ctc).signTypedData(
    {
      name: "StateLiftGoalEscrow",
      version: "1",
      chainId: d.ctcChainId,
      verifyingContract: d.contracts.escrow,
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
  await submit(escrow, "openRound", [quote, signature], {
    value: principal + premium,
    ...GAS,
  });
  const roundId = await escrow.roundIdOf(goalId, roundNumber);
  print({
    roundId,
    roundNumber,
    accepted: {
      R_budget: principal,
      B_dedicatedGuarantee: guarantee,
      pi_premium: premium,
      T_sourcePayBy: payBy,
      D_clearingDeadline: clearBy,
    },
    guarantorCapital: {
      available: await escrow.capitalAvailable(d.addresses.guarantor),
      locked: await escrow.capitalLocked(d.addresses.guarantor),
    },
    note: "All five terms are now immutable for this round.",
  });
};

commands.pay = async (f) => {
  const d = loadDeployment();
  const c = connect(d);
  const goalId = need(f, "goal");
  const { ref } = await goalRefOf(d, c, goalId);
  const escrow = c.escrow();
  const roundNumber = Number(need(f, "round"));
  const round = await escrow.getRound(await escrow.roundIdOf(goalId, roundNumber));
  if (round.state === 0n) fail(`round ${roundNumber} was never opened`);

  const role = String(f.as ?? "executor");
  const payer = walletFor(role, c.src);
  const winner = f.winner ?? payer.address;
  const payBy = Number(round.payBy);
  const validBefore = payBy + 3600;
  const nonce = await c
    .router()
    .fillNonce(goalId, roundNumber, winner, payBy);
  const signature = await payer.signTypedData(
    {
      name: "TEST-DOUBLE USD Coin",
      version: "1",
      chainId: d.sourceChainId,
      verifyingContract: d.contracts.token,
    },
    {
      ReceiveWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    {
      from: payer.address,
      to: d.contracts.router,
      value: ref.amount,
      validAfter: 0,
      validBefore,
      nonce,
    },
  );

  const before = await c.token().balanceOf(ref.recipient);
  try {
    const receipt = await (
      await c
        .router(role)
        .fill(
          ref,
          roundNumber,
          payBy,
          winner,
          { from: payer.address, validAfter: 0, validBefore, signature },
          GAS,
        )
    ).wait();
    print({
      testDouble: TEST_DOUBLE_BANNER,
      paid: true,
      sourceBlock: receipt.blockNumber,
      transactionIndex: receipt.index,
      payer: payer.address,
      winner,
      recipientBalanceBefore: before,
      recipientBalanceAfter: await c.token().balanceOf(ref.recipient),
      next: `node cli/operator.mjs prove --goal ${goalId}`,
    });
  } catch (e) {
    const filled = await c.router().fillOf(goalId);
    print({
      testDouble: TEST_DOUBLE_BANNER,
      paid: false,
      reason:
        filled.filledAt !== 0n
          ? "this goal was ALREADY filled on the source chain, so a second payment is impossible"
          : e.shortMessage || e.message,
      alreadyFilledBy:
        filled.filledAt === 0n
          ? null
          : { roundNumber: filled.roundNumber, winner: filled.winner },
      recipientBalanceUnchanged:
        (await c.token().balanceOf(ref.recipient)) === before,
      note: "No tokens were spent by this attempt. This is what makes relay safe.",
    });
    process.exitCode = 1;
  }
};

commands.prove = async (f) => {
  const d = loadDeployment();
  const c = connect(d);
  const goalId = need(f, "goal");
  const router = c.router();
  const filled = await router.fillOf(goalId);
  if (filled.filledAt === 0n)
    fail(
      "this goal has not been filled on the source chain, so there is no payment to prove.\n" +
        `If the round's T has passed you can instead run:  node cli/operator.mjs prove-unfilled --goal ${goalId}`,
    );

  const logs = await router.queryFilter(router.filters.GoalFilled(goalId));
  if (logs.length !== 1) fail(`expected one GoalFilled log, found ${logs.length}`);
  const log = logs[0];
  const block = await proofs.getBlock(c.srcCall, log.blockNumber);
  try {
    await proofs.anchorSourceBlock({
      inbox: c.inbox(),
      anchorAddress: d.contracts.headerAnchor,
      sourceChainId: d.sourceChainId,
      block,
      overrides: GAS,
    });
  } catch (e) {
    fail(`anchoring source block ${Number(BigInt(block.number))} failed: ${describeError(e)}`);
  }
  // NOTE: on an event log, `.index` is the log index within the block. The
  // receipt trie is keyed by TRANSACTION index, which is a different number.
  const txIndex = log.transactionIndex;
  const rp = await proofs.receiptProof(c.srcCall, log.blockNumber, txIndex);
  const evidence = {
    blockHash: block.hash,
    transactionIndex: txIndex,
    receiptProof: rp.proof,
  };
  const fact = await c.verifier().proveFill(evidence);
  const file = saveEvidence(`fill-${goalId.slice(0, 10)}.json`, {
    kind: "GoalFilled",
    goalId,
    evidence,
    fact: {
      goalId: fact.goalId,
      roundNumber: fact.roundNumber,
      winner: fact.winner,
      recipient: fact.recipient,
      amount: fact.amount,
      payBy: fact.payBy,
      sourceTimestamp: fact.sourceTimestamp,
    },
  });
  print({
    anchoredSourceBlock: Number(BigInt(block.number)),
    provenFact: {
      winningRound: fact.roundNumber,
      winner: fact.winner,
      amount: fact.amount,
      sourceTimestamp: fact.sourceTimestamp,
    },
    evidenceFile: file,
    important:
      "A provable fact is NOT settlement. Nothing has moved until you run settle.",
    next: `node cli/operator.mjs settle --goal ${goalId} --round ${fact.roundNumber}`,
  });
};

commands["prove-unfilled"] = async (f) => {
  const d = loadDeployment();
  const c = connect(d);
  const goalId = need(f, "goal");

  // The two chains keep independent clocks. A "still unfilled" fact only retires a
  // round if it comes from a source block at or after that round's T, so offer to
  // move the source chain there rather than letting the operator discover the
  // mismatch two commands later.
  if (f["past-round"] !== undefined) {
    const escrow = c.escrow();
    const roundNumber = Number(f["past-round"]);
    const round = await escrow.getRound(
      await escrow.roundIdOf(goalId, roundNumber),
    );
    if (round.state === 0n) fail(`round ${roundNumber} was never opened`);
    const sourceNow = await proofs.blockTimestamp(c.srcCall);
    const target = Number(round.payBy) + 1;
    if (sourceNow < target) {
      const moved = await proofs.advanceTime(c.srcCall, target - sourceNow);
      console.log(
        `# moved the source chain from ${sourceNow} to ${moved} so it is past round ${roundNumber}'s T (${round.payBy})`,
      );
    }
  }

  await c.srcCall("evm_mine");
  const latest = await proofs.latestBlock(c.srcCall);
  const number = Number(BigInt(latest.number));
  const block = await proofs.getBlock(c.srcCall, number);
  await proofs.anchorSourceBlock({
    inbox: c.inbox(),
    anchorAddress: d.contracts.headerAnchor,
    sourceChainId: d.sourceChainId,
    block,
    overrides: GAS,
  });
  const slot = await c.verifier().fillSlot(goalId);
  const sp = await proofs.stateProof(
    c.srcCall,
    d.contracts.router,
    [slot],
    number,
  );
  const evidence = {
    goalId,
    blockHash: block.hash,
    accountProof: sp.accountProof,
    slotProof: sp.storageProof[0].proof,
  };
  const fact = await c.verifier().proveUnfilled(evidence);
  const file = saveEvidence(`unfilled-${goalId.slice(0, 10)}.json`, {
    kind: "StillUnfilled",
    goalId,
    evidence,
    fact: {
      goalId: fact.goalId,
      sourceTimestamp: fact.sourceTimestamp,
      sourceHeight: fact.sourceHeight,
    },
  });
  print({
    provenFact: {
      stillUnfilledAtSourceTimestamp: fact.sourceTimestamp,
      sourceHeight: fact.sourceHeight,
    },
    evidenceFile: file,
    note:
      "Combined with a round's immutable T, a timestamp at or after T rules that round out forever. " +
      "The GOAL stays open: nobody was paid, so you can still relay.",
    next: `node cli/operator.mjs release --goal ${goalId} --round <n> --by expiry`,
  });
};

async function loadFact(goalId, kind) {
  const file = path.join(
    EVIDENCE_DIR,
    `${kind}-${goalId.slice(0, 10)}.json`,
  );
  if (!fs.existsSync(file))
    fail(
      `no ${kind} evidence for this goal yet. Run:  node cli/operator.mjs ${
        kind === "fill" ? "prove" : "prove-unfilled"
      } --goal ${goalId}`,
    );
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const coder = AbiCoder.defaultAbiCoder();
const encodeFill = (e) =>
  coder.encode(
    ["tuple(bytes32 blockHash,uint256 transactionIndex,bytes[] receiptProof)"],
    [[e.blockHash, e.transactionIndex, e.receiptProof]],
  );
const encodeUnfilled = (e) =>
  coder.encode(
    [
      "tuple(bytes32 goalId,bytes32 blockHash,bytes[] accountProof,bytes[] slotProof)",
    ],
    [[e.goalId, e.blockHash, e.accountProof, e.slotProof]],
  );

commands.settle = async (f) => {
  const d = loadDeployment();
  const c = connect(d);
  const goalId = need(f, "goal");
  const roundNumber = Number(need(f, "round"));
  const escrow = c.escrow(String(f.as ?? "prover"));
  const roundId = await escrow.roundIdOf(goalId, roundNumber);
  const saved = await loadFact(goalId, "fill");

  const before = await escrow.getRound(roundId);
  const receipt = await submit(escrow, "settleRound", [
    roundId,
    encodeFill(saved.evidence),
  ]);
  const parsed = receipt.logs
    .map((l) => {
      try {
        return escrow.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const settled = parsed.find((l) => l.name === "RoundSettled");
  print({
    roundId,
    roundStateBefore: ROUND_STATE[Number(before.state)],
    roundStateAfter: ROUND_STATE[
      Number((await escrow.getRound(roundId)).state)
    ],
    winner: settled?.args.winner,
    amountPaidToWinner: settled?.args.amount,
    paidFrom: settled?.args.fromGuarantee
      ? "B — the dedicated guarantee (the proof landed at or after D, so your budget stayed yours)"
      : "R — your budget (the proof cleared before D)",
    yourRecoveredBudget: await escrow.credits(d.addresses.operator),
    events: parsed.map((l) => l.name),
  });
};

commands.refund = async (f) => {
  const d = loadDeployment();
  const c = connect(d);
  const goalId = need(f, "goal");
  const roundNumber = Number(need(f, "round"));
  const escrow = c.escrow(String(f.as ?? "operator"));
  const roundId = await escrow.roundIdOf(goalId, roundNumber);
  await submit(escrow, "claimRefund", [roundId]);
  const round = await escrow.getRound(roundId);
  print({
    roundId,
    roundState: ROUND_STATE[Number(round.state)],
    yourRecoveredBudget: await escrow.credits(d.addresses.operator),
    guaranteeStillLocked: await escrow.capitalLocked(d.addresses.guarantor),
    note:
      "The budget is yours as of D, by chain-accepted time. The guarantee stays locked " +
      "because a payment may still turn out to have happened.",
  });
};

commands.release = async (f) => {
  const d = loadDeployment();
  const c = connect(d);
  const goalId = need(f, "goal");
  const roundNumber = Number(need(f, "round"));
  const by = String(f.by ?? "winner");
  const escrow = c.escrow(String(f.as ?? "guarantor"));
  const roundId = await escrow.roundIdOf(goalId, roundNumber);

  if (by === "expiry") {
    const saved = await loadFact(goalId, "unfilled");
    await submit(escrow, "releaseGuaranteeByExpiry", [
      roundId,
      encodeUnfilled(saved.evidence),
    ]);
  } else {
    const saved = await loadFact(goalId, "fill");
    await submit(escrow, "releaseGuaranteeByWinner", [
      roundId,
      encodeFill(saved.evidence),
    ]);
  }
  const round = await escrow.getRound(roundId);
  print({
    roundId,
    releasedBy: by,
    roundState: ROUND_STATE[Number(round.state)],
    guarantorAvailable: await escrow.capitalAvailable(d.addresses.guarantor),
    guarantorLocked: await escrow.capitalLocked(d.addresses.guarantor),
    yourRecoveredBudget: await escrow.credits(d.addresses.operator),
    goalStillOpenForRelay:
      by === "expiry"
        ? "yes — expiry retires the ROUND, not the GOAL"
        : "no — the goal was filled on the source chain",
  });
};

commands["withdraw-capital"] = async (f) => {
  const d = loadDeployment();
  const c = connect(d);
  const amount = BigInt(need(f, "amount"));
  const escrow = c.escrow("guarantor");
  // Moves unlocked capital into withdrawable credits. Capital backing a live
  // round is not unlocked and cannot be taken out.
  await submit(escrow, "withdrawCapital", [amount]);
  print({
    guarantor: d.addresses.guarantor,
    movedToCredits: amount,
    stillAvailableCapital: await escrow.capitalAvailable(d.addresses.guarantor),
    stillLockedCapital: await escrow.capitalLocked(d.addresses.guarantor),
    withdrawableCredits: await escrow.credits(d.addresses.guarantor),
    next: "node cli/operator.mjs withdraw --as guarantor",
  });
};

commands.withdraw = async (f) => {
  const d = loadDeployment();
  const c = connect(d);
  const role = String(f.as ?? "operator");
  const address = d.addresses[role] ?? fail(`unknown role ${role}`);
  const escrow = c.escrow(role);
  const amount = await escrow.credits(address);
  if (amount === 0n) fail(`${role} has nothing to withdraw`);
  await submit(escrow, "withdraw", [address]);
  print({ role, address, withdrawn: amount });
};

commands.advance = async (f) => {
  const d = loadDeployment();
  const c = connect(d);
  const chain = String(f.chain ?? "ctc");
  const seconds = Number(need(f, "seconds"));
  const call = chain === "source" ? c.srcCall : c.ctcCall;
  const after = await proofs.advanceTime(call, seconds);
  print({
    chain,
    advancedBy: seconds,
    newChainTimestamp: after,
    note: "Deadlines are judged by chain-accepted time, so this moves the chain, not a clock in this process.",
  });
};

commands.status = async (f) => {
  const d = loadDeployment();
  const c = connect(d);
  const goalId = need(f, "goal");
  const escrow = c.escrow();
  const { goal } = await goalRefOf(d, c, goalId);
  const ctcNow = await proofs.blockTimestamp(c.ctcCall);
  const fill = await c.router().fillOf(goalId);

  const rounds = [];
  for (let n = 1; n <= Number(goal.roundCount); n++) {
    const roundId = await escrow.roundIdOf(goalId, n);
    const r = await escrow.getRound(roundId);
    rounds.push({
      roundNumber: n,
      roundId,
      state: ROUND_STATE[Number(r.state)],
      R_budget: r.principal,
      B_dedicatedGuarantee: r.guarantee,
      pi_premium: r.premium,
      T_sourcePayBy: r.payBy,
      D_clearingDeadline: r.clearBy,
      pastT: ctcNow >= Number(r.payBy),
      pastD: ctcNow >= Number(r.clearBy),
      budgetReturnedToYou: r.principalReturned,
    });
  }

  const lastRound = rounds[rounds.length - 1];
  // Relay eligibility depends only on the latest still-payable round.
  const lastRoundPendingPastT =
    lastRound?.state === "Pending" && lastRound.pastT;
  const goalPaid = goal.state === 2n;
  // A retired round needs no clock wait: it was retired by a source-chain proof.
  const lastRoundRetired = lastRound?.state === "Released";

  // Four SEPARATE questions. Deliberately never merged into one status word,
  // because "budget returned" and "old payment still unproven" are both true at
  // the same time in the case this product exists to handle.
  const answers = {
    "1_budgetReturnedToYou": {
      answer: rounds.some((r) => r.budgetReturnedToYou)
        ? `yes for round(s) ${rounds
            .filter((r) => r.budgetReturnedToYou)
            .map((r) => r.roundNumber)
            .join(", ")}`
        : "no",
      // Scope recovered credits to this goal; the operator ledger is global.
      recoveredCredits: rounds.reduce(
        (sum, r) => sum + (r.budgetReturnedToYou ? r.R_budget : 0n),
        0n,
      ),
    },
    "2_oldPaymentStillAwaitingProof": {
      answer:
        rounds.some((r) => r.state === "Pending" || r.state === "Refunded") &&
        !goalPaid
          ? "yes — one or more rounds are uncleared, and the CTC side genuinely does not know whether a payment happened"
          : "no",
      unclearedRounds: rounds
        .filter((r) => r.state === "Pending" || r.state === "Refunded")
        .map((r) => r.roundNumber),
    },
    "3_canRelayOnThisSameGoal": {
      answer: goalPaid
        ? "no — this goal is already filled on the source chain"
        : Number(goal.roundCount) >= Number(goal.maxRounds)
          ? "no — the goal's round cap is reached"
          : Number(goal.roundCount) === 0 ||
              lastRoundRetired ||
              lastRoundPendingPastT ||
              lastRound?.pastT
            ? "yes — open the next round; a second real payment is impossible"
            : "not yet — wait until the current round's T has passed",
      roundsUsed: `${goal.roundCount} of ${goal.maxRounds}`,
    },
    "4_finalOutcomePaidExactlyOnce": {
      answer: goalPaid
        ? `yes — filled by round ${goal.filledRound} on the source chain`
        : "not yet — no compliant payment has been proven for this goal",
      // Spelled out because the two flags below legitimately disagree while a
      // payment has happened but has not been proven and settled here yet.
      readingThisField:
        fill.filledAt !== 0n && !goalPaid
          ? "the source chain HAS been paid, but this side has not settled it yet — " +
            "these are two different things, and telling them apart is the point of this product"
          : "the source-chain fact and this side's settlement agree",
      sourceChainFilled: fill.filledAt !== 0n,
      sourceChainWinningRound: fill.filledAt === 0n ? null : fill.roundNumber,
      winnerRewardedOnce: goal.winnerPaid !== ZeroAddress,
      rewardedWinner:
        goal.winnerPaid === ZeroAddress ? null : goal.winnerPaid,
    },
  };

  const [balance, held, available, locked, credits] = await escrow.invariant();
  print({
    testDouble: TEST_DOUBLE_BANNER,
    goalId,
    goalState: GOAL_STATE[Number(goal.state)],
    recipient: goal.terms.recipient,
    amount: goal.terms.amount,
    chainTime: { creditcoinSide: ctcNow, source: await proofs.blockTimestamp(c.srcCall) },
    fourSeparateQuestions: answers,
    rounds,
    money: {
      R_stillEscrowed: held,
      B_lockedAgainstRounds: locked,
      guaranteeCapitalAvailable: available,
      withdrawableCredits: credits,
      escrowBalance: balance,
      balancesReconcile: balance === held + available + locked + credits,
    },
  });
};

commands.help = async () => {
  console.log(`StateLift operator console (local demo)

${TEST_DOUBLE_BANNER}

Setup
  npm run local:up                      start both local chains and deploy
  npm run local:down                    stop them

Understand what you are buying
  demo-quote                            the full demo quote and what it covers

Operator
  create-goal   --ref <text> [--amount N] [--recipient 0x..] [--max-rounds N]
  open-round    --goal <id> [--principal N] [--guarantee N] [--premium N]
                              [--pay-in S] [--clear-in S] [--round N]
  refund        --goal <id> --round N   recover R once D has passed
  withdraw      [--as operator|guarantor|executor|executor2]
  status        --goal <id>             four separate questions, never merged

Guarantor
  deposit-capital  --amount N           commit underwriting capital
  withdraw-capital --amount N           take back UNLOCKED capital only
  withdraw --as guarantor               collect earned premiums

Executor
  pay           --goal <id> --round N [--as executor|executor2]

Anyone (the guarantor must be able to do these unaided)
  prove          --goal <id>            anchor + prove the source payment
  prove-unfilled --goal <id> [--past-round N]
                                        prove the goal was still unpaid; --past-round
                                        moves the source chain past that round's T
  settle         --goal <id> --round N  pay the winner from R, or from B after D
  release        --goal <id> --round N --by winner|expiry

Demo control
  advance --chain ctc|source --seconds N   move a chain's clock forward
`);
};

// ---------------------------------------------------------------- entry

const [command, ...rest] = process.argv.slice(2);
const handler = commands[command ?? "help"];
if (!handler) {
  console.error(`unknown command "${command}"\n`);
  await commands.help();
  process.exit(2);
}
try {
  await handler(flags(rest));
} catch (e) {
  fail(describeError(e));
}
