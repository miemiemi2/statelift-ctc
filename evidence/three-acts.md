# 三幕演示原始记录（自动生成）

生成命令: `npm run demo:three-acts`
生成时间: 2026-09-13T13:30:28.842Z

两条本地链真实运行；付款真实发生在源链；CTC 侧真实验证该付款的 Merkle-Patricia 证明。两个测试替身是源链代币（MockUSDC3009）与 Attestcoin 区块证明器（MockAttestcoinProver）。**这不是真实 testnet 集成，不得当作真实 testnet 集成报告。**

## 资金不变量

每一次状态快照都断言 `escrow 余额 == 轮次本金R + 可用担保 + 锁定担保B + 可提取额度`。本次共 13 个快照，全部成立（任一不成立脚本会直接失败退出）。

## 状态转移与四问快照

### [A] round open, nothing paid yet

- 目标状态: `Open`
- 轮次 1: `Pending` (过T=false, 过D=false, 预算已归还=false)
- 问1 预算是否已归还: no
- 问2 旧付款是否待证明: yes — one or more rounds are uncleared, and the CTC side genuinely does not know whether a payment happened
- 问3 是否可沿同一G接手: not yet — wait until the current round's T has passed
- 问4 最终是否只付一次: not yet — no compliant payment has been proven for this goal
- 资金: R在押=5150, B锁定=5150, 担保可用=34850, 可提取=31, 余额=45181, 对账=true

### [A] paid on the source chain, nothing proven on the CTC side

- 目标状态: `Open`
- 轮次 1: `Pending` (过T=false, 过D=false, 预算已归还=false)
- 问1 预算是否已归还: no
- 问2 旧付款是否待证明: yes — one or more rounds are uncleared, and the CTC side genuinely does not know whether a payment happened
- 问3 是否可沿同一G接手: not yet — wait until the current round's T has passed
- 问4 最终是否只付一次: not yet — no compliant payment has been proven for this goal
- 资金: R在押=5150, B锁定=5150, 担保可用=34850, 可提取=31, 余额=45181, 对账=true

### [A] fact provable but NOT settled

- 目标状态: `Open`
- 轮次 1: `Pending` (过T=false, 过D=false, 预算已归还=false)
- 问1 预算是否已归还: no
- 问2 旧付款是否待证明: yes — one or more rounds are uncleared, and the CTC side genuinely does not know whether a payment happened
- 问3 是否可沿同一G接手: not yet — wait until the current round's T has passed
- 问4 最终是否只付一次: not yet — no compliant payment has been proven for this goal
- 资金: R在押=5150, B锁定=5150, 担保可用=34850, 可提取=31, 余额=45181, 对账=true

### [A] settled before D: winner paid from R, guarantee released

- 目标状态: `Paid`
- 轮次 1: `SettledFromPrincipal` (过T=false, 过D=false, 预算已归还=false)
- 问1 预算是否已归还: no
- 问2 旧付款是否待证明: no
- 问3 是否可沿同一G接手: no — this goal is already filled on the source chain
- 问4 最终是否只付一次: yes — filled by round 1 on the source chain
- 资金: R在押=0, B锁定=0, 担保可用=40000, 可提取=5181, 余额=45181, 对账=true

### [B] paid, but the CTC side does not know it

- 目标状态: `Open`
- 轮次 1: `Pending` (过T=false, 过D=false, 预算已归还=false)
- 问1 预算是否已归还: no
- 问2 旧付款是否待证明: yes — one or more rounds are uncleared, and the CTC side genuinely does not know whether a payment happened
- 问3 是否可沿同一G接手: not yet — wait until the current round's T has passed
- 问4 最终是否只付一次: not yet — no compliant payment has been proven for this goal
- 资金: R在押=5150, B锁定=5150, 担保可用=74850, 可提取=5212, 余额=90362, 对账=true

### [B] past D: budget recovered AND old payment still unproven

- 目标状态: `Open`
- 轮次 1: `Refunded` (过T=true, 过D=true, 预算已归还=true)
- 问1 预算是否已归还: yes for round(s) 1
- 问2 旧付款是否待证明: yes — one or more rounds are uncleared, and the CTC side genuinely does not know whether a payment happened
- 问3 是否可沿同一G接手: yes — open the next round; a second real payment is impossible
- 问4 最终是否只付一次: not yet — no compliant payment has been proven for this goal
- 资金: R在押=0, B锁定=5150, 担保可用=74850, 可提取=10362, 余额=90362, 对账=true

### [B] late proof settled from B; the operator keeps R

- 目标状态: `Paid`
- 轮次 1: `SettledFromGuarantee` (过T=true, 过D=true, 预算已归还=true)
- 问1 预算是否已归还: yes for round(s) 1
- 问2 旧付款是否待证明: no
- 问3 是否可沿同一G接手: no — this goal is already filled on the source chain
- 问4 最终是否只付一次: yes — filled by round 1 on the source chain
- 资金: R在押=0, B锁定=0, 担保可用=74850, 可提取=15512, 余额=90362, 对账=true

### [C] past T1, operator does not know whether the old payment happened

- 目标状态: `Open`
- 轮次 1: `Pending` (过T=true, 过D=false, 预算已归还=false)
- 问1 预算是否已归还: no
- 问2 旧付款是否待证明: yes — one or more rounds are uncleared, and the CTC side genuinely does not know whether a payment happened
- 问3 是否可沿同一G接手: yes — open the next round; a second real payment is impossible
- 问4 最终是否只付一次: not yet — no compliant payment has been proven for this goal
- 资金: R在押=5150, B锁定=5150, 担保可用=109700, 可提取=15543, 余额=135543, 对账=true

### [C] replacement payment refused on the source chain, nothing spent

- 目标状态: `Open`
- 轮次 1: `Pending` (过T=true, 过D=false, 预算已归还=false)
- 轮次 2: `Pending` (过T=false, 过D=false, 预算已归还=false)
- 问1 预算是否已归还: no
- 问2 旧付款是否待证明: yes — one or more rounds are uncleared, and the CTC side genuinely does not know whether a payment happened
- 问3 是否可沿同一G接手: not yet — wait until the current round's T has passed
- 问4 最终是否只付一次: not yet — no compliant payment has been proven for this goal
- 资金: R在押=10300, B锁定=10300, 担保可用=104550, 可提取=15574, 余额=140724, 对账=true

### [C] old round settled from its B; the relay round unwound in full

- 目标状态: `Paid`
- 轮次 1: `SettledFromGuarantee` (过T=true, 过D=true, 预算已归还=true)
- 轮次 2: `Released` (过T=true, 过D=false, 预算已归还=true)
- 问1 预算是否已归还: yes for round(s) 1, 2
- 问2 旧付款是否待证明: no
- 问3 是否可沿同一G接手: no — this goal is already filled on the source chain
- 问4 最终是否只付一次: yes — filled by round 1 on the source chain
- 资金: R在押=0, B锁定=0, 担保可用=109700, 可提取=31024, 余额=140724, 对账=true

### [C2] round open, no payment

- 目标状态: `Open`
- 轮次 1: `Pending` (过T=false, 过D=false, 预算已归还=false)
- 问1 预算是否已归还: no
- 问2 旧付款是否待证明: yes — one or more rounds are uncleared, and the CTC side genuinely does not know whether a payment happened
- 问3 是否可沿同一G接手: not yet — wait until the current round's T has passed
- 问4 最终是否只付一次: not yet — no compliant payment has been proven for this goal
- 资金: R在押=5150, B锁定=5150, 担保可用=104550, 可提取=31055, 余额=145905, 对账=true

### [C2] R1 returned at D without proof; B1 stays locked and G remains open

- 目标状态: `Open`
- 轮次 1: `Refunded` (过T=true, 过D=true, 预算已归还=true)
- 问1 预算是否已归还: yes for round(s) 1
- 问2 旧付款是否待证明: yes — one or more rounds are uncleared, and the CTC side genuinely does not know whether a payment happened
- 问3 是否可沿同一G接手: yes — open the next round; a second real payment is impossible
- 问4 最终是否只付一次: not yet — no compliant payment has been proven for this goal
- 资金: R在押=0, B锁定=5150, 担保可用=104550, 可提取=36205, 余额=145905, 对账=true

### [C2] replacement executor completed the same goal

