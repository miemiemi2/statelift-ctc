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
  liveVerified = false;
function render() {
  const scene = scenes[position];
  $("case").textContent = scene.case;
  $("title").textContent = scene.title;
  $("story").textContent = scene.story;
  $("caption").textContent =
    scene.caption || "Recorded per-goal / per-round outcome";
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
  $("live").hidden = !scene.live;
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
        title: "The executor disappears. The payment still needs to happen.",
        story:
          "A Creditcoin operator needs to pay a supplier in Ethereum USDC. No payment proof has arrived. Keeping the budget locked blocks progress; starting a separate payment could pay twice.",
        rows: [
          [
            "Supplier payment",
            `${formatUnits(relay.terms.amount, 6)} test USDC`,
          ],
          ["Round 1 budget reserved", R],
          ["Round 1 guarantee funded in advance", B],
        ],
        meaning:
          "StateLift gives the operator a deadline to recover the budget and a safe way to continue.",
        boundary:
          "Target-customer scenario. Testnet amounts; no established customer or market quote.",
        transactions: [["Open round 1", "open-1"]],
      },
      {
        case: "Case A · Same goal, deadline reached",
        act: "relay",
        flow: relay,
        title: "Recover the budget without declaring “unpaid”.",
        story:
          "At the clearing deadline, the operator claims the round’s principal. Its guarantee remains liable while the destination chain still lacks a payment fact.",
        rows: [
          ["Round 1 budget", `${R} credited to the operator`],
          ["Round 1 guarantee", `${B} remains locked`],
          ["Meaning of the refund", "Payment outcome still unknown"],
        ],
        meaning:
          "Budget recovery does not erase responsibility for a real payment.",
        boundary:
          "Credited means withdrawable inside the escrow. This frame does not claim it has already been withdrawn or reused.",
        transactions: [["Deadline refund", "refund-1"]],
      },
      {
        case: "Case A · Same goal, replacement executor",
        act: "relay",
        flow: relay,
        title: "A new executor finishes the same payment goal.",
        story:
          "Round 2 brings its own principal, premium and guarantee. The replacement pays through the same source-chain goal. The accepted winning fact settles round 2 and releases round 1’s unused guarantee.",
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
          "Every retry shares one source-chain gate: at most one compliant payment per goal.",
        boundary:
          "The guarantee applies to executions through GoalRouter. It does not prevent unrelated direct transfers.",
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
        title: "What if the old executor had already paid?",
        story:
          "In this different case, the supplier was paid before the payment deadline, but settlement arrived after the clearing deadline. The operator keeps its recovered principal; the dedicated guarantee pays the executor.",
        rows: [
          [
            "Operator’s recovered principal",
            `${money(late.rounds["1"].principal)} retained`,
          ],
          [
            "Winner’s payment",
            `${money(late.rounds["1"].principal)} credited from this round’s guarantee`,
          ],
          [
            "Guarantor’s exposure",
            "Real principal loss, not just a temporary advance",
          ],
        ],
        meaning:
          "Refunding the operator does not leave a proven payment unpaid.",
        boundary:
          "Separate goal from Case A. The late-proof timing was deliberately exercised; it does not estimate natural late-loss probability.",
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
        title: "Silence alone cannot unlock the guarantee.",
        story:
          "This third goal was still unfilled after the round’s source payment deadline. The budget has been credited back, but a missing receipt alone cannot safely release the guarantee.",
        rows: [
          [
            "Round guarantee before expiry release",
            `${money(eb.round.guarantee)} locked`,
          ],
          ["Principal returned", money(expiry.quote.principal)],
          ["Evidence needed", "Authenticated post-deadline unfilled state"],
        ],
        meaning:
          "Attestcoin proves what happened. StateLift proves a payment hadn’t.",
        boundary:
          "The claim concerns this GoalRouter goal at an authenticated source block, not arbitrary absence.",
        transactions: [
          ["Principal refund", "refund-1"],
          ["Source header anchor", "anchor-expiry", "sepolia"],
          ["Accept authenticated root", "accept-root"],
        ],
      },
      {
        case: "Case C · Authenticated fact changes capital ownership",
        act: "expiry",
        flow: expiry,
        live: true,
        title: "Release the guarantee. Keep the goal open.",
        story:
          "The authenticated state proof shows the goal was still unfilled after the round expired. That round can no longer win, so its guarantee becomes available. A new round can still pursue the same goal.",
        rows: [
          ["Guarantee released", money(released)],
          ["Released round", "Closed to further payment liability"],
          ["Payment goal", "Still open for a new funded round"],
        ],
        meaning:
          "An absence proof changes Creditcoin funds, not just a “proof valid” label.",
        boundary:
          "Recorded outcome above. Use “Verify expiry live” below to re-run the checks through public RPC.",
        transactions: [["Release guarantee by expiry", "release-expiry"]],
      },
      {
        case: "StateLift · Funded clearing-deadline protection",
        title: "Recover the budget. Continue safely. Honor real payments.",
        story:
          "For payment operators who need a clearing deadline: keep the same goal across attempts, recover principal when the outcome is uncertain, and fund late-payment responsibility in advance.",
        rows: [
          ["Operator buys", "Budget recovery and safe same-goal handoff"],
          [
            "Guarantor provides",
            "A separately funded guarantee for each round",
          ],
          ["Proof decides", "Who owns the reserved Creditcoin funds"],
        ],
        meaning: "One payment goal. At most one compliant supplier payment.",
        boundary:
          "Testnet prototype. Guarantees carry real loss risk; sustainable pricing and customer demand remain unverified.",
        transactions: [],
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
  busy = true;
  $("verify").disabled = true;
  render();
  $("live-result").hidden = true;
  try {
    const result = await verifyFlow(
      "expiry",
      load,
      (message) => ($("live-status").textContent = message),
    );
    liveVerified = true;
    $("live-status").textContent =
      `Live verification passed · ${result.checks.length} checks · ${new Date(result.checkedAt).toLocaleString()}`;
    const locked = result.rows.find((r) => r.name === "Locked guarantee B");
    $("live-summary").textContent =
      `Public RPC: locked B ${money(locked.before)} → ${money(locked.after)} at Creditcoin block ${result.block}. Released round; goal remains Open.`;
    $("live-result").hidden = false;
  } catch (error) {
    $("live-status").textContent =
      `Live verification incomplete: ${error.shortMessage || error.message}. The recorded replay remains separate. Wait briefly and retry.`;
  } finally {
    busy = false;
    $("verify").disabled = false;
    $("verify").textContent = liveVerified
      ? "Verify expiry again"
      : "Retry live verification";
    render();
  }
};
await initialise();
