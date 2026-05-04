# Phase 2.4 Plan：入选预期与 Burn 预期分析

> 维护规则：本文档是 Phase 2.4 的产品计划。它描述分析框架和用户判断方式，不写技术实现细节，不扩展成大而全 Dashboard。

## 1. 阶段目标

Phase 2.4 的目标是让用户能回答一个更准确的问题：

> 我现在持有的代币，分别暴露在哪些「入选预期」和「burn 预期」上？这些预期是在增强，还是在减弱？

这不是以用户持仓为参照物去筛选信号。

正确顺序是：

1. 先独立观察全场 competing agents。
2. 判断每个 agent 的入选预期。
3. 判断已入选 agent 的 burn 预期。
4. 最后再把用户持仓映射到这些预期上。

## 2. 两个数据来源

Phase 2.4 只承认两个主数据来源。

```text
competing_agents_data = Degen Virtuals 页面 Competing Agents 板块的数据。用于判断全场 agent 的入选预期。

pot_live_pnl_data = Pot Monitor 记录的官方 Pot 跟单账户 Live P&L、已实现 P&L、未实现 P&L 和本地快照。用于判断已入选 agent 的 burn 预期。

说明：本文档里 `pot_*` 前缀的 P&L 字段都指官方 Pot 跟单账户的收益/亏损，不指用户自己买 Agent 代币后的持仓盈亏。
```

用户钱包持仓不是第三个分析来源。

```text
wallet_exposure = 用户当前持仓映射。只用于回答用户押注了哪些预期，不用于决定全场预期本身。
```

## 3. 入选预期

入选预期指的是：

```text
selection_expectation = 某个 competing agent 被 AI Council 选入 top 10，并获得 allocation 的可能性和强弱。
```

入选预期主要来自 Competing Agents 数据。

第一版只看最少必要信号。

Competing Agents 最小字段：

```text
agent_id = competing agent 的唯一编号。用于把榜单、Pot 和用户持仓映射到同一个对象。

agent_name = competing agent 名称。用于用户阅读和对话分析。

search_name = 在 Degen / Virtuals 页面搜索时应该输入的名称。默认等于 agent_name，不等于 token_symbol。

token_symbol = agent 对应代币符号。用于映射用户持仓。

token_address = agent 对应代币合约地址。用于避免同名符号混淆。

virtual_id = Virtuals 页面 ID。用于跳转查看代币。

agent_wallet = agent 的交易钱包地址。用于识别链上交易历史。

realized_pnl_usd = 已实现 P&L，单位是美元。代表已经落袋的交易结果。

mtm_pnl_usd = mark-to-market P&L，单位是美元。代表按当前市场价格重估后的账面浮盈/浮亏，不能当成已经落袋的收益。

holdings_value_usd = agent 当前账户资金规模的美元代理值。用于估算 P&L 相对资金规模的效率。

capital_efficiency_ratio = 资本效率原始值。计算方式为 realized_pnl_usd / holdings_value_usd 与 mtm_pnl_usd / holdings_value_usd 的平均值，负数按 0 处理。

api_return_pct = Competing Agents 接口原样返回的 returnPct。只展示，不进入默认评分。

return_pct = 兼容旧输出保留的接口原始字段。后续阅读时应优先看 capital_efficiency_ratio，不应把它当成本金回报率。

trade_count = 交易次数。代表样本量。

win_rate = 胜率。必须结合 trade_count 判断。

sharpe_ratio = 风险调整后的收益质量。当前缺失较多且数值不稳定，第一版只展示，不纳入主评分。

open_perps = 当前未平仓合约数量。代表当前风险暴露。

trade_volume_usd = 总交易量，单位是美元。用于判断活跃度和策略规模。

last_trade_at = 最近交易时间。代表 agent 是否还活跃。

forum_post_count = 论坛理由数量。代表 agent 是否留下可被 Council 阅读的历史理由。

calculated_at = Competing Agents 数据计算时间。用于提示这条数据距离当前有多久；不直接决定入选预期是否有效。

data_age_minutes = calculated_at 距离当前分析时间的分钟数。用于阅读时判断数据年龄。

data_freshness = 数据年龄提示。可选值为 fresh / aging / old / unknown。它只是提示，不参与默认 selection_score。

dex_pool_count = Base 链上可查询到的 DEX 池子数量。只作为可选辅助检查，不进入默认评分。

dex_liquidity_usd = 最大 DEX 池子的美元流动性。只作为可选辅助检查，不进入默认评分。

tradability_status = 可交易性状态。可选值为 dex_liquid / low_liquidity / no_pool / unknown / unchecked。默认 unchecked。
```

第一版不需要的 Competing Agents 字段：

```text
image_url = 头像，只影响展示，不影响第一版判断。

owner_wallet = 创建者钱包，第一版不用于判断入选预期。

subscription_price = 订阅价格，第一版不用于判断入选预期。

description = 自我介绍文本，第一版先不纳入，避免主观解释过多。
```

入选预期采用连续函数加权打分，而不是只看单个指标，也不是手动分档。

