#!/usr/bin/env node
// Runs the three acts end to end through the operator CLI and writes the raw
// transcript, the state transitions and the fund-invariant checks to evidence/.
//
// Self-contained: it starts its own local world and shuts it down afterwards.
//
// Both a source chain and a Creditcoin-side chain really run; the payment really
// happens on the source chain; the CTC side really verifies Merkle-Patricia proofs
// of it. The two test doubles are the source token (MockUSDC3009) and the
// Attestcoin block prover (MockAttestcoinProver). This is NOT a testnet integration.

import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ROOT } = require("../lib/local/deployment.cjs");

const CLI = path.join(ROOT, "cli", "operator.mjs");
const STATE = path.join(ROOT, ".statelift-local", "deployment.json");
const OUT_DIR = path.join(ROOT, "evidence");
const SOURCE_PORT = 18945;
const CTC_PORT = 18946;

const transcript = [];
const transitions = [];

function run(args, { expectFailure = false } = {}) {
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
  // Drop ganache's native-binding warnings; they are noise, not results.
  const clean = out
    .split("\n")
    .filter(
      (l) =>
        !/bigint: Failed to load bindings|µWS|uws_linux|Require stack|node_modules|^- \/|Falling back to a NodeJS/.test(
          l,
        ),
    )
    .join("\n")
    .trim();
  transcript.push({
    command: `node cli/operator.mjs ${args.join(" ")}`,
    failed,
    output: clean,
  });
  if (failed && !expectFailure)
    throw Error(`command failed: ${args.join(" ")}\n${clean}`);
  if (!failed && expectFailure)
    throw Error(`command was expected to fail: ${args.join(" ")}\n${clean}`);
  const start = clean.indexOf("{");
  const json =
    start === -1
      ? null
      : JSON.parse(clean.slice(start, clean.lastIndexOf("}") + 1));
  return { text: clean, json, failed };
}

/// Records a labelled snapshot of the four questions plus the fund invariant.
function snapshot(act, label, goal) {
  const s = run(["status", "--goal", goal]).json;
  const q = s.fourSeparateQuestions;
  const entry = {
    act,
    label,
    goalState: s.goalState,
    rounds: s.rounds.map((r) => ({
      round: r.roundNumber,
      state: r.state,
      pastT: r.pastT,
      pastD: r.pastD,
      budgetReturned: r.budgetReturnedToYou,
    })),
    fourQuestions: {
      budgetReturned: q["1_budgetReturnedToYou"].answer,
      oldPaymentAwaitingProof: q["2_oldPaymentStillAwaitingProof"].answer,
      canRelay: q["3_canRelayOnThisSameGoal"].answer,
      paidExactlyOnce: q["4_finalOutcomePaidExactlyOnce"].answer,
    },
    money: s.money,
  };
  if (!s.money.balancesReconcile)
    throw Error(
      `FUND INVARIANT BROKEN at ${act} / ${label}: ${JSON.stringify(s.money)}`,
    );
  transitions.push(entry);
  console.log(
    `  [${act}] ${label}\n` +
      `      budget returned      : ${entry.fourQuestions.budgetReturned}\n` +
      `      old payment unproven : ${entry.fourQuestions.oldPaymentAwaitingProof}\n` +
      `      can relay on same G  : ${entry.fourQuestions.canRelay}\n` +
      `      paid exactly once    : ${entry.fourQuestions.paidExactlyOnce}`,
  );
  return entry;
}

const goalOf = (ref) => run(["create-goal", "--ref", ref]).json.goalId;

async function actA() {
  console.log("\n=== Act A — the ordinary case: proof clears before D ===");
  const goal = goalOf("demo-act-a");
  run(["deposit-capital", "--amount", "40000"]);
  run(["open-round", "--goal", goal, "--pay-in", "600", "--clear-in", "900"]);
  snapshot("A", "round open, nothing paid yet", goal);

  const paid = run(["pay", "--goal", goal, "--round", "1", "--as", "executor"]).json;
  if (paid.paid !== true) throw Error("Act A: the payment should have succeeded");
  snapshot("A", "paid on the source chain, nothing proven on the CTC side", goal);

  run(["prove", "--goal", goal]);
  snapshot("A", "fact provable but NOT settled", goal);

  const settled = run(["settle", "--goal", goal, "--round", "1"]).json;
  if (settled.roundStateAfter !== "SettledFromPrincipal")
    throw Error(`Act A: expected SettledFromPrincipal, got ${settled.roundStateAfter}`);
  if (!/^R —/.test(settled.paidFrom))
    throw Error("Act A: the winner must be paid from the operator's budget R");
  snapshot("A", "settled before D: winner paid from R, guarantee released", goal);
  return { goal, settled };
}

