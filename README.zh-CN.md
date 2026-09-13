# StateLift

**跨链付款结果不明时，你的预算不会被无限冻结，付款也不会发生第二次。付款人失联可以换人，迟到的旧付款由该轮专属保障资金承担。**

本地三幕与四条真实测试网路径均已跑通：官方 Sepolia USDC 付款经官方 Attestcoin 证明改变 Creditcoin 的 R/B 归属。前三条路径完成提款核对；expiry 路径保留可复查的 B 与 credits。逐笔证据见 [测试网集成文档](docs/TESTNET-INTEGRATION.md)，当前完成度见 [STATUS.md](STATUS.md)。

---

## 先看你买的是什么

```bash
npm install
node cli/operator.mjs demo-quote
```

这条命令不碰任何链，它打印一张透明报价：预算 `R`、专属担保 `B`、源付款截止 `T`、清账截止 `D`、保障费 `π`、覆盖范围、保障方的最坏责任，以及为什么"自己留备用金 / 普通 solver 重试 / 单独退款工具"都给不了同一个结果。

**所有数字都是演示参数**，不是市场报价、不是已有客户、不是已备流动性。

购买结果是：在**不知道旧付款到底成没成**时，恢复自己的预算并沿同一 G 安全接力；代价由每轮足额担保明确承担。所有数字均为演示参数，承保模型见 [承保模型](research/underwriting-model.md)。

---

## 一条命令跑通本地三幕

```bash
npm install
npm run demo:three-acts
```

它会自己起两条本地链、真实执行付款、真实验证跨链证明、走完三幕，并把原始记录写到 `evidence/three-acts.md` 与 `evidence/three-acts-transitions.json`。每一次状态快照都会断言资金对账等式成立，不成立就直接失败退出。

首次运行需要编译合约，约一分钟；之后全程约两分钟。

---

## 自己动手操作

```bash
npm run local:up            # 起两条本地链并部署，保持这个进程活着
```

它会打印两条链的地址、各个角色的账户地址和所有合约地址。**换一个终端**继续：

```bash
node cli/operator.mjs help
```

命令按角色分组。下面是三幕的手动走法。

每一幕都从 `create-goal` 开始，用**不同的业务编号**：一个付款目标一旦被支付，就不能再开新轮次（会得到 `GoalAlreadyPaid`），所以三幕不能共用同一个目标。

`create-goal` 会在输出里返回 `goalId`。下面的例子用 shell 变量把它接住：

```bash
G=$(node cli/operator.mjs create-goal --ref invoice-2026-0042 \
    | grep '"goalId"' | cut -d'"' -f4)
echo $G
```

### 幕 A — 正常付款

```bash
G=$(node cli/operator.mjs create-goal --ref invoice-A \
    | grep '"goalId"' | cut -d'"' -f4)
node cli/operator.mjs deposit-capital --amount 40000       # 保障方注入承保资本
node cli/operator.mjs open-round --goal $G --pay-in 600 --clear-in 900
node cli/operator.mjs pay --goal $G --round 1 --as executor # 执行者真实付款
node cli/operator.mjs prove --goal $G                      # 锚定源链区块头并生成证明
node cli/operator.mjs settle --goal $G --round 1
node cli/operator.mjs status --goal $G
```

结果：赢家从**你的预算 R** 获偿一次，担保 `B` 原额释放，保障方只留下保障费 `π`。

### 幕 B — 付款已发生但证明迟到

```bash
G=$(node cli/operator.mjs create-goal --ref invoice-B \
    | grep '"goalId"' | cut -d'"' -f4)
node cli/operator.mjs open-round --goal $G --pay-in 300 --clear-in 600
node cli/operator.mjs pay --goal $G --round 1 --as executor
node cli/operator.mjs advance --chain ctc --seconds 700     # 让链走过 D
node cli/operator.mjs refund --goal $G --round 1            # 预算归你
node cli/operator.mjs status --goal $G                      # 问1 和问2 同时为 yes
node cli/operator.mjs prove --goal $G                       # 迟到的证明到达
node cli/operator.mjs settle --goal $G --round 1 --as guarantor
```