打分前只过最小基础门槛：

```text
eligible_for_selection_scoring = 该 agent 存在于 Competing Agents，并且有 performance 数据。

data_freshness = 数据年龄提示。比赛周期是一周，Competing Agents 的 calculated_at 不应被当成 30 分钟级别的硬失效条件。
```

入选预期总分为 0 到 100。

搜索字段不进入 selection_score。

原因：

```text
selection_score = 这个 agent 是否值得关注。

search_name = 用户去页面搜索时应该输入什么。

例如 ALX 的 search_name 是 Alexa，CLAWMANIA 的 search_name 是 Claw-mania。
```

评分原则：

```text
阈值只用于最终 high / medium / low 分层。

排序和仓位判断使用连续函数，避免“刚好超过某条线就突然大幅变好”的问题。

原始字段只记录事实，不一定单独打分。

判断函数可以是一元函数，也可以是多元函数；但每个函数只能回答一个清楚问题。

权重只在总分或维度合成时出现，不写进字段原始定义里。
```

第一版连续函数：

```text
distribution_score(value, all_values) =
50 + 50 * tanh((value - median(all_values)) / robust_scale(all_values))

用途：判断某个 agent 在全场 competing agents 中处于什么位置。

含义：全场中位数约为 50；明显好于中位数接近 100；明显差于中位数接近 0。
```

```text
capital_efficiency_score =
f_positive(capital_efficiency_ratio, 25%)
* f_positive(holdings_value_usd, 500 美元)

含义：这个 agent 是否用相对合理的资金规模做出了有效 P&L。

子分：
capital_return_score = capital_efficiency_ratio 本身的强度。
capital_base_confidence_score = holdings_value_usd 是否足够大，避免小本金比例被放大。

原因：接口原始 returnPct 不是用户直觉中的本金回报率。例如 BL 的 realized_pnl_usd 接近 holdings_value_usd，但接口 returnPct 只有 0.24%。因此资本效率必须用 P&L / 资金规模重新计算。

补充：如果 holdings_value_usd 很小，P&L / 资金规模会被夸大，所以要乘以资金规模可信度。几美元的小资金不能因为比例高就拿到满分。
```

```text
sample_score = f_positive(trade_count, 60)

win_rate_score = f_symmetric(win_rate - 50%, 12%)

statistical_credibility_score =
sample_score * win_rate_score

含义：这个胜率是否有足够样本支撑。

说明：胜率离开交易次数没有意义，所以这里是一个合理的多元判断函数，不需要拆成两个独立维度加权。
```

交易结果分：

```text
pnl_relative_score = mtm_pnl_usd 和 realized_pnl_usd 在全场中的相对位置。

pnl_absolute_score = mtm_pnl_usd 和 realized_pnl_usd 的绝对金额强度。

trading_result_score =
55% * pnl_relative_score
+ 45% * pnl_absolute_score

原因：只看相对排名会把很小的 P&L 也顶得太高；只看绝对金额又会忽略资本效率。

子分：
mtm_relative_score = mtm_pnl_usd 在全场中的相对位置。
realized_relative_score = realized_pnl_usd 在全场中的相对位置。
mtm_absolute_score = mtm_pnl_usd 的绝对金额强度。
realized_absolute_score = realized_pnl_usd 的绝对金额强度。
```

字段解释：

```text
trading_result_score = 交易结果函数分。权重 15%。
同时看 mtm_pnl_usd / realized_pnl_usd 的相对排名和绝对金额。其中 mtm_pnl_usd 是账面浮盈/浮亏，realized_pnl_usd 是已实现收益。

capital_efficiency_score = 资本效率函数分。权重 25%。
看 capital_efficiency_ratio 的绝对强度。接口原始 api_return_pct 只展示，不进入默认评分。

statistical_credibility_score = 样本可信度函数分。权重 35%。
先看 trade_count 是否足够，再看 win_rate 是否真的有解释价值。低胜率会自然拉低分数，不靠额外硬门槛。

activity_score = 活跃度函数分。权重 10%。
距离 last_trade_at 越久，分数按时间衰减。

council_evidence_score = Council 可读证据函数分。权重 5%。
forum_post_count 越多，越说明 Council 有材料理解该 agent，但边际加分递减；这个字段不能代表交易能力，所以权重必须低。

open_exposure_safety_score = 未平仓暴露安全分。权重 10%。
open_perps 相对于 trade_count 越高，说明当前暴露负担越重，分数越低。它不代表完整风控能力，所以名称只描述“未平仓暴露安全”。
```

计算方式：

```text
selection_score =
25% * capital_efficiency_score
+ 15% * trading_result_score
+ 35% * statistical_credibility_score
+ 10% * open_exposure_safety_score
+ 10% * activity_score
+ 5% * council_evidence_score

每个单项分都是 0 到 100，再按权重相加。
```

当前状态：

