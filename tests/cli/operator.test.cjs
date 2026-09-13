// Task 10: the operator CLI, exercised as a real process against real local chains.
//
// This test is the guard on the product ENTRY, not on the contracts. It runs the
// actual `cli/operator.mjs` binary the way a first-time operator would, and checks
// that the four questions in `status` stay separate and truthful at every stage of
// the acts. If these four ever collapse into one vague word, the product has lost
// the thing it exists to communicate.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(ROOT, "cli", "operator.mjs");
const STATE = path.join(ROOT, ".statelift-local", "deployment.json");

const SOURCE_PORT = 18745;
const CTC_PORT = 18746;

/// Runs one CLI command as a child process and parses its JSON payload.
function cli(args, { expectFailure = false } = {}) {
  let out;
  let failed = false;
  try {
    out = execFileSync(process.execPath, [CLI, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 240000,
    });
  } catch (e) {
    failed = true;
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  if (!expectFailure && failed)
    throw Error(`cli ${args.join(" ")} failed:\n${out}`);
  const start = out.indexOf("{");
  const json =
    start === -1 ? null : JSON.parse(out.slice(start, out.lastIndexOf("}") + 1));
  return { text: out, json, failed };
}

let daemon;

test.before(async () => {
  if (fs.existsSync(STATE))
    throw Error(
      `a local world is already running (${STATE}). Run "npm run local:down" first.`,
    );
  const { spawn } = require("node:child_process");
  daemon = spawn(
    process.execPath,
    [CLI, "up", "--source-port", String(SOURCE_PORT), "--ctc-port", String(CTC_PORT)],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  daemon.stdout.on("data", (d) => (log += d));
  daemon.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 120; i++) {
    if (fs.existsSync(STATE)) return;
    if (daemon.exitCode !== null)
      throw Error(`local world exited early:\n${log}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error(`local world did not start in time:\n${log}`);
});

test.after(async () => {
  if (daemon && daemon.exitCode === null) {
    daemon.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 1500));
    if (daemon.exitCode === null) daemon.kill("SIGKILL");
  }
  fs.rmSync(STATE, { force: true });
});

const q = (goal) => cli(["status", "--goal", goal]).json.fourSeparateQuestions;
/// Creates a goal and tops up the guarantor. Capital is topped up per test because
/// Act B permanently consumes a dedicated guarantee, so a shared pool would run dry
/// and later tests would fail for the wrong reason.
const newGoal = (ref) => {
  cli(["deposit-capital", "--amount", "40000"]);
  return cli(["create-goal", "--ref", ref]).json.goalId;
};

test("the entry explains what is being bought before any chain action", () => {
  const { text } = cli(["demo-quote"]);
  // The purchase reason must survive in the product entry, not only in a doc.
  for (const phrase of [
    "DEMO PARAMETER",
    "AT MOST ONCE",
    "R becomes yours",
    "paid from B",
    "Worst case they lose R",
    "Your own reserve fund",
    "A normal solver retry",
    "A plain timeout refunder",
  ])
    assert.ok(text.includes(phrase), `demo-quote must mention: ${phrase}`);
});

test("help names the roles and never hides the test doubles", () => {
  const { text } = cli(["help"]);
  assert.match(text, /TEST-DOUBLE/);
  assert.match(text, /not a real Attestcoin testnet integration|not a testnet integration/);
  for (const c of ["create-goal", "open-round", "pay", "prove", "settle", "refund", "release", "status", "deposit-capital", "withdraw-capital"])
    assert.ok(text.includes(c), `help must document ${c}`);
});

test("both chains agree on the goal id the moment a goal is created", () => {
  const created = cli(["create-goal", "--ref", "cli-identity"]).json;
  assert.equal(created.sourceChainDerivesSameId, true);
  assert.match(created.testDouble, /TEST-DOUBLE/);
});

test("Act A through the CLI: the four questions stay separate at every stage", () => {
  const goal = newGoal("cli-act-a");

  // Stage 1: nothing opened yet.
  let a = q(goal);
  assert.match(a["1_budgetReturnedToYou"].answer, /^no$/);
  assert.match(a["2_oldPaymentStillAwaitingProof"].answer, /^no$/);
  assert.match(a["3_canRelayOnThisSameGoal"].answer, /^yes/);
  assert.match(a["4_finalOutcomePaidExactlyOnce"].answer, /^not yet/);

  // Stage 2: round open, no payment yet.
  cli(["open-round", "--goal", goal, "--pay-in", "600", "--clear-in", "900"]);
  a = q(goal);
  assert.match(a["1_budgetReturnedToYou"].answer, /^no$/);
  assert.match(a["2_oldPaymentStillAwaitingProof"].answer, /^yes/);
  assert.match(a["3_canRelayOnThisSameGoal"].answer, /^not yet/);
  assert.match(a["4_finalOutcomePaidExactlyOnce"].answer, /^not yet/);

  // Stage 3: paid on the source chain, but nothing proven on the CTC side.
  assert.equal(cli(["pay", "--goal", goal, "--round", "1"]).json.paid, true);
  a = q(goal);
  assert.match(
    a["2_oldPaymentStillAwaitingProof"].answer,
    /genuinely does not know/,
    "the CTC side must not claim knowledge it does not have",
  );
  assert.equal(a["4_finalOutcomePaidExactlyOnce"].sourceChainFilled, true);
  assert.match(a["4_finalOutcomePaidExactlyOnce"].answer, /^not yet/);

  // Stage 4: proven but NOT settled — still not cleared.
  const proved = cli(["prove", "--goal", goal]).json;
  assert.match(proved.important, /NOT settlement/);
  a = q(goal);
  assert.match(a["4_finalOutcomePaidExactlyOnce"].answer, /^not yet/);
  assert.equal(a["4_finalOutcomePaidExactlyOnce"].winnerRewardedOnce, false);

  // Stage 5: settled before D — paid from the operator's budget.
  const settled = cli(["settle", "--goal", goal, "--round", "1"]).json;
  assert.equal(settled.roundStateAfter, "SettledFromPrincipal");
  assert.match(settled.paidFrom, /^R —/);
  a = q(goal);
  assert.match(a["1_budgetReturnedToYou"].answer, /^no$/, "the budget did its job");
  assert.match(a["3_canRelayOnThisSameGoal"].answer, /^no —/);
  assert.match(a["4_finalOutcomePaidExactlyOnce"].answer, /^yes/);
  assert.equal(a["4_finalOutcomePaidExactlyOnce"].winnerRewardedOnce, true);

  const money = cli(["status", "--goal", goal]).json.money;
  assert.equal(money.balancesReconcile, true);
});

test("Act B through the CLI: budget returned AND old payment unproven are both reported, then B pays", () => {
  const goal = newGoal("cli-act-b");
  cli(["open-round", "--goal", goal, "--pay-in", "300", "--clear-in", "600"]);
  cli(["pay", "--goal", goal, "--round", "1"]);

  // Push past D without ever settling.
  cli(["advance", "--chain", "ctc", "--seconds", "700"]);
  const refund = cli(["refund", "--goal", goal, "--round", "1"]).json;
  assert.equal(refund.roundState, "Refunded");
  assert.notEqual(refund.guaranteeStillLocked, "0");

  // The two facts that a vague status would merge are BOTH true here.
  const a = q(goal);
  assert.match(a["1_budgetReturnedToYou"].answer, /^yes/);
  assert.match(a["2_oldPaymentStillAwaitingProof"].answer, /^yes/);
  assert.match(a["4_finalOutcomePaidExactlyOnce"].answer, /^not yet/);

  // The late proof settles from the guarantee, and the budget stays with the operator.
  cli(["prove", "--goal", goal]);
  const settled = cli(["settle", "--goal", goal, "--round", "1", "--as", "guarantor"]).json;
  assert.equal(settled.roundStateAfter, "SettledFromGuarantee");
  assert.match(settled.paidFrom, /^B —/);
  assert.notEqual(settled.yourRecoveredBudget, "0");

  const after = q(goal);
  assert.match(after["1_budgetReturnedToYou"].answer, /^yes/);
  assert.match(after["4_finalOutcomePaidExactlyOnce"].answer, /^yes/);
  assert.equal(cli(["status", "--goal", goal]).json.money.balancesReconcile, true);
});

test("Act C through the CLI: a replacement payment on an already-filled goal is refused and costs nothing", () => {
  const goal = newGoal("cli-act-c");
  cli(["open-round", "--goal", goal, "--pay-in", "300", "--clear-in", "900"]);
  cli(["pay", "--goal", goal, "--round", "1", "--as", "executor"]);

  // The operator does not know the payment happened, and relays past T1.
  cli(["advance", "--chain", "ctc", "--seconds", "400"]);
  const relayable = q(goal)["3_canRelayOnThisSameGoal"].answer;
  assert.match(relayable, /^yes/);
  cli(["open-round", "--goal", goal, "--round", "2", "--pay-in", "300", "--clear-in", "900"]);

  const attempt = cli(["pay", "--goal", goal, "--round", "2", "--as", "executor2"], {
    expectFailure: true,
  });
  assert.equal(attempt.json.paid, false);
  assert.match(attempt.json.reason, /ALREADY filled/);
  assert.equal(attempt.json.recipientBalanceUnchanged, true);
  assert.match(attempt.json.note, /No tokens were spent/);
  assert.equal(attempt.json.alreadyFilledBy.roundNumber, "1");
});

test("Act C relay completes when the old executor really never paid", () => {
  const goal = newGoal("cli-act-c-vanish");
  assert.equal(q(goal)["1_budgetReturnedToYou"].recoveredCredits, "0",
    "credits from other goals must not appear as this goal's recovered budget");
  cli(["open-round", "--goal", goal, "--pay-in", "300", "--clear-in", "600"]);
  // Nobody pays. Past D, the operator recovers the budget.
  cli(["advance", "--chain", "ctc", "--seconds", "700"]);
  cli(["refund", "--goal", goal, "--round", "1"]);
  const refundedStatus = cli(["status", "--goal", goal]).json;
  assert.equal(refundedStatus.fourSeparateQuestions["1_budgetReturnedToYou"].recoveredCredits,
    refundedStatus.rounds[0].R_budget);

  // A replacement round is opened and completed by a different executor.
  cli(["open-round", "--goal", goal, "--round", "2", "--pay-in", "600", "--clear-in", "900"]);
  assert.match(q(goal)["3_canRelayOnThisSameGoal"].answer, /^not yet/,
    "the old expired round must not make the new live round relayable");
  assert.equal(
    cli(["pay", "--goal", goal, "--round", "2", "--as", "executor2"]).json.paid,
    true,
  );
  cli(["prove", "--goal", goal]);
  const settled = cli(["settle", "--goal", goal, "--round", "2"]).json;
  assert.equal(settled.roundStateAfter, "SettledFromPrincipal");

  // Round 1's guarantee unwinds against the winner fact.
  const released = cli([
    "release", "--goal", goal, "--round", "1", "--by", "winner",
  ]).json;
  assert.equal(released.roundState, "Released");
  assert.match(released.goalStillOpenForRelay, /^no/);

  const a = q(goal);
  assert.match(a["4_finalOutcomePaidExactlyOnce"].answer, /round 2/);
  assert.equal(cli(["status", "--goal", goal]).json.money.balancesReconcile, true);
});

test("expiry release retires the round but leaves the goal relayable", () => {
  const goal = newGoal("cli-expiry");
  cli(["open-round", "--goal", goal, "--pay-in", "120", "--clear-in", "900"]);
  // The two chains keep independent clocks, so the source chain has to be moved
  // past this round's T before "still unfilled" proves anything. --past-round does
  // exactly that, and reports how far it moved.
  const proved = cli([
    "prove-unfilled", "--goal", goal, "--past-round", "1",
  ]).json;
  assert.ok(proved.provenFact.stillUnfilledAtSourceTimestamp);

  const released = cli([
    "release", "--goal", goal, "--round", "1", "--by", "expiry",
  ]).json;
  assert.equal(released.roundState, "Released");
  assert.match(released.goalStillOpenForRelay, /^yes/);

  const a = q(goal);
  assert.match(a["1_budgetReturnedToYou"].answer, /^yes/);
  assert.match(
    a["3_canRelayOnThisSameGoal"].answer,
    /^yes/,
    "expiry retires the round, not the goal",
  );
  assert.match(a["4_finalOutcomePaidExactlyOnce"].answer, /^not yet/);
});

test("a guarantor can take back unlocked capital but not capital backing a live round", () => {
  const goal = newGoal("cli-capital");
  const before = cli(["status", "--goal", goal]).json.money;

  // Lock some capital behind a live round.
  cli(["open-round", "--goal", goal, "--pay-in", "600", "--clear-in", "900"]);
  const locked = cli(["status", "--goal", goal]).json.money.B_lockedAgainstRounds;
  assert.notEqual(locked, "0");

  // Unlocked capital can come back out...
  const out = cli(["withdraw-capital", "--amount", "1000"]).json;
  assert.equal(out.movedToCredits, "1000");
  assert.equal(out.stillLockedCapital, locked);

  // ...but capital backing the live round cannot.
  const tooMuch = cli(
    ["withdraw-capital", "--amount", String(BigInt(before.guaranteeCapitalAvailable) + 10n ** 9n)],
    { expectFailure: true },
  );
  assert.match(tooMuch.text, /InsufficientGuaranteeCapital/);

  // The credited amount is then genuinely withdrawable.
  const paid = cli(["withdraw", "--as", "guarantor"]).json;
  assert.ok(BigInt(paid.withdrawn) >= 1000n);
  assert.equal(cli(["status", "--goal", goal]).json.money.balancesReconcile, true);
});

test("a failing step reports the contract's actual error name", () => {
  const goal = newGoal("cli-errors");
  cli(["open-round", "--goal", goal, "--pay-in", "600", "--clear-in", "900"]);
  // Refunding before D must name the reason, not just say "reverted".
  const early = cli(["refund", "--goal", goal, "--round", "1"], {
    expectFailure: true,
  });
  assert.match(early.text, /NotYetClearingDeadline/);
});

test("status refuses to invent a deployment when the local world is down", () => {
  // Sanity: the command requires the running world, and says how to start it.
  const missing = cli(["status", "--goal", "0x" + "11".repeat(32)], {
    expectFailure: true,
  });
  assert.match(missing.text, /unknown goal|error/);
});
