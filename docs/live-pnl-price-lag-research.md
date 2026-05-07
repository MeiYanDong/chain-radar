# Live P&L 与代币价格滞后性研究

> 目标：研究 Virtuals Degen Pot Live P&L 与对应 Agent 代币价格之间的滞后性，判断「Pot 盈亏变化」是否能领先「代币价格反应」，以及领先多久。

## 当前结论

当前已经有足够的 Pot Live P&L 历史，但历史代币价格数据此前只保存在 `position_advice_snapshots.metrics_json` 中，且默认只保留 24 小时。

这不适合做一整季或多季复盘。

因此新增一张长期复盘表：

```text
pot_market_snapshots
```

它每分钟把同一时刻的 Pot P&L 和 token market 数据一起保存，默认保留 30 天。

2026-05-03 生产验证：

```text
pot_market_snapshots 已在云服务器写入。
最新一轮 Top 10：10/10 个 Agent 都有 token_price_usd、market_cap_usd、fdv_usd。
价格源：Virtuals API 提供 mcapInVirtual / fdvInVirtual / liquidity / volume，VIRTUAL/USD 只作为 USD 换算汇率。
VIRTUAL/USD 优先 CoinGecko，CoinGecko 限流时回退 DexScreener Base VIRTUAL。
2026-05-03 字段拆分为 token_price_usd / token_price_virtual / virtual_usd。当前产品观察口径改回 USD：token_price_usd 是主字段，virtual_usd 只作为换算审计字段。
```

当前初步滞后性结论：

```text
新表刚开始长期采集，样本还不足，不能直接用 pot_market_snapshots 下最终判断。

用 position_advice_snapshots 作为粗略历史回看：
BL 的 Live P&L 变化对价格反应最明显，约领先 15 分钟，相关系数约 0.434，样本 464。
WOA 有较弱领先，约领先 10 分钟，相关系数约 0.178，样本 482。
GOCHU 也有弱领先，约领先 30 分钟，相关系数约 0.114，样本 402。

这些只能作为早期线索，不是最终交易结论。
正式结论以后以 pot_market_snapshots 的长期同源快照为准。
```

当前数据覆盖边界：

```text
Pot P&L 主快照：从 2026-04-28 09:55 左右开始。
官网原始 Top10 快照：从 2026-04-30 11:27 左右开始。
P&L + 市场联合快照：从 2026-05-03 17:48 左右开始。
Agent token 的 USD 价格：从 2026-05-03 17:48 左右开始有数据。

因此，正式研究样本仍以 2026-05-03 17:48 之后的联合快照为准。
```

## 数据缺口

已有数据：

```text
pot_agent_snapshots
```

保存 Top 10 每分钟的官方 Pot 数据：

- Agent
- token
- official rank
- allocation
- current value
- Live P&L
- realized P&L
- unrealized P&L
- positions
- raw_json

问题：

```text
pot_agent_snapshots 没有 token price。
```

已有短期价格：

```text
position_advice_snapshots.metrics_json.tokenPriceUsd
```

问题：

```text
position_advice_snapshots 是仓位建议快照，不是纯市场快照；默认保留 24 小时，不适合长期复盘。
```

## 新增长期表

`pot_market_snapshots` 字段：

```text
timestamp = 快照时间。
season_id = 当前赛季。
agent_name = Agent 名称。
official_rank = 官方 Top 10 排名。
token_symbol = Agent token。
virtual_id = Virtuals token id。
starting_capital = Pot allocation。
current_value = Pot 当前账户价值。
live_pnl = Pot 实时盈亏。
realized_pnl = Pot 已实现盈亏。
unrealized_pnl = Pot 未实现盈亏。
token_price_usd = token 当前美元价格。
token_price_virtual = token 当前 VIRTUAL 计价价格，底层保留，不作为主观察口径。
virtual_usd = 当前用于把 VIRTUAL 计价换算成美元的汇率，底层审计字段。
market_cap_usd = token 市值。
fdv_usd = token FDV。
liquidity_usd = token 流动性。
volume_24h_usd = token 24h 成交量。
data_source = 数据来源。
```

设计原则：

```text
Live P&L 和 token_price_usd 必须同一时间落库。

滞后性研究、可视化曲线和健康检查默认使用 token_price_usd。

token_price_virtual 和 virtual_usd 只保留为底层换算审计字段。

不依赖仓位建议是否发送。

不依赖仓位建议快照保留期。

允许 market 数据临时为空，但 P&L 数据仍保留。
```

