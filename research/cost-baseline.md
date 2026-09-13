# SourceTerminalLens 公平成本基线（待实测）

StateLift 的共享 snapshot/root 只有在批量查询时才可能形成成本优势。`reference-import/contracts-draft/SourceTerminalLens.sol` 是对照实现：一次源链交易读取每个 `(authorizer, nonce)`，逐项 emit，再由 Attestcoin 认证该 receipt。它必须与 StateLift 使用相同的 RPC、确认等待、Creditcoin 记账和服务费口径比较，不能把 Lens 故意做成单项版本。

## 实验矩阵

对订单数 `N = 1, 10, 100, 1000`，分别测：

* Lens：按 `MAX_BATCH=256` 分页调用 `observe`，每页一笔源链交易；每项日志含 token、authorizer、nonce、height、timestamp、consumed。
* StateLift：一笔 HeaderAnchor 后，在同一根下验证 `M = 1, 10, 100` 个账户/storage/receipt 见证；记录 proof 字节、验证 gas、每项 Creditcoin 结算 gas。若跨越 256 块，另计 parent-header 追溯。

每个点记录 source gas、target gas、proof 生成时间、proof bytes、Attestcoin 认证延迟、Creditcoin 交易数和资本锁定时间。报告原始值及摊销值（每项），并公开失败/不可用的样本。小批次若 Lens 更便宜，保留该结果。

## 成本模型（用于在真实测试网数据缺失时避免虚假数字）

令 `L(N)` 为 Lens 的分页源链 gas 加认证和目标链记账成本，`S(N)` 为 StateLift 的一次锚定、header/parent 证明、批量见证验证及相同记账成本。只有在实测 `S(N) < L(N)` 的区间，才能声称共享根带来边际优势。不能用“理论常数”或 mock gas 替代测量；当前仓库尚无 N=1/10/100/1000 的 live 结果。

## 竞争结论门槛

* **技术领先证据**：StateLift 在至少一个真实批量区间（建议 N≥100）降低“每项认证成本”，同时保持 Lens 的语义（旧 nonce 的 true 仍需匹配回执）。
* **产品领先证据**：同一已认证根能在事后查询未预登记 slot，而 Lens 必须新增源链读取交易；演示中删除后台后仍可恢复付款终局。
* 若只有 N=1 或小批次优势，或证明等待/数据可用性抵消 gas 节省，则只能称为能力扩展，不能据此宣称超过 index41/CrossCredit。

当前状态：`SourceTerminalLens.sol` 已作为公平 baseline 纳入工程；实测矩阵和 SP1 批量实现尚未完成，StateLift 尚未取得成本领先结论。
