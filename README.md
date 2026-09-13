# StateLift

**Recover your budget at D. Hand off the same payment goal. Let dedicated B pay a late old obligation.**

StateLift protects a Creditcoin payment operator when an Ethereum USDC payment's outcome is uncertain. All attempts share one source-chain goal G, so replacing an executor cannot produce a second compliant payment. Each round reserves its own fully funded guarantee before accepting the operator's budget.

[中文说明](README.zh-CN.md) · [Whitepaper PDF](submission/StateLift-whitepaper.pdf) · [Technical integration](docs/TESTNET-INTEGRATION.md) · [Underwriting economics](research/underwriting-model.md) · [Competitive position](docs/COMPETITIVE-POSITION.md)

## Real testnet results

These are confirmed transactions, not mock proof-builder responses. Separate operator, guarantor, executor, replacement executor and recipient addresses were used.

| Path | Creditcoin settlement | Verified result |
|---|---|---|
| Normal payment | [0xeffe0ce3…](https://creditcoin-testnet.blockscout.com/tx/0xeffe0ce362de7e976221343f31d217ac5dcd22fcc7227f18c470e694108977b9) | Winner gains R from held principal; B unlocks |
| Payment proven late | [0x742f0927…](https://creditcoin-testnet.blockscout.com/tx/0x742f0927d6e602582725cc4d4218a80cb87a8f9f3aeee710548d6a2760d1ba20) | Operator keeps refunded R; the dedicated B pays the winner |
| Old executor never paid | [0xa532ba0a…](https://creditcoin-testnet.blockscout.com/tx/0xa532ba0a5db0d375178a71286715e332787fb2935591a07d69705a38149a35af) | R1 returned at D; executor 2 completes the same G; old B1 releases |

A second, validly signed source payment attempt was **mined and reverted**, leaving recipient and payer USDC balances unchanged: [duplicate receipt](evidence/testnet/duplicate-payment.json). All credits were subsequently withdrawn to their role wallets; gas-adjusted native balance deltas were verified and the escrow reconciled to zero: [withdrawal evidence](evidence/testnet/withdrawals.json).

The [independent audit](evidence/testnet/audit.json) re-queries historical CTC state before and after each settlement. It verifies winner credit deltas, R/B bucket changes, deadline refund deltas, source winning rounds and deployed runtime code hashes.

## Run locally

Use a current Node.js release; this run used Node 24. The first Solidity compilation takes time.

```bash
npm ci
npm run demo:three-acts
```

The self-contained demo starts two local chains, runs 49 CLI commands and checks 13 accounting snapshots. It includes **old executor never pays → R returned at D → replacement pays and settles the same G → old B released**. Local USDC and Attestcoin substitutes are explicitly labelled; local evidence is not real testnet evidence.

For individual commands:

```bash
npm run local:up
# in another terminal:
node cli/operator.mjs demo-quote
node cli/operator.mjs help
# when finished:
npm run local:down
```

The complete copyable CLI walkthrough is in [README.zh-CN.md](README.zh-CN.md). The status command keeps four distinct questions: budget returned, old payment awaiting proof, safe handoff eligibility, and proven final payment. Refunded does not mean unpaid.

## Verify the published real-chain evidence

No wallet, private key or funding is needed for this read-only command:

```bash
npm ci
node scripts/testnet-audit.mjs
```

It uses public Sepolia and Creditcoin RPCs and public evidence files. Rerunning transactions is a separate, dedicated-account workflow described in [TESTNET-INTEGRATION.md](docs/TESTNET-INTEGRATION.md). Never fund local Ganache accounts or use mainnet assets for these demos.

## Tests

```bash
npm test
```

Current full run: **107 passed, 0 failed**, in about 18 minutes on this ARM64 host. [Raw output](evidence/full-recheck.log). Tests run sequentially to avoid redundant parallel Solidity compilation pressure. Ganache's native-binding fallback is a performance warning, not by itself a failed assertion.

The suite covers source duplicate protection, actual MPT verification, normal/late/unpaid-handoff flows, malformed and mismatched facts, deadline boundaries, dedicated-capital and credit accounting, expiry proofs, CLI status truthfulness and legacy regression cases.

## Architecture and trust boundary

Sepolia GoalRouter atomically receives/forwards official USDC and permanently fills G. A real HeaderAnchor transaction binds a recent canonical payment-block hash. The official Attestcoin proof authenticates that anchor receipt; RootInbox checks its success and contents, then verifies the full block header. GoalFillFactVerifier verifies the payment receipt's MPT inclusion and exact business terms. StateLiftGoalEscrow consumes that fact to assign CTC ownership.

The balance invariant is:

**escrow balance = held R + available guarantee capital + locked per-round B + withdrawable credits.**

Premium π is credited separately at round acceptance. The winner reward is R, not R plus an undisclosed bonus. Before D the winner receives held R; at/after D the operator retains R and that round's B bears the old obligation. A fact naming the winning round releases the guarantees of other rounds of G.

| Component | Product responsibility |
|---|---|
| `contracts/source/GoalRouter.sol` | Same G, at most one compliant USDC payment |
| `contracts/payment/StateLiftGoalEscrow.sol` | R/B/π ownership, deadline recovery, late coverage, handoff |
| `contracts/payment/GoalFillFactVerifier.sol` | Exact winning-round and expiry facts |
| `contracts/proof/` | Native-proof-backed header roots and MPT verification |
| `cli/operator.mjs` | Local operator console |
| `scripts/testnet-*.mjs` | Real testnet deployment, payment, proof, settlement and audit |

Creditcoin chain ID **102031**; Sepolia chain ID **11155111**; Attestcoin source key **1**; official native verifier **0x…0FD2**. Exact endpoints, contracts, hashes and blocks are in [deployment.json](evidence/testnet/deployment.json).

## Economics and limits

R=B=0.1 tCTC, π=0.0006 tCTC and 0.1 test USDC are **demo parameters**, not an exchange rate or market quote. Short late-case deadlines deliberately trigger coverage. The observed official prover requires 32 source blocks plus attestation availability; no latency SLA is implied.

Normal root acceptance plus settlement cost 0.001109895 tCTC, above the demo premium. The deployer subsidized those transactions. With π/R=0.6%, even zero other costs cannot cover a late-loss rate at or above 0.6%. Correlated proof outages can consume many B positions together. [Per-sender gas costs](evidence/testnet/gas-costs.json).

The prototype does not prove customer demand, independent counterparties, profitable underwriting or production security. B can remain locked indefinitely without usable facts. CTC outages can prevent wall-clock withdrawals. USDC upgrades/blacklisting, source-chain assumptions, FX, executor inventory and operational availability remain risks. Failed transactions spend gas; premiums are not refunded.

ProofPay already demonstrates proof-gated cross-chain payments. StateLift's proposed difference is the combined **same-goal handoff + operator clearing deadline + funded late obligation**, not the existence of a solver, tests or an Attestcoin API call. Comparisons with index41 and CrossCredit and the remaining evidence gaps are [explicitly scoped](docs/COMPETITIVE-POSITION.md).

## Legacy isolation

`StateLiftEscrow.sol`, `StateLiftFactVerifier.sol` and their legacy tests preserve an earlier single-round research implementation. They do not implement the current product's cross-round G or dedicated late B. The old `web/` research UI is available only via `npm run legacy:web` and carries a historical label. `npm start` opens current CLI help.

[Current status](STATUS.md) · [Implementation report](IMPLEMENTATION-REPORT.md) · [Raw local demo](evidence/three-acts.md)
