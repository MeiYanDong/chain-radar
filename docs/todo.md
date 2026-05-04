# Todo 纲领

> 维护规则：本文档只记录产品层面的当前任务、阻塞点和阶段索引。Agent 每次完成代码或部署改动后，需要同步更新状态，但不要写代码流水账。

> 方向入口：执行任何任务前先看 [Project Map](./project-map.md)，确认属于 Pot Monitor、Buyback Sentinel、Cloud Stability、Research 还是暂停维护的 Phase 1。

## 当前任务

- [x] 项目多方向系统整理
  - 产物：[Project Map](./project-map.md) 和 [Docs Index](./README.md)
  - 说明：已明确 Phase 1、Pot Monitor、Phase 2.4、Buyback Sentinel、Cloud Stability、Research 的边界、source-of-truth 顺序、GitHub 同步拆分规则和最小测试门槛。

- [x] Phase 2.4：入选预期与 Burn 预期分析
  - 子 todo：[phase-2.4-expectation-exposure-todo.md](./phases/phase-2.4-expectation-exposure-todo.md)
		  - 当前进度：当前可执行闭环已完成。已完成一键刷新分析、个人持仓暴露、早期 Alpha 候选、搜索名称、观察列表、已入选参照组和目标仓位；selection_score 已按“一个函数只回答一个判断问题”展开子分；仓位模型已从固定 U 档位升级并部署为 `fundamental_ratio -> agent_cap_u -> 30% / 40% / 100%` 的比例模型。第三阶段已降噪为以官方 Pot Live P&L 为主字段：正向 Live P&L 阶梯映射 burn 目标仓位比例，已实现 P&L 只做 -5% 到 +10% 的质量修正；短期变化量不进入默认评分或默认提醒，只作为 P&L 类通知和复盘辅助；`pot_live_pnl_usd <= -2500` 进入减仓风险阶梯，`<= -4000` 进入清仓风险阶梯。Selection Alpha monitor 已部署到云服务器；burn 预期已接入 Virtuals 页面同源市值、流动性和 24h 成交量；飞书 Live P&L 阶梯通知保留“信号、动作、实时盈亏、盈亏构成、当前价格、5分钟/15分钟/1小时变化量、阶梯变化、参考比例、仓位调整暂停说明”；仓位调整卡默认暂停，只保存目标仓位快照，不再单独发送“清仓建议”；已新增 Live P&L 与代币价格滞后性研究链路：`pot_market_snapshots` 每分钟保存 P&L + token price + 市值/流动性，`npm run lag:analyze` 输出每个 token 的领先/滞后窗口；生产环境已修复 CoinGecko 429 导致价格为空的问题，改为 CoinGecko + DexScreener 双价格源；字段口径已拆分为 `token_price_usd`、`token_price_virtual` 和 `virtual_usd`，滞后性分析、可视化和健康检查默认使用 USD 价格；最新 Top10 已验证 10/10 写入价格、市值和 FDV；已新增静态可视化报告和数据可靠性面板，明确显示市场快照起点、美元价格起点、最新批次完整度和批次完整率；已新增独立数据健康 watchdog，每分钟检查断采、缺行、价格缺失和官网无效行；按当前通知策略只写日志，不再发送飞书；线上粗略回看显示 BL 约有 15 分钟领先线索，WOA 约有 10 分钟领先线索，正式结论以后以 `pot_market_snapshots` 长期样本为准；Live P&L 阶梯漏报已修复，并补上阈值状态测试、发送失败重试、重启恢复、HTTP 超时、监控循环防重叠、Season `DRAINING / SETTLED` 持续采集和 Selection 失败隔离；`npm run thresholds:test`、`npm run burn-model:test`、`npm run position-model:test`、`npm run expectation` 和服务器一次性 monitor 验证均已通过；云服务器 PM2 已重启到新模型；回购执行地址监控已限定在北京时间每周一 16:00 到 20:00；自动卖出正式模式保持运行；本地已新增自动卖出执行审计表、窗口前健康检查和专项测试，待下一次部署同步到服务器。
	  - 当前通知策略：只暂停入选预期阶段的挑选通知和仓位调整卡。Selection 评分、Selection 快照和仓位建议快照仍继续运行；不再发送强机会、临界机会、入选预期走弱等候选挑选消息，也不再主动发送“仓位调整”卡。入选确认、Pot Live P&L 阶梯和回购触发通知继续发送；官网/API 数据异常、单 Agent 疑似归零和普通数据健康不再发送飞书，只保留日志、原始数据和保护逻辑；但 Pot Live P&L 主线断采会作为“监控事故”单独 @ 提醒。
		  - 可靠性补强：通知链路已从“内存待发送队列”升级为“数据库 outbox”。所有飞书卡片先入库再发送，失败后按退避重试，进程重启后仍可继续补发；发送器会先领取通知再发送，避免 Pot 监控和回购监控并发投递同一条；官网 Pot 原始行也会保存，包括 `currentValue=0` 这类异常行，便于事后追查为什么没有产生正常 P&L。多个 Agent 同时返回 0 时仍按“官网数据源异常事件”处理，但不再发送飞书汇总卡；这段期间继续暂停仓位建议并压制单 Agent 疑似归零处理。孤立异常只进入日志和原始快照，不再发送单 Agent 疑似归零卡。5min / 15min / 1H 变化量已增加首尾帧有效性约束，异常缺帧时显示具体质量状态，不再误算。Selection 同类提醒的冷却也会读取通知历史，重启后不再只靠内存。Android 强提醒通道已从 Pushover 切换为飞书 @ 文本：正向阶梯上穿、负向风险阶梯跌破、回购触发和自动卖出失败会额外进入 `feishu_urgent` outbox；其中 `Live P&L <= -2500` 是减仓风险，`<= -4000` 是清仓风险。飞书卡片仍保留完整决策信息。
  - 剩余重点：不再有当前可执行阻塞。后续只在真实市场结果证明参数不合理、或用户重新启动 Phase 2.3 记录入口时继续迭代。

