# Phase 2.3 Plan：决策记录字段定义

> 维护规则：本文档是 Phase 2.3 的产品计划。它先冻结字段含义和边界，不写实现方案，不扩展成 Dashboard。

## 1. 阶段目标

在飞书提醒之后，给用户一个足够快的记录入口，用最少字段留下当时的判断、概率、信心、心理噪音和动作。

这个阶段的目的不是让系统替用户判断买卖，而是让用户事后能回答三个问题：

- 当时我到底判断了什么？
- 这个判断的概率和信心是多少？
- 后来结果证明，是信号错了、判断错了，还是执行错了？

## 2. 字段设计原则

字段必须满足两条基本要求：

- 必要：字段左边的名称必须对未来复盘有用；没有复盘价值就删除。
- 无歧义：字段右边的定义必须准确到不同人填写时含义一致；有歧义就继续改定义。

分类字段必须满足两条要求：

- 互不重合：同一情况只能落入一个选项。
- 合起来完整：所有选项加起来能覆盖全部情况。

当多个判断依据同时存在时，先按重要性排序，再给权重。权重模型只作为复盘工具，不作为自动交易建议。

## 3. 记录入口

默认入口是：飞书提醒卡片按钮 -> 私密记录页。

飞书提醒仍然先发，不要求用户先记录。用户只有在这条提醒值得判断、观察或交易时，才打开记录页补充主观判断。

## 4. 第一版最小字段

### 4.1 系统自动记录

这些字段由系统自动带入，用户不手填。

```text
signal_id = 一次飞书提醒的唯一编号。用于把提醒、用户判断和后验结果串起来。

alert_time = 飞书提醒发送时间。用于还原当时的判断时点。

agent_name = 触发提醒的 Copy-trading agent 名称。

token_symbol = 这次信号关联的代币符号。

signal_window = 触发变化量的观察窗口。只能是 15min 或 1H。

signal_direction = Live P&L 相比窗口起点的方向。只能是 up 或 down。

delta_pnl_usd = 当前 Live P&L 减去窗口起点 Live P&L，单位是美元。

trigger_tier_usd = 触发提醒的变化量档位。只能是 2000 或 5000。

current_live_pnl_usd = 提醒发生时该 agent 的 Live P&L，单位是美元。

position_snapshot = 提醒发生时该 agent 的持仓摘要。用于复盘 P&L 变化来自哪些仓位。
```

### 4.2 用户手动记录

这些字段是第一版必须保留的主观记录字段。

```text
review_window = 本次判断准备用多久后的结果验证。只能是 15min 或 1H。默认等于 signal_window。

expected_token_direction = 用户认为 review_window 结束时，token_symbol 的价格相对记录时更可能发生的方向。只能是 up / down / no_edge。这个字段只判断代币价格方向，不判断 Live P&L 方向。

subjective_probability = expected_token_direction 成立的主观概率。取值范围按 5 递增。如果 expected_token_direction 是 no_edge，固定为 50；如果 expected_token_direction 是 up 或 down，只能是 55 到 95，不能填 100。

evidence_confidence = 用户认为这次概率估计有多可靠。只能是 1 到 5。
1 = 只看了飞书提醒。
2 = 看了提醒，并粗看价格走势。
3 = 看了提醒、价格走势和代币基本信息。
4 = 除 3 之外，还看了至少一个独立信息源。
5 = 除 4 之外，已有清晰的提前判断，提醒只是触发复核。

primary_psychological_noise = 当时最可能扭曲判断的主要心理因素。只能选一个：none / fomo / fear_loss / recover_loss / overconfidence / fatigue_distraction / unclear。
none = 没有明显心理噪音。
fomo = 主要担心错过机会。
fear_loss = 主要担心亏损。
recover_loss = 主要想把之前亏损赚回来。
overconfidence = 主要觉得自己这次一定对。
fatigue_distraction = 疲劳、分心或状态差。
unclear = 当时说不清主要心理因素。

action = 看到提醒后的现货或多头实际动作。只能是 no_action / open_position / add_position / reduce_position / close_position。第一版不覆盖做空、合约和杠杆动作。
no_action = 没有交易。
open_position = 从无仓位变成有仓位。
add_position = 原本已有仓位，并增加仓位。
reduce_position = 原本已有仓位，并减少一部分仓位。
close_position = 原本已有仓位，并全部退出。

position_change_usd = 如果 action 不是 no_action，本次仓位变化的大约美元金额。只记录绝对金额，不记录盈亏。
```

### 4.3 系统后验记录

这些字段由系统在后续时间点自动补齐。

```text
token_price_at_record = 用户提交记录时 token_symbol 的价格。

token_price_after_review_window = review_window 结束时 token_symbol 的价格。

token_return_pct = review_window 内 token_symbol 的涨跌幅。

live_pnl_after_review_window = review_window 结束时该 agent 的 Live P&L。

live_pnl_delta_after_review_window = review_window 结束时 Live P&L 减去 current_live_pnl_usd。

judgment_result = 按 expected_token_direction 和 token_return_pct 判断结果。只能是 hit / miss / skipped。
hit = expected_token_direction 是 up 且 token_return_pct > 0，或 expected_token_direction 是 down 且 token_return_pct < 0。
miss = expected_token_direction 是 up 且 token_return_pct <= 0，或 expected_token_direction 是 down 且 token_return_pct >= 0。
skipped = expected_token_direction 是 no_edge。
```

## 5. 暂不进入第一版的字段

以下字段有价值，但会拖慢 30 秒记录目标，先不做必填。

```text
free_text_reason = 自由文本理由。暂不作为核心字段，因为歧义大、难比较。

kelly_position_suggestion = Kelly 仓位建议。暂不做，因为样本量不足时容易制造过度自信。

bayesian_prior = 贝叶斯先验概率。暂不做独立字段，先用 subjective_probability 作为用户当时的概率判断。
```

## 6. 后续加权比较

第一版先收集数据，不用总分影响动作。等样本足够后，再考虑以下复盘分数：

```text
signal_strength_score = 信号强度分。由 signal_window、trigger_tier_usd 和 delta_pnl_usd 自动计算。

token_expectation_score = 用户对代币未来预期的评分。只在深度复盘时填写。

agent_credibility_score = 该 agent 过往信号是否有效的评分。由历史记录自动统计。

execution_risk_score = 这次交易执行风险评分。只在发生交易时填写。
```

默认复盘权重可以是：

```text
行动复盘分 =
35% * signal_strength_score
35% * token_expectation_score
20% * agent_credibility_score
10% * execution_risk_score
```

这个分数只回答“当时为什么值得行动”，不回答“下次一定该买多少”。

## 7. 成功标准

- 用户在 30 秒内能完成一条记录。
- 每个字段都有必要性和无歧义定义。
- 分类字段互不重合且覆盖全部情况。
- 后续可以自动判断 hit / miss / skipped。
- 第一版不引入自动交易、不引入做空/合约动作、不引入 Kelly 仓位建议。
