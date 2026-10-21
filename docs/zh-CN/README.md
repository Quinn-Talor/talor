# Talor

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)
[![CI](https://github.com/Quinn-Talor/talor/actions/workflows/ci.yml/badge.svg)](https://github.com/Quinn-Talor/talor/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](#前置)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

[English](../../README.md) · **中文**

> 本地优先的桌面 Agent 平台 —— 运行时、工具、MCP、Skill 与多 agent 委托集于一个应用。

Talor 是一款 Electron 桌面应用,自身**不含任何业务逻辑**。它提供 agent 运行时与工具栈;你运行的 agent 就是你自己掌握的普通文件——一个简短的 `agent.json` 加一个 `prompt.md`——所有数据都留在本机。

---

## 你能得到什么

- **ReAct agent 运行时**:带工具的多步推理,外加代码层面的兜底——死循环与连续失败检测、上下文超限熔断、完成度核查,以及出问题时的强制总结。
- **内置工具**:`bash` / `read` / `write` / `edit` / `glob` / `grep` / `ls`,带路径守卫(敏感路径硬拒绝,workspace 外的路径需你授权)和高风险调用确认。
- **MCP**:接入 stdio 或 Streamable HTTP 的 MCP server,其工具经 `search_tool` 按需展开。
- **Skill**:把 `SKILL.md` 放进 `~/.talor/skills/<name>/`,agent 用 `skill` 工具激活。
- **agent 即文件**:极简 8 字段 schema(`id / name / description / agentPrompt / tools / skills / mcpServers / subagents`);行为写在同目录的 `prompt.md`,可直接编辑。skill 与 MCP 只按名称引用,不复制。
- **子 agent 委托**:agent 可把子任务交给另一个 agent(`delegate_agent`),在隔离会话中执行,带并发上限、超时和防递归。
- **多模型**:Anthropic / OpenAI(及 DeepSeek 等 OpenAI 兼容端点)/ Google / Ollama,基于 Vercel AI SDK v7,支持会话级推理深度。
- **轮次追踪**:每一轮对话都记录为 Langfuse 风格的 trace(模型调用、工具、反思、token 用量),可在应用内查看。
- **prompt 前缀缓存**:append-only 分层装配让可缓存前缀保持稳定,Anthropic 额外打 `cacheControl` 断点。
- **token 用量统计**:会话级 input / output / 缓存读写,跨厂商归一。
- **Feature 扩展框架**:业务对象以 Feature 接入(`ArtifactStore` + `ArtifactUI` + 工具),平台核心无需改动。见 [docs/talor-feature-architecture.md](../talor-feature-architecture.md)。
- **本地优先、注重隐私**:数据在 `~/.talor/` 下;provider API Key 经系统钥匙串加密保存。

---

## 数据布局

```
~/.talor/
  agents/<agent-id>/
    agent.json       # 元数据(不含 agentPrompt)
    prompt.md        # agentPrompt 全文
  skills/<skill-name>/
    SKILL.md         # 平台 skill,所有 agent 共享
    ...
  config.json        # provider 与应用设置
  chat.db            # SQLite:会话、消息、MCP server、账户、trace
```

---

## 安装

### 前置

- Node.js 22+(编译 Electron 41 原生模块需要)
- npm 10+
- macOS / Linux(Windows 未测试)

### 开发模式

```bash
git clone https://github.com/Quinn-Talor/talor.git
cd talor
npm install
npm run dev
```

Vite HMR 与 Electron 主进程会同时启动。

### 打包

```bash
npm run build       # electron-vite + electron-builder → dist/
```

---

## 第一次使用

1. **添加模型 provider**:Settings → Provider(Anthropic / OpenAI / Google / Ollama,或任意 OpenAI 兼容的 base URL)。
2. **与平台助手对话**:启动后进入默认助手,它可以使用内置工具、你配置的 MCP 与 skill,并委托给你的 agent。做文件和命令行相关的工作前先设置 workspace 目录。
3. **添加你自己的 agent**:新建 `~/.talor/agents/<id>/agent.json` 和 `prompt.md`(最小示例见下)。重启 Talor 加载新 agent 后,它会出现在 Agents 页面,可在那里查看、编辑(带实时校验的 JSON 编辑器)并发起对话。

```json
{
  "id": "pr-reviewer",
  "name": "PR Reviewer",
  "description": "Reviews pull requests for correctness and risk.",
  "tools": ["bash", "read", "grep"]
}
```

### 配置 MCP / Skill / Account

- **MCP**:Settings → MCP(stdio 启动命令,或带 bearer / API Key 认证的 HTTP URL)。
- **Skill**:把 `SKILL.md`(及附属文件)放到 `~/.talor/skills/<name>/`。
- **Account**:Settings → Account,配置第三方凭据(如 `GITHUB_TOKEN`)。
- **Permissions**:Settings → Permissions 列出你按 workspace 授予过的路径规则。

---

## 架构

完整架构与 agent 作业流程(检测 / 反思 / 收尾)见 [docs/engineering/overview.md](../engineering/overview.md)。

```
Renderer (React 19 + Tailwind + Zustand)
   │ IPC(contextBridge,沙箱)
Main Process
   ipc/*                                 入口层
   chat/orchestrator + loop/react-loop   ReAct 引擎 + 检测 / 反思
   prompt/PromptPipeline                 分层、缓存友好的 prompt 装配
   memory/ShortTermMemory                历史压缩(保留工具调用配对锚点)
   agent/*                               agent 加载、工具集、委托
   tools/*                               内置工具、路径守卫、风险门
   mcp/*                                 MCP 客户端(stdio + Streamable HTTP)
   skills/*                              平台 skill 注册表
   providers/*                           模型适配、用量归一
   observe/*                             轮次追踪
   repos/* + db/                         SQLite
```

---

## 贡献 · 社区

- [CONTRIBUTING.md](./CONTRIBUTING.md) — 开发环境、流程、不可破坏的不变量
- [CODE_OF_CONDUCT.md](../../CODE_OF_CONDUCT.md) — 行为准则(Contributor Covenant)
- [SECURITY.md](../../SECURITY.md) — 安全漏洞私密报告
- [CHANGELOG.md](../../CHANGELOG.md) — 变更记录

工程规范见 [docs/engineering/](../engineering/);AI agent 协作指南见 [CLAUDE.md](../../CLAUDE.md)。欢迎 issue / PR,提交前请先读 CONTRIBUTING。

---

## License

[MIT](../../LICENSE) © Quinn-Talor
