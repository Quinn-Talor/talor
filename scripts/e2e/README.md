# Talor 端到端测试（隔离 Electron + 假模型）

在系统临时目录里建一个全新的主目录，启动真实的 Electron 构建产物，经 CDP 调用 `talorAPI`，
用可编排的假 OpenAI 兼容服务（`mock.mjs`）验证「实际发给模型的请求」。不碰真实的 `~/.talor`。

```bash
npx electron-vite build   # 先构建 out/
npm run test:e2e          # 约 35 秒，退出码 0 = 全部通过
```

要求：macOS（直接启动 `Electron.app` 二进制）；`better-sqlite3` 处于 Electron 版本（`npm run rebuild:electron`）；
本机 9222 端口空闲（应用在 dev 模式下开远程调试端口）。

覆盖：图片附件与 `data:` 前缀、跨轮与重启后保留、非视觉 / 超大图片 / PDF 的拒绝路径、`read` 读图、
`keepRecentImages`、文本附件与 bash 回归、会话删除、退出清理、`chat.db` 无旧表。
日志与结果写在 `talor-e2e-*` 临时目录（运行结束时打印路径）。

注意：`.bin/electron` 只是包装脚本，杀掉它不会结束真正的应用进程，所以驱动直接启动二进制。
