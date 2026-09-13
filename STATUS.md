# StateLift 当前状态

2026-09-14。用户授权的赛前工程补强已完成，正在核验最终发布和 Mac 交付；录屏由用户负责。并发最多一个 worker，注意 429，不读取或输出私钥。

## 已核完成

- 同 G 最多一次合规付款、D 后恢复 R、同 G 接力、迟到付款由专属 B 承担，保留分账 invariant。
- 四条真实 Sepolia / Creditcoin 路径：normal、late、relay、unfilled expiry；完整 evidence 位于 `evidence/testnet/flow-*.json`。
- expiry 真实 `releaseGuaranteeByExpiry`：`0xc281cefe2f518f1bf2c64f594213f4502a698d260646629a8a9f54d881ed6ab6`，释放 0.1 tCTC B，G 仍开放。
- 全量基线 107/107；新增多轮场景后 negative-fact 定向测试 13/13，覆盖两轮独立 expiry 后第三轮正常结算。未宣称扩展后全量重跑。
- 只读浏览器验证页复验四条流程的部署代码、历史 R/B/credit、proof 和状态；不签名或发交易。支持已公开流程的名称、交易哈希和 goal ID，不支持任意交易。
- 浏览器手机/桌面 expiry、错误输入通过；最终评委视角审查见 `submission/FINAL-AUDIT.md`。
- README/提交文案/PDF 已统一四条路径与测试口径。前三路径提款时 escrow 为零；后续 expiry 仍有可用 B 和 credits，不能称当前总余额为零。

## 当前入口

- 公开仓库：https://github.com/miemiemi2/statelift-ctc
- 验证页：https://miemiemi2.github.io/statelift-ctc/web/verifier.html
- Mac 交付：`/Users/mixu/Desktop/StateLift-Submission/statelift-ctc-public-latest.zip`，旧版已加 `_old-` 前缀。

## 已定范围和限制

不做通用历史查询平台重构、持续主网锚定、多进程角色隔离或新消费者；这是当前投入判断，不代表未来没有发展空间。测试网 gas 高于 π、缺少独立承保与客户证据，B 在缺事实时可能长期锁定；这些边界已披露。录制 demo 不在助手任务中。
