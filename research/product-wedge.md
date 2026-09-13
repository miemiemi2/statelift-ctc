# StateLift 产品楔子：面向批量付款运营商的可恢复结算

## 目标用户与净所得

目标用户是一家需要每天向数十至数百个 Ethereum USDC 地址付款的运营方（grant、赏金、供应商结算）。它在 Creditcoin 持有 CTC 作为付款预算，但不希望收款人承担跨链、换币或新钱包。StateLift 将每项付款的 CTC 预算锁定；执行方使用自有 Ethereum USDC，通过 ERC‑3009 向指定地址付款。经 Attestcoin 认证的 receipt/state proof 到达后，合约逐项结算；到期且 nonce 仍未使用则自动释放预算，可在同一批次内换执行方重试。

运营方得到的不是“又一条桥”，而是数据库丢失、worker 消失或部分执行失败时仍可公开重建的资金终局：已付项绝不重复，未付项可退款/重试，未知项继续等待。批量三态账本直接减少人工对账和重复付款风险。

## 为什么是 CTC→原生 USDC

CTC 是运营方在 Creditcoin 的可编程预算单位，可锁定服务费、保证金和重试上限；USDC 是收款方已经接受的 Ethereum 结算资产。让执行方持有 USDC 库存，避免平台自建 USDC 流动性池；执行者仍承担库存、汇率和桥接成本，这些必须进入报价。CTC 只在成功证明后支付执行方报价，失败时原额可退；因此 CTC 承担“条件付款预算”，而非被收款人强迫接收的代币。

## 与 Lens/现成方案的真实差别

SourceTerminalLens 在每个源链逐项读取 nonce 并发事件，少量订单可能更便宜。StateLift 的楔子仅在批量运营场景成立：一次已认证 canonical root 允许事后选择未预登记的账户/slot，后台丢失后任何恢复者可用公开证明重建 N 项事实（Lens 也具备逐项公开恢复能力；共享根不独占该优势）；无需为每项查询再写源链交易。该优势是恢复性和运维净收益，不宣称证明或目标链 gas 对 N 为常数，也不承诺总成本必低。

普通桥、Circle transfer、intent/solver 方案能把 USDC 移动或代提交，但通常把失败退款、重试资格和“已付款不可再次结算”留在中心化订单数据库；它们不提供本合约所需的负状态证明（授权到期且 nonce=false）和按目标预算守恒。人工客服或多签退款可覆盖个案，却无法在运营方失联时让陌生执行者安全接手。

## 可采用的单一改进

把产品首屏和演示收窄为“批量付款恢复台”：先展示一批 3–100 项订单，模拟后台消失；恢复者提交同一根下的 payment/nonce proofs，界面即时分出 paid / refundable / pending，并允许仅对 refundable 项换人重试。所有费用（源 gas、证明、CTC 报价）按项列出。这样用户价值来自批量异常时资金可恢复和不重复，而非泛化为通用跨链平台。

## 推翻条件

若实测 N≤10 时，逐项 Lens 查询的源交易、证明和目标 gas 总成本及延迟均低于共享根方案，且运营方仍可依赖中心化数据库/多签恢复，则 StateLift 的新增净所得不足，应退回 Lens 或仅做其证明适配层。若无法取得真实 Attestcoin 根、USDC nonce 历史和可复现恢复演示，也不得把该楔子宣称为已验证产品。

## 近邻核对（官方资料）

- Across 文档的 Intents 设计允许 filler 先在目的链交付，随后由 UMA 无许可 relayer 结算；见 [Across Intents](https://docs.across.to/concepts/intents)。这已经提供 solver 竞价和目的链先付体验，StateLift不能把“第三方执行者”当独特价值。其可争取点仅是：付款目标的 nonce 未使用这一负状态，可作为 CC 预算退款/重试的链上终局，并与批量账本绑定。
- deBridge DLN 采用“order + solver liquidity”模型，solver 在目的链交付后由验证网络确认源链锁定并释放；见 [DLN overview](https://docs.debridge.com/dln-details/overview/introduction)。这证明库存、汇率和 solver 风险客观存在，CTC→USDC并未消除 FX；StateLift只能把 FX 作为逐项报价透明传递，并增加可验证退款/重试规则。

因此当前证据不足以宣称 StateLift 已胜过 Lens、Across 或 DLN。产品楔子成立的必要条件是：在批量异常场景中，状态证明确实减少重新登记源链查询或人工裁决，并且实测总成本/延迟可接受；否则应退回“带可验证负状态的批量付款适配层”。