async function actB() {
  console.log("\n=== Act B — the payment happened, the proof was late ===");
  const goal = goalOf("demo-act-b");
  run(["deposit-capital", "--amount", "40000"]);
  run(["open-round", "--goal", goal, "--pay-in", "300", "--clear-in", "600"]);
  const paid = run(["pay", "--goal", goal, "--round", "1", "--as", "executor"]).json;
  if (paid.paid !== true) throw Error("Act B: the payment should have succeeded");
  snapshot("B", "paid, but the CTC side does not know it", goal);

  run(["advance", "--chain", "ctc", "--seconds", "700"]);
  const refund = run(["refund", "--goal", goal, "--round", "1"]).json;
  if (refund.roundState !== "Refunded")
    throw Error(`Act B: expected Refunded, got ${refund.roundState}`);
  if (refund.guaranteeStillLocked === "0")
    throw Error("Act B: the guarantee must stay liable after the refund");
  // The two facts a vague dashboard would merge are both true right here.
  const s = snapshot("B", "past D: budget recovered AND old payment still unproven", goal);
  if (!/^yes/.test(s.fourQuestions.budgetReturned))
    throw Error("Act B: the budget should have been returned");
  if (!/^yes/.test(s.fourQuestions.oldPaymentAwaitingProof))
    throw Error("Act B: the old payment should still be awaiting proof");

  run(["prove", "--goal", goal]);
  const settled = run([
    "settle", "--goal", goal, "--round", "1", "--as", "guarantor",
  ]).json;
  if (settled.roundStateAfter !== "SettledFromGuarantee")
    throw Error(`Act B: expected SettledFromGuarantee, got ${settled.roundStateAfter}`);
  if (!/^B —/.test(settled.paidFrom))
    throw Error("Act B: the winner must be paid from the dedicated guarantee B");
  snapshot("B", "late proof settled from B; the operator keeps R", goal);
  return { goal, settled };
}

async function actC() {
  console.log("\n=== Act C — the executor vanishes, the operator relays safely ===");
  const goal = goalOf("demo-act-c");
  run(["deposit-capital", "--amount", "40000"]);

  // C-part 1: the old payment HAD happened. The relay attempt must be refused.
  run(["open-round", "--goal", goal, "--pay-in", "300", "--clear-in", "900"]);
  run(["pay", "--goal", goal, "--round", "1", "--as", "executor"]);
  run(["advance", "--chain", "ctc", "--seconds", "400"]);
  snapshot("C", "past T1, operator does not know whether the old payment happened", goal);

  run(["open-round", "--goal", goal, "--round", "2", "--pay-in", "300", "--clear-in", "900"]);
  const attempt = run(
    ["pay", "--goal", goal, "--round", "2", "--as", "executor2"],
    { expectFailure: true },
  ).json;
  if (attempt.paid !== false)
    throw Error("Act C: the replacement payment must be refused");
  if (attempt.recipientBalanceUnchanged !== true)
    throw Error("Act C: the recipient balance must not change on a refused attempt");
  console.log(
    `      replacement payment refused: ${attempt.reason}\n` +
      `      recipient balance unchanged: ${attempt.recipientBalanceUnchanged}`,
  );
  snapshot("C", "replacement payment refused on the source chain, nothing spent", goal);

  // The late round-1 fact settles from its own guarantee; round 2 unwinds.
  run(["advance", "--chain", "ctc", "--seconds", "700"]);
  run(["refund", "--goal", goal, "--round", "1"]);
  run(["prove", "--goal", goal]);
  const settled = run([
    "settle", "--goal", goal, "--round", "1", "--as", "guarantor",
  ]).json;
  if (settled.roundStateAfter !== "SettledFromGuarantee")
    throw Error(`Act C: expected SettledFromGuarantee, got ${settled.roundStateAfter}`);
  const released = run([
    "release", "--goal", goal, "--round", "2", "--by", "winner",
  ]).json;
  if (released.roundState !== "Released")
    throw Error(`Act C: expected Released, got ${released.roundState}`);
  snapshot("C", "old round settled from its B; the relay round unwound in full", goal);

  // C-part 2: nobody paid; recover R without a proof, then complete the same G.
  console.log("\n=== Act C (continued) — nobody paid, R recovered at D, new executor finishes ===");
  const goal2 = goalOf("demo-act-c-unpaid");
  run(["open-round", "--goal", goal2, "--pay-in", "120", "--clear-in", "900"]);
  snapshot("C2", "round open, no payment", goal2);
  run(["advance", "--chain", "ctc", "--seconds", "1000"]);
  const refund = run(["refund", "--goal", goal2, "--round", "1"]).json;
  if (refund.roundState !== "Refunded") throw Error("Act C2: R must be returned at D");
  const s = snapshot("C2", "R1 returned at D without proof; B1 stays locked and G remains open", goal2);
  if (!/^yes/.test(s.fourQuestions.canRelay))
    throw Error("Act C2: relay should be possible after an expiry release");

  run(["open-round", "--goal", goal2, "--round", "2", "--pay-in", "5000", "--clear-in", "5300"]);
  const paid2 = run(["pay", "--goal", goal2, "--round", "2", "--as", "executor2"]).json;
  if (paid2.paid !== true) throw Error("Act C2: the relay payment should succeed");
  run(["prove", "--goal", goal2]);
  const settled2 = run(["settle", "--goal", goal2, "--round", "2"]).json;
  if (settled2.roundStateAfter !== "SettledFromPrincipal")
    throw Error(`Act C2: expected SettledFromPrincipal, got ${settled2.roundStateAfter}`);
  const oldReleased = run(["release", "--goal", goal2, "--round", "1", "--by", "winner"]).json;
  if (oldReleased.roundState !== "Released") throw Error("Act C2: winner fact must release old B1");
  snapshot("C2", "replacement executor completed the same goal", goal2);
  return { goal, goal2 };
}

