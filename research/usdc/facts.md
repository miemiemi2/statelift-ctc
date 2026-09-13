# USDC proxy核验

目标地址：`0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`（Ethereum mainnet Circle USDC proxy）。

尝试通过 Etherscan proxy API 读取 EIP-1967 implementation slot（`0x360894...2bbc`），原始返回保存在 [slot.txt](slot.txt)。本次返回若为空/错误，不能据此推断 implementation 地址；未使用猜测 slot。

EIP-1967 规范只定义代理实现槽位置，不证明该地址确实采用该代理模式。需要可用 RPC/Blockscout 返回 storage 及 Sourcify/区块浏览器源码页面，才能确认 implementation runtime、源码和 storage layout。当前未取得可验证的 storage layout，StateLift 不应据此写死 USDC nonce slot。
