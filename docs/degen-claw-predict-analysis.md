# Degen Claw Predict 分析报告

> 数据采集时间：2026/04/28 | Season 5 Day 1 | 奖池：2,109 VIRTUAL

## 1. 游戏机制

Degen Claw Predict 是一个围绕 Weekly AI Trading Competition 结果的预测市场。

**流程：**
1. 提交预测（140 字符）+ 质押 VIRTUAL，截止时间为周一 GMT+8 08:00
2. 周一 AI Council 独立选出 top 10 agents
3. AI God（GPT-5.5、Gemini 3.1 Pro、Claude Opus 4.7）对每条预测评分
4. 95% 奖池按评分 × 质押量比例分配，5% 归平台

**AI God 评分维度：** accuracy、specificity、boldness、earlier submissions

**关键发现：** AI God 的实际 prompt 给予其完全自由裁量权（"decide how to redistribute"），目标函数是 "make this game fun and fair enough that more people want to participate next week"。这意味着大胆且精准的预测会获得非线性超额回报。

## 2. Season 5 Council 选拔结果

| # | Agent | Token | Blend | 资金分配 | GPT-5.5 | Gemini 3.1 | Opus 4.7 |
|---|-------|-------|-------|---------|---------|------------|----------|
| 1 | ButlerLiquid | $BL | 19.8% | $39,576 | 20% | 20% | 16% |
| 2 | BenYorke \| Starchild | $BENYORKE | 17.0% | $33,922 | 15% | 15% | 18% |
| 3 | seykota | $SEYKOTA | 13.1% | $26,148 | 11% | 15% | 11% |
| 4 | Super Saiyan Pikachu | $GOCHU | 11.3% | $22,615 | 9% | 10% | 13% |
| 5 | WolfOfAlgos | $WOA | 11.0% | $21,908 | 13% | 8% | 10% |
| 6 | ZMAC | $ZMAC | 10.2% | $20,495 | 10% | 10% | 9% |
| 7 | Voltaris | $VOLTS | 7.8% | $15,548 | 8% | 8% | 6% |
| 8 | Labuuu v2 | $LB2 | 3.9% | $7,774 | 5% | 6% | — |
| 9 | FluxBot AI | $FBI | 3.2% | $6,360 | — | 4% | 5% |
| 10 | OracleWars | $ORCL | 2.8% | $5,654 | — | — | 8% |

## 3. 三模型评分详情

### ButlerLiquid — Blend 19.8%（三模型共识最强）

- **GPT-5.5（20%）：** The strongest all-around record: 474 closes, 84.2% win rate, $1,731.87 lifetime PnL, and 8.82 profit factor over 12 active days. The forum stream is mostly automated radar rather than deep discretionary reasoning, but the realized execution record across BTC/ETH/SOL/HYPE/AAVE is too dominant to fade.
- **Gemini 3.1 Pro（20%）：** Leads heavily in PnL with a staggering 474 closes and 84.2% win rate. A high profit factor of 8.82 proves structural edge rather than luck.
- **Claude Opus 4.7（16%）：** Top lifetime PnL ($1,731) with elite 84.2% WR and PF 8.82 across 474 closes — the cleanest statistical edge in the dataset. Slight risk: only one recorded trade in the last 3 days suggests a possible slowdown, hence weighted second rather than first.

### BenYorke | Starchild — Blend 17.0%（Opus 给出最高分）

- **GPT-5.5（15%）：** BenYorke combines a large sample with quality outcomes: 323 closes, 77.7% win rate, $974.48 PnL, and 5.64 profit factor across 12 coins and 15 days. The recent forum posts describe execution hardening and grid-engine fixes, which matters because the edge appears process-driven rather than one lucky trade cluster.
- **Gemini 3.1 Pro（15%）：** Outstanding consistency with 323 trades, 77.7% win rate, and deep asset diversification (12 coins). Proves a highly adaptable strategy.
- **Claude Opus 4.7（18%）：** Best risk-adjusted profile in the field: $974 PnL on 323 closes, 77.7% WR, PF 5.64, 12 coins, 15 active days, and still printing $85 in the last 3 days. Diversified, sustained, and the recent forum post documents a deliberate engine rewrite that should reduce noise — highest conviction.

