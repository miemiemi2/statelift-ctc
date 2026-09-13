# StateLift

**Recover a cross-chain payment budget without declaring the payment failed.**

A cross-chain payment may already have happened while its proof is still missing. StateLift lets a Creditcoin operator recover the reserved budget at a clearing deadline while keeping the real payment obligation covered until authenticated Ethereum evidence resolves the outcome.

If the first attempt did not pay, the same payment goal stays open for another executor. If it paid before the deadline but the proof arrives late, that attempt’s prefunded guarantee settles the executor without clawing back the operator’s refund.

**Attestcoin is part of the settlement path:** authenticated Ethereum payment and historical state evidence directly determine Creditcoin settlement and guarantee release.

[Open the demo](https://miemiemi2.github.io/statelift-ctc/web/demo.html) · [Verify published testnet evidence](https://miemiemi2.github.io/statelift-ctc/web/verifier.html) · [Whitepaper PDF](submission/StateLift-whitepaper.pdf) · [Technical integration](docs/TESTNET-INTEGRATION.md) · [中文说明](README.zh-CN.md)


## Real testnet results

| Path | Creditcoin settlement | Verified result |
|---|---|---|
| Same-goal handoff | [0xa532ba0a…](https://creditcoin-testnet.blockscout.com/tx/0xa532ba0a5db0d375178a71286715e332787fb2935591a07d69705a38149a35af) | R1 returned at D; executor 2 completes the same G; old B1 releases |
| Payment on time, proof accepted late | [0x742f0927…](https://creditcoin-testnet.blockscout.com/tx/0x742f0927d6e602582725cc4d4218a80cb87a8f9f3aeee710548d6a2760d1ba20) | Operator keeps refunded R; the dedicated B pays the winner |
| Unfilled expiry | [0xc281cefe…](https://creditcoin-testnet.blockscout.com/tx/0xc281cefe2f518f1bf2c64f594213f4502a698d260646629a8a9f54d881ed6ab6) | Authenticated post-T unfilled fact releases B1; G remains open |
| Normal control | [0xeffe0ce3…](https://creditcoin-testnet.blockscout.com/tx/0xeffe0ce362de7e976221343f31d217ac5dcd22fcc7227f18c470e694108977b9) | Winner gains R from held principal; B unlocks |
A second, validly signed source payment attempt was **mined and reverted**, leaving recipient and payer USDC balances unchanged: [duplicate receipt](evidence/testnet/duplicate-payment.json). The normal, late and relay runs were subsequently withdrawn to their role wallets; gas-adjusted native balance deltas were verified and the escrow reconciled to zero at that checkpoint (before the later expiry run): [withdrawal evidence](evidence/testnet/withdrawals.json).

The [independent audit](evidence/testnet/audit.json) re-queries historical CTC state before and after each settlement. It verifies winner credit deltas, R/B bucket changes, deadline refund deltas, source winning rounds and deployed runtime code hashes.

## The reusable state-proof boundary

StateLift is deliberately a focused first consumer of a separately deployed state-proof boundary. `RootInbox` authenticates an anchored source header and its state root; `StateProofVerifier` verifies an account and storage proof against that root. Those components do not know about payments, rounds, or guarantees. `GoalFillFactVerifier` is the first business consumer: it applies the generic proof to GoalRouter's fill slot and turns the result into the payment-specific filled or still-unfilled fact. The current prototype proves this boundary with one concrete consumer and does not claim an open-ended historical-query SDK.

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

Full-suite baseline (before the added multi-round case): **107 passed, 0 failed**, in about 18 minutes on this ARM64 host. [Raw output](evidence/full-recheck.log). Tests run sequentially to avoid redundant parallel Solidity compilation pressure. Ganache's native-binding fallback is a performance warning, not by itself a failed assertion.

The updated negative-fact suite additionally passes **13/13**, including two independent expiries followed by a third-round settlement on the same goal ([validation log](evidence/multi-round-validation.log)).

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

R=B=0.1 tCTC, π=0.0006 tCTC and 0.1 test USDC are **demo parameters**, not an exchange rate or market quote. The prototype demonstrates the payment and proof mechanics, not a production underwriting business. Guarantees require prefunded capital and may remain locked while proof is unavailable; demonstration pricing does not establish sustainable economics. Customer demand, independent underwriting, and production security remain unvalidated.

The observed official prover requires 32 source blocks plus attestation availability. Proof outages can affect multiple guarantee positions, and CTC or USDC operational risks remain. Detailed cost measurements and risk assumptions are in the [underwriting model](research/underwriting-model.md).

[Current status](STATUS.md) · [Raw local demo](evidence/three-acts.md)
