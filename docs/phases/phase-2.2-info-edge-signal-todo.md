# Phase 2.2 Todo：15min 信息差信号

> 维护规则：本文档记录 Phase 2.2 的执行事项。完成代码、部署或配置改动后，Agent 需要更新勾选状态和简短备注。

## 1. 快速信号

- [x] 保留 Live P&L 绝对值阶梯提醒。
- [x] 将 15min 变化量提醒改为 `$2,000 / $5,000` 两档。
- [x] 将 1H 变化量提醒改为 `$2,000 / $5,000` 两档。
- [x] 冷却按窗口、方向和档位分开，避免 `$5,000` 强信号被 `$2,000` 普通信号吞掉。
- [x] 提醒内容展示窗口、变化量、触发档位、当前 P&L 和持仓。

## 2. 稳定性

- [x] 保留启动第一轮只建立基线、不发送提醒。
- [x] 保留异常数据过滤：`currentValue <= 0` 或 `startingCapital <= 0` 时跳过。
- [x] 观察服务器日志，确认新规则在真实运行中没有重复轰炸。
  - 2026-04-26：服务器重启后 `chain-radar-pot-monitor` 连续按 60 秒运行；启动只建立 baseline，不发启动卡片。本地逻辑模拟确认 `$2,000` 档触发后，扩大到 `$5,000` 档会升级提醒，同一档位冷却内不会重复刷。

## 3. 决策记录

- [x] 决策记录已拆分到 Phase 2.3，避免拖慢 Phase 2.2 的快速信号主线。
  - 子 plan：[phase-2.3-decision-record-fields-plan.md](./phase-2.3-decision-record-fields-plan.md)
  - 子 todo：[phase-2.3-decision-record-fields-todo.md](./phase-2.3-decision-record-fields-todo.md)

## 4. 当前运行方式

- 服务器常驻进程：`chain-radar-pot-monitor`。
- 检查频率：每 60 秒。
- 15min 信号：信息差主信号。
- 1H 信号：趋势确认信号。
