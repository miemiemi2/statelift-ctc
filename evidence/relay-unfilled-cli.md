# 未付款旧执行者的完整 CLI 接力证据

本记录对应 README 幕 C 的第二分支：E1 在 `T1` 前从未付款，证明源链
在 `T1` 后仍未填充；释放 E1 的专属担保后，G 保持开放，E2 沿同一个
`goalId` 完成付款并结算。

## 操作顺序

```bash
G=$(node cli/operator.mjs create-goal --ref invoice-C2 | grep '"goalId"' | cut -d'"' -f4)
node cli/operator.mjs open-round --goal "$G" --pay-in 300 --clear-in 900
node cli/operator.mjs advance --chain ctc --seconds 400
node cli/operator.mjs prove-unfilled --goal "$G" --past-round 1
node cli/operator.mjs release --goal "$G" --round 1 --by expiry
node cli/operator.mjs open-round --goal "$G" --round 2 --pay-in 300 --clear-in 900
node cli/operator.mjs pay --goal "$G" --round 2 --as executor2
node cli/operator.mjs prove --goal "$G"
node cli/operator.mjs settle --goal "$G" --round 2
node cli/operator.mjs status --goal "$G"
```

自动化等价路径已由 `tests/goal/act-c-relay.test.cjs` 覆盖，原始输出见
`evidence/task10-operator-cli.md`（“Act C relay completes when the old
executor really never paid”）及 `evidence/task09-negative-fact.md`。

预期结果：E1 为 `Released`，G 仍可接力；E2 为已结算轮次，收款人只收到
一次付款，R2 付给 E2，B2 解锁。该证据是本地 TEST-DOUBLE 环境记录，
不代表真实 Attestcoin 或真实 USDC 测试网集成。