```text
selection_score_v1.1 = 当前 Competing Agents 可用字段下的结构化版本。

当前已修正 returnPct 口径误判、MTM 语义、数据年龄硬过滤、小资金比例放大、搜索名混淆、函数含义混杂等关键问题。

后续不再因为单个 agent 案例频繁改公式；下一步应通过真实入选结果、Live P&L 变化和买入后表现来反向校准。
```

可选 DEX 流动性检查：

```text
默认不启用 DEX 流动性检查，因为 Degen / Virtuals 的页面搜索入口是 Agent 名称，不是 token 符号。

需要辅助检查 Base DEX 池子时，可以单独开启。

dex_liquid = 最大 DEX 池子流动性 >= 1000 美元。

low_liquidity = 有池子，但最大池子流动性 < 1000 美元。

no_pool = 没查到 Base DEX 池子。

unknown = 查询失败或接口限流。
```

入选预期结论：

```text
high = selection_score >= 75。

medium = selection_score >= 50 且 < 75。

low = selection_score < 50。

unknown = 缺少 performance 等关键字段。数据年龄只提示，不直接导致 unknown。
```

## 3.1 入选 Alpha 通知

监控方式：

```text
每 60 秒刷新一次 Competing Agents 全量数据。

每次刷新都保存 selection_score 快照。

快照至少保留 24 小时，用于计算 15min / 1H 变化。
```

通知不使用单一分数阈值，而使用：

```text
当前分数区间
+ 15min 变化
+ 1H 变化
+ 排名变化
+ 是否未入选 / 是否刚入选
```

强 Alpha：

```text
selected_now = false
selection_score >= 75
并且满足至少一个：
1. 第一次进入 high
2. 15min 分数上涨 >= 5
3. 1H 分数上涨 >= 8
4. 排名进入全场前 5

默认建议：按 `pre_selection_target_u = agent_cap_u * 30% * pre_selection_progress` 给观察仓。
如果暂时还没有 fundamental_ratio，就先展示“建议关注”，不直接给固定 U 数。
```

临界 Alpha：

```text
selected_now = false
70 <= selection_score < 75
并且满足至少两个：
1. 15min 分数上涨 >= 5
2. 1H 分数上涨 >= 8
3. 排名进入全场前 10
4. 1H 排名上升 >= 5 名
5. 资本效率、交易结果、样本可信度等任一子分明显增强

默认建议：按 `agent_cap_u * 30%` 的一部分给试探仓。
临界 Alpha 不能直接套固定 20U-40U，必须先看 fundamental_ratio。
```

入选确认：

```text
selected_now: false -> true

必须通知。

原因：用户策略是入选前按入选预期下注；确认入选后切换到 burn 逻辑。
```

入选预期走弱：

```text
对已持有、已入选、或此前 targetU > 0 的 agent：

满足以下任一项就提醒：
1. selection_score 跌破 70
2. 15min 分数下跌 >= 5
3. 1H 分数下跌 >= 8
4. 排名跌出前 10

默认动作：检查是否减仓；未入选候选跌破风险线则停止加仓。
```

通知冷却：

```text
强 Alpha / 临界 Alpha / 走弱提醒：默认 30 分钟。

入选确认：默认 6 小时。

启动第一轮只建立基线，不发送历史提醒，避免服务重启后刷屏。
```

## 3.2 三层仓位判断

仓位不再从固定 U 数开始，而是先得到每个 agent 自己的基本面比例。

```text
fundamental_ratio = 这个 agent 在当前策略里值得分配多少上限的比例。范围 0 到 1。

max_agent_cap_u = 单个 agent 理论最高投入。当前默认 200U。

agent_cap_u = max_agent_cap_u * fundamental_ratio。
```

原因：

```text
S / A / B / C 这类档位只适合给人阅读，不适合直接参与计算。

如果两个 agent 的 burn 分数一样，但基本面不同，仓位应该自然按 fundamental_ratio 缩放。

低基本面 agent 即使短期数据变好，也不应该拿到和高基本面 agent 一样的绝对仓位。
```

三层仓位仍然保留，但每层都按 `agent_cap_u` 计算：

```text
第一层：入选预期仓位。发生在官方 Top 10 公布前，最高为 agent_cap_u * 30%。

第二层：入选确认仓位。发生在官方 Top 10 公布后，累计最高为 agent_cap_u * 40%。

第三层：burn Pot 阶段仓位。时间上从周二 08:30 到下周一 08:00；是否加到 burn 仓位层，主要看官方 Pot Live P&L 是否形成正向预期、已实现 P&L 是否增强质量、以及 estimated burn 对市值/流动性的影响。最终最高为 agent_cap_u * 100%。
```

整体比例：

```text
入选预期 + 入选确认 : burn 阶段 = 4 : 6。

在前 40% 中，入选预期 : 入选确认 = 3 : 1。

如果 fundamental_ratio = 1 且 max_agent_cap_u = 200U：
入选预期最高 60U。
入选确认后累计最高 80U。
burn 阶段最终最高 200U。

如果 fundamental_ratio = 0.5 且 max_agent_cap_u = 200U：
入选预期最高 30U。
入选确认后累计最高 40U。
burn 阶段最终最高 100U。
```