## 分析方法

新增命令：

```bash
npm run lag:analyze
```

默认分析：

```text
基础变化窗口 = 5 分钟。

滞后窗口 = -60, -30, -15, -10, -5, 0, +5, +10, +15, +30, +60 分钟。
```

计算逻辑：

```text
P&L 变化 = live_pnl(t) - live_pnl(t - 5min)

价格变化 = log(price(t + lag) / price(t + lag - 5min))

然后计算二者的 Pearson correlation。
```

解释：

```text
lag > 0 且相关系数为正：
P&L 变化可能领先价格，存在信息差窗口。

lag < 0 且相关系数为正：
价格可能已经提前反应，P&L 不是领先信号。

lag = 0：
P&L 和价格更接近同步变化。
```

## 可回答的问题

长期数据积累后，可以回答：

```text
1. Live P&L 上穿 +1500 后，价格平均多久反应？

2. Live P&L 上穿 +6000 后，价格是否已经提前反应？

3. Live P&L 跌破 -2500 / -4000 时，价格是同步下跌，还是提前下跌？

4. 哪些 token 是 P&L 领先价格？

5. 哪些 token 是价格领先 P&L？

6. 哪些 Agent 的 Live P&L 对价格几乎没有解释力？
```

## 当前使用方式

服务器部署后，监控每分钟自动写入：

```text
pot_market_snapshots
```

## 可视化观察

新增静态 HTML 报告：

```text
reports/live-pnl-price-lag.html
```

页面默认直接使用 `token_price_usd`，也就是 Agent token 的美元价格。

页面顶部会显示数据可靠性：

```text
市场快照起点。
美元价格起点。
最新快照时间。
最新批次完整度。
批次完整率。
```

如果美元价格起点太近，曲线只能用于观察采集是否正常，不能用于策略结论。

主要观察方式：

```text
1. Top10 总览：一屏看 10 个 Agent 的 Live P&L 和价格指数是否同向。

2. 单 Agent 曲线：蓝线是官方跟单实时盈亏，绿线是代币价格指数。

3. 滞后热力图：正 lag 且相关系数为正，才代表 Live P&L 可能领先价格。

4. 阶梯事件表：观察 Live P&L 上穿 / 跌破后，价格是否在后续一小时内跟随。
```

判断口径：

```text
蓝线先动，绿线后动：可能存在信息差窗口。
两条线同时动：信息差很小。
绿线先动：价格已经提前反应，Live P&L 不是领先信号。
```

## 稳定性监控

云服务器已增加独立数据健康检查。

它不依赖主监控进程的内存状态，每分钟检查一次数据库：

```text
最新市场快照是否超过 180 秒未更新。
最新批次是否少于 10 行。
美元价格或市值字段是否缺失。
最近一小时是否出现超过 180 秒的采集断档。
官网原始 Top10 是否存在无效行。
```

异常时只写入服务器日志，不再发送飞书文本提醒。该 watchdog 的职责是帮助排查采集稳定性，不进入交易决策通知通道。

直接分析最近 30 天：

```bash
npm run lag:analyze
```

默认使用美元口径。底层仍保留 VIRTUAL 口径作为审计和后续实验字段。

```bash
LAG_PRICE_UNIT=usd npm run lag:analyze
```

只分析最近 7 天：

```bash
LAG_MAX_AGE_DAYS=7 npm run lag:analyze
```

调整滞后窗口：

```bash
LAG_MINUTES=-30,-15,-10,-5,0,5,10,15,30 npm run lag:analyze
```

调整基础变化窗口：

```bash
LAG_BASE_WINDOW_MINUTES=15 npm run lag:analyze
```

## 判断标准

不能只看一次相关系数。

有效判断至少需要：

```text
每个 token 至少 12 个有效样本。

同一方向在多个相邻滞后窗口中稳定。

结果要结合当时是否有异常数据源、是否接近 buyback 时间、是否已经发生价格暴涨。
```

如果只出现单个窗口的高相关，先当成线索，不直接当成结论。

真正有交易价值的是：

```text
P&L 变化领先价格。

领先窗口足够长。

价格尚未完全反应。

信号在多个 Agent 或多个赛季中复现。
```
