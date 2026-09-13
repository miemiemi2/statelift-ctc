# Task 3 evidence — 源链 GoalRouter 一次性闸门

命令: node --test tests/source/goal-router.test.cjs
时间: 2026-09-13T07:13:25Z

核心断言：同一 goalId 第二次 fill（不同执行者/不同轮次/不同赢家/不同 ERC-3009 nonce）回滚，且第二个执行者余额未被扣减，收款人余额保持一次付款。
测试替身：tests/fixtures/MockUSDC3009.sol（非真实 USDC，无代理/黑名单/铸造控制）。GoalRouter 本身是产品合约。

## 原始输出
```



✔ a compliant fill pays the recipient exactly once and records the winner (1025.133887ms)
✔ a second round on the same goal reverts and spends no second payment (564.332186ms)
✔ replaying the identical fill reverts (471.131454ms)
✔ a fill after the round deadline T reverts (234.847562ms)
✔ an authorization for a different amount cannot fill the goal (261.035385ms)
✔ an authorization bound to another goal cannot fill this goal (259.904337ms)
✔ an authorization signed for a different round number is not reusable (248.406777ms)
✔ the router authorization cannot be redirected to pay the recipient directly (220.703823ms)
✔ zero round number and zero winner are rejected (246.824806ms)
ℹ tests 9
ℹ suites 0
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 24503.328766
```
