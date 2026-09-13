# 阶段 2 验收记录 — 不带源码带路的完整操作

时间: 2026-09-13

方式：只依据 `README.md`、`node cli/operator.mjs demo-quote` 与 `node cli/operator.mjs help` 操作，不查阅合约与 CLI 源码。全部命令对着 `npm run local:up` 起的两条真实本地链执行。

结论：**七项检查全部通过。发现 4 个缺陷，全部属于「文档/入口错误」，没有发现产品行为错误。** 缺陷已在验收后修复，修复过程记录在本文件末尾。

---

## 七项检查

### 1. 正常付款 — 通过

按 README 幕 A 逐条执行：

```
create-goal --ref invoice-2026-0042   -> goalId 0x5ddc0247…, sourceChainDerivesSameId: true
deposit-capital --amount 40000        -> available 40000, locked 0
open-round --pay-in 600 --clear-in 900 -> R=5150 B=5150 pi=31 T=1789293283 D=1789293583
pay --round 1 --as executor           -> paid: true, 收款人余额 0 -> 5000000000
prove                                 -> anchoredSourceBlock 5, winningRound 1
settle --round 1                      -> SettledFromPrincipal, 5150, "R — your budget (the proof cleared before D)"
```

`yourRecoveredBudget: 0` —— 预算完成了它的使命，没有退款，这是正确的。

### 2. 付款已发生但证明迟到 — 通过

```
open-round --pay-in 300 --clear-in 600
pay --round 1 --as executor           -> paid: true
advance --chain ctc --seconds 700      -> 过 D
refund --round 1                      -> Refunded, yourRecoveredBudget 5150, guaranteeStillLocked 5150
prove                                 -> winningRound 1
settle --round 1 --as guarantor        -> SettledFromGuarantee, 5150,
                                          "B — the dedicated guarantee (the proof landed at or
                                           after D, so your budget stayed yours)"
```

D 后用户取回 R，迟到证明由 B 结算，两件事都由链上状态确认，不是文案。

### 3. 付款人失联，第二个执行者沿同一 G 接手 — 通过

```
open-round --pay-in 300 --clear-in 900
pay --round 1 --as executor            -> paid: true（运营者此时并不知道这一步是否发生）
advance --chain ctc --seconds 400       -> 过 T1
open-round --round 2 --pay-in 300 --clear-in 900   -> roundNumber 2
pay --round 2 --as executor2            -> paid: false
```

替补付款的完整返回：

```json
{
  "paid": false,
  "reason": "this goal was ALREADY filled on the source chain, so a second payment is impossible",
  "alreadyFilledBy": { "roundNumber": "1", "winner": "0x22d491Bde…" },
  "recipientBalanceUnchanged": true,
  "note": "No tokens were spent by this attempt. This is what makes relay safe."
}
```

另一条路径（旧执行者确实一次都没付）也按 README 走通：

```
prove-unfilled --past-round 1  -> "# moved the source chain from 1789292777 to 1789294265
                                   so it is past round 1's T (1789294219)"
release --round 1 --by expiry  -> Released, "goalStillOpenForRelay": "yes — expiry retires
                                  the ROUND, not the GOAL"
status                         -> 问3 仍为 "yes — open the next round"
```

### 4. 旧付款最终被证明成功时，系统仍只付款一次 — 通过

检查 2 里迟到证明结算后：赢家获偿一次 `5150`；`winnerRewardedOnce: true`；收款人源链余额始终只有一笔 `5000000000`。检查 3 里替补付款被源链拒绝，收款人余额未变。

### 5. 重放、错误轮次、错误目标、D 边界、保障资本不足都失败 — 通过

每一条都返回**合约的真实错误名**，不是笼统的 reverted：

| 尝试 | 结果 |
|---|---|
| 重放已结算轮次 | `RoundNotPending (from StateLiftGoalEscrow)` |
| 重复领取退款 | `RoundNotPending (from StateLiftGoalEscrow)` |
| 用第 1 轮的事实结算第 2 轮 | `FactRoundMismatch (from StateLiftGoalEscrow)` |
| 用不存在的目标结算 | `no fill evidence for this goal yet. Run: … prove --goal 0x1111…`（入口在链前就挡住并给出下一步） |
| 未过 D 就退款 | `NotYetClearingDeadline (from StateLiftGoalEscrow)` |
| 担保超出保障方可用资本 | `InsufficientGuaranteeCapital (from StateLiftGoalEscrow)` |
| `B < R` 不足额担保 | `UnderCollateralised (from StateLiftGoalEscrow)` |
| `D` 早于 `T` | `DeadlineWindowTooShort (from StateLiftGoalEscrow)` |

### 6. 操作者能说清自己买了什么 — 通过

`demo-quote` 在碰任何链之前就把话说完了。以第一次使用者的身份复述：

> 我为这一笔跨链付款付了 `31`（约 R 的 0.6%）的保障费。买到三件事：这个付款目标在源链上最多被支付一次，所以我的执行者消失了我可以换人而不怕付两次；如果到 `D` 还没清账，`5150` 的预算按链上受理时间归我，不用求任何人、也不取决于谁抢先发交易；如果旧付款其实成功了、证明只是迟到，赢家从这一轮专属的 `5150` 担保里获偿，我的预算不动。
>
> 保障方承担的最坏情况就是亏掉 `5150`、只留下 `31`，恰好发生在收款人确实收到钱而证明迟到的时候。这是收费、预先锁足资金的责任，不是无风险垫款。
>
> 为什么别的做法不等价：自己多留一份备用金给了我现金，但没让重试变安全；普通 solver 重试能换人，退款时机却由后台裁量，迟到付款也没有资金兜底；单纯的超时退款工具能把钱退给我，可退完之后迟到的付款没有资金来源，所以我依然不敢接力。