## 当前阻塞

- [x] 确认云服务器登录方式、部署目录和运行方式。
- [x] 确认服务器上的飞书 webhook 环境变量。
- [x] 云服务器 SSH 已恢复。
- [x] Pot Monitor 已在服务器上启动。
- [x] 前端旧 Dashboard 已从 PM2 常驻列表移除，避免把暂停维护能力误认为当前主线。
- [x] 已配置 PM2 开机自启动，满足服务器重启后自动恢复运行。
- [x] 等待新一周 Top 10 Agent 开始跟单。
  - 说明：本周比赛进入收尾，Agent 仓位陆续关闭；当前 burn 样本只用于字段和函数校验，不作为新的买入判断。
  - 2026-04-28：Season 5 Top10 已可拉取并完成真实数据测试；该项不再是阻塞。
  - 回购监控：窗口内通过 Base RPC 扫描 `0x9Bda49389B29Fa4E204eD9De8f3d7d06f84dA171` 的买入交易；发现非 USDC/VIRTUAL token 买入且同笔交易花出 VIRTUAL 时，触发飞书“回购已发生，检查卖出”提醒。Blockscout 只作为备用数据源。
  - 自动卖出：正式模式已开启。使用真实回购执行地址，扫描窗口为北京时间每周一 16:00 到 20:00；窗口外暂停扫描。命中后卖出热钱包内该代币 100%。私钥只放本地或服务器 `.env`，不进入文档和代码仓库。2026-04-28 小比例回购触发测试已通过：热钱包卖出 999 NOVA，卖出交易进入回购买入后的下一块。本地已补上执行审计表和每周一 15:50 窗口前健康检查，部署后生效。
  - Android 警报：Pushover 在当前 iQOO 上只能进入 App，不能稳定触发系统弹窗；已切换为飞书 @ 文本强提醒，Pushover 仅保留为停用备用。

## 暂停维护

- [ ] Phase 1：大户成本分析 Dashboard
  - 当前不继续扩展。
  - 只在主线需要时作为辅助参考。

- [ ] Phase 2.3：决策记录入口实现
  - 字段定义已完成。
  - 当前先用监控和对话分析，不急着做私密记录页。
  - 暂停范围：飞书“记录判断”入口、私密记录页和 15min / 1H 后验结果自动补齐。

## 后续任务

- [x] 全场预期分析最小闭环
  - 目标：用 `Competing Agents` 数据判断每个 agent 的入选预期。
- [x] Burn 预期分析最小闭环
  - 目标：用官方 Pot Monitor 的 Live P&L 判断 burn 预期和目标仓位，用已实现 P&L 做额外质量修正。
  - 说明：当前官方 Pot Live P&L 和 token 市值/流动性已纳入；5min / 15min / 1H 变化量不进入默认评分或默认提醒，只在仓位调整卡和后台复盘中辅助理解“正在变好还是变坏”。周二 08:30 后即为 burn_pot_window；是否进入 burn_add 仓位层由正向 Live P&L、burn 质量、风险倍率共同决定。
	  - 2026-05-01：已按统一通知口径同步新公式：Live P&L 阶梯提醒改细，`pot_live_pnl_usd <= -2500` 减仓风险，`<= -4000` 清仓风险；`pot_realized_pnl_usd` 只做额外兑现质量增强或风险惩罚，不再单独发送清仓建议卡。
- [x] 我的持仓暴露映射
  - 目标：把用户持仓映射到各 agent 的入选预期和 burn 预期上。