### seykota — Blend 13.1%（Gemini 偏高）

- **GPT-5.5（11%）：** seykota is the best high-conviction smaller-sample pick: 29 closes, $722.84 PnL, 69.0% win rate, 13.74 profit factor, and an unusually strong average win/loss profile. The forum rationales repeatedly mention fresh-eyes reviews, stop movement, and manual resets, suggesting disciplined management rather than passive luck.
- **Gemini 3.1 Pro（15%）：** High-conviction swing trader with a massive 13.74 profit factor. Excellent rationale posts show a structured, rule-based approach to trend trading.
- **Claude Opus 4.7（11%）：** PF 13.74 with 69% WR across 29 closes and $722 PnL — quality over quantity. Forum posts ('Run #69 Fresh Eyes') demonstrate a disciplined trail-stop / position-management framework, and recent 3-day activity is positive across 8 trades.

### Super Saiyan Pikachu — Blend 11.3%（Opus 最看好）

- **GPT-5.5（9%）：** Super Saiyan Pikachu has 186 closes, $612.37 PnL, and an 80.02 profit factor, with average losses kept extremely small. The trade universe is concentrated in four coins and only five active days, but its posts show adaptive BTC/ETH narrative timing around ETF flows and resistance zones.
- **Gemini 3.1 Pro（10%）：** A highly asymmetric risk profile with a PF of 80.02 and minimal average losses ($0.097). Excels at cutting losers early and letting winners run.
- **Claude Opus 4.7（13%）：** PF of 80 on 186 closes is exceptional, and crucially the agent printed $241 in the last 3 days — the strongest recent momentum in the field. Forum rationale on ETH ETF resistance shows real macro reasoning, not just mechanical scalping.

### WolfOfAlgos — Blend 11.0%（GPT 偏高）

- **GPT-5.5（13%）：** WolfOfAlgos has a strong blend of scale and breadth: 166 closes, $743.22 PnL, 65.1% win rate, 2.74 profit factor, and 28 traded coins. Its 100 rationale posts show active trade review and technical framing, so I trust it more than several higher-PF agents with thinner records.
- **Gemini 3.1 Pro（8%）：** Strong absolute returns across 166 trades with broad market coverage (28 coins). Consistent forum activity indicates a systemic, well-monitored approach.
- **Claude Opus 4.7（10%）：** $743 PnL, 65% WR, PF 2.74 across 28 coins — the most diversified high-PnL agent. Recent 3 days are roughly flat, but the breadth (28 coins, 14 days) and detailed per-trade forum analysis suggest robust adaptive logic.

### ZMAC — Blend 10.2%（三模型共识）

- **GPT-5.5（10%）：** ZMAC has explosive recent form: 98 closes in four days, $527.92 PnL, 70.4% win rate, and a 171.56 profit factor driven by very small average losses. The short operating window keeps it below the top four, but its narrative-aware posts and recent activity make it a strong 7-day bet.
- **Gemini 3.1 Pro（10%）：** An incredible profit factor of 171.56 across 98 trades. Demonstrates unmatched precision in entries and risk management with very tight losses.
- **Claude Opus 4.7（9%）：** PF 171 and 70.4% WR with $527 PnL on 98 closes — extreme efficiency. Only 4 active days is a sample-size risk, but +$87 in the last 3 days and thoughtful forum posts about fading SOL into resistance support continued edge.

### Voltaris — Blend 7.8%（Opus 打折最多）

- **GPT-5.5（8%）：** Voltaris earns a slot through breadth and consistency: 134 closes, 75.4% win rate, $578.11 PnL, 30 coins, and a full 100-post rationale history. I size it below peers because its 1.89 profit factor and average loss larger than average win imply a less forgiving payoff structure if market conditions turn.
- **Gemini 3.1 Pro（8%）：** Solid momentum trader with 134 trades and high asset diversity (30 coins). Maintained a 75.4% win rate showing reliable execution across different pairs.
- **Claude Opus 4.7（6%）：** $578 PnL, 75.4% WR, 30-coin breadth and 100 detailed forum posts including signal-based shorts on SOL with MACD+EMA logic. PF only 1.89 and recent 3-day at -$57 is concerning, so smaller weight — but the process quality earns inclusion.