- 目标状态: `Paid`
- 轮次 1: `Released` (过T=true, 过D=true, 预算已归还=true)
- 轮次 2: `SettledFromPrincipal` (过T=false, 过D=false, 预算已归还=false)
- 问1 预算是否已归还: yes for round(s) 1
- 问2 旧付款是否待证明: no
- 问3 是否可沿同一G接手: no — this goal is already filled on the source chain
- 问4 最终是否只付一次: yes — filled by round 2 on the source chain
- 资金: R在押=0, B锁定=0, 担保可用=109700, 可提取=41386, 余额=151086, 对账=true

## 完整命令记录

### `node cli/operator.mjs demo-quote`

```
StateLift demo quote — every number below is a DEMO PARAMETER.
Not a market price, not an existing customer, not committed liquidity.

  What you are paying for a cross-chain payment goal G:

    R  budget            5150 local units   (includes the winner's full reward)
    B  dedicated guarantee 5150 local units (B >= R, reserved for THIS round only)
    T  source pay-by      opening + 600 s   (demo; product doc uses 1800 s)
    D  clearing deadline  opening + 900 s   (demo; product doc uses 7200 s)
    pi guarantee premium    31 local units  (~0.6% of R, earned at open, never refunded)

  What you get:
    1. The same goal G is paid AT MOST ONCE, enforced on the source chain.
       So if your executor vanishes you can hand G to someone else without
       ever risking a second real payment.
    2. If nothing has cleared by D, R becomes yours by chain-accepted time.
       Not by asking anyone, and not by winning a race to send a transaction.
    3. If the old payment turns out to have happened and the proof only lands
       after D, the winner is paid from B. You keep R.

  What the guarantor is on the hook for:
    Worst case they lose R (5150) and keep only pi (31). That happens exactly when
    the recipient really was paid and the proof was late. This is a priced,
    pre-funded liability, not risk-free float.

  Not covered: purchasing power of R, wall-clock withdrawal if the CTC chain halts,
  gas already spent, pi itself, or gifts sent straight to the recipient.

  Why a simpler tool is not the same thing:
    * Your own reserve fund     -> gives you cash, does NOT make retry safe.
    * A normal solver retry     -> can swap executors, but refund timing stays
                                   at someone's discretion and late payments have
                                   no funded backstop.
    * A plain timeout refunder  -> returns money, but after the refund a late
                                   payment has no source of funds, so you still
                                   dare not relay.
```

### `node cli/operator.mjs create-goal --ref demo-act-a`

```
{
  "testDouble": "TEST-DOUBLE: source token is MockUSDC3009 (not real USDC); Attestcoin prover is MockAttestcoinProver. Local demo only, not a testnet integration.",
  "goalId": "0x1d2558879c7de9e4dedb4d895d3ddd9bd1e58dcd0cb14a7f6b421340095e074f",
  "sourceChainDerivesSameId": true,
  "owner": "0xFFcf8FDEE72ac11b5c542428B35EEF5769C409f0",
  "recipient": "0xE11BA2b4D45Eaed5996Cd0823791E0C93114882d",
  "amount": "5000000000",
  "maxRounds": 8,
  "note": "Recipient and amount are now fixed for this goal. Every retry reuses this goalId."
}
```

### `node cli/operator.mjs deposit-capital --amount 40000`

```
{
  "guarantor": "0xd03ea8624C8C5987235048901fB614fDcA89b117",
  "available": "40000",
  "locked": "0",
  "note": "Only unlocked capital can be withdrawn. Capital backing a live round cannot."
}
```

### `node cli/operator.mjs open-round --goal 0x1d2558879c7de9e4dedb4d895d3ddd9bd1e58dcd0cb14a7f6b421340095e074f --pay-in 600 --clear-in 900`

```
{
  "roundId": "0x7c73c7ebe4928bc849f09c7c371ea91872b7e5041b1a1056e7f96500ed6c985c",
  "roundNumber": 1,
  "accepted": {
    "R_budget": "5150",
    "B_dedicatedGuarantee": "5150",
    "pi_premium": "31",
    "T_sourcePayBy": 1789306864,
    "D_clearingDeadline": 1789307164
  },
  "guarantorCapital": {
    "available": "34850",
    "locked": "5150"
  },
  "note": "All five terms are now immutable for this round."
}
```

### `node cli/operator.mjs status --goal 0x1d2558879c7de9e4dedb4d895d3ddd9bd1e58dcd0cb14a7f6b421340095e074f`

```
{
  "testDouble": "TEST-DOUBLE: source token is MockUSDC3009 (not real USDC); Attestcoin prover is MockAttestcoinProver. Local demo only, not a testnet integration.",
  "goalId": "0x1d2558879c7de9e4dedb4d895d3ddd9bd1e58dcd0cb14a7f6b421340095e074f",
  "goalState": "Open",
  "recipient": "0xE11BA2b4D45Eaed5996Cd0823791E0C93114882d",
  "amount": "5000000000",
  "chainTime": {
    "creditcoinSide": 1789306266,
    "source": 1789306261
  },
  "fourSeparateQuestions": {
    "1_budgetReturnedToYou": {
      "answer": "no",
      "recoveredCredits": "0"
    },
    "2_oldPaymentStillAwaitingProof": {
      "answer": "yes — one or more rounds are uncleared, and the CTC side genuinely does not know whether a payment happened",
      "unclearedRounds": [
        1
      ]
    },
    "3_canRelayOnThisSameGoal": {
      "answer": "not yet — wait until the current round's T has passed",
      "roundsUsed": "1 of 8"
    },
    "4_finalOutcomePaidExactlyOnce": {
      "answer": "not yet — no compliant payment has been proven for this goal",
      "readingThisField": "the source-chain fact and this side's settlement agree",
      "sourceChainFilled": false,
      "sourceChainWinningRound": null,
      "winnerRewardedOnce": false,
      "rewardedWinner": null
    }
  },
  "rounds": [
    {
      "roundNumber": 1,
      "roundId": "0x7c73c7ebe4928bc849f09c7c371ea91872b7e5041b1a1056e7f96500ed6c985c",
      "state": "Pending",
      "R_budget": "5150",
      "B_dedicatedGuarantee": "5150",
      "pi_premium": "31",
      "T_sourcePayBy": "1789306864",
      "D_clearingDeadline": "1789307164",
      "pastT": false,
      "pastD": false,
      "budgetReturnedToYou": false
    }
  ],
  "money": {
    "R_stillEscrowed": "5150",
    "B_lockedAgainstRounds": "5150",
    "guaranteeCapitalAvailable": "34850",
    "withdrawableCredits": "31",
    "escrowBalance": "45181",
    "balancesReconcile": true
  }
}
```

### `node cli/operator.mjs pay --goal 0x1d2558879c7de9e4dedb4d895d3ddd9bd1e58dcd0cb14a7f6b421340095e074f --round 1 --as executor`

```
{
  "testDouble": "TEST-DOUBLE: source token is MockUSDC3009 (not real USDC); Attestcoin prover is MockAttestcoinProver. Local demo only, not a testnet integration.",
  "paid": true,
  "sourceBlock": 5,
  "transactionIndex": 0,
  "payer": "0x22d491Bde2303f2f43325b2108D26f1eAbA1e32b",
  "winner": "0x22d491Bde2303f2f43325b2108D26f1eAbA1e32b",
  "recipientBalanceBefore": "0",
  "recipientBalanceAfter": "5000000000",
  "next": "node cli/operator.mjs prove --goal 0x1d2558879c7de9e4dedb4d895d3ddd9bd1e58dcd0cb14a7f6b421340095e074f"
}
```

### `node cli/operator.mjs status --goal 0x1d2558879c7de9e4dedb4d895d3ddd9bd1e58dcd0cb14a7f6b421340095e074f`

