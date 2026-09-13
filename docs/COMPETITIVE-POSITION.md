# StateLift 的可竞争所得与证据缺口

2026-09-13。比较依据是此前保存的作者完整说明，不是对竞品的新一轮链上重放；不据此宣布胜过强对手。

| 对照 | 已公开的直接所得 | StateLift 要争取的差异 | 当前需要诚实保留的缺口 |
|---|---|---|---|
| [index41](https://dorahacks.io/buidl/47994) | 由三笔交易顺序和同池行为判定受保夹击，从事前 bond 赔付；公开判决交易、合约验证源码 | 把“付款到底发生没有”的运营停滞变成到 D 可收回 R、同 G 继续执行、旧付款由专属 B 承担 | 同属事前资本支持的保护承诺；不是首创有证明的赔付。StateLift 需证明三条真实资金路径，且必须解释担保经济性 |
| [CrossCredit](https://github.com/OoJae/crosscredit) | Aave 等既有履约历史直接影响 Creditcoin 贷款抵押条件，公开借还交易与威胁模型 | 由已经发生的确定付款触发已预留资金，事实到归属之间不需要“过去信用预测未来偿付”的推论 | CrossCredit 的降低抵押有直观资本价值和完整贷款体验。StateLift 额外锁足额 B，资本总用量未必更低，也缺少真实客户/费率依据 |
| [ProofPay](https://dorahacks.io/buidl/48205) | solver 向 Ethereum 商户付款，Attestcoin 证明及订单条件通过后领取 Creditcoin escrow | 固定 G 跨轮次，未知付款时到 D 退 R，迟到旧付款仍有独立足额 B 支付，失联可换人 | “CTC 持有人付 Ethereum USDC”“无需手动桥”“按证明结算”已有直接近邻，不是 StateLift 的独特卖点。公开资料不足以证明 ProofPay 缺少所有可扩展的保障机制 |

StateLift 的最窄购买对象是有固定供应商付款义务的 Creditcoin 运营者：他愿意为“该清账时不再把自己的预算押在未知结果上，并可沿同一业务目标接力”支付 π。要以三段演示展示该结果，不能只展示 Attestcoin 验证成功或大量测试。

现有真实证据入口：[部署](../evidence/testnet/deployment.json)、[正常付款记录](../evidence/testnet/flow-normal.json)。当前源码具备下列组合：源端 G 闸门、G/E 轮次、到 D 无证明退 R、每轮足额 B、迟到赔付和赢家事实释放其他轮次。但部署/本地验证不自动等于全部真实路径完成，以对应资金快照为准。

经济代价见 [承保模型](../research/underwriting-model.md)：运营者预算恢复的代价是保障方资本锁定及可能亏损；相关性迟到可能消耗一批 B。尚未验证客户愿付费、自然迟到频率、资本提供方意愿、竞争性报价和长期可用性。

对照资料核验范围：index41/CrossCredit 于 2026-09-12 保存的作者原文，ProofPay 于 2026-09-10 保存的 DoraHacks 项目说明；没有重新运行竞品，不把作者数据称为我们的实测。公开竞品可能继续更新。
