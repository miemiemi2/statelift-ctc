# StateLift — real testnet integration

## Current authoritative evidence

The production contracts are deployed on Ethereum Sepolia (11155111) and Creditcoin testnet (102031). Exact addresses, deployment transactions, blocks and code hashes are in [deployment.json](../evidence/testnet/deployment.json). The dedicated deployer is not the product escrow. Identical addresses across different chains arise from the same deployer nonce; the chain field is essential.

Creditcoin RPC: `https://rpc.cc3-testnet.creditcoin.network`. Attestcoin prover: `https://prover.cc3-testnet.creditcoin.network/`. Native verifier: `0x0000000000000000000000000000000000000FD2`. Source chain key: **1**, which means Sepolia in this testnet environment. Official Sepolia USDC: `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`.

[Prerequisites](../evidence/testnet/prerequisites.json) preserve raw RPC responses. [Normal flow](../evidence/testnet/flow-normal.json), [late flow](../evidence/testnet/flow-late.json), and [relay flow](../evidence/testnet/flow-relay.json) are resumable journals; the presence of a journal does not imply that its settlement step has completed. Inspect transaction receipts and before/after snapshots.

## Proof-to-money chain

1. The guarantor signs an EIP-712 round quote. `openRound` locks the operator's R and dedicated B; π is credited separately to the guarantor.
2. An executor signs USDC `ReceiveWithAuthorization`, domain `USDC` version `2`. GoalRouter receives exactly the amount, forwards it to the fixed recipient, and permanently fills G. Round number, winner and T bind the authorization nonce.
3. A later Sepolia `HeaderAnchor.anchor(paymentBlock)` transaction records the canonical payment-block hash. It must be mined within the EVM's 256-block history window.
4. The official prover authenticates this **real anchor transaction**, not locally assembled synthetic transaction bytes. Its observed API requires a 32-block reorg-protection window. This is measured behavior of the current endpoint, not a guaranteed latency SLA.
5. RootInbox invokes the official 0x0FD2 verifier, checks anchor receipt success, emitter, chain, height and block hash, and stores roots from the hash-matched full header. Header encoding includes Pectra `requestsHash`.
6. The runner fetches all payment-block receipts, rebuilds the receipt trie and asserts the canonical receiptsRoot. GoalFillFactVerifier checks the proven GoalRouter event and exact goal/round/recipient/amount/deadline.
7. `settleRound` calls that verifier and changes withdrawable CTC ownership. Before D, the winner gets R; after D, the operator retains/reclaims R and the winner gets R from that round's B. A proof being valid alone does not transfer ownership.

Native verification also checks that a mutated payload is rejected. This does not replace contract-level semantic validation or prove liveness.

## Running and resuming

Run from the project root. Only dedicated testnet credentials are used; no key is printed, copied to evidence or required from the user. Role keys are derived in memory under an explicit testnet namespace; only public role addresses are saved. Production key custody is outside this demo's scope.

```bash
node scripts/testnet-check.mjs
node scripts/testnet-deploy.mjs
node scripts/testnet-fund-roles.mjs
node scripts/testnet-flow.mjs normal start
# Once the original anchor is outside the official confirmation window:
node scripts/testnet-flow.mjs normal prove
node scripts/testnet-flow.mjs normal settle
```

For `late`: `start` pays and anchors; after D, run `refund`, then `prove`, then `settle`. For `relay`: `start` deliberately does not pay; after D run `refund`, then `relay` to open/pay round 2; after its anchor is confirmed run `prove`, then `settle`, which releases round 1's B against the winning round-2 fact.

Each broadcast is checkpointed before receipt waiting. When a process times out, inspect and resume its saved transaction rather than creating a new goal or deployment. An HTTP 404 with `retriable:true` during the 32-block window requires waiting for that same source anchor; it does not justify re-anchoring. Do not rerun concurrent writers using the same role's nonce.

## Demonstration boundaries

R=B=0.1 tCTC, π=0.0006 tCTC and source amount=0.1 test USDC are demo parameters, not an FX quote or commercial insurance price. Normal D is intentionally long enough for confirmation. Late/first relay rounds deliberately use short T/D to exercise the guarantee; these are unsuitable defaults for commercial use. No time-travel RPC is used on real testnets.

Roles are distinct addresses but operated by one demo harness. This proves protocol mechanics, not independent counterparties, demand, market pricing or decentralization of operations. RPC/prover availability and canonical chain assumptions remain dependencies. B can stay locked indefinitely if no usable fact ever becomes available; the bounded recovery promise applies to the operator's R.