```
{
  "testDouble": "TEST-DOUBLE: source token is MockUSDC3009 (not real USDC); Attestcoin prover is MockAttestcoinProver. Local demo only, not a testnet integration.",
  "goalId": "0x1d2558879c7de9e4dedb4d895d3ddd9bd1e58dcd0cb14a7f6b421340095e074f",
  "goalState": "Open",
  "recipient": "0xE11BA2b4D45Eaed5996Cd0823791E0C93114882d",
  "amount": "5000000000",
  "chainTime": {
    "creditcoinSide": 1789306266,
    "source": 1789306268
  },
  "fourSeparateQuestions": {
    "1_budgetReturnedToYou": {
      "answer": "no",
      "recoveredCredits": "0"
    },
    "2_oldPaymentStillAwaitingProof": {
      "answer": "yes — one or more rounds are uncleared, and the CTC side genuinely does not know whether a payment happened",
      "unclearedRounds": [
        1
      ]
    },
    "3_canRelayOnThisSameGoal": {
      "answer": "not yet — wait until the current round's T has passed",
      "roundsUsed": "1 of 8"
    },
    "4_finalOutcomePaidExactlyOnce": {
      "answer": "not yet — no compliant payment has been proven for this goal",
      "readingThisField": "the source chain HAS been paid, but this side has not settled it yet — these are two different things, and telling them apart is the point of this product",
      "sourceChainFilled": true,
      "sourceChainWinningRound": "1",
      "winnerRewardedOnce": false,
      "rewardedWinner": null
    }
  },
  "rounds": [
    {
      "roundNumber": 1,
      "roundId": "0x7c73c7ebe4928bc849f09c7c371ea91872b7e5041b1a1056e7f96500ed6c985c",
      "state": "Pending",
      "R_budget": "5150",
      "B_dedicatedGuarantee": "5150",
      "pi_premium": "31",
      "T_sourcePayBy": "1789306864",
      "D_clearingDeadline": "1789307164",
      "pastT": false,
      "pastD": false,
      "budgetReturnedToYou": false
    }
  ],
  "money": {
    "R_stillEscrowed": "5150",
    "B_lockedAgainstRounds": "5150",
    "guaranteeCapitalAvailable": "34850",
    "withdrawableCredits": "31",
    "escrowBalance": "45181",
    "balancesReconcile": true
  }
}
```

### `node cli/operator.mjs prove --goal 0x1d2558879c7de9e4dedb4d895d3ddd9bd1e58dcd0cb14a7f6b421340095e074f`

```
{
  "anchoredSourceBlock": 5,
  "provenFact": {
    "winningRound": "1",
    "winner": "0x22d491Bde2303f2f43325b2108D26f1eAbA1e32b",
    "amount": "5000000000",
    "sourceTimestamp": "1789306268"
  },
  "evidenceFile": "evidence/cli/fill-0x1d255887.json",
  "important": "A provable fact is NOT settlement. Nothing has moved until you run settle.",
  "next": "node cli/operator.mjs settle --goal 0x1d2558879c7de9e4dedb4d895d3ddd9bd1e58dcd0cb14a7f6b421340095e074f --round 1"
}
```

### `node cli/operator.mjs status --goal 0x1d2558879c7de9e4dedb4d895d3ddd9bd1e58dcd0cb14a7f6b421340095e074f`

```
{
  "testDouble": "TEST-DOUBLE: source token is MockUSDC3009 (not real USDC); Attestcoin prover is MockAttestcoinProver. Local demo only, not a testnet integration.",
  "goalId": "0x1d2558879c7de9e4dedb4d895d3ddd9bd1e58dcd0cb14a7f6b421340095e074f",
  "goalState": "Open",
  "recipient": "0xE11BA2b4D45Eaed5996Cd0823791E0C93114882d",
  "amount": "5000000000",
  "chainTime": {
    "creditcoinSide": 1789306270,
    "source": 1789306268
  },
  "fourSeparateQuestions": {
    "1_budgetReturnedToYou": {
      "answer": "no",
      "recoveredCredits": "0"
    },
    "2_oldPaymentStillAwaitingProof": {
      "answer": "yes — one or more rounds are uncleared, and the CTC side genuinely does not know whether a payment happened",
      "unclearedRounds": [
        1
      ]
    },
    "3_canRelayOnThisSameGoal": {
      "answer": "not yet — wait until the current round's T has passed",
      "roundsUsed": "1 of 8"
    },
    "4_finalOutcomePaidExactlyOnce": {
      "answer": "not yet — no compliant payment has been proven for this goal",
      "readingThisField": "the source chain HAS been paid, but this side has not settled it yet — these are two different things, and telling them apart is the point of this product",
      "sourceChainFilled": true,
      "sourceChainWinningRound": "1",
      "winnerRewardedOnce": false,
      "rewardedWinner": null
    }
  },
  "rounds": [
    {
      "roundNumber": 1,
      "roundId": "0x7c73c7ebe4928bc849f09c7c371ea91872b7e5041b1a1056e7f96500ed6c985c",
      "state": "Pending",
      "R_budget": "5150",
      "B_dedicatedGuarantee": "5150",
      "pi_premium": "31",
      "T_sourcePayBy": "1789306864",
      "D_clearingDeadline": "1789307164",
      "pastT": false,
      "pastD": false,
      "budgetReturnedToYou": false
    }
  ],
  "money": {
    "R_stillEscrowed": "5150",
    "B_lockedAgainstRounds": "5150",
    "guaranteeCapitalAvailable": "34850",
    "withdrawableCredits": "31",
    "escrowBalance": "45181",
    "balancesReconcile": true
  }
}
```

### `node cli/operator.mjs settle --goal 0x1d2558879c7de9e4dedb4d895d3ddd9bd1e58dcd0cb14a7f6b421340095e074f --round 1`

```
{
  "roundId": "0x7c73c7ebe4928bc849f09c7c371ea91872b7e5041b1a1056e7f96500ed6c985c",
  "roundStateBefore": "Pending",
  "roundStateAfter": "SettledFromPrincipal",
  "winner": "0x22d491Bde2303f2f43325b2108D26f1eAbA1e32b",
  "amountPaidToWinner": "5150",
  "paidFrom": "R — your budget (the proof cleared before D)",
  "yourRecoveredBudget": "0",
  "events": [
    "RoundSettled"
  ]
}
```

### `node cli/operator.mjs status --goal 0x1d2558879c7de9e4dedb4d895d3ddd9bd1e58dcd0cb14a7f6b421340095e074f`

```
{
  "testDouble": "TEST-DOUBLE: source token is MockUSDC3009 (not real USDC); Attestcoin prover is MockAttestcoinProver. Local demo only, not a testnet integration.",
  "goalId": "0x1d2558879c7de9e4dedb4d895d3ddd9bd1e58dcd0cb14a7f6b421340095e074f",
  "goalState": "Paid",
  "recipient": "0xE11BA2b4D45Eaed5996Cd0823791E0C93114882d",
  "amount": "5000000000",
  "chainTime": {
    "creditcoinSide": 1789306276,
    "source": 1789306268
  },
  "fourSeparateQuestions": {
    "1_budgetReturnedToYou": {
      "answer": "no",
      "recoveredCredits": "0"
    },
    "2_oldPaymentStillAwaitingProof": {
      "answer": "no",
      "unclearedRounds": []
    },
    "3_canRelayOnThisSameGoal": {
      "answer": "no — this goal is already filled on the source chain",
      "roundsUsed": "1 of 8"
    },
    "4_finalOutcomePaidExactlyOnce": {
      "answer": "yes — filled by round 1 on the source chain",
      "readingThisField": "the source-chain fact and this side's settlement agree",
      "sourceChainFilled": true,
      "sourceChainWinningRound": "1",
      "winnerRewardedOnce": true,
      "rewardedWinner": "0x22d491Bde2303f2f43325b2108D26f1eAbA1e32b"
    }
  },
  "rounds": [
    {
      "roundNumber": 1,
      "roundId": "0x7c73c7ebe4928bc849f09c7c371ea91872b7e5041b1a1056e7f96500ed6c985c",
      "state": "SettledFromPrincipal",
      "R_budget": "5150",
      "B_dedicatedGuarantee": "5150",
      "pi_premium": "31",
      "T_sourcePayBy": "1789306864",
      "D_clearingDeadline": "1789307164",
      "pastT": false,
      "pastD": false,
      "budgetReturnedToYou": false
    }
  ],
  "money": {
    "R_stillEscrowed": "0",
    "B_lockedAgainstRounds": "0",
    "guaranteeCapitalAvailable": "40000",
    "withdrawableCredits": "5181",
    "escrowBalance": "45181",
    "balancesReconcile": true
  }
}
```

### `node cli/operator.mjs create-goal --ref demo-act-b`

