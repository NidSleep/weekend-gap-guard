# Weekend Gap Guard

> BNB Hack: Tokenized Stocks. An on-chain vault that lets an AI agent trade tokenized stocks 24/7, while refusing trades when the on-chain price drifts too far from the reference price, with a tighter band when NYSE is closed.

**Problem:** tokenized stocks (bStocks / Ondo / xStocks on BSC) trade 24/7, but the reference price freezes at Friday close. On thin weekend liquidity a rumor can push the on-chain price +10% with nothing to anchor it, and an always-on agent will chase it.

**Solution:** `GapGuardVault.sol` checks every agent trade on-chain: stock allowlist, daily USDT budget, market-aware price-gap band (5% open / 3% closed vs reference), and an owner kill switch. Violations revert with custom errors (`PriceGapTooWide`, `NotWhitelisted`, `DailyLimitExceeded`, `VaultFrozen`).

**Live demo (no wallet needed):** https://weekend-gap-guard.vercel.app — runs the real contract bytecode on an EVM inside your browser.

**Demo video (62s, narrated):** [`media/WeekendGapGuard-demo.mp4`](media/WeekendGapGuard-demo.mp4)

**Run the live demo** (real contracts on a local EVM, every button sends real transactions):
```bash
cd live
npm install
npm run demo   # then open http://localhost:5178
npm test       # scenario test, run while the demo is up
```

**Status:** contracts and demo use mock tokens, oracle and DEX. Next: real bStocks / Ondo / xStocks on BSC mainnet, reference price + market status from the BNB RWA Data API, PancakeSwap routing, BNB Agent Studio agent with Altana session keys. Pitch deck: `WeekendGapGuard.pptx` / `deck.html`.

---

## 中文说明

**给 AI 交易 agent 用的链上金库：周末买代币化股票时，链上合约替你把关。**

## 它解决什么问题

代币化股票（BSC 上的 bStocks / Ondo / xStocks）在链上 24/7 交易，但美股周末休市：参考价停在周五收盘，DEX 上的价格却还在动。周末一有消息，链上价格可能比周五收盘高出 10%，周一开盘又被拉回来。一个 7×24 运行的 AI agent，最容易在这种时候追高，或者被 prompt injection 骗去买垃圾币。

Weekend Gap Guard 是一个 USDT 金库合约 `GapGuardVault.sol`。agent 可以代用户买入代币化股票，但以下几种交易合约会直接 revert：

| 检查 | 自定义错误 |
|---|---|
| 调用者不是授权 agent | `NotAgent()` |
| 用户已一键冻结 | `VaultFrozen()` |
| 代币不在白名单 | `NotWhitelisted(token)` |
| 超出当日（UTC）预算 | `DailyLimitExceeded(requested, remaining)` |
| DEX 价格偏离参考价超出允许带宽 | `PriceGapTooWide(gapBps, maxBps, marketOpen)` |

偏离计算：`gapBps = |dexPrice - refPrice| * 10000 / refPrice`。开盘时带宽 5%（500 bps），**休市时收紧到 3%（300 bps）**，因为这时的参考价已经过时。买到的股票代币留在金库里，只有 owner 能提走。

## 目录

```
contracts/GapGuardVault.sol   金库合约（solc 0.8.20，无外部依赖）
contracts/Mocks.sol           MockERC20（USDT / bNVDA / bAAPL / RUG）、MockReferenceOracle、MockDex
live/start.js                 启动本地 Hardhat 节点（8546），编译部署，网页服务（5178）
live/public/index.html        演示页面：真实交易、区块号、gas、解码后的 revert
live/test-scenarios.js        场景 ①–⑤ 的自动化测试
```

## 如何运行

```bash
cd gapguard/live
npm install        # 已从 agentvault/live 复制 node_modules 的话可以跳过
npm run demo       # 打开 http://localhost:5178
npm test           # 另开一个终端：跑场景 ①–⑤ 并断言结果
```

初始状态："周六 10:00，美股休市，参考价 = 周五收盘"。金库 1000 USDT，每日额度 100 USDT，白名单 bNVDA、bAAPL（不含 RUG）。参考价 NVDA $180、AAPL $230，DEX 价 NVDA $181、AAPL $231。

| 按钮 | 发生什么 | 结果 |
|---|---|---|
| ① | 周六，agent 买 20 USDT bNVDA（偏离 0.55%） | ✓ 成交 |
| ② | 市场事件：DEX bNVDA 被炒到 $199（+10.6%），agent 追高买 30 | ✗ `PriceGapTooWide(1055, 300, false)` |
| ③ | prompt injection：agent 买 50 USDT RUG | ✗ `NotWhitelisted(RUG)` |
| ④ | agent 买 90 USDT bAAPL | ✗ `DailyLimitExceeded(90, 80)` |
| ⑤ | 周一开盘：市场转为开盘，参考价 NVDA $197（偏离约 1%），agent 买 30 | ✓ 成交 |
| ⑥ | owner 冻结 / 解冻 | 冻结后 agent 买入 ✗ `VaultFrozen()` |
| ⑦ | 重置：全部重新部署 | 新地址 |

失败的交易也会被真实广播上链，作为 status 0 的失败交易被打包，资金不动。

## 从 demo 到正式提交

当前 demo 只跑在本地 Hardhat 链（chainId 31337），用的是 Hardhat 公开测试账户和 mock 合约。正式提交需要：

1. **换成真实代币**：把 MockERC20 换成 BSC 主网上真实的 bStocks / Ondo / xStocks 代币地址和真实 USDT（BSC-USD，18 位小数），白名单只放这些地址。
2. **换成真实参考价和开收盘状态**：用 BNB RWA Data API（或 Ondo / xStocks 官方参考价源）替代 `MockReferenceOracle`。需要一个链上 oracle adapter 实现 `referencePrice(token)` 和 `marketOpen()`；同时加上价格时效检查（数据过期就拒绝交易），避免 oracle 停更时被利用。
3. **通过 PancakeSwap 下单**：用 PancakeSwap Router 替代 `MockDex`。`dexPrice` 不能只取池子即时价（可被闪电贷操纵），应改用 TWAP 或 router 报价，并保留 `minOut` 滑点保护。
4. **先模拟，再小额实盘**：先在 BSC testnet 或主网 fork 上跑完全部场景，再按黑客松要求用很小的真实金额在主网跑一遍，把真实 tx hash 写进提交材料。私钥只放在本地环境变量里，不进仓库。
5. **agent 的密钥管理**：考虑用 BNB Agent Studio 或 Altana 的 session key 给 agent 授权，做到有时限、有额度、可撤销，金库合约这一层仍然做最后的强制校验。
6. **上线前**：补单元测试（边界值：带宽刚好等于上限、跨 UTC 日重置额度），做一次安全审查。
