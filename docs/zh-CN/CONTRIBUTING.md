# 贡献指南

感谢参与 Talor 的开发!

> English: [CONTRIBUTING.md](../../CONTRIBUTING.md).

> Talor 是**纯 agent 平台**,自身不含业务 agent。贡献应增强运行时(agent 循环、工具、skill、provider、prompt 流水线),而非加入具体业务逻辑。

---

## 快速开始

**前置**:Node.js 22+、npm 10+、macOS 或 Linux(Windows 未测试)。

```bash
git clone https://github.com/Quinn-Talor/talor.git
cd talor
npm install
npm run dev          # Vite HMR + Electron 主进程
```

| 命令                 | 用途                                            |
| -------------------- | ----------------------------------------------- |
| `npm run dev`        | 启动开发环境(Electron + Vite HMR)               |
| `npm test`           | 全量测试                                        |
| `npm run test:watch` | 测试 watch                                      |
| `npm run typecheck`  | 三 tsconfig 合并类型检查(main/preload/renderer) |
| `npm run lint`       | ESLint                                          |
| `npm run build`      | electron-vite 构建 + electron-builder 打包      |

**原生模块注意**:`better-sqlite3` 按 Electron 的 ABI 编译。在 Node 下跑 `vitest` 需先重建为 Node ABI,跑完再切回:

```bash
# 直接跑 vitest 前:
cd node_modules/better-sqlite3 && npx --no-install node-gyp rebuild
# 之后再启动 app:
npx @electron/rebuild -f -w better-sqlite3
```

---

## 动手前

先读 [`vibe/project/`](../../vibe/project/) 的工程知识库:

- [`overview.md`](../../vibe/project/overview.md) — 架构总览 + agent 作业流程(检测 / 反思 / 收尾)
- [`standards.md`](../../vibe/project/standards.md) — MUST / SHOULD / NEVER 规则
- [`patterns.md`](../../vibe/project/patterns.md) — 模式 + 参考实现索引

[`CLAUDE.md`](../../CLAUDE.md) 是最快上手入口(也供 AI 编码 agent 用),列了最常见的坑。

---

## 开发流程

1. **切分支**:从 `master` 切(`git switch -c fix/...` 或 `feat/...`),不要直接提交到 `master`。
2. **找参考实现**:在模式索引里找对应实现,照范式写。
3. **写测试**:「触发 + 不触发」两条(`standards.md §L-MUST-3`);修 bug 先写复现测试。
4. **本地验证**:`npm test && npm run typecheck` 必须全绿(允许存量失败,但要明确告知)。
5. **提交**:`type(scope): summary`(type ∈ feat / fix / refactor / docs / test / chore),消息体说明 **why**。
6. **提 PR**:针对 `master`,描述清晰、关联 issue。

### 不可破坏的不变量

少数规则由代码强制 + 测试守护 —— 破坏会废 session 或搞崩工具回合。完整清单见 `CLAUDE.md §4` 与 `standards.md`,要点:

- `assistant(tool_use)` + `tool(result)` 必须同事务落盘(`createBatch`),**且**读取时确定排序(`ORDER BY created_at, rowid`);重建 prompt 时不得有消息劈开这对配对。(§I-MUST-1/3、§J-MUST-2b)
- 可缓存的 prompt 前缀(system/agent/tools/history 层)跨 build 必须字节一致 —— 不得含时间戳/随机数。(§J-MUST-2c)
- 所有文件路径走 `resolveToolPath`;高风险命令在 validate/path-guard 层拦截,不靠用户 confirm 兜底。(§K)
- 工具错误用 `ToolErrorEnvelope`,不用字符串前缀。(§F-MUST-3)

---

## 报告问题

用 issue 模板开 [GitHub issue](https://github.com/Quinn-Talor/talor/issues)。**安全漏洞**勿走公开 issue,见 [SECURITY.md](../../SECURITY.md)。

## 贡献授权

提交即表示同意以本仓库许可证(Apache 2.0 + Commons Clause)授权你的贡献。