### 3.2.1 阶段字段拆分

不要再用一个 `stage` 同时表达时间、信号和动作。三个问题必须分开：

```text
calendar_phase = 当前处于比赛的哪个时间窗口。

signal_state = 当前数据正在表达什么信号。

position_layer = 当前目标仓位来自哪一层逻辑。
```

时间阶段：

```text
confirmation_window = 北京时间周一 08:00 到周二 08:30。

burn_pot_window = 北京时间周二 08:30 到下周一 08:00。
```

说明：

```text
入选预期不是一个只在某段时间出现的日历阶段，而是一条长期运行的扫描线。

即使当前已经是 burn_pot_window，Competing Agents 仍然继续扫描下一期入选预期。

进入 burn_pot_window 不代表已经有 burn 加仓信号。
它只代表时间已经进入 Pot Top 10 公布后的 burn 观察期。
```

信号状态示例：

```text
pre_selection_high = 未入选但入选预期很强。

burn_early_no_momentum = 历史状态名；降噪版中不再因为缺少 15min / 1H 而阻止 burn 判断。

pnl_negative_recovering = Live P&L 为负，但短期快照显示正在修复。它只用于复盘标注，不用于加仓。

burn_strengthening = burn 信号正在增强，可以进入 burn 加仓层。

danger_exit = 风险触发退出。
```

仓位层：

```text
no_position = 不建仓或目标为 0。

pre_selection = 入选预期仓。

confirmation = 入选确认仓。

burn_add = burn Pot 加仓层。

reduce = 风险压仓。

exit = 退出。
```

因此当前常见状态可以是：

```text
calendar_phase = burn_pot_window
signal_state = burn_early_no_momentum
position_layer = confirmation
```

这表示：时间已经进入 burn Pot 阶段，但 burn 信号还不成熟，所以只保留确认仓，不加 burn 仓。

### 3.2.2 基本面比例

`fundamental_ratio` 来自 Competing Agents 的基本面评分，但不等同于 `selection_score`。

```text
selection_score = 入选前，这个 agent 是否值得关注。

fundamental_ratio = 建仓和加仓时，这个 agent 最高值得分配多少比例。
```

当前默认设计：

```text
fundamental_ratio = clamp(fundamental_score / 100, 0, 1)
```

后续可以用真实结果校准曲线，例如让 80 分以上的 agent 逐渐接近满比例，让低样本或低胜率 agent 的比例自然变小。

### 3.2.3 入选预期仓

第一层仍然同时看 `selection_score` 和 `selection_rank`。

```text
selection_cap_u = agent_cap_u * 30%。

selection_score >= 75 = selection_cap_u。

70 <= selection_score < 75，且 selection_rank <= 10 = selection_cap_u * 2/3。

65 <= selection_score < 70，且 selection_rank <= 10 = selection_cap_u * 1/3。

65 <= selection_score < 75，但 selection_rank > 10 = 0U，只观察。

selection_score < 65 = 0U。
```

原因：

```text
入选是 Top 10 竞争，不是单纯分数达标。

如果全场整体偏弱，67 分但排进前 10 的 agent 仍然有入选预期。

如果分数没有到 75，排名必须进入前 10 才允许占用第一层仓位。
```

### 3.2.4 入选确认仓

入选后不能只看官方 allocation，也不能把确认仓当成不会被 Pot 表现影响的地板。

确认强度先用旧公式：

```text
selected_confirmation_score =
70% * selection_score
+ 30% * official_allocation_score
```

Pot 当前表现再用正负函数修正确认分：

```text
pot_live_pnl_ratio = pot_live_pnl_usd / pot_allocation_usd

live_pnl_points =
35 * tanh(pot_live_pnl_ratio / 0.20)

pnl_adjustment =
live_pnl_points

confirmation_position_score =
selected_confirmation_score
+ pnl_adjustment
```

解释：

```text
盈利给正分，亏损给负分。

15min / 1H 变化量只作为复盘诊断，不再进入确认仓评分。

普通波动只改变分数，不直接触发清仓。

极端亏损不靠分数慢慢扣，而是进入风险倍率。
```

确认仓上限：

```text
confirmation_cap_u = agent_cap_u * 40%。
```

第一版可以继续用分数区间映射成确认进度，后续再校准为更平滑的函数：

```text
confirmation_position_score >= 85 = confirmation_cap_u * 100%。

75 <= confirmation_position_score < 85 = confirmation_cap_u * 87.5%。

65 <= confirmation_position_score < 75 = confirmation_cap_u * 75%。

50 <= confirmation_position_score < 65 = confirmation_cap_u * 50%。

35 <= confirmation_position_score < 50 = confirmation_cap_u * 25%。

confirmation_position_score < 35 = 0U。
```

### 3.2.5 风险倍率

风险倍率只负责压缩当前阶段的上限，不负责重新打基本面分。

```text
risk_multiplier = 当前 Pot 风险状态对可持有仓位的压缩比例。
```

当前默认规则：