### Labuuu v2 — Blend 3.9%（仅 GPT + Gemini 选入）

- **GPT-5.5（5%）：** Labuuu v2 looks like a low-drawdown execution machine: 132 closes, 78.0% win rate, 83.75 profit factor, and 53 coins traded. I cap the allocation because total PnL is only $174.89 and the forum record is thin, but the realized loss control is excellent.
- **Gemini 3.1 Pro（6%）：** Traded 53 different coins while maintaining an 83.75 profit factor. Showcases extreme strategy versatility and a sharp instinct for liquidity and tape reading.
- **Claude Opus 4.7：** 未选入

### FluxBot AI — Blend 3.2%（仅 Gemini + Opus 选入）

- **GPT-5.5：** 未选入
- **Gemini 3.1 Pro（4%）：** Emerging strategy with an 84.2% win rate and 9.16 PF. Excellent foundational rationale posts demonstrating deep factor analysis and asset screening.
- **Claude Opus 4.7（5%）：** Brand new (2 days) but already 84.2% WR, PF 9.16, $90 PnL across 19 closes and 10 coins. Forum factor-analysis posts ('ENA 78/100') suggest a structured quant approach; small allocation reflects high quality but limited sample.

### OracleWars — Blend 2.8%（仅 Opus 选入）

- **GPT-5.5：** 未选入
- **Gemini 3.1 Pro：** 未选入
- **Claude Opus 4.7（8%）：** Despite a low 37.5% WR, PF 3.60 on 469 closes proves the asymmetric R:R is real, and +$94 in the last 3 days is the strongest recent number after Pikachu. High-frequency edge with positive expectancy.

## 4. 三模型偏好画像

### GPT-5.5 — "业绩为王"

| 偏好维度 | 权重 | 证据 |
|---------|------|------|
| 绝对 PnL | 最高 | BL $1,731 → 20%，WOA $743 → 13% |
| 交易量 + 样本量 | 高 | 对短样本打折（ZMAC 4天、Pikachu 5天） |
| Forum 内容 | 中 | 提到但不决定性 |
| 近期动量 | 低 | 几乎不提最近 3 天表现 |

**GPT 不选的 agent：** FluxBot AI（太新）、OracleWars（低胜率）

### Gemini 3.1 Pro — "数字说话"

| 偏好维度 | 权重 | 证据 |
|---------|------|------|
| Profit Factor | 最高 | ZMAC 171→10%，Pikachu 80→10%，seykota 13.7→15% |
| Win Rate | 高 | 高胜率 agent 普遍获得更高分 |
| 资产多样性 | 中 | 提到但不如 PF 重要 |
| 近期动量 | 低 | 不关注近期趋势 |
| 风险信号 | 不关注 | 从不主动找负面因素 |

**Gemini 不选的 agent：** OracleWars（低胜率直接否决）

### Claude Opus 4.7 — "风险调整 + 近期动量"

| 偏好维度 | 权重 | 证据 |
|---------|------|------|
| 最近 3 天表现 | 最高 | 每条评语必提，Pikachu +$241→13%，Voltaris -$57→6% |
| Forum 质量 | 高 | BenYorke engine rewrite→18%，Pikachu macro reasoning→13% |
| 风险因子 | 主动寻找 | BL 放缓→16%（打折），Voltaris 近期亏→6% |
| 不对称 R:R | 独特关注 | OracleWars 37.5% WR 但 PF 3.6→8%（唯一选入） |
| 样本量 | 中 | FluxBot 2天→给分但注明 limited sample |

**Opus 独特行为：** 是唯一选 OracleWars 的模型，也是给 BenYorke 和 Pikachu 最高分的模型。Opus 是最大的 swing vote。

## 5. Council 选拔 vs Arena 排名的映射

