# Plan 纲领

> 维护规则：本文档是产品路线图纲领。Agent 每次完成代码或部署改动后，需要同步更新本文档的当前状态和索引，但不要把技术细节写进来。

> 方向入口：多方向边界、命名、公开同步规则以 [Project Map](./project-map.md) 为准。本文档只保留产品路线图，不承担方向分流职责。

## 当前阶段

Phase 2.4：入选预期与 Burn 预期分析

当前目标是先独立判断全场 competing agents 的「入选预期」和当前 Pot 的「burn 预期」，再把用户持仓映射成风险/收益暴露。

当前进展：Pot Monitor 和 Selection Alpha monitor 已经在云服务器 7*24 运行。Phase 2.3 的决策记录字段已完成产品定义，但暂不进入实现；Phase 2.4 的当前可执行闭环已完成：一键刷新分析、每分钟入选预期评分快照、个人持仓暴露、早期 Alpha 候选、观察列表、已入选参照组和目标仓位都已可用。仓位模型已从固定 U 档位升级并部署为“基本面比例模型”：先得到 `fundamental_ratio`，再得到 `agent_cap_u = 200U * fundamental_ratio`，入选预期 / 入选确认 / burn 分别按 `30% / 40% / 100%` 计算；官方 Pot Live P&L 是第三阶段仓位和提醒的主字段，正向 Live P&L 阶梯已映射为 `45% / 50% / 55% / 60% / 65% / 75% / 90% / 100%` 的 burn 目标仓位比例，已实现 P&L 只做 -5% 到 +10% 的质量修正。5min / 15min / 1H 变化量只作为 P&L 类通知、后台诊断和复盘材料，不再进入默认评分或默认独立提醒。风险门槛已简化为 `pot_live_pnl_usd <= -2500` 减仓风险、`<= -4000` 清仓风险。阶段语义已拆成 `calendar_phase / signal_state / position_layer`，当前可以同时处于 burn Pot 时间窗口和 confirmation 仓位层。`npm run expectation`、云端 `position_advice_snapshots` 和飞书通知已同步到新模型；Live P&L 阶梯通知保留“信号、动作、实时盈亏、盈亏构成、当前价格、5分钟/15分钟/1小时变化量、阶梯变化、参考比例、仓位调整暂停说明”，仓位调整卡默认暂停发送，只继续保存目标仓位快照用于复盘，不再单独发送“清仓建议”。Burn 预期已接入 Virtuals 页面同源的市值、流动性和 24h 成交量；已新增 `pot_market_snapshots` 长期复盘表，用于研究 Live P&L 与代币价格的领先/滞后关系，默认保留 30 天，并提供 `npm run lag:analyze` 分析命令。Live P&L 阶梯漏报已修复，并补上阈值状态测试、发送失败重试、重启恢复、HTTP 超时、监控循环防重叠、Season `DRAINING / SETTLED` 持续采集和 Selection 失败隔离；`npm run thresholds:test`、`npm run burn-model:test`、`npm run position-model:test`、`npm run expectation` 和服务器一次性 monitor 验证均已通过。回购执行地址监控只在北京时间每周一 16:00 到 20:00 扫描，发现官方买入后触发飞书提醒。自动卖出已完成“小额直接卖出 -> 回购触发卖出”测试闭环，并切回正式运行：监听真实回购执行地址，命中后卖出热钱包内该代币 100%。本地已补上自动卖出执行审计表、窗口前健康检查命令和专项测试，待下一次部署同步到服务器。

可靠性补强：当前通知不再依赖内存待发送队列。飞书卡片会先写入数据库 outbox，再由发送器领取并投递；失败会退避重试，进程重启后仍能继续补发，并且不会因为 Pot 监控和回购监控同时运行而重复发送同一条。官网 Pot 每轮原始行也会保存，正常行和异常行都可复盘，避免 `currentValue=0` 这类异常被静默过滤。若多个 Agent 同时返回 `currentValue=0`，系统仍按“官网数据源异常事件”处理并暂停仓位建议，但不再发送“官网数据异常”飞书卡；孤立单 Agent 异常也只进入日志和原始快照，不再发送“疑似归零”飞书卡。独立数据健康 watchdog 继续每分钟检查采集稳定性；普通健康结果只写服务器日志，但 Pot Live P&L 主线断采会作为“监控事故”单独发送飞书 @ 文本。5min / 15min / 1H 变化量要求首尾帧都有效且时间跨度足够，异常缺帧时显示具体质量状态，不把缺失数据误算成趋势。Selection 同类提醒的冷却会读取通知历史，重启后不再只靠内存。为了避免只看普通飞书卡片错过关键风险，强提醒通道改为飞书 @ 文本：飞书卡片继续承载完整决策信息，@ 文本只承载需要立刻听到的短句警报。