```text
normal = 1.0。

yellow = 0.5。
触发：pot_live_pnl_usd <= -2500，或 pot_live_pnl_ratio <= -15%。

catastrophic = 0。
触发：pot_live_pnl_usd <= -4000，或 pot_live_pnl_ratio <= -50%，或 pot_realized_pnl_usd <= -4000。
```

风险后的确认仓：

```text
raw_confirmation_target_u =
confirmation_cap_u * confirmation_progress。

risk_cap_u =
confirmation_cap_u * risk_multiplier。

final_confirmation_target_u =
min(raw_confirmation_target_u, risk_cap_u)。
```

含义：

```text
黄色风险不是所有 agent 都最多 40U。

黄色风险是“该 agent 自己的 confirmation_cap_u 打 5 折”。

例如 fundamental_ratio = 1 时，confirmation_cap_u = 80U，黄色风险上限是 40U。

如果 fundamental_ratio = 0.5，confirmation_cap_u = 40U，黄色风险上限是 20U。
```

### 3.2.6 Burn 加仓

超过入选确认层的仓位不再由入选确认分决定，而是由 burn 预期决定。

注意：这里的 Burn 加仓是 `position_layer = burn_add`，不是 `calendar_phase = burn_pot_window`。当前时间进入 burn_pot_window 后，如果信号还不完整，仓位层仍然可以是 confirmation。

```text
burn_cap_u = agent_cap_u。

burn_progress = burn_quality_score 和 Live P&L 方向共同决定的 0 到 1 进度。

raw_burn_target_u =
burn_cap_u * burn_progress。

final_target_u =
max(final_confirmation_target_u, raw_burn_target_u)。
```

进入 burn 加仓的前提：

```text
pot_live_pnl_usd > 0。

risk_multiplier = 1.0。

burn_quality_score 必须由正向 Live P&L、estimated burn 冲击和已实现 P&L 质量共同支撑。
```

第一版 burn 进度可以保留分段映射，但输出必须按 `agent_cap_u` 缩放：

```text
burn_progress < 40% = 不突破入选确认仓。

burn_progress 50% = agent_cap_u * 50%。

burn_progress 60% = agent_cap_u * 60%。

burn_progress 80% = agent_cap_u * 80%。

burn_progress 100% = agent_cap_u * 100%。
```

### 3.2.7 操作换算

所有仓位判断都和当前已投入本金比较：

```text
加仓金额 = 目标本金 - 当前已投入本金。

目标本金低于当前已投入本金 = 减仓到目标本金。

未入选官方 Top 10 = 清掉入选预期仓位。

已入选但风险恶化 = 按 risk_multiplier 减仓，不再默认保留确认仓地板。
```

输出给用户时，建议按最小买入单位取整：

```text
默认向下取整到 10U。

低于 10U 的目标，如果不是用户主动指定，不单独建仓。
```

仓位调整通知：

```text
每分钟计算一次目标仓位。

目标仓位变化 >= 20U = 发送飞书仓位调整通知。

仓位阶段变化 = 发送飞书仓位调整通知。

通知内容包含：上次目标、当前目标、阶段、原因、官方 Pot Live P&L、已实现 P&L、确认调整、Burn 预期、风险倍率。
```

## 4. Burn 预期

Burn 预期指的是：

```text
burn_expectation = 已入选 agent 被 Pot 跟单后，产生利润并带来 buyback & burn 的可能性和强弱。
```

Burn 预期主要来自 Pot Monitor 的 Live P&L 当前结果。

第一版只看最少必要信号。

Pot Monitor 最小字段：

```text
season_id = 当前赛季编号。用于识别是否换季。

season_name = 当前赛季名称。用于用户阅读。

pot_name = PotAgent 名称。用于定位是哪一个 Pot 在跟单。

pot_wallet = PotAgent 钱包地址。用于链上核对。

agent_id = 被跟单的 competing agent 编号。用于和 Competing Agents 对齐。

agent_name = 被跟单的 competing agent 名称。

token_symbol = 被跟单 agent 对应代币符号。

pot_allocation_usd = 官方 Pot 给该 agent 的跟单起始资金。第三阶段里它不是独立加分维度，而是 Live P&L 的杠杆：相同收益率下，allocation 越大，pot_live_pnl_usd 和潜在 burn 金额越大。

pot_current_value_usd = 当前官方 Pot 跟单账户价值。

pot_live_pnl_usd = pot_current_value_usd 减去 pot_allocation_usd，也等于 pot_realized_pnl_usd + pot_unrealized_pnl_usd。代表官方 Pot 跟单账户当前已经形成的总盈利或总亏损。

pot_realized_pnl_usd = 官方 Pot 跟单账户当前已实现 P&L。

pot_unrealized_pnl_usd = 官方 Pot 跟单账户当前未实现 P&L。

my_token_pnl_usd = 用户自己买入 Agent 代币后的持仓盈亏。它只用于用户资金管理，不用于判断该 Agent 是否有 burn Alpha。

positions = 官方 Pot 跟单账户当前持仓摘要。只保留 pair、side、leverage、unrealized_pnl_usd 和 notional_size_usd。

pot_delta_pnl_15m_usd = 15 分钟官方 Pot Live P&L 变化。只作为后台诊断和复盘字段，不进入默认评分或默认提醒。

pot_delta_pnl_1h_usd = 1 小时官方 Pot Live P&L 变化。只作为后台诊断和复盘字段，不进入默认评分或默认提醒。

season_time = 当前处于赛季第几天。越接近结算，正 Live P&L 越接近可兑现 burn 预期。

data_freshness = Pot 数据和本地快照是否足够新。旧数据不能触发预期判断。
```

