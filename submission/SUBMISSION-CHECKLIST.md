# Final submission checklist

Prepared locally and in the public repository on 2026-09-13.

| Required item | Ready artifact / value | Status |
|---|---|---|
| Project description | `submission/SUBMISSION.md`, also below | Ready |
| Attestcoin integration summary | `docs/TESTNET-INTEGRATION.md`, `submission/SUBMISSION.md` | Ready |
| GitHub repository | https://github.com/miemiemi2/statelift-ctc | Ready and public |
| PDF deck / whitepaper | https://github.com/miemiemi2/statelift-ctc/raw/main/submission/StateLift-whitepaper.pdf | Ready; 6 pages, 11 bookmarks, 13 links, no text overflow |
| Prototype video | User's final recording | Pending user recording only |
| Team/project profile fields | Use the existing authorized contest account; do not invent members or links | Form entry |
| Contest form | Public endpoint returned HTTP 405 to read-only requests on 2026-09-13; submission form state could not be inspected without its browser/account flow | Needs browser submission |

## Copy for the form

**Short description:** StateLift gives Creditcoin payment operators a bounded recovery deadline and safe same-goal handoff for uncertain Ethereum USDC payments. GoalRouter makes compliant payment of G permanent and at-most-once. Each round locks R, premium π and dedicated B≥R. At D the operator can recover R; if a late payment is later proven, that round's B pays the winner. Attestcoin proof is consumed by Creditcoin settlement, so the proof changes CTC ownership rather than only displaying a result.

**Integration:** Real Ethereum Sepolia payment, real HeaderAnchor, official Creditcoin prover and native verifier 0x0000000000000000000000000000000000000FD2, RootInbox receipt/root checks, MPT receipt inclusion and GoalFillFactVerifier exact business checks. Three confirmed testnet settlements are linked from `submission/SUBMISSION.md`.

**Video URL:** paste the URL of the user's final recording after following [DEMO-RUNBOOK.md](DEMO-RUNBOOK.md). The recording should show `node scripts/showcase.mjs` and the linked explorer transactions; it does not need a wallet or new transaction.

**Honest limitation:** This is a testnet prototype. R=B=0.1 tCTC, π=0.0006 tCTC and 0.1 test USDC are demonstration parameters. Measured root plus settlement gas exceeds π. There is no customer, independent guarantor, profitability or professional security-audit evidence.