```
{
  "testDouble": "TEST-DOUBLE: source token is MockUSDC3009 (not real USDC); Attestcoin prover is MockAttestcoinProver. Local demo only, not a testnet integration.",
  "goalId": "0xe8fd6d7b411d9245120551315533b2673b5008f8fc84b66605bd4e6c9a185644",
  "sourceChainDerivesSameId": true,
  "owner": "0xFFcf8FDEE72ac11b5c542428B35EEF5769C409f0",
  "recipient": "0xE11BA2b4D45Eaed5996Cd0823791E0C93114882d",
  "amount": "5000000000",
  "maxRounds": 8,
  "note": "Recipient and amount are now fixed for this goal. Every retry reuses this goalId."
}
```

### `node cli/operator.mjs deposit-capital --amount 40000`

```
{
  "guarantor": "0xd03ea8624C8C5987235048901fB614fDcA89b117",
  "available": "80000",
  "locked": "0",
  "note": "Only unlocked capital can be withdrawn. Capital backing a live round cannot."
}
```

### `node cli/operator.mjs open-round --goal 0xe8fd6d7b411d9245120551315533b2673b5008f8fc84b66605bd4e6c9a185644 --pay-in 300 --clear-in 600`

```
{
  "roundId": "0x40e90758ec7eed300eb983583b599f9afd84c7c8466ac8ae9e5cbaea1373cc48",
  "roundNumber": 1,
  "accepted": {
    "R_budget": "5150",
    "B_dedicatedGuarantee": "5150",
    "pi_premium": "31",
    "T_sourcePayBy": 1789306581,
    "D_clearingDeadline": 1789306881
  },
  "guarantorCapital": {
    "available": "74850",
    "locked": "5150"
  },
  "note": "All five terms are now immutable for this round."
}
```

### `node cli/operator.mjs pay --goal 0xe8fd6d7b411d9245120551315533b2673b5008f8fc84b66605bd4e6c9a185644 --round 1 --as executor`

```
{
  "testDouble": "TEST-DOUBLE: source token is MockUSDC3009 (not real USDC); Attestcoin prover is MockAttestcoinProver. Local demo only, not a testnet integration.",
  "paid": true,
  "sourceBlock": 6,
  "transactionIndex": 0,
  "payer": "0x22d491Bde2303f2f43325b2108D26f1eAbA1e32b",
  "winner": "0x22d491Bde2303f2f43325b2108D26f1eAbA1e32b",
  "recipientBalanceBefore": "5000000000",
  "recipientBalanceAfter": "10000000000",
  "next": "node cli/operator.mjs prove --goal 0xe8fd6d7b411d9245120551315533b2673b5008f8fc84b66605bd4e6c9a185644"
}
```

### `node cli/operator.mjs status --goal 0xe8fd6d7b411d9245120551315533b2673b5008f8fc84b66605bd4e6c9a185644`

```
{
  "testDouble": "TEST-DOUBLE: source token is MockUSDC3009 (not real USDC); Attestcoin prover is MockAttestcoinProver. Local demo only, not a testnet integration.",
  "goalId": "0xe8fd6d7b411d9245120551315533b2673b5008f8fc84b66605bd4e6c9a185644",
  "goalState": "Open",
  "recipient": "0xE11BA2b4D45Eaed5996Cd0823791E0C93114882d",
  "amount": "5000000000",
  "chainTime": {
    "creditcoinSide": 1789306282,
    "source": 1789306283
  },
  "fourSeparateQuestions": {
    "1_budgetReturnedToYou": {
      "answer": "no",
      "recoveredCredits": "0"
    },
    "2_oldPaymentStillAwaitingProof": {
      "answer": "yes — one or more rounds are uncleared, and the CTC side genuinely does not know whether a payment happened",
      "unclearedRounds": [
        1
      ]
    },
    "3_canRelayOnThisSameGoal": {
      "answer": "not yet — wait until the current round's T has passed",
      "roundsUsed": "1 of 8"
    },
    "4_finalOutcomePaidExactlyOnce": {
      "answer": "not yet — no compliant payment has been proven for this goal",
      "readingThisField": "the source chain HAS been paid, but this side has not settled it yet — these are two different things, and telling them apart is the point of this product",
      "sourceChainFilled": true,
      "sourceChainWinningRound": "1",
      "winnerRewardedOnce": false,
      "rewardedWinner": null
    }
  },
  "rounds": [
    {
      "roundNumber": 1,
      "roundId": "0x40e90758ec7eed300eb983583b599f9afd84c7c8466ac8ae9e5cbaea1373cc48",
      "state": "Pending",
      "R_budget": "5150",
      "B_dedicatedGuarantee": "5150",
      "pi_premium": "31",
      "T_sourcePayBy": "1789306581",
      "D_clearingDeadline": "1789306881",
      "pastT": false,
      "pastD": false,
      "budgetReturnedToYou": false
    }
  ],
  "money": {
    "R_stillEscrowed": "5150",
    "B_lockedAgainstRounds": "5150",
    "guaranteeCapitalAvailable": "74850",
    "withdrawableCredits": "5212",
    "escrowBalance": "90362",
    "balancesReconcile": true
  }
}
```

### `node cli/operator.mjs advance --chain ctc --seconds 700`

```
{
  "chain": "ctc",
  "advancedBy": 700,
  "newChainTimestamp": 1789306985,
  "note": "Deadlines are judged by chain-accepted time, so this moves the chain, not a clock in this process."
}
```

### `node cli/operator.mjs refund --goal 0xe8fd6d7b411d9245120551315533b2673b5008f8fc84b66605bd4e6c9a185644 --round 1`

```
{
  "roundId": "0x40e90758ec7eed300eb983583b599f9afd84c7c8466ac8ae9e5cbaea1373cc48",
  "roundState": "Refunded",
  "yourRecoveredBudget": "5150",
  "guaranteeStillLocked": "5150",
  "note": "The budget is yours as of D, by chain-accepted time. The guarantee stays locked because a payment may still turn out to have happened."
}
```

### `node cli/operator.mjs status --goal 0xe8fd6d7b411d9245120551315533b2673b5008f8fc84b66605bd4e6c9a185644`

```
{
  "testDouble": "TEST-DOUBLE: source token is MockUSDC3009 (not real USDC); Attestcoin prover is MockAttestcoinProver. Local demo only, not a testnet integration.",
  "goalId": "0xe8fd6d7b411d9245120551315533b2673b5008f8fc84b66605bd4e6c9a185644",
  "goalState": "Open",
  "recipient": "0xE11BA2b4D45Eaed5996Cd0823791E0C93114882d",
  "amount": "5000000000",
  "chainTime": {
    "creditcoinSide": 1789306987,
    "source": 1789306283
  },
  "fourSeparateQuestions": {
    "1_budgetReturnedToYou": {
      "answer": "yes for round(s) 1",
      "recoveredCredits": "5150"
    },
    "2_oldPaymentStillAwaitingProof": {
      "answer": "yes — one or more rounds are uncleared, and the CTC side genuinely does not know whether a payment happened",
      "unclearedRounds": [
        1
      ]
    },
    "3_canRelayOnThisSameGoal": {
      "answer": "yes — open the next round; a second real payment is impossible",
      "roundsUsed": "1 of 8"
    },
    "4_finalOutcomePaidExactlyOnce": {
      "answer": "not yet — no compliant payment has been proven for this goal",
      "readingThisField": "the source chain HAS been paid, but this side has not settled it yet — these are two different things, and telling them apart is the point of this product",
      "sourceChainFilled": true,
      "sourceChainWinningRound": "1",
      "winnerRewardedOnce": false,
      "rewardedWinner": null
    }
  },
  "rounds": [
    {
      "roundNumber": 1,
      "roundId": "0x40e90758ec7eed300eb983583b599f9afd84c7c8466ac8ae9e5cbaea1373cc48",
      "state": "Refunded",
      "R_budget": "5150",
      "B_dedicatedGuarantee": "5150",
      "pi_premium": "31",
      "T_sourcePayBy": "1789306581",
      "D_clearingDeadline": "1789306881",
      "pastT": true,
      "pastD": true,
      "budgetReturnedToYou": true
    }
  ],
  "money": {
    "R_stillEscrowed": "0",
    "B_lockedAgainstRounds": "5150",
    "guaranteeCapitalAvailable": "74850",
    "withdrawableCredits": "10362",
    "escrowBalance": "90362",
    "balancesReconcile": true
  }
}
```

### `node cli/operator.mjs prove --goal 0xe8fd6d7b411d9245120551315533b2673b5008f8fc84b66605bd4e6c9a185644`

