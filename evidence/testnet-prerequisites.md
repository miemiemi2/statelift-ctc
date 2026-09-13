# StateLift 无人值守工程前置条件

用户要求一次准备外部条件，工程任务独立运行，不依赖用户逐笔签名。不要再要求用户提供 RPC、prover 地址、比赛链接或个人钱包私钥。

已创建独立测试网部署钱包：`0x5780B298dFAdB0013d65056eb71a519f84A30f91`。
本机凭据：`/root/.config/statelift/testnet-deployer.json`，文件权限 0600。禁止输出 privateKey；不要复制到仓库、备份交付物或日志。仅用于测试网，不接收主网资产。
用户个人接收地址不是此部署钱包，不依赖其签名。

本轮直接核对官方文档/公开页面：
- Creditcoin 测试网公共 RPC：https://rpc.cc3-testnet.creditcoin.network，chain ID 102031。
- Attestcoin 是 Creditcoin 上的协议，不需要用户提供另一个所谓 Attestcoin 网络账号。证明接口：https://prover.cc3-testnet.creditcoin.network/；预编译 0x0000000000000000000000000000000000000FD2；源链 Ethereum Sepolia chainkey 1。
- 官方 CTC 领币说明：https://docs.creditcoin.org/wallets/using-testnet-faucet.md。需要加入 https://discord.gg/creditcoin，在 token-faucet 使用 /faucet address:<部署钱包地址>。
- Google Sepolia 测试 ETH：https://cloud.google.com/application/web3/faucet/ethereum/sepolia。已访问到登录页，未登录领取，额度/资格以登录后页面为准。
- Circle 测试 USDC：https://faucet.circle.com。公开页面无需账号，选择 USDC / Ethereum Sepolia；有 reCAPTCHA，显示每次 20 USDC、同地址同网络每两小时一次。未领取。

当前资金状态：尚未核验到账。请用户将三种免费测试币领到上述项目地址并报告领取结果；主 agent 应独立查链上余额。不要要求充值真钱或购买 ETH/BTC。

本次仅完成前置条件核查和生成部署凭据，没有部署合约，没有完成协议端到端能力验证。登录/人机验证需用户操作，不得绕过。后续测试金额按免费测试币可用余额制定并明确标为演示参数。

## 2026-09-13 只读 RPC 核验

已对公开 RPC `https://rpc.cc3-testnet.creditcoin.network` 做只读 JSON-RPC 请求，原始结果与换算保存于 [`evidence/testnet-rpc-check-20260913.json`](testnet-rpc-check-20260913.json)：chain ID `102031`，区块高度 `5480864`，部署地址 `0x5780…0f91` 的原生余额为 `10000 CTC`。未读取、输出或复制私钥。该余额只证明部署钱包有原生 CTC；并不证明已部署 StateLift 合约或完成 Attestcoin/USDC 端到端集成。