结果：**你保住 R**，赢家从该轮**专属担保 B** 获偿，收款人全程只被支付一次。这是保障方实际亏损的一幕，也是你付 `π` 买到的东西。

### 幕 C — 付款人失联，安全接力

```bash
G=$(node cli/operator.mjs create-goal --ref invoice-C \
    | grep '"goalId"' | cut -d'"' -f4)
node cli/operator.mjs open-round --goal $G --pay-in 300 --clear-in 900
node cli/operator.mjs pay --goal $G --round 1 --as executor   # 你并不知道这一步是否发生
node cli/operator.mjs advance --chain ctc --seconds 400       # 过了 T1
node cli/operator.mjs open-round --goal $G --round 2 --pay-in 300 --clear-in 900
node cli/operator.mjs pay --goal $G --round 2 --as executor2  # 被源链拒绝，一分钱没花
```

最后一条命令会失败，并明确告诉你原因：这个目标在源链上已经被填充过，第二次付款不可能。**这就是接力安全的根据**——不是流程约定，是源链上的一次性闸门。

如果旧执行者确实一次都没付，下面展示「到 D 无证明取回 R → 新执行者沿同一 G 完成」的完整路径（用新目标）：

```bash
G=$(node cli/operator.mjs create-goal --ref invoice-C2 \
    | grep '"goalId"' | cut -d'"' -f4)
node cli/operator.mjs open-round --goal $G --pay-in 300 --clear-in 900
node cli/operator.mjs advance --chain ctc --seconds 1000
node cli/operator.mjs refund --goal $G --round 1
node cli/operator.mjs withdraw --as operator
node cli/operator.mjs status --goal $G     # 问3：仍然可以沿同一个 G 接手
node cli/operator.mjs open-round --goal $G --round 2 --pay-in 300 --clear-in 900
node cli/operator.mjs pay --goal $G --round 2 --as executor2
node cli/operator.mjs prove --goal $G
node cli/operator.mjs settle --goal $G --round 2
node cli/operator.mjs release --goal $G --round 1 --by winner
node cli/operator.mjs status --goal $G
```

这条完整分支中，R1 到 D 无需付款证明即可退回；B1 保持锁定。
E2 沿同一 G 付款并结算，赢家从 R2 获偿，B2 释放；赢家事实随后释放 B1。
另有提前退役入口：`prove-unfilled --goal $G --past-round 1` 加
`release --goal $G --round 1 --by expiry`，需要真实的过期未填充事实。
如果 `prove-unfilled` 发现目标其实已经填充，必须改走迟到付款的 B 结算分支，
不能把负向事实当成退款凭证。

### 收钱

```bash
node cli/operator.mjs withdraw --as operator     # 运营者取回已归还的预算
node cli/operator.mjs withdraw --as executor     # 赢家取走报酬
node cli/operator.mjs withdraw-capital --amount 40000   # 保障方取回未锁定的资本
node cli/operator.mjs withdraw --as guarantor    # 保障方取走已赚到的保障费
```

`withdraw-capital` 只能取出**未锁定**的资本；正在为某一轮担保的资金取不出来，这正是「足额担保」不只是一个标签的地方。

收工：

```bash
npm run local:down
```

---

## status 的四个问题为什么分开

`status` 永远把这四件事分成四个独立字段，不合并成一个状态词：

1. 你的预算是否已归还
2. 旧付款是否仍在等证明（并明说 CTC 侧**确实不知道**付没付）
3. 是否可以沿同一个目标接手
4. 最终是否只付了一次

幕 B 过 D 之后，**第 1 问和第 2 问同时是 yes**。任何把它们糊成一句话的看板，都会在这一刻骗到使用者。

---

## 它是怎么成立的

```
源链（Ethereum 替身）                    Creditcoin 侧
─────────────────────                    ──────────────
GoalRouter                               StateLiftGoalEscrow
  fills[G] 一次性闸门                      G 目标 / E 轮次
  ERC-3009 授权收款方=Router                R / B / π / 可提取额度 四账分离
  原子写入 Filled[G]                        D 归属按链上受理时间固定
  发出 GoalFilled 事件                      迟到证明只能动 B
        │                                        ↑
        │ 真实区块头 + 真实 MPT 证明              │
        └────────► RootInbox ──► StateProofVerifier ──► GoalFillFactVerifier
```