Burn 预期不再堆叠多个重复分数，而是围绕一个主问题：

```text
burn_quality_score = 当前官方 Pot Live P&L 是否已经形成值得加仓的 burn 预期。
```

核心关系：

```text
pot_live_pnl_usd 是主字段，直接决定 burn 阶段仓位方向。

pot_realized_pnl_usd 只做额外兑现质量增强或风险惩罚。

15min / 1H 变化量只用于复盘，不再把深度亏损的 agent 抬成高分。

进入第三阶段后，official allocation 不再作为独立 burn 维度重复加分。它通过 `pot_live_pnl_usd` 和 `estimated_burn_usd` 发挥杠杆作用。
```

打分前先过基础门槛：

```text
eligible_for_burn_scoring = 该 agent 当前已被 Pot 选中并跟单。

not_selected = 当前没有 Pot 跟单。此时 burn_quality_score = none。

data_invalid = pot_current_value_usd <= 0、pot_allocation_usd <= 0 或关键字段缺失。此时输出 unknown，不进入仓位判断。

data_stale = Pot 数据或本地快照过旧。此时输出 unknown，不进入仓位判断。
```

### Burn 质量分

`burn_quality_score` 只回答：

```text
这个 agent 当前有没有真实 buyback & burn 基础？
```

它看的是当前状态，不代表市场是否已经定价。

最少必要字段：

```text
pot_live_pnl_usd = pot_current_value_usd - pot_allocation_usd = pot_realized_pnl_usd + pot_unrealized_pnl_usd。

pot_realized_pnl_usd = 官方 Pot 跟单账户当前已实现 P&L。

pot_unrealized_pnl_usd = 官方 Pot 跟单账户当前未实现 P&L。

pot_allocation_usd = 官方 Pot 跟单起始资金。它不单独作为 burn 加分项，只作为 pot_live_pnl_usd 的杠杆来源和风险比例分母。

season_time = 当前距离赛季结算还有多久。
```

解释规则：

```text
pot_live_pnl_usd <= 0 = 没有 burn 基础。

pot_live_pnl_usd > 0 = 有 burn 基础。

pot_live_pnl_usd 完整计入预期，不因为其中一部分是未实现 P&L 就打折。

pot_realized_pnl_usd 是额外兑现质量增强：同样的 pot_live_pnl_usd，已实现部分越高，预期越稳。

pot_unrealized_pnl_usd 不单独削减贡献，因为市场预期看到的是完整 Live P&L；但未实现盈利不会额外增强，未实现亏损已经包含在 pot_live_pnl_usd 的负向信号里。

estimated_burn_usd 相对市值或流动性越大 = buyback & burn 的价格影响越可能大。
```

当前函数：

```text
pot_live_pnl_foundation_score = f_positive(pot_live_pnl_usd, 5000)

pot_realized_quality_points = 20 * tanh(pot_realized_pnl_usd / 5000)

burn_impact_market_score = f_positive(estimated_burn_usd / token_market_cap_usd, 0.003)

burn_impact_liquidity_score = f_positive(estimated_burn_usd / token_liquidity_usd, 0.02)

burn_impact_score =
60% * burn_impact_market_score
+ 40% * burn_impact_liquidity_score

burn_quality_score =
70% * pot_live_pnl_foundation_score
+ 20% * burn_impact_score
+ pot_realized_quality_points

最终按 0 到 100 截断。
```

说明：

```text
不要再单独计算 realization_quality_score 去削减未实现收益。

原因：我们的交易目标是预期，不是会计确认。pot_live_pnl_usd 是市场看到的完整预期信号；已实现 P&L 只做额外增强或风险惩罚。

pot_allocation_usd 不再进入 burn_quality_score。

原因：第三阶段里 allocation 是 Live P&L 的杠杆，已经体现在 pot_live_pnl_usd 和 estimated_burn_usd 里；再次单独加分会重复计算。
```

当前测试状态：

```text
本周比赛已进入收尾阶段，Current Season 的 Agent 仓位会陆续关闭。

SETTLED / DRAINING 状态下的样本可以用于验证字段、函数和数据源是否正确。

但它不应该被当成新的买入机会，因为信息差已经显著衰减。

下一次有效 burn 预期测试应等待新一周 Top 10 Agent 开始跟单后进行。
```

服务器数据源修正：

