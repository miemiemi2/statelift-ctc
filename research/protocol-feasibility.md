# StateLift 协议能力核验（2026-09-11）

## 结论

状态证明与 ERC-3009 终局推理在协议层可成立，但本仓库没有证据证明 Attestcoin 当前部署已暴露“receipt + header/stateRoot”验证接口；这必须在测试网用真实合约核验后才能写成已交付能力。

## Attestcoin → HeaderAnchor → root

StateLift 所需链路是：锚合约在源链读取 `blockhash(h)` 并 emit；Attestcoin 认证该调用交易的包含、成功 receipt、emitter 与事件字段；Creditcoin 重建目标高度的完整 RLP header，哈希等于事件中的 blockhash 后才采信 `stateRoot/transactionsRoot/receiptsRoot`。仅有交易 inclusion 或任意 RPC header 不足以认证根。`blockhash` 只对最近 256 个区块可直接读取；更早历史须沿 parentHash 或使用批量证明。Attestcoin 的 quorum、finality、receipt 日志接口和连续性语义仍是未核验缺口（不得以本地 mock 代替）。

## ERC-3009 语义

EIP-3009 的 `transferWithAuthorization` 要求当前时间在严格开区间 `validAfter < now < validBefore` 内（USDC 实现检查 `now > validAfter && now < validBefore`），并要求 nonce 未使用；成功执行或 `cancelAuthorization` 都会把 `(authorizer, nonce)` 标记为 used，状态更新与转账在同一交易内回滚。故在已认证时间达到 `validBefore` 且指定 token 的 authorization state 仍为未使用时，可推出该授权未被成功消费且未来不能再消费，可触发退款。`authorizationState == true` 不能单独证明付款，必须再验匹配 receipt/Transfer。该推理依赖具体 USDC proxy implementation、storage layout 和 nonce 状态在期间未被升级或重置。

官方：EIP-3009，https://eips.ethereum.org/EIPS/eip-3009 （访问 2026-09-11）；USDC 合约实现需锁定部署地址与 runtime，不能以 GitHub master 代替。

## 历史 state proof 边界

Ethereum JSON-RPC `eth_getProof`（EIP-1186）可对指定历史 block 返回账户、storage trie 成员或非成员证明；验证需已认证 header 的 `stateRoot`，secure-trie key 与 storage slot 必须准确。空 RPC、缺节点、截断 proof 都不是“值为零”；证明只回答该历史快照，不能推出当前所有权、持续抵押率或信用质量。transactions/receipts trie 的 key 是 `RLP(index)`，与账户/storage proof 不同。

官方：EIP-1186，https://eips.ethereum.org/EIPS/eip-1186 （访问 2026-09-11）；Ethereum execution JSON-RPC `eth_getProof` 文档，https://ethereum.org/en/developers/apis/json-rpc/#eth_getproof （访问 2026-09-11）。

## 未完成证据

- live Attestcoin verifier 是否认证成功 receipt、日志 emitter、header 连续性；
- HeaderAnchor 源码部署、事件 schema、h<当前块且不可伪造约束；
- 真实 USDC proxy 的 implementation/codeHash、nonce slot 与升级历史；
- 历史归档节点可用性、MPT gas，以及批量/SP1 成本。


## Attestcoin 官方文档证据（非 live 部署证明）

官方文档明确：Merkle leaf 由 verified transaction bytes 计算；验证 inclusion 后，ASC 合约直接从该交易字节解码 status 及 transfer event 字段，Proof Builder 同时提交 Merkle 与 continuity proof。来源：https://docs.attestcoin.org/attestcoin-protocol/attestcoin-readability/step-2-transaction-proving/merkle-proving-and-transaction-inclusion.md（抓取 2026-09-10，HTTP 200；本地缓存 merkle-proving-and-transaction-inclusion.md）。这支持字段被交易字节/叶哈希绑定，但不是当前链上 verifier、SDK schema 或已部署 HeaderAnchor 的实证；仍须测试网调用和源码地址锁定。

## USC SDK 当前文档字段核验（抓取 2026-09-11）

官方 SDK 页面（HTTP 200）https://docs.attestcoin.org/attestcoin-protocol/dapp-builder-infrastructure/attestcoin-sdk-usc-sdk.md 明列 `ProofBuilder.getProof(txHash)` 返回：`chainKey`, `headerNumber`, `txHash`, `txBytes`, `merkleProof`, `continuityProof`, `cached`；并说明 merkle proof 证明交易在 block transaction tree、continuity proof 将该 block 连至 Creditcoin attestation。官方 Merkle 页面说明 leaf 对 transaction bytes hash，验证后 ASC 从 bytes 解码 status/event 字段。因此 receipt/status/event 字段在已验证 tx bytes 内被绑定。

边界：该 SDK 文档只描述 transaction inclusion proof；返回 schema 没有 receipt trie proof、header 的 stateRoot/receiptsRoot 字段，也没有 `eth_getProof` 状态证明 API。故 StateLift 的 HeaderAnchor + canonical header + historical state proof 仍是待实现扩展，不能宣称 USC SDK 已支持。
