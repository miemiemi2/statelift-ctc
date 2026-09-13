# Task 8 evidence — 幕 C：付款人失联的安全接力

命令: node --test tests/goal/act-c-relay.test.cjs
时间: 2026-09-13T08:27:48Z

这是普通退款工具与普通重试都给不了的一幕：运营者**不需要先知道旧付款到底发生了没有**就能安全换人。源链一次性闸门使第二次付款不可能，因此"换人"永远不会变成"付两次"。

## 两个子情形都真实覆盖

**C1 旧执行者确实没付款**：过 D1 运营者取回 R1（B1 仍锁，因为 CTC 侧无法排除已付款）；过 T1 后沿同一 G 开 E2；E2 真实付款并在 D2 前结算，赢家从 R2 获偿；再用 E2 的事实释放 B1。结果：收款人只收到一次付款，两份担保原额归还，保障方赚两笔 π，运营者拿回搁死的 R1。

**C2 旧执行者其实已付、只是证明迟到**：运营者不知情仍然接力开 E2；E2 执行者的付款尝试在源链因 AlreadyFilled 回滚，**未被扣款**，收款人仍只有一次付款；过 D1 后 R1 归运营者，E1 的迟到事实从 B1 结算给旧赢家；E2 永不可能获胜，其 R2 与 B2 全额归还。结果：恰好消耗一份专属担保，运营者收回两份预算。

## 其他关键断言

- 迟到事实不能支付第二个赢家：对 E2 用 E1 事实 -> FactRoundMismatch；对已结算的 E1 重放 -> 拒绝。winnerPaid 全程只有一个地址、只付一次。
- 轮次不能自称落败来释放自己的担保 -> ThisRoundStillCouldWin。
- 无关目标的付款事实不能释放本目标的担保 -> FactGoalMismatch，且不会把本目标标记为已付。
- **外人自费通过未登记轮次完成同一 G**：收款人确实收到款，G 被标记为已付且 filledRound=7，但 winnerPaid 保持零地址——未登记、未锁资的轮次不能冒领奖励；已登记轮次干净解锁。
- T1 之前拒绝接力（PreviousRoundStillLive）；T1 之后允许，此时两轮同时在账且 R/B 分别独立计账（held=2R, locked=2B）。
- 可连续接力到第三轮，两个被放弃的轮次用同一个赢家事实各自解锁。

## 测试环境改动

tests/helpers.cjs 的 environment() 从 5 个 signer 扩到 6 个，以便第二执行者（索引 5）在 CTC 侧也有对应账户。索引 0-4 的既有用法不变。

## 原始输出
```



✔ Act C1: executor vanishes, operator recovers R1 and a replacement round completes the goal (22901.866129ms)
✔ Act C2: the old payment had happened, so the replacement payment is rejected on the source chain (19910.469918ms)
✔ Act C: a late fact for the old round cannot pay a second winner (12791.049503ms)
✔ Act C: a round cannot release its own guarantee by claiming it lost (13330.849169ms)
✔ Act C: a fact from an unrelated goal cannot release a guarantee (13533.694094ms)
✔ Act C: an outsider filling an unregistered round closes the goal without paying anyone (24311.800045ms)
✔ Act C: relay is refused while the previous round can still be filled (2441.021609ms)
✔ Act C: a third round can follow a second failed relay (29558.152589ms)
ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 168484.524065
```