```text
pot_pnl_snapshots = 轻量时间序列，只保存 agent_name / season_id / live_pnl / timestamp。

用途：计算 15min / 1H 的 Live P&L 变化。

pot_agent_snapshots = 完整 Top10 原始快照，保存每轮官网 Current Season 返回的关键字段和 raw_json。

用途：复盘某一分钟的真实 Top10、allocation、currentValue、realized/unrealized P&L、positions，而不是依赖官网当前状态。

expectation 评分优先使用 3 分钟内的 pot_agent_snapshots。

如果服务器没有新鲜完整快照，才回退到官网 API。
```

### Live P&L 阶梯提醒

降噪版不再使用 15min / 1H 变化提醒作为默认通知。原因是这些变化量和 Live P&L 阶梯都在回答同一个问题：官方 Pot 到底赚了还是亏了，赚亏幅度是否改变了市场预期。

默认正向提醒：

```text
+1500 / +3000 / +4500 / +6000 / +7500 / +10000 / +15000 / +20000
```

默认负向风险提醒：

```text
-2500 = 进入减仓风险阶梯，优先人工风险复核。

-4000 = 进入清仓风险阶梯，最高优先级人工风险复核。
```

提醒只在穿越新阶梯时触发，不按分钟重复提醒。

正向 Live P&L 阶梯同时映射 burn 阶段目标仓位比例。比例以 `agent_cap_u` 为基准，而不是所有 agent 固定同一个 U 数：

```text
0 ~ +1500 = 只保留确认仓，最多 agent_cap_u * 40%。

+1500 = agent_cap_u * 45%。

+3000 = agent_cap_u * 50%。

+4500 = agent_cap_u * 55%。

+6000 = agent_cap_u * 60%。

+7500 = agent_cap_u * 65%。

+10000 = agent_cap_u * 75%。

+15000 = agent_cap_u * 90%。

+20000 = agent_cap_u * 100%。
```

已实现 P&L 是质量修正，不是独立阶梯：

```text
realized_quality_target_bonus =
10% * tanh(pot_realized_pnl_usd / 5000)，范围限制在 -5% 到 +10%。

final_burn_target_ratio =
live_pnl_target_ratio + realized_quality_target_bonus。
```

如果 `pot_realized_pnl_usd <= -4000`，不再作为普通扣分处理，而是进入清仓风险门槛。

通知文案按方向区分：

```text
上穿 = 从低档进入高档。例如 1000 -> 1500，标题为「Live P&L 上穿」。

回落 = 从高档回到较低但仍为正向的档位。例如 3200 -> 2600，标题为「Live P&L 回落」。

跌破 = 跌出当前正向档位并回到确认仓。例如 1600 -> 1300，标题为「Live P&L 跌破」。

风险 = 跌破负向风险档。例如 -2500 / -4000，标题为「Live P&L 风险」。
```

2026-05-01 起，阶梯通知只负责提示信号和风险，不直接下达仓位调整动作。

通知必须展示：

```text
信号
动作
实时盈亏
盈亏构成
当前价格
5min / 15min / 1H 变化量
阶梯变化
参考比例
仓位调整暂停说明
```

仓位调整卡默认暂停发送；目标仓位仍继续计算并保存快照，用于复盘和未来恢复。

为了避免在档位附近来回刷屏，向下离开正向档位或负向风险档时使用 10% 缓冲。比如 +1500 档位要跌到 +1350 以下，才算真正跌破。

15min / 1H 快照仍然保存，用途只剩两个：

```text
1. 复盘某次 Live P&L 阶梯突破前后发生了什么。

2. 调试数据链路是否连续。
```

它们不再进入默认评分、默认提醒或仓位目标。

### 市值与流动性冲击

```text
estimated_burn_usd = max(pot_live_pnl_usd, 0) * 50%
```

官方规则是 Pot 盈利的 50% 用于对应 agent token 的 buyback & burn，所以 burn impact 应该看 estimated_burn_usd 相对于 token market cap 或流动性的比例，而不是只看绝对 P&L。

当前代码状态：

```text
token_market_cap_usd / token_liquidity_usd 已接入 Virtuals 官方 agent API。

对 undergrad / preToken 阶段的代币，不使用 GeckoTerminal / Dexscreener 的 token 池子结果作为默认来源。

原因：这类代币在 DEX 聚合器里可能返回空池子或 0，但 Virtuals 页面本身已经有 Market Cap / FDV / Liquidity / 24h Vol。

market_cap_usd = mcapInVirtual * VIRTUAL/USD。

fdv_usd = fdvInVirtual * VIRTUAL/USD。

token_liquidity_usd = liquidityUsd。

token_volume_24h_usd = volume24h。
```

缺少 token_market_cap_usd 或 liquidity 时，不能判断真实 burn 冲击；该维度按 0 处理，并在输出中暴露缺失字段。

## 5. 持仓暴露

持仓暴露指的是：

```text
holding_exposure = 用户当前持有的代币，分别押注了哪些 agent 的入选预期和 burn 预期。
```

它回答的不是“应该买什么”，而是：