## 阶段索引

- Phase 0：想法验证
  - 状态：已完成
  - 说明：验证“看大户成本能否帮助判断入场机会”。

- Phase 1：大户成本分析 Dashboard
  - 状态：暂停维护
  - 说明：保留为历史能力和辅助视图，当前不作为主线。

- Phase 2：Virtuals Degen Pot Monitor
  - 状态：已形成主线
  - 说明：从单个代币分析升级为观察交易赛 10 个 Agent 的 Live P&L。

- Phase 2.1：云服务器同步与常驻运行
  - 状态：已完成
  - 子 plan：[phase-2.1-cloud-sync-plan.md](./phases/phase-2.1-cloud-sync-plan.md)
  - 子 todo：[phase-2.1-cloud-sync-todo.md](./phases/phase-2.1-cloud-sync-todo.md)

- Phase 2.2：15min 信息差信号
  - 状态：已完成快速信号与稳定性闭环
  - 说明：优先捕捉 Copy-trading Live P&L 的快速变化，把它作为代币未来预期变化的早期信号。
  - 子 plan：[phase-2.2-info-edge-signal-plan.md](./phases/phase-2.2-info-edge-signal-plan.md)
  - 子 todo：[phase-2.2-info-edge-signal-todo.md](./phases/phase-2.2-info-edge-signal-todo.md)

- Phase 2.3：决策记录字段定义
  - 状态：产品定义已完成，暂缓实现
  - 说明：按照“最少必要、定义无歧义、分类互斥完整”的原则，冻结提醒后的记录字段。
  - 子 plan：[phase-2.3-decision-record-fields-plan.md](./phases/phase-2.3-decision-record-fields-plan.md)
  - 子 todo：[phase-2.3-decision-record-fields-todo.md](./phases/phase-2.3-decision-record-fields-todo.md)

- Phase 2.4：入选预期与 Burn 预期分析
  - 状态：当前可执行闭环已完成；后续只在真实市场结果证明参数不合理时继续校准
  - 说明：以 `Competing Agents` 和官方 Pot Monitor `Live P&L` 为两个分析来源，先判断全场预期，再映射用户持仓暴露；入选预期已进入每分钟云端监控，Burn 预期已接入 Virtuals 页面同源市值/流动性数据。最新仓位模型改为按基本面比例缩放，并用 P&L 函数调整和风险倍率处理减仓；第三阶段中 official allocation 只作为 Pot Live P&L 的杠杆，不再独立加分。Season 5 Top10 已完成真实数据测试和服务器部署验证。
  - 子 plan：[phase-2.4-expectation-exposure-plan.md](./phases/phase-2.4-expectation-exposure-plan.md)
  - 子 todo：[phase-2.4-expectation-exposure-todo.md](./phases/phase-2.4-expectation-exposure-todo.md)

## 当前产品原则

- 当前主线只围绕 Pot Monitor。
- 大户成本分析暂停维护，不在 Phase 2.1 里继续扩展。
- Live P&L 阶梯提醒优先于变化量提醒；5min / 15min / 1H 变化量只保留为仓位卡片辅助和后台复盘材料。
- 全场预期判断先于个人持仓判断；个人持仓只用于映射当前暴露，不作为分析源头。
- 当前数据分析来源只有两个：Degen Virtuals `Competing Agents` 和官方 Pot Monitor `Live P&L`。
- Pot P&L 和用户代币持仓 P&L 必须分开：前者是 Alpha 信号，后者只用于用户资金管理。
- 阈值用于提醒和风控边界，函数用于评分；仓位先按基本面比例确定上限，再按阶段进度、P&L 调整和风险倍率计算。
- 字段必须最少必要、定义无歧义；分类字段必须互斥且完整。
- 提醒要少而有用，不追求消息数量。
- 强提醒只覆盖真正需要立刻打断人的事件：正向阶梯上穿、负向风险阶梯跌破、回购触发和自动卖出失败；`Live P&L <= -2500` 是减仓风险，`<= -4000` 是清仓风险。
- 文档面向普通用户和产品判断，技术细节放到子 todo 或运行文档。
