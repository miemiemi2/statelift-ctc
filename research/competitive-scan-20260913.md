# Public competitive scan — 2026-09-13

This is a public-material scan, not an independent security or economic audit. Claims below are repo/README claims unless marked as verified here.

## What the strongest public packages show

| Project | Public shape | Evidence surface | StateLift implication |
|---|---|---|---|
| SignalProof | Live DePIN connectivity product | Live site, demo video, tests badge, docs | Strongest presentation and click-through verification pattern; it is not a payment recovery competitor. |
| Attestable | Parametric infrastructure-failure protection | Long architecture/security explanation and a live-testnet section | Strongest risk-transfer framing; its trigger is service/feed failure, not at-most-once supplier payment or same-goal relay. |
| CrossCredit | Mainnet repayment history → Creditcoin lending | Live app, five claimed mainnet repayment proofs, on-chain credit tier and loan | Strongest “real external history changes destination-chain state” story. StateLift should lead with its harder absence fact and money-path semantics, not generic proof use. |
| ProofReserve | Lending-pool reserve controller with AI recommendation | Live app, two evidence epochs and claimed 14 source transactions | Strongest AI/product polish among sampled repos; AI is advisory and not the core proof. It does not demonstrate bounded payment recovery. |
| Backstop | Parametric insurance for DeFi loss | Public architecture, testnet claims, broad adapters/use cases | Broadest insurance scope, which also makes its product promise less specific than StateLift’s operator wedge. |
| AttestFlow / CREDPORT | Sentinel or portable credit profile | Clear precompile diagrams and conventional inclusion-proof flows | Good explanatory baseline; neither public README surfaced StateLift’s combination of non-membership expiry, same-G handoff, and dedicated late-round B. |

## Reassessment of StateLift

StateLift is not differentiated by “Attestcoin proof settles on Creditcoin.” Several sampled projects make that claim. Its defensible product wedge is the conjunction:

1. GoalRouter makes compliant payment of a fixed `G` one-shot on the source chain.
2. `claimRefund` returns `R` at `D` without asserting non-payment.
3. A replacement executor can continue the same `G` after the old executor disappears.
4. A late winning payment is paid from that round’s dedicated full `B`.
5. A post-`T` state-root proof of *absence* can release an old round’s `B` while leaving `G` open.

The fifth item is the most unusual public evidence in this package. It is now backed by the real expiry release transaction in `evidence/testnet/flow-expiry.json` and linked from the submission copy. It should appear first in any evaluator-facing flow.

## Remaining presentation gap

The sampled leaders generally offer a live URL or video. StateLift currently offers a clone-and-run showcase plus explorer links. That is a presentation disadvantage, but it is separable from protocol quality. A static, read-only verifier page would close the gap if it reads public RPC state and shows raw evidence rather than replaying preloaded JSON. It should be built only after the current four-path evidence remains stable.

## Honest limits

This scan does not prove that any competitor has independent users, production security, profitable underwriting, or stronger contracts. Public README claims were not treated as facts without linked artifacts. StateLift likewise should not claim superiority: its strongest demonstrated advantage is the specific expiry/non-membership path and accounting semantics; its weaknesses remain no independent guarantor, no customer evidence, testnet-only economics, and no professional audit.