`demo-quote` 全篇标注 DEMO PARAMETER，并列出不覆盖项（R 的购买力、CTC 停机时的墙钟提款、已花 gas、π 本身、直接赠款给收款人）。

### 7. 入口没有把四种状态混成一个模糊状态 — 通过

幕 B 过 D 之后的 `status`，四个字段各自独立，且**问 1 与问 2 同时为 yes**：

```json
"1_budgetReturnedToYou":       { "answer": "yes for round(s) 1", "recoveredCredits": "5150" },
"2_oldPaymentStillAwaitingProof": {
  "answer": "yes — one or more rounds are uncleared, and the CTC side genuinely does not
             know whether a payment happened",
  "unclearedRounds": [1] },
"3_canRelayOnThisSameGoal":    { "answer": "yes — open the next round; a second real
                                            payment is impossible", "roundsUsed": "1 of 8" },
"4_finalOutcomePaidExactlyOnce": { "answer": "not yet — no compliant payment has been
                                              proven for this goal",
                                   "sourceChainFilled": true,
                                   "winnerRewardedOnce": false }
```

每次 `status` 还输出四账对账 `balancesReconcile`，本次验收全程均为 `true`。

---

## 发现的缺陷

分类按 KIRO-IMPLEMENTATION-PROMPT.md 要求：产品行为错误 / 文档入口错误 / 测试替身限制 / 未实现的真实协议能力。

### F1 — 文档入口错误：README 用 `$G` 但从未说明怎么得到它

README 三幕的命令块都写 `--goal $G`，而 `$G` 从未被赋值。第一次使用者必须自己从 `create-goal` 的输出里认出 `goalId` 再复制。**不影响产品行为，但直接违反「不带源码说明的人能按 README 跑通」。**

### F2 — 文档入口错误：README 幕 B 与幕 C 沿用幕 A 的 `$G`，照抄必然失败

幕 A 结束后该目标已被支付。照 README 字面执行幕 B 的第一条命令，得到：

```
error: GoalAlreadyPaid (from StateLiftGoalEscrow)
```

产品行为是对的（已付目标不得再开轮次），错在 README 没有说「每一幕换一个新目标」。这是本次验收里最会卡住新使用者的一条。

### F3 — 产品入口缺口：保障方存得进资本，取不出来

`deposit-capital` 有，反向操作没有。`help` 里没有任何命令能把未锁定的担保资本取出，而 `deposit-capital` 自己的提示却说「Only unlocked capital can be withdrawn」——承诺了一个入口里不存在的操作。

实测：`withdraw --as guarantor` 只取出了保障费 `155`（5 笔 π），`guaranteeCapitalAvailable` 仍有 `24550` 无法取回。尝试 `withdraw-capital` 命令不存在。

严格说这是入口缺口而非合约缺口（`status` 能读到这笔资本，说明账目正确），但对保障方而言，「资本进得去出不来」是不能接受的产品状态。

### F4 — 入口清晰度（次要）：问 4 的两个字段看起来自相矛盾

问 4 同时给出 `"answer": "not yet — no compliant payment has been proven"` 和 `"sourceChainFilled": true`。这在语义上是**正确且诚实**的区分（源链确实已填充；CTC 侧尚未完成结算），也正是本产品要讲清的那件事，但字段名本身没有解释这个区别，第一次读会觉得矛盾。不是行为错误，是措辞问题。

### 未归入缺陷的既有限制（如实记录，非本次新发现）

- **测试替身限制**：源链代币是 `MockUSDC3009`，不复制真实 USDC 的代理/升级布局、黑名单与铸造控制；Attestcoin 区块证明器是 `MockAttestcoinProver`，只校验链键。CLI 每条命令都标注了 `TEST-DOUBLE`。
- **未实现的真实协议能力**：真实 Attestcoin 证明器接口、成本与失败模式均未接触；真实 USDC 语义未接触；单保障方、固定收款人与精确金额、无多资产、无批量。
- **演示控制不属于产品**：`advance --chain … --seconds N` 是演示用的时钟控制，真实环境不存在。README 与 `help` 均把它单独列在「Demo control」下，没有混进运营者流程。

---

## 验收后的修复

按「记录真实失败、用户结果和修复」的要求，上述 F1–F4 在记录之后修复，承诺与行为均未改动：

1. **F1** — README 三幕改为显式捕获 goalId，并给出可直接复制的 shell 形式。
2. **F2** — README 幕 B、幕 C 各自以 `create-goal` 开头，并加一句说明：一个目标一旦被支付就不能再开轮次，所以每一幕用新的业务编号。
3. **F3** — 新增 `withdraw-capital --amount N` 命令，暴露合约既有的未锁定资本提取能力；`help` 中列入保障方可用操作。新增 CLI 测试覆盖「存入 → 锁定部分 → 只能取出未锁定部分」。
4. **F4** — 问 4 增加一个说明字段，直说源链已填充与 CTC 侧已结算是两件事。

修复后的复验记录见 `evidence/stage2-recheck.md`。
