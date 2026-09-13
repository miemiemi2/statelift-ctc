# 阶段 2 修复后复验

时间: 2026-09-13。对 `evidence/stage2-acceptance.md` 记录的 F1–F4 逐条复验，在一个全新的本地世界上进行。

承诺与产品行为均未改动。四项修复都只动文档与入口，或补上一个入口里缺失的既有能力。

## F1 / F2 — README 三幕现在照抄可跑

按修正后的 README 幕 A 逐条执行，含 shell 捕获 goalId：

```
G=$(node cli/operator.mjs create-goal --ref invoice-A | grep '"goalId"' | cut -d'"' -f4)
captured G=0x2541b04be5426fdcfd3bfd1e0d815e297798dd9060c33dc23608224156229ee7
deposit-capital --amount 40000            -> available 40000
open-round --pay-in 600 --clear-in 900    -> roundId 0x90ac59f7…
pay --round 1 --as executor               -> paid: true
prove                                     -> winningRound 1
settle --round 1                          -> SettledFromPrincipal, "R — your budget"
```

幕 B 现在以自己的 `create-goal` 开头，不再撞 `GoalAlreadyPaid`：

```
open-round --pay-in 300 --clear-in 600    -> roundId 0x7840b9f6…
pay --round 1 --as executor               -> paid: true
advance --chain ctc --seconds 700         -> 1789293775
refund --round 1                          -> Refunded, yourRecoveredBudget 5150
```

## F3 — 保障方资本现在能取回

新增 `withdraw-capital --amount N`，并在 `help` 中新增独立的 Guarantor 段落：

```
Guarantor
  deposit-capital  --amount N           commit underwriting capital
  withdraw-capital --amount N           take back UNLOCKED capital only
  withdraw --as guarantor               collect earned premiums
```

实测（当时有一轮在押，锁定 5150）：

```
deposit-capital 之后            -> available 34851, locked 5150
withdraw-capital --amount 5000  -> movedToCredits 5000, stillAvailableCapital 29851,
                                   stillLockedCapital 5150, withdrawableCredits 5062
withdraw-capital --amount 99999999 -> error: InsufficientGuaranteeCapital
withdraw --as guarantor         -> withdrawn 5062
```

未锁定资本可取回；超过未锁定额度被拒；为在押轮次担保的 5150 始终锁定。「足额担保」因此不是标签。

## F4 — 问 4 不再看起来自相矛盾

```json
"4_finalOutcomePaidExactlyOnce": {
  "answer": "not yet — no compliant payment has been proven for this goal",
  "readingThisField": "the source chain HAS been paid, but this side has not settled it
     yet — these are two different things, and telling them apart is the point of this product",
  "sourceChainFilled": true,
  "sourceChainWinningRound": "1",
  "winnerRewardedOnce": false,
  "rewardedWinner": null
}
```

## 回归

`node --test tests/cli/operator.test.cjs` → **11 个测试全部通过**（新增一个专门覆盖「存入 → 锁定部分 → 只能取出未锁定部分 → 超额被拒」）。`help` 的文档断言同时扩展到 `deposit-capital` 与 `withdraw-capital`，防止入口再次漏掉保障方的操作。