三条承诺各自的落点：

- **同一目标最多付一次** → 源链 `GoalRouter.fills[G]` 只能从空变为已填充，一次，永久。换人重试撞上它就整笔回滚，不再花 USDC；已上链的失败交易仍花 gas。
- **有限期限预算恢复** → 到 `D`，`R` 的归属按**链上受理时间**固定为你。`settleRound` 在 `D` 之后被迫走 `B`，与谁先发交易无关；否则执行者只要等过 `D` 再抢跑就能夺走 `R`，期限承诺会退化成排序竞赛。
- **迟到责任归属** → 每轮有专属 `B ≥ R`，开单时就从保障方可用资本里锁走。承保资本不足则**拒绝开单**，"已受保"不是一个标签。

外链证据直接决定谁从哪份资金拿钱：一个指名第 N 轮的 `GoalFilled` 事实，既让第 N 轮的赢家可以获偿，也同时证明其他轮次永远不可能获胜、其担保可以释放。

---

## 代码在哪

**产品路径**

| 路径 | 作用 |
|---|---|
| `contracts/source/GoalRouter.sol` | 源链一次性闸门。这是"最多付一次"从断言变成事实的地方 |
| `contracts/payment/StateLiftGoalEscrow.sol` | G/E 双层、四账分离、D 归属、迟到 B 结算、接力 |
| `contracts/payment/GoalFillFactVerifier.sol` | 把锚定的源链回执变成"哪一轮赢、谁是赢家"；也能证明"仍未填充" |
| `contracts/proof/` | HeaderAnchor / RootInbox / StateProofVerifier / MerklePatricia / StrictRLP |
| `cli/operator.mjs` | 运营者控制台 |
| `lib/local/` | 本地世界的部署与证明辅助（测试与 CLI 共用同一份实现） |

---

## 测试

```bash
npm test                # 全部
npm run test:contracts  # 只跑合约与证明
npm run test:cli        # 只跑 CLI 入口
```

本机 ganache 的原生数学绑定加载失败，EVM 退化为纯 JS，链上 MPT 验证很慢，全量测试需要十几分钟。这是环境性能问题，不是产品逻辑问题。

`evidence/` 保存每个阶段的原始命令输出，包括本任务过程中发现并修掉的缺陷。

---

## 范围与诚实边界

**两个测试替身**，在 CLI 每一条命令的输出里都标注为 `TEST-DOUBLE`：

- `tests/fixtures/MockUSDC3009.sol` — 一个最小的 ERC-20 + EIP-3009，**不是真实 USDC**：没有代理/升级布局、没有黑名单、没有铸造控制。
- `tests/fixtures/MockAttestcoinProver.sol` — 站在 Attestcoin 原生区块证明器的位置上。

替身之后的一切都是真实代码路径：区块头 RLP 解析、账户/存储/回执的 Merkle-Patricia 验证、`GoalRouter`、`GoalFillFactVerifier`、`StateLiftGoalEscrow`。付款真实发生在一条独立的源链上，证明由那条链的真实区块导出。

**明确不成立的说法**：

- 本地 CLI 的 mock 结果不能作为赛事真实集成证据。真实测试网仅以 `evidence/testnet/` 中的官方证明、交易回执及资金状态为准，部署本身不证明结算已完成。
- 报价里的 `R / B / T / D / π` 全是演示参数。保障方的资本成本、相关性故障损失和可接受费率**都未验证**。
- 没有真实客户、没有已备流动性。
- 产品不承诺任何故障下都能限时退款：CTC 链停机时不承诺墙钟准时提款，`R` 的购买力不保证，已花的 gas 与 `π` 本身不退。
- 极端情况下收款人确实收到了款、你也确实取回了 `R`，保障方净亏 `R`。这是**收费、预先锁足资金**的清账期限责任，不是无风险垫款。

当前状态、未完成项与阻塞项见 [STATUS.md](STATUS.md)。可复现验收场景见 [ACCEPTANCE.md](ACCEPTANCE.md)。
