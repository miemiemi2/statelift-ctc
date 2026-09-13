# Task 7 evidence — 幕 B：D 后退款与迟到 B 结算

命令: node --test tests/goal/act-b-late.test.cjs
时间: 2026-09-13T08:18:19Z

场景：源链在 T 前真实付款成功（收款人确实收到 5,000 tdUSDC），但认证未在 D 前完成结算。

关键断言：
- D 前 claimRefund 被拒（NotYetClearingDeadline）。
- 过 D 后 R 归运营者（state->Refunded），**B 不释放**，继续为可能已发生的付款担责；此时 G 仍为 Open、filledRound=0，即 CTC 侧诚实地承认自己不知道付没付。
- 迟到成功证明到达后：赢家从 B 获偿 R，运营者仍持有 R（不被挪回），B==R 时专属担保被全额消耗，保障方只留 π。RoundSettled.fromGuarantee == true。
- **防抢跑（本任务最关键的一条）**：运营者尚未调用 claimRefund 时，执行者自己提交迟到证明，仍然只能动 B，且 R 被强制记入运营者账下。R 的归属由链上受理时间在 D 固定，不取决于谁先发交易。
- D 边界两侧：D-30 结算走 R 并释放 B（SettledFromPrincipal）；到达 D 当刻结算走 B（SettledFromGuarantee）。
- 退款不可重复领取；赢家不可二次获偿；迟到结算后 G 关闭不再开新轮。
- 收款人全程只被支付一次。
- 全员提款后 escrow 余额归零且四账全为 0。

## 保障方最坏责任已被实测

本幕正是 PRODUCT-SLICE.md 里写明的最坏情况：收款人已收到款，运营者又取回 R，保障方净损失 R（仅保留 π）。测试断言的就是这个结果，不是回避它。

## 本任务修正的测试基础设施缺陷

settleRound 在 D 前后走不同分支，D 后分支写入更多状态、耗气更多。ethers 按当前区块估算气且不加缓冲，于是估算时在窗口内、上链时已过窗口的结算会耗尽气而失败，且没有 revert 原因。已改为通过夹具 settle()/releaseByWinner() 传入固定 gasLimit=6,000,000。副作用：避免了重复执行 MPT 验证，幕 A 从 355s 降到 138s，幕 B 从 414s 降到 108s。

## 原始输出
```



✔ Act B: at D the operator recovers R while the guarantee stays liable (3277.288058ms)
✔ Act B: a late proof pays the winner from B and never touches the returned R (11074.661988ms)
✔ Act B anti-front-run: a late proof draws on B even if the operator never claimed (10442.745812ms)
✔ Act B boundary: settling just before D uses R and releases B (10941.842211ms)
✔ Act B boundary: settling once D has been reached uses B (11064.113792ms)
✔ Act B: the refund cannot be claimed twice and the winner cannot be paid twice (10889.175938ms)
✔ Act B: after a late settlement the goal is closed to new rounds (10638.588655ms)
✔ Act B: everyone can withdraw their own side of the outcome (11655.624727ms)
ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 110324.329993
```