```
{
  "anchoredSourceBlock": 6,
  "provenFact": {
    "winningRound": "1",
    "winner": "0x22d491Bde2303f2f43325b2108D26f1eAbA1e32b",
    "amount": "5000000000",
    "sourceTimestamp": "1789306283"
  },
  "evidenceFile": "evidence/cli/fill-0xe8fd6d7b.json",
  "important": "A provable fact is NOT settlement. Nothing has moved until you run settle.",
  "next": "node cli/operator.mjs settle --goal 0xe8fd6d7b411d9245120551315533b2673b5008f8fc84b66605bd4e6c9a185644 --round 1"
}
```

### `node cli/operator.mjs settle --goal 0xe8fd6d7b411d9245120551315533b2673b5008f8fc84b66605bd4e6c9a185644 --round 1 --as guarantor`

```
{
  "roundId": "0x40e90758ec7eed300eb983583b599f9afd84c7c8466ac8ae9e5cbaea1373cc48",
  "roundStateBefore": "Refunded",
  "roundStateAfter": "SettledFromGuarantee",
  "winner": "0x22d491Bde2303f2f43325b2108D26f1eAbA1e32b",
  "amountPaidToWinner": "5150",
  "paidFrom": "B — the dedicated guarantee (the proof landed at or after D, so your budget stayed yours)",
  "yourRecoveredBudget": "5150",
  "events": [
    "RoundSettled"
  ]
}
```

### `node cli/operator.mjs status --goal 0xe8fd6d7b411d9245120551315533b2673b5008f8fc84b66605bd4e6c9a185644`

```
{
  "testDouble": "TEST-DOUBLE: source token is MockUSDC3009 (not real USDC); Attestcoin prover is MockAttestcoinProver. Local demo only, not a testnet integration.",
  "goalId": "0xe8fd6d7b411d9245120551315533b2673b5008f8fc84b66605bd4e6c9a185644",
  "goalState": "Paid",
  "recipient": "0xE11BA2b4D45Eaed5996Cd0823791E0C93114882d",
  "amount": "5000000000",
  "chainTime": {
    "creditcoinSide": 1789306993,
    "source": 1789306283
  },
  "fourSeparateQuestions": {
    "1_budgetReturnedToYou": {
      "answer": "yes for round(s) 1",
      "recoveredCredits": "5150"
    },
    "2_oldPaymentStillAwaitingProof": {
      "answer": "no",
      "unclearedRounds": []
    },
    "3_canRelayOnThisSameGoal": {
      "answer": "no — this goal is already filled on the source chain",
      "roundsUsed": "1 of 8"
    },
    "4_finalOutcomePaidExactlyOnce": {
      "answer": "yes — filled by round 1 on the source chain",
      "readingThisField": "the source-chain fact and this side's settlement agree",
      "sourceChainFilled": true,
      "sourceChainWinningRound": "1",
      "winnerRewardedOnce": true,
      "rewardedWinner": "0x22d491Bde2303f2f43325b2108D26f1eAbA1e32b"
    }
  },
  "rounds": [
    {
      "roundNumber": 1,
      "roundId": "0x40e90758ec7eed300eb983583b599f9afd84c7c8466ac8ae9e5cbaea1373cc48",
      "state": "SettledFromGuarantee",
      "R_budget": "5150",
      "B_dedicatedGuarantee": "5150",
      "pi_premium": "31",
      "T_sourcePayBy": "1789306581",
      "D_clearingDeadline": "1789306881",
      "pastT": true,
      "pastD": true,
      "budgetReturnedToYou": true
    }
  ],
  "money": {
    "R_stillEscrowed": "0",
    "B_lockedAgainstRounds": "0",
    "guaranteeCapitalAvailable": "74850",
    "withdrawableCredits": "15512",
    "escrowBalance": "90362",
    "balancesReconcile": true
  }
}
```

### `node cli/operator.mjs create-goal --ref demo-act-c`

```
{
  "testDouble": "TEST-DOUBLE: source token is MockUSDC3009 (not real USDC); Attestcoin prover is MockAttestcoinProver. Local demo only, not a testnet integration.",
  "goalId": "0x6b66b60262aad91ee9089e02eb9142a1ad8fe762e08c4bfad41a1efb8d314b33",
  "sourceChainDerivesSameId": true,
  "owner": "0xFFcf8FDEE72ac11b5c542428B35EEF5769C409f0",
  "recipient": "0xE11BA2b4D45Eaed5996Cd0823791E0C93114882d",
  "amount": "5000000000",
  "maxRounds": 8,
  "note": "Recipient and amount are now fixed for this goal. Every retry reuses this goalId."
}
```

### `node cli/operator.mjs deposit-capital --amount 40000`

```
{
  "guarantor": "0xd03ea8624C8C5987235048901fB614fDcA89b117",
  "available": "114850",
  "locked": "0",
  "note": "Only unlocked capital can be withdrawn. Capital backing a live round cannot."
}
```

### `node cli/operator.mjs open-round --goal 0x6b66b60262aad91ee9089e02eb9142a1ad8fe762e08c4bfad41a1efb8d314b33 --pay-in 300 --clear-in 900`

```
{
  "roundId": "0x7da6353510316d6d672e19c8f7cb977537e4e0e0358a160dd3db05da81d07466",
  "roundNumber": 1,
  "accepted": {
    "R_budget": "5150",
    "B_dedicatedGuarantee": "5150",
    "pi_premium": "31",
    "T_sourcePayBy": 1789307298,
    "D_clearingDeadline": 1789307898
  },
  "guarantorCapital": {
    "available": "109700",
    "locked": "5150"
  },
  "note": "All five terms are now immutable for this round."
}
```

### `node cli/operator.mjs pay --goal 0x6b66b60262aad91ee9089e02eb9142a1ad8fe762e08c4bfad41a1efb8d314b33 --round 1 --as executor`

```
{
  "testDouble": "TEST-DOUBLE: source token is MockUSDC3009 (not real USDC); Attestcoin prover is MockAttestcoinProver. Local demo only, not a testnet integration.",
  "paid": true,
  "sourceBlock": 7,
  "transactionIndex": 0,
  "payer": "0x22d491Bde2303f2f43325b2108D26f1eAbA1e32b",
  "winner": "0x22d491Bde2303f2f43325b2108D26f1eAbA1e32b",
  "recipientBalanceBefore": "10000000000",
  "recipientBalanceAfter": "15000000000",
  "next": "node cli/operator.mjs prove --goal 0x6b66b60262aad91ee9089e02eb9142a1ad8fe762e08c4bfad41a1efb8d314b33"
}
```

### `node cli/operator.mjs advance --chain ctc --seconds 400`

```
{
  "chain": "ctc",
  "advancedBy": 400,
  "newChainTimestamp": 1789307402,
  "note": "Deadlines are judged by chain-accepted time, so this moves the chain, not a clock in this process."
}
```

### `node cli/operator.mjs status --goal 0x6b66b60262aad91ee9089e02eb9142a1ad8fe762e08c4bfad41a1efb8d314b33`

```
{
  "testDouble": "TEST-DOUBLE: source token is MockUSDC3009 (not real USDC); Attestcoin prover is MockAttestcoinProver. Local demo only, not a testnet integration.",
  "goalId": "0x6b66b60262aad91ee9089e02eb9142a1ad8fe762e08c4bfad41a1efb8d314b33",
  "goalState": "Open",
  "recipient": "0xE11BA2b4D45Eaed5996Cd0823791E0C93114882d",
  "amount": "5000000000",
  "chainTime": {
    "creditcoinSide": 1789307402,
    "source": 1789306301
  },
  "fourSeparateQuestions": {
    "1_budgetReturnedToYou": {
      "answer": "no",
      "recoveredCredits": "0"
    },
    "2_oldPaymentStillAwaitingProof": {
      "answer": "yes — one or more rounds are uncleared, and the CTC side genuinely does not know whether a payment happened",
      "unclearedRounds": [
        1
      ]
    },
    "3_canRelayOnThisSameGoal": {
      "answer": "yes — open the next round; a second real payment is impossible",
      "roundsUsed": "1 of 8"
    },
    "4_finalOutcomePaidExactlyOnce": {
      "answer": "not yet — no compliant payment has been proven for this goal",
      "readingThisField": "the source chain HAS been paid, but this side has not settled it yet — these are two different things, and telling them apart is the point of this product",
      "sourceChainFilled": true,
      "sourceChainWinningRound": "1",
      "winnerRewardedOnce": false,
      "rewardedWinner": null
    }
  },
  "rounds": [
    {
      "roundNumber": 1,
      "roundId": "0x7da6353510316d6d672e19c8f7cb977537e4e0e0358a160dd3db05da81d07466",
      "state": "Pending",
      "R_budget": "5150",
      "B_dedicatedGuarantee": "5150",
      "pi_premium": "31",
      "T_sourcePayBy": "1789307298",
      "D_clearingDeadline": "1789307898",
      "pastT": true,
      "pastD": false,
      "budgetReturnedToYou": false
    }
  ],
  "money": {
    "R_stillEscrowed": "5150",
    "B_lockedAgainstRounds": "5150",
    "guaranteeCapitalAvailable": "109700",
    "withdrawableCredits": "15543",
    "escrowBalance": "135543",
    "balancesReconcile": true
  }
}
```

