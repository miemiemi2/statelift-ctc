import { verifyFlow, stringify } from "./verify-core.mjs";
import { formatEther } from "./vendor/ethers.js";
const $ = (id) => document.getElementById(id);
const load = async (path) => {
  const r = await fetch(new URL("../" + path, import.meta.url), {
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw Error(`Cannot load ${path} (${r.status})`);
  return r.json();
};
for (const button of document.querySelectorAll("[data-act]"))
  button.onclick = () => {
    $("query").value = button.dataset.act;
  };
$("form").onsubmit = async (event) => {
  event.preventDefault();
  const buttons = [...document.querySelectorAll("button")];
  buttons.forEach((b) => (b.disabled = true));
  $("result").hidden = true;
  $("status").textContent = "Loading published evidence…";
  try {
    const query = $("query").value.trim().toLowerCase();
    const acts = ["expiry", "normal", "late", "relay"];
    let act = acts.includes(query) ? query : null;
    if (!act && /^0x[0-9a-f]{64}$/.test(query))
      for (const candidate of acts) {
        const f = await load(`evidence/testnet/flow-${candidate}.json`);
        if (
          f.goalId.toLowerCase() === query ||
          Object.values(f.transactions).some(
            (t) => t.hash?.toLowerCase() === query,
          )
        ) {
          act = candidate;
          break;
        }
      }
    if (!act)
      throw Error(
        "Enter expiry, normal, late, relay, or a transaction hash / goal ID from one of those published flows.",
      );
    const r = await verifyFlow(
      act,
      load,
      (message) => ($("status").textContent = message),
    );
    $("headline").textContent =
      act === "expiry"
        ? "Guarantee released. Goal still open."
        : act === "late"
          ? "Late winner paid from dedicated guarantee."
          : act === "relay"
            ? "Second executor paid. Old guarantee released."
            : "Winner paid from reserved principal.";
    $("identity").textContent =
      `${r.proof.type} · Creditcoin block ${r.block} · Goal ${r.goalId}`;
    $("explorer").href =
      `https://creditcoin-testnet.blockscout.com/tx/${r.hash}`;
    $("balances").replaceChildren();
    for (const row of r.rows) {
      const tr = document.createElement("tr");
      for (const value of [
        row.name,
        formatEther(row.before),
        formatEther(row.after),
        formatEther(BigInt(row.after) - BigInt(row.before)),
      ]) {
        const td = document.createElement("td");
        td.textContent = value;
        tr.append(td);
      }
      $("balances").append(tr);
    }
    $("checks").replaceChildren();
    for (const check of r.checks) {
      const li = document.createElement("li");
      li.textContent = `Passed — ${check.name}`;
      $("checks").append(li);
    }
    $("raw").textContent = stringify(r);
    $("result").hidden = false;
    $("status").textContent =
      `Verified ${r.checks.length} checks at ${new Date(r.checkedAt).toLocaleString()}.`;
  } catch (error) {
    $("status").textContent =
      `Verification incomplete: ${error.shortMessage || error.message}. If RPC is unavailable or rate-limited, wait briefly and retry.`;
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
};
