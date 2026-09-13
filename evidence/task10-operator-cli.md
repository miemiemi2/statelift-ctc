# Task 10 evidence — 运营者 CLI 与显式状态面板

命令: node --test tests/cli/operator.test.cjs
时间: 2026-09-13T09:27:31Z

测试方式：以**真实子进程**运行 cli/operator.mjs，对着两条真实本地链，完全按第一次上手的运营者的用法。这一组测试守的是产品入口，不是合约。

## 四问不合并

status 把四件事拆成四个独立字段，任何阶段都不合并成一个模糊状态词：
1. 预算是否已归还给你
2. 旧付款是否仍在等证明（并明确说出 CTC 侧"确实不知道付没付"）
3. 是否可以沿同一 G 接手
4. 最终是否只付了一次

幕 B 是关键：过 D 退款后，第 1 问和第 2 问**同时为 yes**。这正是普通看板会糊成一句话、而本产品必须分开讲的情形。

## 本任务发现并修复的一个真实产品缺口

CLI 测试暴露出：一个已被过期证明退役（Released）的轮次，仍然会因为 CTC 本地时钟没到该轮 T 而阻止开新轮（PreviousRoundStillLive）。这与"早释放"的目的自相矛盾。

已修 StateLiftGoalEscrow.openRound：若上一轮状态为 Released 则不再要求等待时钟，因为 Released 只能由源链证明达成，而源链证明比本链时钟是更强的证据。合约层新增两个测试覆盖（tests/goal/negative-fact.test.cjs 现 12 个测试全通过）。

## 其他修复

1. ethers 的 JSON-RPC 批处理与 ganache 不兼容，表现为不透明的 "could not coalesce error"。已设 batchMaxCount: 1。
2. ethers 默认缓存 eth_getTransactionCount 250ms，导致连续交易复用同一 nonce，**所有合约静默部署到同一地址**。已设 cacheTimeout: -1。这是本任务最隐蔽的缺陷。
3. 事件日志的 .index 是区块内日志序号，而回执树以**交易序号**为键。prove 原先用错，表现为 MissingReceipt。已改用 log.transactionIndex。
4. 每次 CLI 调用都重跑 solc（约 30 秒）。已在 up 时把所需 ABI 缓存进部署记录，单条命令降到约 1.1 秒。
5. 因为结算路径在 D 前后耗气不同，必须显式指定 gasLimit，而这会让 ethers 跳过估算、从而拿不到 revert 数据。已在每个写操作前加只读预检，把"transaction execution reverted"变成合约真实错误名（例：NotYetClearingDeadline、RoundCouldStillBeFilled）。
6. 两条链时钟独立，为负向证明需要把源链推过该轮 T。已加 prove-unfilled --past-round N 自动处理并打印移动了多少。

## 原始输出
```
✔ the entry explains what is being bought before any chain action (33952.188159ms)
✔ help names the roles and never hides the test doubles (889.636554ms)
✔ both chains agree on the goal id the moment a goal is created (1146.457313ms)
✔ Act A through the CLI: the four questions stay separate at every stage (18503.331072ms)
✔ Act B through the CLI: budget returned AND old payment unproven are both reported, then B pays (16754.455533ms)
✔ Act C through the CLI: a replacement payment on an already-filled goal is refused and costs nothing (8973.116232ms)
✔ Act C relay completes when the old executor really never paid (21088.419189ms)
✔ expiry release retires the round but leaves the goal relayable (7429.579465ms)
✔ a failing step reports the contract's actual error name (4406.510845ms)
✔ status refuses to invent a deployment when the local world is down (965.038823ms)
ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 115688.059061
```
