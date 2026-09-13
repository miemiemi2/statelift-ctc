# Task 9 evidence — 负向事实与担保早释放

命令: node --test tests/goal/negative-fact.test.cjs
时间: 2026-09-13T08:37:17Z

**结论：完整实现，未退化。** Task 2 的 spike 确认 eth_getProof 可用，因此负向路径也走真实存储证明，不需要降级为"已识别未实现"。

## 做了什么

GoalFillFactVerifier 新增 proveUnfilled / verifyUnfilled：从锚定的源链区块，用真实账户证明 + 存储证明，证明 GoalRouter 的 fills[goalId] 基槽仍为 0（即该目标当时尚未被填充）。

StateLiftGoalEscrow 新增 releaseGuaranteeByExpiry(roundId, evidence)：若负向事实的源链时间戳 >= 该轮的 T，则该轮永远不可能被填充（Router 在 T 后拒绝 fill），于是释放 B 并归还 R。

## 商业意义

没有这条路径，承保了一个无人填充的轮次的保障方必须等到清账截止 D 才能收回承保额度。有了它，只要能证明 T 已过且仍未付款，额度立刻回收。

## 与赢家释放的关键区别

releaseGuaranteeByWinner 会把 G 标记为已付（源链确实付过了）；releaseGuaranteeByExpiry **不关闭 G**——没有人被支付，运营者仍可接力。过期的是轮次 E，不是目标 G。测试直接验证了这一点：早释放之后开 E2 并正常付款结算成功。

## 防伪造

负向证明最危险的伪造方式是拿一个该地址还没有代码（或代码不同）的区块来证明"槽为零"。因此验证器在构造时绑定了 GoalRouter 的真实代码哈希（从源链 eth_getProof 读取），负向证明必须同时满足账户存在且代码哈希匹配。测试用一个绑错代码哈希的验证器确认会被拒（RouterCodeMismatch），零代码哈希的构造也被拒。

## 其他断言

- 目标真被填充后，负向事实被拒（GoalWasAlreadyFilled）——源链存储自己说了实话。
- T 之前的负向证明什么也证明不了，被拒（RoundCouldStillBeFilled）。
- 未锚定区块的负向证明被拒。
- 篡改 goalId 的证明被拒。
- 已退款的轮次也可早释放，且 R 不会被二次入账。
- 已释放的轮次不能再次释放。
- GuaranteeReleased.winningRound == 0 标识"按过期释放"而非"按赢家释放"。

## 原始输出
```



✔ an unfilled goal produces a negative fact carrying the source timestamp (3004.040764ms)
✔ a negative fact is refused once the goal really has been filled (5011.011633ms)
✔ expiry release frees the guarantee and the budget without closing the goal (3209.43424ms)
✔ expiry release before T proves nothing and is refused (3368.659974ms)
✔ after expiry release the operator can still relay and win on the same goal (13032.092156ms)
✔ a negative fact for another goal cannot release this round (3252.136229ms)
✔ a negative fact from an unanchored source block is refused (1511.293591ms)
✔ a negative fact cannot be forged against an address that is not the router (3569.430609ms)
✔ expiry release also works on an already refunded round (3176.032183ms)
✔ a released round cannot be released or settled again (3090.367437ms)
ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 72711.165445
```
