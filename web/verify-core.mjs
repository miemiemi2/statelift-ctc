import {
  Contract,
  JsonRpcProvider,
  FetchRequest,
  keccak256,
} from "./vendor/ethers.js";
export const stringify = (x) =>
  JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2);
const rpc = (url) => {
  const request = new FetchRequest(url);
  request.timeout = 20000;
  request.setThrottleParams({ maxAttempts: 3, slotInterval: 1500 });
  return request;
};
export async function verifyFlow(act, load, progress = () => {}) {
  const providers = {
    creditcoin: new JsonRpcProvider(
      rpc("https://rpc.cc3-testnet.creditcoin.network"),
      102031,
      { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 },
    ),
    sepolia: new JsonRpcProvider(
      rpc("https://ethereum-sepolia-rpc.publicnode.com"),
      11155111,
      { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 },
    ),
  };
  const result = {
    act,
    checkedAt: new Date().toISOString(),
    checks: [],
    rows: [],
    scope:
      "Historical block-end states and on-chain verifier calls; RPC responses are trusted. Not a security audit.",
  };
  const check = (name, ok) => {
    result.checks.push({ name, ok: !!ok });
    if (!ok) throw Error(`Mismatch: ${name}`);
  };
  try {
    const d = await load("evidence/testnet/deployment.json"),
      a = await load("web/abi.json"),
      f = await load(`evidence/testnet/flow-${act}.json`);
    const make = (n) =>
      new Contract(
        d.contracts[n].address,
        a[n],
        providers[d.contracts[n].chain],
      );
    const escrow = make("StateLiftGoalEscrow"),
      router = make("GoalRouter"),
      verifier = make("GoalFillFactVerifier");
    for (const [chain, id] of [
      ["creditcoin", 102031],
      ["sepolia", 11155111],
    ])
      check(
        `${chain} chain ID`,
        Number(BigInt(await providers[chain].send("eth_chainId", []))) === id,
      );
    progress("Checking deployed contracts and historical balances…");
    for (const n of Object.keys(d.contracts))
      check(
        `${n} deployed code`,
        keccak256(
          await providers[d.contracts[n].chain].getCode(d.contracts[n].address),
        ) === d.contracts[n].runtimeCodeHash,
      );
    const n = act === "relay" ? 2 : 1,
      rid = await escrow.roundIdOf(f.goalId, n),
      h = f.transactions[act === "expiry" ? "release-expiry" : "settle"].hash;
    const receipt = await providers.creditcoin.getTransactionReceipt(h);
    check("Confirmed successful transaction", receipt?.status === 1);
    check(
      "Expected escrow destination",
      receipt.to.toLowerCase() ===
        d.contracts.StateLiftGoalEscrow.address.toLowerCase(),
    );
    result.hash = h;
    result.goalId = f.goalId;
    result.block = receipt.blockNumber;
    const before = { blockTag: receipt.blockNumber - 1 },
      after = { blockTag: receipt.blockNumber };
    const ib = await escrow.invariant(before),
      ia = await escrow.invariant(after),
      rb = await escrow.getRound(rid, before),
      ra = await escrow.getRound(rid, after);
    for (const inv of [ib, ia])
      check(
        "Accounting: balance = held R + available B + locked B + credits",
        inv[0] === inv[1] + inv[2] + inv[3] + inv[4],
      );
    [
      "Escrow balance",
      "Held principal R",
      "Available guarantee B",
      "Locked guarantee B",
      "Withdrawable credits",
    ].forEach((name, i) =>
      result.rows.push({ name, before: ib[i], after: ia[i] }),
    );
    const goal = await escrow.getGoal(f.goalId, after);
    if (act === "expiry") {
      progress("Revalidating the unfilled state proof…");
      const fact = await verifier.proveUnfilled(f.unfilled.evidence, after);
      check(
        "Proof names this goal and a post-T block",
        fact.goalId === f.goalId && fact.sourceTimestamp >= rb.payBy,
      );
      check(
        "Round released; goal remains open",
        (rb.state === 1n || rb.state === 3n) &&
          ra.state === 5n &&
          goal.state === 1n &&
          goal.filledRound === 0n,
      );
      check(
        "Dedicated B moved locked → available",
        ib[3] - ia[3] === rb.guarantee && ia[2] - ib[2] === rb.guarantee,
      );
      check(
        "Refund remains credited; release does not pay a winner",
        ra.principalReturned && ib[1] === ia[1] && ib[4] === ia[4],
      );
      result.proof = {
        type: "Post-T storage non-membership",
        sourceHeight: fact.sourceHeight,
        sourceTimestamp: fact.sourceTimestamp,
      };
    } else {
      progress("Revalidating the payment receipt proof…");
      const fact = await verifier.proveFill(f.evidence, after);
      const fill = await router.fillOf(f.goalId);
      check(
        "Source winner and destination agree",
        fact.goalId === f.goalId &&
          fact.roundNumber === BigInt(n) &&
          fill.roundNumber === BigInt(n) &&
          fill.winner === fact.winner &&
          goal.winnerPaid === fact.winner,
      );
      check(
        "Round settled from correct bucket",
        (rb.state === 1n || rb.state === 3n) &&
          ra.state === (act === "late" ? 4n : 2n),
      );
      const cb = await escrow.credits(fact.winner, before),
        ca = await escrow.credits(fact.winner, after);
      check("Winner credited exactly R", ca - cb === rb.principal);
      check(
        "R/B allocation matches deadline",
        ib[3] - ia[3] === rb.guarantee &&
          ib[1] - ia[1] === (act === "late" ? 0n : rb.principal) &&
          ia[2] - ib[2] ===
            (act === "late" ? rb.guarantee - rb.principal : rb.guarantee),
      );
      result.rows.push({ name: "Winner credit", before: cb, after: ca });
      result.proof = {
        type: "Payment receipt inclusion",
        sourceTimestamp: fact.sourceTimestamp,
      };
    }
    if (act !== "normal") {
      const rr = await providers.creditcoin.getTransactionReceipt(
        f.transactions["refund-1"].hash,
      );
      check("Refund receipt successful", rr?.status === 1);
      const b = await escrow.credits(goal.owner, {
          blockTag: rr.blockNumber - 1,
        }),
        c = await escrow.credits(goal.owner, { blockTag: rr.blockNumber });
      const old = await escrow.getRound(await escrow.roundIdOf(f.goalId, 1));
      check("Operator recovered round-1 R", c - b === old.principal);
      result.refund = {
        hash: rr.hash,
        block: rr.blockNumber,
        before: b,
        after: c,
      };
    }
    if (act === "relay") {
      const rr = await providers.creditcoin.getTransactionReceipt(
        f.transactions["release-1"].hash,
      );
      check("Old guarantee release confirmed", rr?.status === 1);
      const x = await escrow.invariant({ blockTag: rr.blockNumber - 1 }),
        y = await escrow.invariant({ blockTag: rr.blockNumber });
      const old = await escrow.getRound(await escrow.roundIdOf(f.goalId, 1), {
        blockTag: rr.blockNumber,
      });
      check(
        "Old B released independently",
        old.state === 5n &&
          x[3] - y[3] === old.guarantee &&
          y[2] - x[2] === old.guarantee,
      );
      result.oldRelease = { hash: rr.hash, before: [...x], after: [...y] };
    }
    result.current = { block: await providers.creditcoin.getBlockNumber() };
    result.current.buckets = [
      ...(await escrow.invariant({ blockTag: result.current.block })),
    ];
    result.roundState = Number(ra.state);
    result.goalState = Number(goal.state);
    result.passed = true;
    return JSON.parse(stringify(result));
  } finally {
    for (const p of Object.values(providers)) p.destroy();
  }
}