### `node cli/operator.mjs open-round --goal 0x6b66b60262aad91ee9089e02eb9142a1ad8fe762e08c4bfad41a1efb8d314b33 --round 2 --pay-in 300 --clear-in 900`

```
{
  "roundId": "0x86e2d07d5ef17695998a660f0b5798cfe31f8f7b35c305674fc2676bb20e276b",
  "roundNumber": 2,
  "accepted": {
    "R_budget": "5150",
    "B_dedicatedGuarantee": "5150",
    "pi_premium": "31",
    "T_sourcePayBy": 1789307702,
    "D_clearingDeadline": 1789308302
  },
  "guarantorCapital": {
    "available": "104550",
    "locked": "10300"
  },
  "note": "All five terms are now immutable for this round."
}
```

### `node cli/operator.mjs pay --goal 0x6b66b60262aad91ee9089e02eb9142a1ad8fe762e08c4bfad41a1efb8d314b33 --round 2 --as executor2`  (预期失败)

```
{
  "testDouble": "TEST-DOUBLE: source token is MockUSDC3009 (not real USDC); Attestcoin prover is MockAttestcoinProver. Local demo only, not a testnet integration.",
  "paid": false,
  "reason": "this goal was ALREADY filled on the source chain, so a second payment is impossible",
  "alreadyFilledBy": {
    "roundNumber": "1",
    "winner": "0x22d491Bde2303f2f43325b2108D26f1eAbA1e32b"
  },
  "recipientBalanceUnchanged": true,
  "note": "No tokens were spent by this attempt. This is what makes relay safe."
}
```

### `node cli/operator.mjs status --goal 0x6b66b60262aad91ee9089e02eb9142a1ad8fe762e08c4bfad41a1efb8d314b33`

```
{
  "testDouble": "TEST-DOUBLE: source token is MockUSDC3009 (not real USDC); Attestcoin prover is MockAttestcoinProver. Local demo only, not a testnet integration.",
  "goalId": "0x6b66b60262aad91ee9089e02eb9142a1ad8fe762e08c4bfad41a1efb8d314b33",
  "goalState": "Open",
  "recipient": "0xE11BA2b4D45Eaed5996Cd0823791E0C93114882d",
  "amount": "5000000000",
  "chainTime": {
    "creditcoinSide": 1789307404,
    "source": 1789306305
  },
  "fourSeparateQuestions": {
    "1_budgetReturnedToYou": {
      "answer": "no",
      "recoveredCredits": "0"
    },
    "2_oldPaymentStillAwaitingProof": {
      "answer": "yes — one or more rounds are uncleared, and the CTC side genuinely does not know whether a payment happened",
      "unclearedRounds": [
        1,
        2
      ]
    },
    "3_canRelayOnThisSameGoal": {
      "answer": "not yet — wait until the current round's T has passed",
      "roundsUsed": "2 of 8"
    },
    "4_finalOutcomePaidExactlyOnce": {
      "answer": "not yet — no compliant payment has been proven for this goal",
      "readingThisField": "the source chain HAS been paid, but this side has not settled it yet — these are two different things, and telling them apart is the point of this product",
      "sourceChainFilled": true,
      "sourceChainWinningRound": "1",
      "winnerRewardedOnce": false,
      "rewardedWinner": null
    }
  },
  "rounds": [
    {
      "roundNumber": 1,
      "roundId": "0x7da6353510316d6d672e19c8f7cb977537e4e0e0358a160dd3db05da81d07466",
      "state": "Pending",
      "R_budget": "5150",
      "B_dedicatedGuarantee": "5150",
      "pi_premium": "31",
      "T_sourcePayBy": "1789307298",
      "D_clearingDeadline": "1789307898",
      "pastT": true,
      "pastD": false,
      "budgetReturnedToYou": false
    },
    {
      "roundNumber": 2,
      "roundId": "0x86e2d07d5ef17695998a660f0b5798cfe31f8f7b35c305674fc2676bb20e276b",
      "state": "Pending",
      "R_budget": "5150",
      "B_dedicatedGuarantee": "5150",
      "pi_premium": "31",
      "T_sourcePayBy": "1789307702",
      "D_clearingDeadline": "1789308302",
      "pastT": false,
      "pastD": false,
      "budgetReturnedToYou": false
    }
  ],
  "money": {
    "R_stillEscrowed": "10300",
    "B_lockedAgainstRounds": "10300",
    "guaranteeCapitalAvailable": "104550",
    "withdrawableCredits": "15574",
    "escrowBalance": "140724",
    "balancesReconcile": true
  }
}
```

### `node cli/operator.mjs advance --chain ctc --seconds 700`

```
{
  "chain": "ctc",
  "advancedBy": 700,
  "newChainTimestamp": 1789308107,
  "note": "Deadlines are judged by chain-accepted time, so this moves the chain, not a clock in this process."
}
```

### `node cli/operator.mjs refund --goal 0x6b66b60262aad91ee9089e02eb9142a1ad8fe762e08c4bfad41a1efb8d314b33 --round 1`

```
{
  "roundId": "0x7da6353510316d6d672e19c8f7cb977537e4e0e0358a160dd3db05da81d07466",
  "roundState": "Refunded",
  "yourRecoveredBudget": "10300",
  "guaranteeStillLocked": "10300",
  "note": "The budget is yours as of D, by chain-accepted time. The guarantee stays locked because a payment may still turn out to have happened."
}
```

### `node cli/operator.mjs prove --goal 0x6b66b60262aad91ee9089e02eb9142a1ad8fe762e08c4bfad41a1efb8d314b33`

```
{
  "anchoredSourceBlock": 7,
  "provenFact": {
    "winningRound": "1",
    "winner": "0x22d491Bde2303f2f43325b2108D26f1eAbA1e32b",
    "amount": "5000000000",
    "sourceTimestamp": "1789306301"
  },
  "evidenceFile": "evidence/cli/fill-0x6b66b602.json",
  "important": "A provable fact is NOT settlement. Nothing has moved until you run settle.",
  "next": "node cli/operator.mjs settle --goal 0x6b66b60262aad91ee9089e02eb9142a1ad8fe762e08c4bfad41a1efb8d314b33 --round 1"
}
```

### `node cli/operator.mjs settle --goal 0x6b66b60262aad91ee9089e02eb9142a1ad8fe762e08c4bfad41a1efb8d314b33 --round 1 --as guarantor`

```
{
  "roundId": "0x7da6353510316d6d672e19c8f7cb977537e4e0e0358a160dd3db05da81d07466",
  "roundStateBefore": "Refunded",
  "roundStateAfter": "SettledFromGuarantee",
  "winner": "0x22d491Bde2303f2f43325b2108D26f1eAbA1e32b",
  "amountPaidToWinner": "5150",
  "paidFrom": "B — the dedicated guarantee (the proof landed at or after D, so your budget stayed yours)",
  "yourRecoveredBudget": "10300",
  "events": [
    "RoundSettled"
  ]
}
```

### `node cli/operator.mjs release --goal 0x6b66b60262aad91ee9089e02eb9142a1ad8fe762e08c4bfad41a1efb8d314b33 --round 2 --by winner`

```
{
  "roundId": "0x86e2d07d5ef17695998a660f0b5798cfe31f8f7b35c305674fc2676bb20e276b",
  "releasedBy": "winner",
  "roundState": "Released",
  "guarantorAvailable": "109700",
  "guarantorLocked": "0",
  "yourRecoveredBudget": "15450",
  "goalStillOpenForRelay": "no — the goal was filled on the source chain"
}
```

