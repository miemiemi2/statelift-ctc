# Task 11 evidence — 三幕脚本、evidence 与文档整合

时间: 2026-09-13T09:42:46Z

## 全量测试

命令: `npm test`

结果：**106 个测试全部通过，0 失败**，耗时 435 秒。

已确认 legacy 测试未被破坏（tests/cli/*.test.js、tests/proof/*.test.cjs、tests/payment/escrow.test.cjs、tests/payment/fact-integration.test.cjs 全部在内）。tests/helpers.cjs 的 signers 由 5 扩到 6 对既有用法无影响。

顺带修正：package.json 的 test glob 原先只匹配 tests/cli/*.test.js，漏掉了新的 tests/cli/*.test.cjs（CLI 入口测试根本没被 npm test 跑到）。已补，并新增 test:contracts 与 test:cli 两个子集脚本。

```
✔ the router authorization cannot be redirected to pay the recipient directly (236.521165ms)
✔ zero round number and zero winner are rejected (266.485175ms)
ℹ tests 106
ℹ suites 0
ℹ pass 106
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 435324.109001
```

## 三幕一键脚本

命令: `npm run demo:three-acts`

自包含：自己起两条本地链、真实付款、真实验证跨链证明、走完三幕、再关掉。产出：
- evidence/three-acts.md（13 个状态快照 + 48 条命令的完整原始记录）
- evidence/three-acts-transitions.json（机器可读的状态转移）

**每个快照都断言资金对账等式** `escrow余额 == R在押 + 可用担保 + 锁定担保 + 可提取额度`，任一不成立脚本直接失败退出。本次 13 个快照全部成立。

脚本同时对产品行为做硬断言，不只是打印：幕 A 必须 SettledFromPrincipal 且付款来自 R；幕 B 必须 SettledFromGuarantee 且付款来自 B；幕 B 过 D 时第 1 问与第 2 问必须同时为 yes；幕 C 的替补付款必须被源链拒绝且收款人余额不变；幕 C2 的过期释放必须留下可接力的目标。

### 幕 B 的关键时刻（脚本实际输出）

```
### [B] past D: budget recovered AND old payment still unproven

- 目标状态: `Open`
- 轮次 1: `Refunded` (过T=true, 过D=true, 预算已归还=true)
- 问1 预算是否已归还: yes for round(s) 1
- 问2 旧付款是否待证明: yes — one or more rounds are uncleared, and the CTC side genuinely does not know whether a payment happened
```

## 文档整合

- README.md 重写为运营者手册：先讲买的是什么（demo-quote），再给三十秒一键跑通，再给三幕手动操作步骤，然后解释 status 四问为何分开、承诺如何落到代码、legacy 非产品路径的明确标注、以及一节「范围与诚实边界」列出所有不成立的说法。
- STATUS.md 重写：阶段 1 出口逐条核对表、关键发现与修复记录（1 个核心缺口 + 3 个真实产品缺陷 + 6 个工具链缺陷）、legacy 处置提醒、阶段 2 要求、6 条阻塞项/未解决。

## evidence/ 目录当前内容

```
cli
task02-source-proof-spike.md
task03-goal-router.md
task04-goal-fill-fact.md
task05-escrow-open.md
task06-act-a.md
task07-act-b.md
task08-act-c.md
task09-negative-fact.md
task10-operator-cli.md
task11-integration.md
three-acts-transitions.json
three-acts.md
```
