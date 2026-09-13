# Task 5 evidence — CTC 侧 G/E 骨架与保障资本池

命令: node --test tests/goal/escrow-open.test.cjs
时间: 2026-09-13T07:31:10Z

关键断言：
1. 两条链从同样条款推导出同一个 goalId（escrow.goalIdOf == router.goalIdOf）。若二者分叉，真实源链付款产生的事实将匹配不到任何目标，产品会静默失效。
2. 开单后 R / B / π / credits 四池分离，且 balance == held + available + locked + credits（invariant() 每步断言）。
3. B < R 拒绝开单（UnderCollateralised）。
4. 保障方可用资本 < B 拒绝开单（InsufficientGuaranteeCapital），不锁资金、不产生轮次。
5. 同一份资本不能同时担保两个未决轮次。
6. 已锁定资本不可提取。
7. D <= T、D == T、D < T + minClearingWindow 全部拒绝（DeadlineWindowTooShort）。
8. 上一轮 T 未过时不得开替补轮（PreviousRoundStillLive）；过 T1 后允许接力。

演示参数：R=5150, B=5150, π=31, minClearingWindow=60（演示报价用 5400）。

## 过程中发现并修正的两个测试基础设施缺陷

1. evm_increaseTime 后经 ethers provider 读 latest 区块会拿到缓存的旧时间戳，导致时间旅行静默无效。已改为直连 RPC 读取，并在 ctcTravel/srcTravel 内断言时间确实前进，否则抛错。
2. ganache 上部分回滚调用不会在 estimateGas 阶段失败，而是以 status 0 上链。因此所有期望回滚的断言必须 await .wait()，否则 assert.rejects 会漏判。

## 原始输出
```



✔ both chains derive the same goal id from the same terms (991.596998ms)
✔ a goal fixes recipient and amount and cannot be created twice (548.12842ms)
✔ opening a round splits R, B and the premium into separate pools (1563.140979ms)
✔ a quote with guarantee below the principal is refused (613.842633ms)
✔ a quote the guarantor cannot fund is refused (650.399366ms)
✔ the same capital cannot underwrite two live rounds (1431.969756ms)
✔ locked capital cannot be withdrawn by the guarantor (1374.702681ms)
✔ a clearing deadline that is not clear of the payment deadline is refused (649.331679ms)
✔ a payment deadline in the past is refused (624.215266ms)
✔ the operator must send exactly R plus the premium (670.067862ms)
✔ only the goal owner can open a round on it (621.819289ms)
✔ a round quote cannot be opened without the guarantor's signature (648.913396ms)
✔ a guarantor quote nonce cannot be reused (1489.287193ms)
✔ an expired quote is refused (610.713893ms)
✔ round numbers must be consecutive and a replacement cannot open while the previous round is still live (2206.130498ms)
✔ the goal's round cap is enforced (1460.483275ms)
✔ guarantee capital can be deposited and unlocked capital withdrawn (891.603431ms)
✔ a zero-value capital deposit and an empty withdrawal are refused (453.438408ms)
ℹ tests 18
ℹ suites 0
ℹ pass 18
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 47018.123336
```