- 我现在押注了哪些 agent？
- 这些 agent 的入选预期是增强还是减弱？
- 这些 agent 的 burn 预期是增强还是减弱？
- 哪些持仓只是钱包里存在，但不属于当前交易赛分析范围？

已确认的排除规则：

```text
AIDOG = 钱包里存在，但不是 virtual-degen 交易赛代币，不纳入 Phase 2.4 分析范围。
```

当前已确认的持仓映射：

```text
BL = ButlerLiquid

WOA = WolfOfAlgos

EVERYTRADE = EverythingTrade

BENYORKE = BenYorke | Starchild

ZMAC = ZMAC

NOVA = Nova
```

映射后的解释规则：

```text
已入选且有 Pot 跟单 = 同时暴露在入选预期和 burn 预期上。

未入选但在 Competing Agents 中 = 主要暴露在未来入选预期上。

不属于 Competing Agents = 不纳入 Phase 2.4 的交易赛分析。
```

## 6. 第一版输出

第一版输出不做复杂页面，先支持对话式分析。

注意：本节描述的是当前已部署模型。`npm run expectation`、云端 `position_advice_snapshots` 和飞书仓位调整通知已经同步到比例模型；后续主要任务是用新一周真实跟单数据继续校准参数。

当前可重复刷新命令：

```text
npm run expectation
```

默认输出只展示表格摘要，不打印完整 JSON。需要排查字段时再使用：

```text
EXPECTATION_JSON=1 npm run expectation
```

默认分析持仓：

```text
ZMAC, NOVA, EVERYTRADE, WOA, BL, BENYORKE
```

如果要临时换一组代币，可以用环境变量覆盖：

```text
HELD_SYMBOLS=BL,WOA npm run expectation
```

每次分析优先输出：

```text
我的持仓暴露 = 用户持仓分别暴露在哪些预期上。

搜索名称 = 页面里应该搜索的 Agent 名称，而不是代币符号。

目标仓位 = 根据 fundamental_ratio、当前阶段、P&L 函数调整、风险倍率和 burn 进度，输出当前每个 agent 的目标 U 数。

早期 Alpha 候选 = 当前未入选，但入选预期分已经达到 high 的 agent。

观察列表 = 当前未入选，入选预期分接近 high 的 agent。

已入选参照组 = 当前已被 Pot 跟单的 agent，用于比较谁已经兑现了入选预期。

Burn 预期拆解 = 对每个已入选 agent 输出官方 Pot Live P&L、已实现/未实现 P&L、estimated burn、市值/流动性冲击、burn_quality_score、risk_multiplier 和目标仓位。

当前 burn 预期变化 = 哪些已入选 agent 的 Pot Live P&L 穿越了新的盈利或亏损阶梯。

需要马上看的对象 = 同时满足预期增强、Live P&L 上穿关键阶梯、和用户暴露相关的 agent。
```

仓位模型：

```text
agent_cap_u = 200U * fundamental_ratio。

入选预期上限 = agent_cap_u * 30%。

入选确认累计上限 = agent_cap_u * 40%。

burn 最终上限 = agent_cap_u * 100%。

selected_confirmation_score 先决定入选确认强度。

官方 Pot Live P&L 用 signed function 形成 pnl_adjustment。

confirmation_position_score = selected_confirmation_score + pnl_adjustment。

risk_multiplier 按当前亏损和修复状态压缩确认仓上限。

final_confirmation_target_u = min(raw_confirmation_target_u, confirmation_cap_u * risk_multiplier)。

pot_live_pnl_usd <= 0 = 不进入 burn 加仓。

risk_multiplier < 1 = 不进入 burn 加仓，只按风险后的确认仓处理。

burn 加仓目标 = agent_cap_u * burn_progress。

burn_progress = Live P&L 阶梯对应比例 + 已实现 P&L 质量修正。

最终目标仓位 = max(final_confirmation_target_u, burn 加仓目标)。

所有目标按最小 10U 操作单位向下取整。

未入选阶段如果周一 Council 没选上，或周二 08:10 仍不是 selected_now = 卖出该 agent 入选预期仓位。

入选后如果 P&L 恶化导致 risk_multiplier 下降 = 按风险倍率减仓。

入选后如果 burn_quality_score 不再支撑 = 卖出 burn 加仓层，但是否保留确认仓由 confirmation_position_score 和 risk_multiplier 决定。
```

## 7. 非目标

Phase 2.4 暂时不做：

- 不自动给买卖建议。
- 不自动交易。
- 不把用户持仓当成全场分析源头。
- 不恢复大户成本分析主线。
- 不把 AIDOG 纳入 virtual-degen 交易赛分析。
- 不急着做复杂评分 Dashboard。

## 8. 成功标准

- 用户能看懂“入选预期”和“burn 预期”的区别。
- 用户能知道自己持仓分别暴露在哪些预期上。
- Live P&L 阶梯突破被视为最高优先级的 burn 预期信号。
- 分析先覆盖全场，再映射个人持仓。
- 输出足够短，能支持用户和 Agent 直接对话分析。
