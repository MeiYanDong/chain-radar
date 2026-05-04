# Phase 2.1 Todo：云服务器同步与常驻运行

> 维护规则：本文档记录 Phase 2.1 的详细执行事项。完成代码、部署或配置改动后，Agent 需要更新勾选状态和简短备注。

## 1. 同步前准备

- [x] 修复本地构建和 lint 阻塞。
- [x] 确认前端生产构建不依赖 Google Fonts 外部请求。
- [x] 在 `.env.example` 中补充 `FEISHU_WEBHOOK`。
- [x] 确认云服务器登录方式。
- [x] 确认云服务器部署目录：`/opt/chain-radar`。
- [x] 确认云服务器使用 `pm2` 作为第一版守护方式。

## 2. 同步代码

- [x] 确认要同步的本地改动范围。
- [x] 排除 `node_modules`、构建产物、本地缓存、`data/`、`output/`；真实 `.env` 单独同步为服务器环境配置。
- [x] 将代码同步到云服务器。
- [x] 在服务器上安装依赖。
  - 备注：根目录依赖和 web 依赖均已安装。远端 Next 构建会压垮 1G 轻量服务器，已改为本机构建后同步 `.next` 产物。
- [x] 固化监控进程部署方式。
  - 备注：1G 服务器禁止远端执行 `npm run build`。监控进程必须本地 `npm run build` 后同步 `dist/`，服务器只运行 `node dist/watcher.js`。
- [x] 同步运行所需的 `data/` 和 `output/`。

## 3. 配置服务器环境

- [x] 配置 `FEISHU_WEBHOOK`。
- [ ] 如需链上扫描，再配置 `RPC_URL`。
- [ ] 如需价格查询增强，再配置 `COINGECKO_API_KEY`。
- [ ] 确认服务器时间和时区不会影响日志判断。

## 当前阻塞

- [x] 云服务器 SSH 已恢复。
  - 备注：自助诊断显示云盘读写受限，普通重启完成后恢复。
- [x] 前端旧 Dashboard 不开放公网，也不作为当前常驻服务。
  - 备注：根路径 `/` 仍是 Phase 1 的大户成本分析页面，当前已暂停维护；Phase 2.1 只保留 Pot Monitor 常驻运行。
- [x] 设置 PM2 开机自启动。
  - 备注：已创建并启用 `pm2-root` systemd 服务，且已保存当前进程列表。

## 4. 启动 Pot / Selection Monitor

- [x] 在服务器上启动 Pot Monitor。
- [x] 确认它能拉到 10 个 Agent 数据。
- [x] 确认日志能看到定时运行记录。
- [x] 确认进程关闭终端后仍能运行。
- [x] 确认程序异常退出后可以恢复。
  - 备注：已启用 `pm2-root` systemd 开机自启动，并执行 `pm2 save` 保存当前进程列表。
- [x] 同步并重启服务器上的 Selection Alpha monitor 新版本。
  - 说明：服务器已运行 `node dist/watcher.js`；Selection Alpha monitor 已能写入快照。
  - 部署脚本：`SERVER_IP=<server-ip> scripts/deploy-monitor.sh`。

## 5. 验收

- [x] 根目录 TypeScript 构建通过。
- [x] Web lint 通过。
- [x] Web production build 通过。
- [x] Pot Monitor 正常运行至少一个观察周期。
- [x] Selection Alpha monitor 正常运行至少一个观察周期。
  - 备注：服务器快照表从 652 增长到 978，确认不是只跑启动第一轮。
- [x] 飞书 webhook 已由真实环境变量加载。
- [x] 冷启动提醒逻辑已修复：启动第一轮只建立基线，不发送提醒。
- [x] 更新总 `plan.md` 和总 `todo.md` 状态。

## 6. 后续交接

- [x] 记录服务器上的运行方式。
- [x] 记录查看日志的方法。
- [x] 记录停止和重启的方法。
- [ ] 记录下一阶段 Phase 2.2 的阈值重设计入口。

## 7. 当前运行方式

- Pot / Selection Monitor：`pm2` 进程 `chain-radar-pot-monitor`，每 60 秒检查一次。
- 服务器运行命令：`node dist/watcher.js`。
- 禁止事项：不要在 1G 云服务器上执行 `npm run build` / `tsc` / Next build。
- 本地单次验收：`RUN_ONCE=1 npm run watch`。
- 服务器单次验收：`RUN_ONCE=1 node dist/watcher.js`。
- 开机自启动：`pm2-root` systemd 服务已启用，服务器重启后会自动恢复保存的 PM2 进程列表。
- 前端服务：当前不常驻运行；旧 Dashboard 属于暂停维护的 Phase 1 能力。
- 查看状态：`pm2 list`。
- 查看日志：`pm2 logs chain-radar-pot-monitor --lines 80 --nostream`。
- 重启服务：`pm2 restart chain-radar-pot-monitor`。
