# Task 6 evidence — 幕 A：D 前正常结算

命令: node --test tests/goal/act-a-settle.test.cjs
时间: 2026-09-13T08:20:09Z

完整纵向链路（每个测试都真实走完）：
1. CTC 侧 createGoal + depositCapital + openRound（锁 R/B，π 记入保障方）
2. 源链真实执行 GoalRouter.fill（ERC-3009 授权 -> Router -> 收款人真实收到 5,000 tdUSDC）
3. 源链真实区块头 RLP -> RootInbox.accept 锚定
4. 真实 MPT 回执证明 -> GoalFillFactVerifier
5. CTC 侧 settleRound（由无关第三方提交）

关键断言：
- 赢家从 R 获偿恰好一次；B 原额回到保障方可用资本；保障方只留 π；运营者不获退款（预算已完成使命）。
- RoundSettled.fromGuarantee == false（从 R 结算，未动 B）。
- 重放同一成功事实不二次付款。
- 已结算轮次即使过了 D 也不可退款。
- G 已付后不能再开新轮（GoalAlreadyPaid）。
- 事实的轮次号/截止/目标不匹配一律拒绝（FactRoundMismatch / FactDeadlineMismatch / FactGoalMismatch）。
- **证明已进 Inbox 但未完成结算不算清账**：fact 可证但轮次仍 Pending，资金未动。
- 四账不变量 balance == held + available + locked + credits 每步成立。

## 本任务修正的合约缺口

settleRound 原先未校验事实中的 payBy 是否等于该轮 T。执行者可以用自选的截止时间填充并仍然结算，等于 T 不生效。已新增 FactDeadlineMismatch 校验。

## 原始输出
```



✔ Act A: proof before D pays the winner from R and releases B (11811.403602ms)
✔ Act A: the winner can withdraw exactly once (11204.762984ms)
✔ Act A: the operator cannot claim a refund on a settled round (11006.093963ms)
✔ Act A: replaying the same success fact does not pay twice (10574.409458ms)
✔ Act A: no further round can open once the goal is paid (10513.572518ms)
✔ Act A: a fact naming a different round cannot settle this round (12508.616771ms)
✔ Act A: a fill quoting a deadline other than the round's T cannot settle it (13013.389275ms)
✔ Act A: a fact for a different goal cannot settle this round (12877.384065ms)
✔ Act A: settling an unknown round fails (2608.024933ms)
✔ Act A: a proof sitting in the inbox is not settlement by itself (12875.244219ms)
ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 138608.003191
```
