import { formatEther, formatUnits } from "./vendor/ethers.js";
import { verifyFlow } from "./verify-core.mjs";
const $ = (id) => document.getElementById(id);
const load = async (path) => {
  const response = await fetch(new URL("../" + path, import.meta.url), {
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw Error(`Evidence unavailable (${response.status}): ${path}`);
  return response.json();
};
const money = (value) => `${formatEther(value)} tCTC`;
const snapshot = (flow, label) => {
  const result = flow.snapshots.find((s) => s.label === label);
  if (!result) throw Error(`Missing snapshot: ${label}`);
  return result;
};
const requireFact = (ok, name) => {
  if (!ok) throw Error(`Evidence mismatch: ${name}`);
};
let scenes = [],
  position = 0,
  busy = false,
  liveVerified = false,
  liveCache = new Map();
function render() {
  const scene = scenes[position];
  $("case").textContent = scene.case;
  $("title").textContent = scene.title;
  $("story").textContent = scene.story;
  $("caption").textContent =
    scene.caption || "Recorded state";
  $("rows").replaceChildren();
  for (const row of scene.rows) {
    const tr = document.createElement("tr");
    for (const value of row) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    }
    $("rows").append(tr);
  }
  $("meaning").textContent = scene.meaning;
  $("boundary").textContent = scene.boundary;
  $("evidence").hidden = !scene.flow;
  $("evidence").open = false;
  if (scene.flow) {
    $("goal").textContent = `Goal ID: ${scene.flow.goalId}`;
    $("links").replaceChildren();
    for (const [name, key, chain = "creditcoin"] of scene.transactions) {
      const tx = scene.flow.transactions[key];
      if (!tx?.hash) throw Error(`Missing transaction: ${key}`);
      const li = document.createElement("li"),
        a = document.createElement("a");
      a.textContent = `${name} · ${tx.hash.slice(0, 12)}…`;
      a.href = `https://${chain === "sepolia" ? "sepolia.etherscan.io" : "creditcoin-testnet.blockscout.com"}/tx/${tx.hash}`;
      a.target = "_blank";
      a.rel = "noopener";
      li.append(a);
      $("links").append(li);
    }
    const li = document.createElement("li"),
      a = document.createElement("a");
    a.href = `./verifier.html?act=${scene.act}`;
    a.textContent = "Revalidate this case against public RPC";
    a.target = "_blank";
    a.rel = "noopener";
    li.append(a);
    $("links").append(li);
  }
  const isCase = scene.act === "expiry";
  $("live").hidden = !isCase;
  $("verify").hidden = scene.act !== "expiry";
  if (isCase && !liveCache.has(scene.act))
    $("live-status").textContent =
      "Checking the recorded expiry transaction against public RPC…";
  $("step").textContent = `${position + 1} / ${scenes.length}`;
  $("back").disabled = busy || position === 0;
  $("next").disabled = busy;
  $("next").textContent =
    position === scenes.length - 1 ? "Restart demonstration" : "Next scene";
}
async function initialise() {
  $("error").hidden = true;
  $("retry").hidden = true;
  $("next").disabled = true;
  try {
    const relay = await load("evidence/testnet/flow-relay.json");
    const late = await load("evidence/testnet/flow-late.json");
    const expiry = await load("evidence/testnet/flow-expiry.json");
    const audit = await load("evidence/testnet/browser-verification.json");
    const R = money(relay.rounds["1"].principal),
      B = money(relay.rounds["1"].guarantee);
    const refund = snapshot(relay, "R1-returned-no-proof-B1-locked"),
      done = snapshot(relay, "old-B1-released-by-round-2-winner");
    requireFact(
      refund.rounds["1"].principalReturned &&
        Number(done.rounds["2"].state) === 2 &&
        Number(relay.fact.roundNumber) === 2,
      "same-goal relay",
    );
    const lateDone = snapshot(late, "after-settlement");
    requireFact(
      lateDone.rounds["1"].principalReturned &&
        Number(lateDone.rounds["1"].state) === 4,
      "late settlement from B",
    );
    const eb = snapshot(expiry, "R-returned-B-locked"),
      ea = snapshot(expiry, "B-released-by-expiry");
    const expiryAudit = audit.results.find((r) => r.act === "expiry");
    requireFact(
      expiryAudit?.passed &&
        expiryAudit.goalId === expiry.goalId &&
        expiryAudit.goalState === 1 &&
        Number(ea.round.state) === 5,
      "expiry leaves goal open",
    );
    const released = BigInt(eb.invariant[3]) - BigInt(ea.invariant[3]);
    requireFact(
      released === BigInt(expiry.quote.guarantee),
      "expiry guarantee delta",
    );
    scenes = [
      {
        case: "Case A · Same-goal handoff",
        act: "relay",
        flow: relay,
        title: "The payment proof hasn’t arrived.",
        story:
          "An operator has reserved funds on Creditcoin for a supplier payment in Ethereum USDC. Without proof of payment, those funds remain locked.",
        rows: [
          [
            "Supplier payment",
            `${formatUnits(relay.terms.amount, 6)} test USDC`,
          ],
          ["Round 1 budget reserved", R],
          ["Round 1 guarantee funded in advance", B],
        ],
        meaning:
          "The operator can recover these funds at the agreed deadline, even if the proof has not arrived.",
        boundary:
          "Illustrative supplier scenario using real testnet transactions.",
        transactions: [["Open round 1", "open-1"]],
      },
      {
        case: "Case A · Same goal, deadline reached",
        act: "relay",
        flow: relay,
        title: "The budget is now available to withdraw.",
        story:
          "The operator has claimed the reserved funds after the settlement deadline. The guarantee stays locked in case a valid payment proof arrives later.",
        rows: [
          ["Round 1 budget", `${R} credited to the operator`],
          ["Round 1 guarantee", `${B} remains locked`],
          ["Payment status", "Not yet established on Creditcoin"],
        ],
        meaning:
          "A late payment proof can still be settled from this round’s guarantee.",
        boundary:
          "The funds are available to withdraw from escrow. This record does not show a withdrawal or reuse.",
        transactions: [["Deadline refund", "refund-1"]],
      },
      {
        case: "Case A · Same goal, replacement executor",
        act: "relay",
        flow: relay,
        title: "A second executor completes the payment.",
        story:
          "The operator funds a second round, with a new guarantee and fee. A replacement executor pays the supplier under the same goal ID. Its payment proof is accepted on Creditcoin.",
        rows: [
          [
            "Source winner",
            `Round ${relay.fact.roundNumber} · ${formatUnits(relay.fact.amount, 6)} test USDC`,
          ],
          [
            "Replacement executor",
            `${money(relay.rounds["2"].principal)} credited from round 2 principal`,
          ],
          ["Round 1 guarantee", `${B} released`],
        ],
        meaning:
          "GoalRouter accepts only one compliant payment for this goal, across all rounds.",
        boundary:
          "Duplicate-payment protection covers GoalRouter payments only. Direct transfers outside the router are not covered.",
        transactions: [
          ["Replacement source payment", "pay-2", "sepolia"],
          ["Round 2 settlement", "settle"],
          ["Release old guarantee", "release-1"],
        ],
      },
      {
        case: "Case B · Separate goal / separate testnet record",
        act: "late",
        flow: late,
        title: "The payment was on time, but its proof was late.",
        story:
          "In this separate case, the executor paid the supplier on time. By the time settlement took place on Creditcoin, the operator had already recovered the budget.",
        rows: [
          [
            "Operator’s recovered principal",
            `${money(late.rounds["1"].principal)} retained`,
          ],
          [
            "Executor’s settlement credit",
            `${money(late.rounds["1"].principal)} credited from this round’s guarantee`,
          ],
          [
            "Guarantor’s exposure",
            "The guarantee can be spent in full",
          ],
        ],
        meaning:
          "The executor receives credit from this round’s guarantee. The operator’s recovered funds are not taken back.",
        boundary:
          "Separate transaction record from Case A. Proof submission was deliberately delayed for this test.",
        transactions: [
          ["Original source payment", "pay-1", "sepolia"],
          ["Operator refund", "refund-1"],
          ["Late settlement from guarantee", "settle"],
        ],
      },
      {
        case: "Case C · Separate goal / separate testnet record",
        act: "expiry",
        flow: expiry,
        title: "The guarantee is still locked after the deadline.",
        story:
          "In this third case, the operator has recovered the budget. To release the guarantee too, the contract needs proof that the goal was still unfilled after this round’s payment deadline.",
        rows: [
          [
            "Round guarantee before expiry release",
            `${money(eb.round.guarantee)} locked`,
          ],
          ["Principal returned", money(expiry.quote.principal)],
          ["Evidence needed", "Authenticated post-deadline unfilled state"],
        ],
        meaning:
          "StateLift uses an Attestcoin-authenticated block hash to verify the goal’s unfilled state.",
        boundary:
          "The proof covers this goal’s state at a specific Ethereum block after the deadline.",
        transactions: [
          ["Principal refund", "refund-1"],
          ["Source header anchor", "anchor-expiry", "sepolia"],
          ["Accept authenticated root", "accept-root"],
        ],
      },
      {
        case: "Case C · Guarantee release",
        act: "expiry",
        flow: expiry,
        live: true,
        title: "The unfilled proof releases this round’s guarantee.",
        story:
          "The contract accepts the state proof and makes this round’s guarantee available again. The expired round cannot make a valid payment.",
        rows: [
          ["Guarantee released", money(released)],
          ["Released round", "No further valid payments"],
          ["Payment goal", "Still open for a new funded round"],
        ],
        meaning:
          "The goal remains open, so a new funded round can still complete the payment.",
        boundary:
          "The table shows the recorded transaction result. The live check below revalidates it against public RPC.",
        transactions: [["Release guarantee by expiry", "release-expiry"]],
      },
      {
        case: "StateLift · Summary",
        title: "Each payment round has a deadline and its own guarantee.",
        story:
          "The operator can recover its budget at the settlement deadline and fund another attempt under the same goal. Each round’s guarantee covers a valid payment settled after that budget has been returned.",
        rows: [
          ["Operator receives", "Budget recovery at the settlement deadline"],
          [
            "Guarantor funds",
            "A separately funded guarantee for each round",
          ],
          ["Accepted proof determines", "Settlement or guarantee release"],
        ],
        meaning: "The operator pays a fee for this protection. The guarantor can lose the full guaranteed amount.",
        boundary:
          "Testnet prototype. Customer demand and sustainable guarantee pricing have not been validated.",
        transactions: [],
      },
    ];
    // The recording uses five narrative beats. Keep every recorded result and
    // transaction link, while grouping the intermediate accounting states.
    scenes = [
      {
        ...scenes[0],
        case: "Case A · Payment proof pending",
        title: "A stalled payment shouldn’t trap the budget.",
        story: "A supplier needs paying on Ethereum, but the Creditcoin contract cannot yet verify the first attempt. Waiting ties up the budget; retrying blindly risks paying twice.",
        meaning: "StateLift sets a deadline for budget recovery and keeps the same payment goal available for a later attempt.",
        rows: [...scenes[0].rows, ...scenes[1].rows],
        transactions: [[...scenes[0].transactions[0]], [...scenes[1].transactions[0]]],
      },
      {
        ...scenes[2],
        case: "Case A · Same-goal handoff",
        title: "A second executor completes the same payment goal.",
        story: "The first attempt’s budget is withdrawable after the deadline. A second executor funds a new round and pays through the same goal.",
        meaning: "The router accepts at most one compliant supplier payment for this goal, across all rounds.",
      },
      scenes[3],
      {
        ...scenes[4],
        case: "Case C · Unfilled proof and guarantee release",
        title: "The unfilled proof releases this round’s guarantee.",
        story: "The operator has recovered the budget. An authenticated state proof is needed to show that this goal was still unfilled after the deadline and release the guarantee.",
        rows: [...scenes[4].rows, ...scenes[5].rows],
        transactions: [...scenes[4].transactions, ...scenes[5].transactions],
        live: true,
        meaning: "The goal remains open for a new funded round, while this expired round cannot make a valid payment.",
      },
      {
        ...scenes[6],
        title: "Recover the budget. Keep the goal open. Cover real payments.",
      },
    ];
    position = 0;
    render();
  } catch (error) {
    $("error").hidden = false;
    $("error").textContent = `Cannot load the demonstration: ${error.message}`;
    $("retry").hidden = false;
    $("story").textContent =
      "No recorded outcome is shown until its evidence is available.";
  }
}
async function startLive(act, force = false) {
  if (!act || (!force && liveCache.has(act))) return liveCache.get(act);
  busy = true;
  render();
  const promise = (async () => {
    try {
      const result = await verifyFlow(act, load, (message) => {
        if (scenes[position]?.act === act)
          $("live-status").textContent = message;
      });
      if (scenes[position]?.act === act) {
        $("live-status").textContent =
          `Live verification passed · ${result.checks.length} checks · ${new Date(result.checkedAt).toLocaleString()}`;
        if (act === "expiry") {
          const locked = result.rows.find(
            (r) => r.name === "Locked guarantee B",
          );
          $("live-summary").textContent =
            `Public RPC: locked B ${money(locked.before)} → ${money(locked.after)} at Creditcoin block ${result.block}. Released round; goal remains Open.`;
          $("live-result").hidden = false;
        }
      }
      return result;
    } catch (error) {
      liveCache.delete(act);
      if (scenes[position]?.act === act)
        $("live-status").textContent =
          `Live verification incomplete: ${error.shortMessage || error.message}. Retry this case or use the recorded evidence.`;
      throw error;
    } finally {
      busy = false;
      render();
    }
  })();
  liveCache.set(act, promise);
  return promise;
}

$("next").onclick = () => {
  if (!busy) {
    position = (position + 1) % scenes.length;
    render();
  }
};
$("back").onclick = () => {
  if (!busy && position > 0) {
    position--;
    render();
  }
};
$("retry").onclick = initialise;
$("verify").onclick = async () => {
  if (busy) return;
  liveVerified = false;
  liveCache.delete("expiry");
  $("live-result").hidden = true;
  $("verify").textContent = "Verify expiry again";
  try {
    await startLive("expiry", true);
    liveVerified = true;
  } catch {
    /* status is rendered by startLive */
  }
};
await initialise();
