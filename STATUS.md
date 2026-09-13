# StateLift 当前状态

用户目标：尽可能有竞争力、可真实运行、完整参赛。工程、测试、真实 testnet、证据和材料由助手完成；用户只负责最后录制 demo。并发最多一个 worker，注意 429。此前禁止 testnet/等待用户选方向的状态已淘汰。

## 已核完成（2026-09-13）

- CLI 两项下限修复及重复付款最终回执测试已完成。全量串行 **107/107 通过、0 失败，1093 秒**，`evidence/full-recheck.log`。
- 更新后的本地三幕 demo **49 命令、13 快照**全部通过，包括旧人未付→到 D 退 R→新人同 G 付款结算→旧 B 释放。`evidence/three-acts.md`。
- 六个生产合约部署真实 Sepolia / Creditcoin 102031；官方 USDC、官方 prover 和 0x0FD2，source chainkey 1。完整地址和回执 `evidence/testnet/deployment.json`。
- **三条真实链路径全部结算成功**：normal 从 R，late 保留运营者 R 并从 B 支付，relay 第二执行者同 G 支付、结算并释放旧 B。
- 正常结算 `0xeffe0ce362de7e976221343f31d217ac5dcd22fcc7227f18c470e694108977b9`；迟到 `0x742f0927d6e602582725cc4d4218a80cb87a8f9f3aeee710548d6a2760d1ba20`；接力 `0xa532ba0a5db0d375178a71286715e332787fb2935591a07d69705a38149a35af`。
- 另一有效签名重复付款在 Sepolia 实际上链回滚，双方 USDC 余额不变；`evidence/testnet/duplicate-payment.json`。
- 独立只读审计重新查询结算区块前后历史 RPC 状态，验证 R/B/赢家/退款变化；`evidence/testnet/audit.json`。`node scripts/testnet-audit.mjs` 已改为完全无需凭据的公开核验入口，最后一次复验日志 `evidence/testnet-audit.log`。
- 所有角色已实际提款，核对 gas 调整后的钱包到账，escrow 五项余额全部归零；`evidence/testnet/withdrawals.json`。
- 英文 README、中文 CLI 指引、技术集成文档、承保模型、竞品对照、英文白皮书已完成草稿。PDF 已生成并视觉/文字检查：`submission/StateLift-whitepaper.pdf`，6 页，无文字越界。
- legacy 网页已隔离为 `npm run legacy:web`，默认 npm start 是当前 CLI help。

## 下一步（尚未完成，目标保持 active）

1. PDF 已复核，专用及派生测试网私钥扫描无泄漏；继续核对文档链接与提交文件。
2. 准备简洁可录制 demo 与最终提交文案；用户不承担安装/工程准备。
3. 整理可公开 GitHub 仓库与 PDF URL，核对当前赛事表单及团队资料入口；按项目授权推进，只有录屏由用户承担。
4. 将用户需要的交付物送达 Mac 桌面并核验（已于 2026-09-13 22:13 重建并同步）；完成最终逐项交付审计。

## 实测限制与经济风险

- 官方 prover 实测 32 源区块保护窗口之后仍要等 attestation；保存了 BlockNotOnSourceChain / BlockNotReady 响应及原锚，未重发付款。
- R=B=0.1 tCTC、π=0.0006 tCTC、源付款 0.1 测试 USDC 均为演示参数。正常 root+settle gas 成本 **0.001109895 tCTC** 已高于 π；由部署者补贴，不能称盈利。
- 无客户、独立承保意愿或市场报价证据；相关性迟到可能消耗所有已锁 B，无事实时 B 锁定没有有限上界。测试网角色分开地址但由同一个 harness 控制；不是专业安全审计。

历史阶段报告：[归档](evidence/history/stage2-IMPLEMENTATION-REPORT.md)。当前文档以本状态和真实链 evidence 为准。
