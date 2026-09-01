# Token Lens

一个面向 ETHFI、BP 与 PENDLE 的中文数据看板，集中展示市场价格、供应、质押/退出、收益市场、链上权限与协议价值捕获。

## 功能

- 聚合 Binance、OKX、Bybit 的 ETHFI 现货价格与成交量
- 展示流通供应、最大供应与未流通数量
- 聚合 Ethereum、Optimism、Arbitrum、Base 的 sETHFI 链上份额
- 读取 Ethereum、Arbitrum、Base 的 sETHFI 退出合约状态
- 回填 7D、30D、90D 质押历史与兑换率收益
- 区分 sETHFI 退出和团队、投资人的代币归属解锁
- 支持自动更新与手动强制刷新
- RPC 失败时拒绝发布残缺的跨链汇总，避免把读取失败误判为资产减少
- 展示 BP 的 Backpack 行情、公开质押、里程碑供应与 Solana Mint/Freeze 权限
- 聚合 PENDLE 三所行情、活跃收益市场、sPENDLE 质押、协议收入、回购与到期分布

## 本地运行

需要 Node.js `>=22.13.0`。

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`。

## 检查与构建

```bash
npm run lint
npm run build
```

## 数据口径

- 市场价格采用多个中心化交易所有效报价的中位数。
- sETHFI 总份额来自各链代币合约的 `totalSupply`。
- 对应质押资产通过 sETHFI 份额与链上 Accountant 兑换率计算。
- 退出队列来自官网当前使用的 AtomicQueue：按 `AtomicRequestUpdated` 与 `AtomicRequestFulfilled` 事件还原 Ethereum、Arbitrum、Base 的未完成请求，并剔除已取消或已过期状态。
- 代币归属解锁与 sETHFI 退出是两套独立数据，页面分别展示。
- PENDLE 活跃市场只统计未到期且 TVL 大于 0 的 Pendle Core API 市场；vePENDLE 仅作为迁移中的虚拟 sPENDLE 余额展示。
- PENDLE 团队与投资人归属已完成，不展示过时的解锁倒计时；持续供应变化按终端激励排放口径观察。

项目默认使用公共 API 和公共 RPC。可选的 `COINGECKO_API_KEY` 仅通过运行环境变量读取，仓库不包含任何密钥。

## 免责声明

本项目用于数据研究与观察，不构成投资建议。链上状态、市场数据和官方规则可能随时变化，请在做出决策前独立核验。