| Arena 排名 | Agent | Council 结果 | 原因 |
|-----------|-------|-------------|------|
| #1 | ButlerLiquid | Council #1 ✓ | 全维度碾压 |
| #2 | Voltaris | Council #7 ↓ | PF 仅 1.89，近期 -$57 |
| #3 | BenYorke | Council #2 ✓ | 风险调整后最优 |
| #4 | WolfOfAlgos | Council #5 ↓ | PF 仅 2.74，近期平 |
| #5 | AlgoAce | 未入选 ✗ | 样本量不足 |
| #6 | Nexor | 未入选 ✗ | — |
| #7 | Monyet | 未入选 ✗ | 33.4% 胜率致命 |
| #8 | Labuuu v2 | Council #8 ✓ | PF 83.75 极高 |
| #9 | Argonaut AI | 未入选 ✗ | 仅 14 笔交易 |
| #19 | seykota | Council #3 ↑ | PF 13.74 + 纪律性 |
| 不在前20 | Super Saiyan Pikachu | Council #4 ↑ | PF 80 + 近期动量 |
| 不在前20 | ZMAC | Council #6 ↑ | PF 171 爆炸性 |
| 不在前20 | FluxBot AI | Council #9 ↑ | 新但质量极高 |
| 不在前20 | OracleWars | Council #10 ↑ | Opus 独选，不对称 R:R |

**核心结论：Council 的真实排序指标是 Profit Factor + Win Rate + 近期动量，而非 Realized P&L。**

## 6. Season 4 实战复盘（我们的预测结果）

| 预测 | 投入 | 回报 | 净盈亏 | AI God 评语 |
|------|------|------|--------|------------|
| BL #1 + Monyet 出局 | 10V | +184V | +174V | "Two-part bullseye" |
| Voltaris #2 + BenYorke 跌 | 11V | 0V | -11V | 两个都错 |
| Top 3 锁定 + 无黑马 | 8V | +2V | -6V | WOA 没进 top 3 |
| 3/10 全票 + Gemini 反骨 | 5V | +1V | -4V | 实际 7 个全票 |

**总账：投入 34V → 回收 187V → 净赚 +153V（ROI +450%）**

## 7. 下周 Predict 策略框架

### 信息采集流程（周日执行）

1. 访问 Arena 页面，提取所有 agent 的 PF、WR、交易量、活跃天数、近 3 天 PnL
2. 访问 Council Rationale 页面，分析三模型的最新偏好变化
3. 对比 Arena 数据和 Council 选拔逻辑，识别"Arena 排名低但 Council 会选"的 agent

### 预测内容策略

- **不看 Arena 排名做预测**，直接分析 PF、WR、近期动量
- **Opus 是关键变量**——预测 Opus 的独立判断是差异化得分来源
- **尾部名额（8-10）波动最大**——最有预测价值
- **一条精准 bullseye 的回报是非线性的**——集中火力在 1-2 条高置信度预测

### 凯利公式资金分配

- 对每条预测估算：命中概率 × 预期得分 → 计算 Kelly fraction
- Half-Kelly 作为实际下注比例
- Kelly 建议不下注的部分保留（上次保留 20V 是正确决策）

### 关键指标阈值（基于本季数据）

| 指标 | 入选门槛 | 高分配门槛 |
|------|---------|-----------|
| Profit Factor | >3.0 | >10 |
| Win Rate | >60%（或低 WR + 高 PF 的不对称策略） | >75% |
| 交易量 | >20 closes | >100 closes |
| 活跃天数 | >2 days | >10 days |
| 近 3 天 PnL | 正值 | >$80 |

## 8. Burn Event Log

| 日期 | Token | 销毁数量 | Tx |
|------|-------|---------|-----|
| 04/27/26 | Voltaris | 26,287,704 | 0x917b...b5e0 |
| 04/27/26 | AlgoAce | 44,509,313 | 0xb0fa...2b9f |
| 04/27/26 | ButlerLiquid | 67,506,275 | 0xc3ad...4605 |
| 04/27/26 | EverythingTrade | 76,113,578 | 0xd7e6...3fe1 |
| 04/27/26 | BenYorke | 13,590,727 | 0x6bf9...9996 |
| 04/27/26 | WolfOfAlgos | 107,289,409 | 0xa786...303f |
| 04/20/26 | WolfOfAlgos | 7,376,921 | 0xab8c...abe8 |
| 04/20/26 | Argonaut AI | 37,671,113 | 0xd2c2...e3de |
| 04/20/26 | Fat Tiger | 39,360,820 | 0x96bb...2b00 |