### `node cli/operator.mjs status --goal 0x6b66b60262aad91ee9089e02eb9142a1ad8fe762e08c4bfad41a1efb8d314b33`

```
{
  "testDouble": "TEST-DOUBLE: source token is MockUSDC3009 (not real USDC); Attestcoin prover is MockAttestcoinProver. Local demo only, not a testnet integration.",
  "goalId": "0x6b66b60262aad91ee9089e02eb9142a1ad8fe762e08c4bfad41a1efb8d314b33",
  "goalState": "Paid",
  "recipient": "0xE11BA2b4D45Eaed5996Cd0823791E0C93114882d",
  "amount": "5000000000",
  "chainTime": {
    "creditcoinSide": 1789308118,
    "source": 1789306305
  },
  "fourSeparateQuestions": {
    "1_budgetReturnedToYou": {
      "answer": "yes for round(s) 1, 2",
      "recoveredCredits": "10300"
    },
    "2_oldPaymentStillAwaitingProof": {
      "answer": "no",
      "unclearedRounds": []
    },
    "3_canRelayOnThisSameGoal": {
      "answer": "no — this goal is already filled on the source chain",
      "roundsUsed": "2 of 8"
    },
    "4_finalOutcomePaidExactlyOnce": {
      "answer": "yes — filled by round 1 on the source chain",
      "readingThisField": "the source-chain fact and this side's settlement agree",
      "sourceChainFilled": true,
      "sourceChainWinningRound": "1",
      "winnerRewardedOnce": true,
      "rewardedWinner": "0x22d491Bde2303f2f43325b2108D26f1eAbA1e32b"
    }
  },
  "rounds": [
    {
      "roundNumber": 1,
      "roundId": "0x7da6353510316d6d672e19c8f7cb977537e4e0e0358a160dd3db05da81d07466",
      "state": "SettledFromGuarantee",
      "R_budget": "5150",
      "B_dedicatedGuarantee": "5150",
      "pi_premium": "31",
      "T_sourcePayBy": "1789307298",
      "D_clearingDeadline": "1789307898",
      "pastT": true,
      "pastD": true,
      "budgetReturnedToYou": true
    },
    {
      "roundNumber": 2,
      "roundId": "0x86e2d07d5ef17695998a660f0b5798cfe31f8f7b35c305674fc2676bb20e276b",
      "state": "Released",
      "R_budget": "5150",
      "B_dedicatedGuarantee": "5150",
      "pi_premium": "31",
      "T_sourcePayBy": "1789307702",
      "D_clearingDeadline": "1789308302",
      "pastT": true,
      "pastD": false,
      "budgetReturnedToYou": true
    }
  ],
  "money": {
    "R_stillEscrowed": "0",
    "B_lockedAgainstRounds": "0",
    "guaranteeCapitalAvailable": "109700",
    "withdrawableCredits": "31024",
    "escrowBalance": "140724",
    "balancesReconcile": true
  }
}
```

### `node cli/operator.mjs create-goal --ref demo-act-c-unpaid`

```
{
  "testDouble": "TEST-DOUBLE: source token is MockUSDC3009 (not real USDC); Attestcoin prover is MockAttestcoinProver. Local demo only, not a testnet integration.",
  "goalId": "0x1d2aa5f1f1cdfac8799b0e58e840d8eb68e2993b5a5760070ca2d944be65b727",
  "sourceChainDerivesSameId": true,
  "owner": "0xFFcf8FDEE72ac11b5c542428B35EEF5769C409f0",
  "recipient": "0xE11BA2b4D45Eaed5996Cd0823791E0C93114882d",
  "amount": "5000000000",
  "maxRounds": 8,
  "note": "Recipient and amount are now fixed for this goal. Every retry reuses this goalId."
}
```

### `node cli/operator.mjs open-round --goal 0x1d2aa5f1f1cdfac8799b0e58e840d8eb68e2993b5a5760070ca2d944be65b727 --pay-in 120 --clear-in 900`

```
{
  "roundId": "0xa434387d181425844dca0b8db55af626026d411f6a363d4d184ab852eee7dc4b",
  "roundNumber": 1,
  "accepted": {
    "R_budget": "5150",
    "B_dedicatedGuarantee": "5150",
    "pi_premium": "31",
    "T_sourcePayBy": 1789308241,
    "D_clearingDeadline": 1789309021
  },
  "guarantorCapital": {
    "available": "104550",
    "locked": "5150"
  },
  "note": "All five terms are now immutable for this round."
}
```

### `node cli/operator.mjs status --goal 0x1d2aa5f1f1cdfac8799b0e58e840d8eb68e2993b5a5760070ca2d944be65b727`

```
{
  "testDouble": "TEST-DOUBLE: source token is MockUSDC3009 (not real USDC); Attestcoin prover is MockAttestcoinProver. Local demo only, not a testnet integration.",
  "goalId": "0x1d2aa5f1f1cdfac8799b0e58e840d8eb68e2993b5a5760070ca2d944be65b727",
  "goalState": "Open",
  "recipient": "0xE11BA2b4D45Eaed5996Cd0823791E0C93114882d",
  "amount": "5000000000",
  "chainTime": {
    "creditcoinSide": 1789308123,
    "source": 1789306305
  },
  "fourSeparateQuestions": {
    "1_budgetReturnedToYou": {
      "answer": "no",
      "recoveredCredits": "0"
    },
    "2_oldPaymentStillAwaitingProof": {
      "answer": "yes — one or more rounds are uncleared, and the CTC side genuinely does not know whether a payment happened",
      "unclearedRounds": [
        1
      ]
    },
    "3_canRelayOnThisSameGoal": {
      "answer": "not yet — wait until the current round's T has passed",
      "roundsUsed": "1 of 8"
    },
    "4_finalOutcomePaidExactlyOnce": {
      "answer": "not yet — no compliant payment has been proven for this goal",
      "readingThisField": "the source-chain fact and this side's settlement agree",
      "sourceChainFilled": false,
      "sourceChainWinningRound": null,
      "winnerRewardedOnce": false,
      "rewardedWinner": null
    }
  },
  "rounds": [
    {
      "roundNumber": 1,
      "roundId": "0xa434387d181425844dca0b8db55af626026d411f6a363d4d184ab852eee7dc4b",
      "state": "Pending",
      "R_budget": "5150",
      "B_dedicatedGuarantee": "5150",
      "pi_premium": "31",
      "T_sourcePayBy": "1789308241",
      "D_clearingDeadline": "1789309021",
      "pastT": false,
      "pastD": false,
      "budgetReturnedToYou": false
    }
  ],
  "money": {
    "R_stillEscrowed": "5150",
    "B_lockedAgainstRounds": "5150",
    "guaranteeCapitalAvailable": "104550",
    "withdrawableCredits": "31055",
    "escrowBalance": "145905",
    "balancesReconcile": true
  }
}
```

### `node cli/operator.mjs advance --chain ctc --seconds 1000`

```
{
  "chain": "ctc",
  "advancedBy": 1000,
  "newChainTimestamp": 1789309125,
  "note": "Deadlines are judged by chain-accepted time, so this moves the chain, not a clock in this process."
}
```

### `node cli/operator.mjs refund --goal 0x1d2aa5f1f1cdfac8799b0e58e840d8eb68e2993b5a5760070ca2d944be65b727 --round 1`

```
{
  "roundId": "0xa434387d181425844dca0b8db55af626026d411f6a363d4d184ab852eee7dc4b",
  "roundState": "Refunded",
  "yourRecoveredBudget": "20600",
  "guaranteeStillLocked": "5150",
  "note": "The budget is yours as of D, by chain-accepted time. The guarantee stays locked because a payment may still turn out to have happened."
}
```

### `node cli/operator.mjs status --goal 0x1d2aa5f1f1cdfac8799b0e58e840d8eb68e2993b5a5760070ca2d944be65b727`

