# Task 4 evidence — GoalFillFactVerifier（正向事实）

命令: node --test tests/payment/goal-fill-fact.test.cjs
时间: 2026-09-13T07:17:55Z

链路：源链真实 fill 执行 -> 真实区块头 RLP -> RootInbox.accept 锚定 -> StateProofVerifier.receipt 真实 MPT 回执证明 -> NativeReceiptPolicy 严格解码 -> GoalFilled 日志 -> (goalId, roundNumber, winner, sourceTimestamp)。

唯一测试替身：MockAttestcoinProver（Attestcoin 原生区块证明器的替身）与 MockUSDC3009。区块头解析、状态/回执 MPT 验证、GoalRouter、GoalFillFactVerifier 均为真实产品代码。

## 原始输出
```



✔ an anchored fill receipt yields the winning round and winner (21777.920097ms)
✔ the fact reports the round that actually filled, not the round asked about (11366.052402ms)
✔ a goal id that was not the one filled does not appear in the fact (11312.692874ms)
✔ an unanchored block cannot produce a fact (708.790329ms)
✔ a tampered receipt proof cannot produce a fact (1389.021499ms)
✔ a receipt from an anchored block with no router fill log is rejected (5440.314385ms)
✔ the verifier is bound to one router and one inbox (21055.948327ms)
✔ a verifier cannot be constructed with a mismatched state verifier or zero router (485.527405ms)
ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 97613.159707
```
