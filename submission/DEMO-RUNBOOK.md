# StateLift demo recording runbook

The engineering work is complete. Record this read-only replay from the project root; it does not spend funds or require a wallet.

```bash
npm ci
node scripts/showcase.mjs
```

Suggested narration:

1. “StateLift protects one payment goal G. The source router allows at most one compliant USDC payment.”
2. “In the normal path, the proof moves the executor’s reward from R and releases B.”
3. “In the late path, the operator has already recovered R at D. The authenticated proof moves the winner’s reward from that round’s B.”
4. “In the handoff path, the old executor never paid. A second executor pays the same G, and the old B is released.”
5. “A separate validly signed duplicate payment was mined and reverted, with both USDC balances unchanged.”
6. “The audit re-queries the historical Creditcoin states before and after settlement, then shows the final escrow balance is zero.”

The output uses confirmed testnet transaction hashes and links. It is a replay of completed evidence, not a claim that a new transaction is being sent during recording.