function writeEvidence(started) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const md = [];
  md.push("# 三幕演示原始记录（自动生成）");
  md.push("");
  md.push(`生成命令: \`npm run demo:three-acts\``);
  md.push(`生成时间: ${started}`);
  md.push("");
  md.push(
    "两条本地链真实运行；付款真实发生在源链；CTC 侧真实验证该付款的 Merkle-Patricia 证明。" +
      "两个测试替身是源链代币（MockUSDC3009）与 Attestcoin 区块证明器（MockAttestcoinProver）。" +
      "**这不是真实 testnet 集成，不得当作真实 testnet 集成报告。**",
  );
  md.push("");
  md.push("## 资金不变量");
  md.push("");
  md.push(
    "每一次状态快照都断言 `escrow 余额 == 轮次本金R + 可用担保 + 锁定担保B + 可提取额度`。" +
      `本次共 ${transitions.length} 个快照，全部成立（任一不成立脚本会直接失败退出）。`,
  );
  md.push("");
  md.push("## 状态转移与四问快照");
  md.push("");
  for (const t of transitions) {
    md.push(`### [${t.act}] ${t.label}`);
    md.push("");
    md.push(`- 目标状态: \`${t.goalState}\``);
    for (const r of t.rounds)
      md.push(
        `- 轮次 ${r.round}: \`${r.state}\` (过T=${r.pastT}, 过D=${r.pastD}, 预算已归还=${r.budgetReturned})`,
      );
    md.push(`- 问1 预算是否已归还: ${t.fourQuestions.budgetReturned}`);
    md.push(`- 问2 旧付款是否待证明: ${t.fourQuestions.oldPaymentAwaitingProof}`);
    md.push(`- 问3 是否可沿同一G接手: ${t.fourQuestions.canRelay}`);
    md.push(`- 问4 最终是否只付一次: ${t.fourQuestions.paidExactlyOnce}`);
    md.push(
      `- 资金: R在押=${t.money.R_stillEscrowed}, B锁定=${t.money.B_lockedAgainstRounds}, ` +
        `担保可用=${t.money.guaranteeCapitalAvailable}, 可提取=${t.money.withdrawableCredits}, ` +
        `余额=${t.money.escrowBalance}, 对账=${t.money.balancesReconcile}`,
    );
    md.push("");
  }
  md.push("## 完整命令记录");
  md.push("");
  for (const c of transcript) {
    md.push(`### \`${c.command}\`${c.failed ? "  (预期失败)" : ""}`);
    md.push("");
    md.push("```");
    md.push(c.output);
    md.push("```");
    md.push("");
  }
  fs.writeFileSync(path.join(OUT_DIR, "three-acts.md"), md.join("\n") + "\n");
  fs.writeFileSync(
    path.join(OUT_DIR, "three-acts-transitions.json"),
    JSON.stringify({ generatedAt: started, transitions, transcript }, null, 2) + "\n",
  );
  console.log(
    `\nwrote evidence/three-acts.md and evidence/three-acts-transitions.json ` +
      `(${transitions.length} snapshots, ${transcript.length} commands)`,
  );
}

async function main() {
  if (fs.existsSync(STATE)) {
    console.error(
      `A local world is already running (${path.relative(ROOT, STATE)}).\n` +
        `Run "npm run local:down" first.`,
    );
    process.exit(1);
  }
  const started = new Date().toISOString();
  console.log("starting a local world for the demo (compiles once)...");
  const daemon = spawn(
    process.execPath,
    [CLI, "up", "--source-port", String(SOURCE_PORT), "--ctc-port", String(CTC_PORT)],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  daemon.stdout.on("data", (d) => (log += d));
  daemon.stderr.on("data", (d) => (log += d));

  const stop = async () => {
    if (daemon.exitCode === null) {
      daemon.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 1500));
      if (daemon.exitCode === null) daemon.kill("SIGKILL");
    }
    fs.rmSync(STATE, { force: true });
  };

  try {
    for (let i = 0; ; i++) {
      if (fs.existsSync(STATE)) break;
      if (daemon.exitCode !== null) throw Error(`local world exited:\n${log}`);
      if (i > 120) throw Error(`local world did not start:\n${log}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
    run(["demo-quote"]);
    await actA();
    await actB();
    await actC();
    writeEvidence(started);
    console.log("\nAll three acts completed and every fund invariant held.");
  } catch (e) {
    console.error(`\nDEMO FAILED: ${e.message}`);
    try {
      writeEvidence(started);
      console.error("partial evidence was still written");
    } catch {}
    await stop();
    process.exit(1);
  }
  await stop();
}

await main();
