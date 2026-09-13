# StateLift — submission copy

## Project description

StateLift makes one uncertain supplier payment recoverable, relayable and at-most-once for Creditcoin operators paying fixed suppliers in Ethereum USDC. Every attempt keeps the same payment goal G and passes through a source-chain one-shot gate. If a payment is unknown at the clearing deadline D, the operator can recover its reserved principal R without declaring that the supplier was unpaid. If an executor disappeared, another executor can continue under the same G. If the old payment later proves real and late, that round’s dedicated, fully funded guarantee B pays the winner. The supplier receives at most one compliant payment.

## Attestcoin integration

Attestcoin is part of the money decision. A real Sepolia payment and its HeaderAnchor transaction are proven by the official Creditcoin prover (source key 1). Creditcoin’s native verifier at `0x0000000000000000000000000000000000000FD2` authenticates the source transaction, receipt trie and continuity. RootInbox checks the successful anchor receipt and full block hash. GoalFillFactVerifier then checks the exact GoalRouter event, goal, round, recipient, token, amount, deadline and source timestamp. `StateLiftGoalEscrow.settleRound` consumes the fact and changes who owns CTC. Attestcoin’s transaction-inclusion proof alone does not establish that a storage slot is empty. StateLift authenticates a state root through the anchored block hash, then verifies storage non-membership to establish the post-deadline unfilled fact. The evidence includes before/after historical balance buckets, not just a “proof valid” label.

## Demonstrated results

- Unfilled expiry: [release](https://creditcoin-testnet.blockscout.com/tx/0xc281cefe2f518f1bf2c64f594213f4502a698d260646629a8a9f54d881ed6ab6) releases B1 after a post-T authenticated unfilled fact while leaving G open.
- Normal: [settlement](https://creditcoin-testnet.blockscout.com/tx/0xeffe0ce362de7e976221343f31d217ac5dcd22fcc7227f18c470e694108977b9) pays from R and unlocks B.
- Late proof: [settlement](https://creditcoin-testnet.blockscout.com/tx/0x742f0927d6e602582725cc4d4218a80cb87a8f9f3aeee710548d6a2760d1ba20) keeps recovered R with the operator and pays from B.
- Unpaid handoff: [settlement](https://creditcoin-testnet.blockscout.com/tx/0xa532ba0a5db0d375178a71286715e332787fb2935591a07d69705a38149a35af) completes round 2 on the same G and releases old B1.
- [Independent audit](../evidence/testnet/audit.json) checks historical deltas, and [withdrawal evidence](../evidence/testnet/withdrawals.json) shows the escrow at zero after the normal, late and relay runs, before the later expiry run. The expiry bundle separately records B becoming available and R remaining credited.

## Honest limits

R=B=0.1 tCTC, π=0.0006 tCTC and 0.1 test USDC are demo parameters. The measured proof-root and settlement gas exceeds π, so this run is not profitable underwriting. The prototype has no customer, market quote, independent guarantor or security-audit evidence. B can remain locked while authenticated facts are unavailable. See the whitepaper and underwriting model for correlated-loss and capital-cost limits.

## Links

- Product walkthrough: https://miemiemi2.github.io/statelift-ctc/web/demo.html
- Public verifier: https://miemiemi2.github.io/statelift-ctc/web/verifier.html
- Repository: [StateLift](https://github.com/miemiemi2/statelift-ctc)
- Whitepaper: https://github.com/miemiemi2/statelift-ctc/raw/main/submission/StateLift-whitepaper.pdf
- Source and evidence: `README.md`, `docs/TESTNET-INTEGRATION.md`, `evidence/testnet/`