```
{
  "testDouble": "TEST-DOUBLE: source token is MockUSDC3009 (not real USDC); Attestcoin prover is MockAttestcoinProver. Local demo only, not a testnet integration.",
  "goalId": "0x1d2aa5f1f1cdfac8799b0e58e840d8eb68e2993b5a5760070ca2d944be65b727",
  "goalState": "Open",
  "recipient": "0xE11BA2b4D45Eaed5996Cd0823791E0C93114882d",
  "amount": "5000000000",
  "chainTime": {
    "creditcoinSide": 1789309126,
    "source": 1789306305
  },
  "fourSeparateQuestions": {
    "1_budgetReturnedToYou": {
      "answer": "yes for round(s) 1",
      "recoveredCredits": "5150"
    },
    "2_oldPaymentStillAwaitingProof": {
      "answer": "yes — one or more rounds are uncleared, and the CTC side genuinely does not know whether a payment happened",
      "unclearedRounds": [
        1
      ]
    },
    "3_canRelayOnThisSameGoal": {
      "answer": "yes — open the next round; a second real payment is impossible",
      "roundsUsed": "1 of 8"
    },
    "4_finalOutcomePaidExactlyOnce": {
      "answer": "not yet — no compliant payment has been proven for this goal",
      "readingThisField": "the source-chain fact and this side's settlement agree",
      "sourceChainFilled": false,
      "sourceChainWinningRound": null,
      "winnerRewardedOnce": false,
      "rewardedWinner": null
    }
  },
  "rounds": [
    {
      "roundNumber": 1,
      "roundId": "0xa434387d181425844dca0b8db55af626026d411f6a363d4d184ab852eee7dc4b",
      "state": "Refunded",
      "R_budget": "5150",
      "B_dedicatedGuarantee": "5150",
      "pi_premium": "31",
      "T_sourcePayBy": "1789308241",
      "D_clearingDeadline": "1789309021",
      "pastT": true,
      "pastD": true,
      "budgetReturnedToYou": true
    }
  ],
  "money": {
    "R_stillEscrowed": "0",
    "B_lockedAgainstRounds": "5150",
    "guaranteeCapitalAvailable": "104550",
    "withdrawableCredits": "36205",
    "escrowBalance": "145905",
    "balancesReconcile": true
  }
}
```

### `node cli/operator.mjs open-round --goal 0x1d2aa5f1f1cdfac8799b0e58e840d8eb68e2993b5a5760070ca2d944be65b727 --round 2 --pay-in 5000 --clear-in 5300`

```
{
  "roundId": "0xb28a044dfbedc13441c2f6e3dbe64d4d9130e986efcf0ef2249dd31f617caa75",
  "roundNumber": 2,
  "accepted": {
    "R_budget": "5150",
    "B_dedicatedGuarantee": "5150",
    "pi_premium": "31",
    "T_sourcePayBy": 1789314126,
    "D_clearingDeadline": 1789314426
  },
  "guarantorCapital": {
    "available": "99400",
    "locked": "10300"
  },
  "note": "All five terms are now immutable for this round."
}
```

### `node cli/operator.mjs pay --goal 0x1d2aa5f1f1cdfac8799b0e58e840d8eb68e2993b5a5760070ca2d944be65b727 --round 2 --as executor2`

```
{
  "testDouble": "TEST-DOUBLE: source token is MockUSDC3009 (not real USDC); Attestcoin prover is MockAttestcoinProver. Local demo only, not a testnet integration.",
  "paid": true,
  "sourceBlock": 9,
  "transactionIndex": 0,
  "payer": "0x95cED938F7991cd0dFcb48F0a06a40FA1aF46EBC",
  "winner": "0x95cED938F7991cd0dFcb48F0a06a40FA1aF46EBC",
  "recipientBalanceBefore": "15000000000",
  "recipientBalanceAfter": "20000000000",
  "next": "node cli/operator.mjs prove --goal 0x1d2aa5f1f1cdfac8799b0e58e840d8eb68e2993b5a5760070ca2d944be65b727"
}
```

### `node cli/operator.mjs prove --goal 0x1d2aa5f1f1cdfac8799b0e58e840d8eb68e2993b5a5760070ca2d944be65b727`

```
{
  "anchoredSourceBlock": 9,
  "provenFact": {
    "winningRound": "2",
    "winner": "0x95cED938F7991cd0dFcb48F0a06a40FA1aF46EBC",
    "amount": "5000000000",
    "sourceTimestamp": "1789306329"
  },
  "evidenceFile": "evidence/cli/fill-0x1d2aa5f1.json",
  "important": "A provable fact is NOT settlement. Nothing has moved until you run settle.",
  "next": "node cli/operator.mjs settle --goal 0x1d2aa5f1f1cdfac8799b0e58e840d8eb68e2993b5a5760070ca2d944be65b727 --round 2"
}
```

### `node cli/operator.mjs settle --goal 0x1d2aa5f1f1cdfac8799b0e58e840d8eb68e2993b5a5760070ca2d944be65b727 --round 2`

```
{
  "roundId": "0xb28a044dfbedc13441c2f6e3dbe64d4d9130e986efcf0ef2249dd31f617caa75",
  "roundStateBefore": "Pending",
  "roundStateAfter": "SettledFromPrincipal",
  "winner": "0x95cED938F7991cd0dFcb48F0a06a40FA1aF46EBC",
  "amountPaidToWinner": "5150",
  "paidFrom": "R — your budget (the proof cleared before D)",
  "yourRecoveredBudget": "20600",
  "events": [
    "RoundSettled"
  ]
}
```

### `node cli/operator.mjs release --goal 0x1d2aa5f1f1cdfac8799b0e58e840d8eb68e2993b5a5760070ca2d944be65b727 --round 1 --by winner`

```
{
  "roundId": "0xa434387d181425844dca0b8db55af626026d411f6a363d4d184ab852eee7dc4b",
  "releasedBy": "winner",
  "roundState": "Released",
  "guarantorAvailable": "109700",
  "guarantorLocked": "0",
  "yourRecoveredBudget": "20600",
  "goalStillOpenForRelay": "no — the goal was filled on the source chain"
}
```

### `node cli/operator.mjs status --goal 0x1d2aa5f1f1cdfac8799b0e58e840d8eb68e2993b5a5760070ca2d944be65b727`

```
{
  "testDouble": "TEST-DOUBLE: source token is MockUSDC3009 (not real USDC); Attestcoin prover is MockAttestcoinProver. Local demo only, not a testnet integration.",
  "goalId": "0x1d2aa5f1f1cdfac8799b0e58e840d8eb68e2993b5a5760070ca2d944be65b727",
  "goalState": "Paid",
  "recipient": "0xE11BA2b4D45Eaed5996Cd0823791E0C93114882d",
  "amount": "5000000000",
  "chainTime": {
    "creditcoinSide": 1789309139,
    "source": 1789306329
  },
  "fourSeparateQuestions": {
    "1_budgetReturnedToYou": {
      "answer": "yes for round(s) 1",
      "recoveredCredits": "5150"
    },
    "2_oldPaymentStillAwaitingProof": {
      "answer": "no",
      "unclearedRounds": []
    },
    "3_canRelayOnThisSameGoal": {
      "answer": "no — this goal is already filled on the source chain",
      "roundsUsed": "2 of 8"
    },
    "4_finalOutcomePaidExactlyOnce": {
      "answer": "yes — filled by round 2 on the source chain",
      "readingThisField": "the source-chain fact and this side's settlement agree",
      "sourceChainFilled": true,
      "sourceChainWinningRound": "2",
      "winnerRewardedOnce": true,
      "rewardedWinner": "0x95cED938F7991cd0dFcb48F0a06a40FA1aF46EBC"
    }
  },
  "rounds": [
    {
      "roundNumber": 1,
      "roundId": "0xa434387d181425844dca0b8db55af626026d411f6a363d4d184ab852eee7dc4b",
      "state": "Released",
      "R_budget": "5150",
      "B_dedicatedGuarantee": "5150",
      "pi_premium": "31",
      "T_sourcePayBy": "1789308241",
      "D_clearingDeadline": "1789309021",
      "pastT": true,
      "pastD": true,
      "budgetReturnedToYou": true
    },
    {
      "roundNumber": 2,
      "roundId": "0xb28a044dfbedc13441c2f6e3dbe64d4d9130e986efcf0ef2249dd31f617caa75",
      "state": "SettledFromPrincipal",
      "R_budget": "5150",
      "B_dedicatedGuarantee": "5150",
      "pi_premium": "31",
      "T_sourcePayBy": "1789314126",
      "D_clearingDeadline": "1789314426",
      "pastT": false,
      "pastD": false,
      "budgetReturnedToYou": false
    }
  ],
  "money": {
    "R_stillEscrowed": "0",
    "B_lockedAgainstRounds": "0",
    "guaranteeCapitalAvailable": "109700",
    "withdrawableCredits": "41386",
    "escrowBalance": "151086",
    "balancesReconcile": true
  }
}
```
