# Talor 工作区 UI 重设计

> 日期：2026-05-15
> 状态：草稿 — 待 review
> 作者：design ↔ quinn.li 协作迭代
> 关联可视化：`.superpowers/brainstorm/91391-1778854140/content/final-v2.html`

---

## 1. 背景

当前 Chat 工作区在视觉上"丑、不自然"。具体根因在 [.superpowers/brainstorm/91391-1778854140/content/diagnosis.html](../../../.superpowers/brainstorm/91391-1778854140/content/diagnosis.html) 已枚举，核心是：

- **两个视觉世界硬拼** — 深色侧栏 + 浅灰主区，无共享强调色 / 字体节奏 / 圆角语言
- **像素级硬编码、无设计 token** — 字号 9/10/11/12/13/14 全用；圆角 6/7/8/10/14/16 全用；颜色散落 30+ 个 hex 字面量
- **气泡 + 卡片双重容器** — 消息有 4 种背景 + 4 种边框；inline 状态卡每 turn 堆 3-4 个
- **状态色彩 emoji 化** — `✓ ❓ ⏸ ⚠️ 🔮 📦` 系统 emoji 跟 UI 字体完全脱节
- **LLM 输出 + 工具调用是孤岛** — assistant message 在白气泡里、工具调用另起 `font-mono text-xs` 列，逻辑上属同一 turn 视觉上完全分离

## 2. 目标

|     | 目标                                   | 衡量                                                                           |
| --- | -------------------------------------- | ------------------------------------------------------------------------------ |
| G1  | 同一套设计 token 贯穿整个 workspace    | 没有再用未在 `tokens` 中定义的 hex / px                                        |
| G2  | 视觉层级清晰，长 markdown 易读         | 用户可以扫读千字以上的 agent 回复不疲劳                                        |
| G3  | 工具调用紧贴所属 turn                  | 不再"另起一列"                                                                 |
| G4  | 状态信号不抢戏                         | 默认无色块；只有需要用户行动时才有视觉容器                                     |
| G5  | 流式过程视觉稳定                       | block 容器一旦识别立刻定型，无 skeleton→card 跳变                              |
| G6  | Talor 身份是"通用 agent"不是"编码工具" | 默认场景、tool 列表、文案体现日常工作（邮件 / 日历 / 文档 / 网搜）而非源码操作 |

非目标：

- 多主题（暗/亮模式切换）— 本次仅做亮色，dark mode 后续
- 移动端适配 — Talor 是 desktop only
- 国际化 — UI 文本暂时只考虑中文

## 3. 设计方向

选定方向：**A · Linear / Vercel chromeless flow**（详见 `directions.html`）。

核心范式：

- 扁平浅灰，状态色仅点缀
- 一根 1px 灰竖线串起整个 turn（用户消息 + agent prose + 工具 + block 都在同一垂直 rail 内）
- 长 markdown 享有充分留白
- 黑白灰为主，蓝/绿/红/橙仅作为点缀（4-6px 圆点 / 2px 左竖线 / 加粗文字色）

被否决的方向：

- **B · cozy-dark terminal**：长 markdown 在暗色下可读性下降；亮色用户劝退
- **C · Notion-style document**：去气泡好，但用户消息识别变弱；改造量太大

## 4. Design tokens

### 4.1 Colors

```
--text     #09090b   主要文本
--body     #27272a   次要文本（描述、meta）
--mute     #71717a   弱化文本（提示、标签）
--subtle   #a1a1aa   最弱（占位符、时间戳）
--line     #e4e4e7   1px 边界、分隔线
--line-2   #f4f4f5   极浅边界、inline code 背景
--surface  #fafafa   sidebar 背景、hover 态
--canvas   #ffffff   主区背景、卡片

--accent   #3b82f6   蓝色（链接、agent avatar 渐变 起点）
--indigo   #6366f1   蓝色（渐变 终点）

--ok       #16a34a   绿色（done 圆点）
--warn     #d97706   橙色（blocked / warning medium）
--err      #dc2626   红色（warning high / error）
--info     #2563eb   蓝色（need_input 左竖线、链接、日历）
```

颜色只用在以下场景：

- **状态色点**（4-6px 圆点）
- **左竖线**（2px，标记需要交互的容器）
- **链接 + 引用编号**
- **强调文字色**（仅 warning high）
- **avatar 渐变**

**禁止**：填充背景（除 hover surface 外）、border 主色描边、card 主色边框。

### 4.2 Type scale

仅 4 档：

```
11px       tool 标签 / kbd / 时间戳 / meta
12.5px     mono code / 小标签 / button 文本
14px       prose body / 主文本
17px       page 标题（罕用）
```

字重仅 3 档：400 / 500 / 600。**禁止 700 加粗**（视觉过重）。

字体：

- **UI sans**：`-apple-system, "Segoe UI", "PingFang SC", sans-serif`
- **Mono**：`"SF Mono", "Menlo", monospace`
- **行高**：1.55 (mono) / 1.65 (UI) / 1.7 (prose)

### 4.3 Radius

仅 3 档：4px / 6px / 10px。

```
4px    inline code、tag
6px    button、tool row、chip
10px   card、code block
```

**禁止** 7/8/14/16/999 等。

### 4.4 Spacing

5 stops：4 / 8 / 12 / 16 / 24（px）。

### 4.5 Line weight

- **1px** — 主要边界（card、sidebar、topbar 底边）
- **2px** — 左竖线（rail、需交互容器、blockquote）
- **dashed** — pending 状态、推断 / 损坏 hint

**禁止** 0.5px solid（在 Retina 下渲染不一致）。

## 5. 整体布局

```
┌───────────┬──────────────────────────────────────────────┐
│           │  Topbar (44px)                                │
│  Sidebar  ├──────────────────────────────────────────────┤
│  240px    │                                              │
│           │  Messages (flex:1, overflow-y:auto)          │
│           │                                              │
│           ├──────────────────────────────────────────────┤
│           │  Input area                                  │
└───────────┴──────────────────────────────────────────────┘
```

- App 容器全局 `bg-canvas`
- Sidebar 与 main 用 1px `var(--line)` 垂直分隔（仅一条）
- Sidebar 底色 `var(--surface)`，main 底色 `var(--canvas)`

## 6. Sidebar

### 6.1 顶部 header band（A2 样式）

布局：`[drag-region 30px] [search filled chip][black solid "+"]`

```
┌──────────────────────┐
│ (30px drag region)   │ ← macOS traffic lights 区
├──────────────────────┤
│ [🔍 搜索] [⏶ +]       │ ← search + new button
├──────────────────────┤
│ 今天                  │ ← group label
│ [秘] 本周客户回款 ...  │ ← session item
```

- **search chip**：flex:1, h:30px, `bg-line-2`，左边一个 stroke search icon + 文字"搜索"。无 border。hover 时 `bg-line`。点击展开命令面板（含搜索）。
- **+ button**：30×30, radius 7px, `bg-text` (`#09090b`)，白色 stroke "+" icon。这是**唯一的 strong 视觉锚**，主操作。hover `bg-#000`. 快捷键 ⌘N。
- search 和 + 之间 8px gap。

### 6.2 会话列表

- 分组标签："今天 / 昨天 / 更早"。10px uppercase mute 文本，padding 10px 16px 4px。
- 会话项：48-56px 高（视字数），20×20 渐变 avatar + 标题 + meta。
  - **active**：`bg-canvas` + `box-shadow: 0 0 0 1px var(--line)`（用 shadow 不用 border，避免占用 layout 空间）
  - **hover**：`bg-line-2`
- **agent avatar 渐变色**：根据 agent 主题色映射（不再随机彩虹）：
  - 秘书 / 客服 → green→emerald
  - 研究 / 分析 → blue→indigo
  - 文案 / 创作 → amber→orange
  - 日程 / 协调 → purple→violet
  - 数据 → pink→rose

### 6.3 设置（底部，固定贴底）

**关键结构**：设置必须是 sidebar flex column 的**独立子元素**，跟 `sb-list` 同级（**不是 sb-list 内部最后一项**）。否则会话短时 settings 跟着列表停在中间，下方空出大片。

```html
<aside class="sb" style="display:flex; flex-direction:column">
  <div class="sb-drag" />
  <div class="sb-bar" />
  <!-- search + + -->
  <div class="sb-list" style="flex:1; overflow-y:auto">...sessions only...</div>
  <div class="sb-settings" />
  <!-- ← 同级，flex:1 把它推到底 -->
</aside>
```

样式：

- 用跟会话项相同的 padding (7px 8px) / margin (4px 8px 8px) / border-radius (6px) / hover (`bg-line-2`)
- **去掉** 之前的 `border-top: 1px solid var(--line)` — 视觉上是"列表最后一项"，结构上是 sibling
- 内部：齿轮 stroke icon + "设置" + 右端 `⌘,` mono kbd

## 7. Topbar

44px 高，`border-bottom: 1px solid var(--line)`，padding 0 18px。

布局：`[agent picker] [model picker] [...] [导出 agent]`

- **agent picker** / **model picker**：5px 9px padding，6px radius，hover `bg-surface`。
  - 内部：18×18 渐变 avatar (agent) 或 18×18 `#e0e7ff` 底 indigo 字 (model) + name + sub + 9px chevron
- **导出 agent**（右端）：5px 10px padding，1px border-line outline button，6px radius。stroke download icon + "导出 agent"。

去掉了：Crystallizer 按钮（折回 prose 流程，无独立入口）。

## 8. 消息流（Message Stream）

### 8.1 Turn anatomy

每个 turn 是一个 `padding-left: 32px` 的容器，左侧绝对定位一个 22×22 avatar，其右侧 11px 处一根 1px 灰垂直 rail 从 top:22px 延伸到 bottom（最后一个 turn 不画）。

```
┌─┐
│Q│  user 消息内容
└─┘
 │
 │
┌─┐
│T│  prose
└─┘  ✓ tool row
 │   prose 续
 │   <code block>
 │   <done pill>
```

- **avatar**：22×22，6px radius
  - user：纯 `bg-text`
  - bot：渐变（根据当前 agent 色，e.g. emerald 渐变 for 秘书）

### 8.2 Date divider

跨多日时插入 date divider：左右 1px 线 + 中心 10.5px uppercase mute 文字 "今天 · 14:32" 或 "2026-05-14"。

## 9. Markdown 渲染

完整规范见 `a-markdown.html`。摘要：

### 9.1 Heading

|     | font-size | weight        | margin | 边框       |
| --- | --------- | ------------- | ------ | ---------- |
| h1  | 22px      | 700           | 24/8   | 无         |
| h2  | 18px      | 600           | 22/6   | bottom 1px |
| h3  | 15.5px    | 600           | 18/4   | 无         |
| h4  | 13.5px    | 600           | 14/4   | 无         |
| h5  | 12px      | 600 uppercase | 12/4   | 无         |
| h6  | 11.5px    | 500           | 10/2   | 无         |

### 9.2 Inline

- **bold**：`font-weight: 600`，**禁止 700**
- **italic**：保留
- **strikethrough**：mute 色
- **inline code**：`bg-line-2`，4px radius，12.5px mono，500 weight，正文色（**不再 pink-on-gray**）
- **link**：`color: info`，1px subtle 下划线（rgba(37,99,235,0.3)），hover 时变深
- **kbd**：1px border line + 2px 底边、4px radius、11.5px mono、`bg-canvas`
- **mark**：`bg-#fef3c7`，文本主色

### 9.3 Lists

- **ul bullet**：4px 灰圆点（`::before` 实现，无 disc）；嵌套层用 outline 1px ring
- **ol**：默认 marker，但 `color: mute`，`tabular-nums`
- **task list**：14×14 1.5px border 方框；checked 时 `bg-text` 白勾 + 整条 strike + mute
- 列表项间距 3px，含多段时段间 4px

### 9.4 Blockquote

- **2px 左 line（不再 4px）**
- 无背景
- 无 italic
- 嵌套递减颜色（line → subtle）

### 9.5 Code block

- 1px border line + 10px radius
- `bg-#fcfcfc`（不再黑底嵌白卡）
- header：6px 12px padding，11px mono mute 文本（语言 + 来源），右端 hover-only "copy"
- pre：12px 14px padding，12.5px mono，1.6 line-height
- 语法高亮：
  - keyword `#7c3aed`
  - function `#2563eb`
  - string `#16a34a`
  - variable `#db2777`
  - type `#0891b2`
  - number `#ea580c`
  - comment `var(--subtle)` italic

### 9.6 Table

- 11.5px uppercase mute 表头 + 1px bottom border
- 13px 主色 body，1px line-2 分隔行
- 数字列 `tabular-nums` 右对齐
- 行 hover `bg-surface`

### 9.7 Edge cases

完整列表见 `a-markdown.html` 第 4 节。包括：列表项嵌代码块、表格单元格嵌 code、blockquote 嵌代码块 / 嵌 blockquote、超长 inline code 折行、空 fence、无语言 fallback、hr 紧贴 heading。

## 10. 工具调用渲染（Tool Calls）

完整场景见 `a-all-scenarios.html` 第 2 节。

### 10.1 通用 tool row

- 单行，h:26px，6px radius，12px mono
- 结构：`[12×12 stat icon] [tool name 38px+] [target 1fr truncate] [duration mute]`
- hover：`bg-surface`，右侧出现 ▸ chevron 表示可展开
- 展开后 below：2px left line 缩进 + Input / Output 段（10px font-family sans label + mono 内容）

### 10.2 4 种状态

| 状态                   | icon                       | 颜色      |
| ---------------------- | -------------------------- | --------- |
| running                | 1.5px stroke 旋转圈，10×10 | `info` 蓝 |
| done                   | √ stroke check 12×12       | `ok` 绿   |
| error                  | ✕ stroke 圈+x 12×12        | `err` 红  |
| 跳过/permission denied | — em dash                  | `mute`    |

### 10.3 内置 7 工具的特殊呈现

**只对内置工具做专门渲染**（因为输出结构固定 + Talor 控制 + 有产品差异化价值）：

- **bash** → 2px 左 line 缩进 + mono terminal text。stdout 默认色；stderr 红色；汇总行（X tests · Y passed）末尾 sans 色。
- **edit / write** → 内联 diff card（独立 1px border 容器；`bg-#f0fdf4` 加行、`bg-#fef2f2` 删行；行号 mute 30px 右对齐 + 符号 + 文字 mono）
- **read** → 仅 tool row，target 含行号范围 (1-200)
- **grep** → 2px 左 line 缩进 + 文件分组 + 匹配行号 + 命中片段 yellow highlight
- **glob** → 仅 tool row，target 显示 pattern + match count
- **ls** → 2px 左 line 缩进 + mono 文件树（含 size 列）
- **subagent**（如果存在）→ 嵌套块：渐变 mini avatar (16×16) + 子 agent 名 + tool 数摘要 + summary 文字
- **5+ 连续 tool** → 自动折叠为概览：dashed border + "X 个工具调用 · Y 用时 · 展开 ▾"

### 10.4 MCP 工具的呈现（通用 row + LLM 当渲染器）

**核心决策**：Talor UI **不认识任何 MCP 业务概念**（email / calendar / web / Notion / ...）。所有 MCP 工具走统一通用渲染：

```
✓ tool_name · 摘要 · 耗时  [▸ 展开 JSON]
```

- **tool row**：跟内置工具一样的 `[stat icon] [tname] [targ] [dur]` 结构
- **摘要**（targ 文本）：MCP server 在 tool result 里提供（如 "12 results"），否则退化为 "output: N chars"
- **展开**：点击 row 展开 JSON pretty-print（折叠态默认）
- **不做内容专属渲染** — 不为 gmail / gcal / brave 等任何特定工具写 EmailCard / CalendarEvent / SearchResult 等组件

**为什么不做注册表**：

- 硬编码工具名意味着每个新 MCP server 都要改 UI 源码 — 跟 Talor "通用 agent 平台" 定位冲突
- MCP 工具名不标准化（`gmail.search` vs `mail.list` vs `outlook.search`）
- 给特定 MCP 工具写专门 UI = 隐式偏袒，破坏生态中立

**业务内容怎么呈现**：交给 LLM。LLM 看 tool JSON 后用 markdown table / list / blockquote / proposal block 在 prose 里说出关键信息。例如 `gmail.search` 返回 12 封邮件 → LLM 输出 markdown 表格列出"客户 / 事项 / 状态 / 优先级"。完整设计见 §11A · Block 协议。

## 11. Talor block 渲染

**核心决策**：block 是 agent 内部状态结构 + 通用 UI 原语，<b>用来支撑业务表达但本身不带任何业务概念</b>。整个 Talor UI 只认识 5 个 block + markdown。

### 11.1 渲染规则

| Block             | 渲染方式                                                        | 显示 label 文字        |
| ----------------- | --------------------------------------------------------------- | ---------------------- |
| `done`            | 行内 pill：4px 绿圆点 + 摘要（耗时 / 工具数 / 修改数）          | ❌ 不显示 "Done"       |
| `need_input`      | 2px info 左竖线 + 问题 + 选项按钮 + reason                      | ❌ 不显示 "Need input" |
| `blocked`         | 行内 row：橙圆点 + body + retry 链接                            | ❌ 不显示 "blocked"    |
| `warning`         | 行内 row：圆点定档严重度 + body；high 时 body err 加粗          | ❌ 不显示 "warning"    |
| `proposal`        | 2px indigo 左竖线 + summary + preview + CTA + secondary_actions | ❌ 不显示 "proposal"   |
| `invalid`         | **不渲染** — 进开发者 debug log                                 | —                      |
| `inferred_intent` | **删除**（不再产出此类型）                                      | —                      |

`proposal` 由原 `draft_detected` **泛化**而来：原来只能用于"agent 草稿提议保存"，现在可承载任意"用户一键确认动作"（发邮件 / 创建会议 / 保存配置 / 调用外部 API ...）。详细 schema 见 §11A。

### 11.2 为什么去掉 label

> Block type 是开发者命名（"need_input" / "blocked" / "warning" / "proposal"），用户不需要看。色点 + 容器形态 + 内容语气 = 用户能理解的 100% 信息。

例如：need_input 里的问题文本 + 选项按钮已经在说"这里需要你回答"；"need input" 这行 lowercase 蓝字是给系统看的标签，对用户是同义反复。

### 11.3 关键约束

- 底层数据全保留：`{"type":"need_input"...}` 仍落 DB / IPC / telemetry，给路由和 metric 用
- `invalid` / `inferred` 的 hint 整体移除（不只 label），它们是 system meta，搬到 settings → debug log

## 11A. Block 协议（LLM 怎么挑、怎么填数据）

完整规范见 [block-protocol.html](../../../.superpowers/brainstorm/91391-1778854140/content/block-protocol.html)。摘要 6 个环节：

### 11A.1 Schema 定义（单一可信源）

`src/shared/ui-rendering/blocks.ts` 用 Zod 定义 5 个 block。LLM 输出和 UI 渲染共用同一份 schema。

```typescript
export const NeedInputSchema = z.object({
  type: z.literal('need_input'),
  question: z.string().min(1),
  options: z.array(z.string()).min(2).max(5),
  reason: z.string().optional(),
})

export const ProposalSchema = z.object({
  type: z.literal('proposal'),
  summary: z.string().min(1),
  preview: z.string().optional(), // markdown
  action: z.object({
    label: z.string(),
    tool: z.string(), // 必须是 registry 已注册的 tool
    args: z.record(z.unknown()),
  }),
  secondary_actions: z
    .array(
      z.object({
        label: z.string(),
        emit: z.string(), // 塞回 LLM 上下文的指令
      }),
    )
    .optional(),
})

// done / blocked / warning 同模式
export const TalorBlock = z.discriminatedUnion('type', [
  NeedInputSchema,
  ProposalSchema,
  DoneSchema,
  BlockedSchema,
  WarningSchema,
])
```

### 11A.2 System prompt 注入

新建 `src/main/prompt/plugins/UiBlockPlugin.ts`，固定在 system prompt 末尾追加 block 协议段（schema + 1-2 个真实例子 + when-to-use）。

### 11A.3 LLM 输出格式

LLM 在 markdown prose 中嵌入 ` ```talor` fenced JSON：

````
看了下 SLA 文档，按你要求的语气起好了草稿：

```talor
{
  "type": "proposal",
  "summary": "邮件草稿 · 王总 · Re: Q4 续约",
  "preview": "王总你好...",
  "action": {
    "label": "发送",
    "tool": "gmail.send_draft",
    "args": {"draft_id": "draft_8f3a2c1"}
  }
}
````

发送前你看看。

````

`draft_id` 来自上一步 `gmail.create_draft` 工具结果 — **LLM 是数据流的胶水**。

### 11A.4 流式 parser（扩展 `splitMessageWithTalorBlocks`）

- 识别 ` ```talor` 开 fence → 切到 block 模式
- 前 ~20 byte 解出 `type` 字段 → 立刻渲染最终容器（per §12 流式一致性）
- fence 关闭后用 Zod 校验，失败降级为 `invalid`（不渲染 UI，进 dev log）
- 未知 `type`（不在 5 个 block 之内）→ 当 `invalid` 处理

### 11A.5 用户操作回环

| 用户动作 | 系统反应 |
|---|---|
| `need_input` 选项 → 点击 | 字符串当作新 user message 发回 LLM |
| `proposal` CTA → 点击 | 调 `toolRegistry.invoke(action.tool, action.args)`，结果作为 tool_result 入 LLM 上下文 |
| `proposal` secondary `emit` → 点击 | `emit` 字符串当新 user message |
| `blocked` retry → 点击 | 若有 `retry_tool` 调用之；否则简单发"重试" |
| `warning` | 无交互 |

### 11A.6 安全门（不可绕过）

用户点 proposal CTA 时，**Talor 不直接信任 LLM 给的 tool + args**，三道校验：

1. **Tool 存在**：`action.tool` 必须是 registry 注册过的（内置 7 + 当前 agent 启用的 MCP server tools）
2. **Args 校验**：用该 tool 的 Zod schema 校验 `action.args`
3. **权限检查**：走现有 `PermissionGuard`（bash 黑名单 / 路径白名单 / MCP server enabled）

任一失败：错误 envelope 作为 system message 塞回 LLM 上下文（"Tried to invoke X but got DENIED because Y"），让 LLM 解释/改提议。**LLM 提议、Talor 执行 — 分开权限**。

## 12. 流式一致性

完整规范见 `a-streaming-consistency.html`。

**核心原则**：block 类型一旦识别（JSON 前 ~20 byte），立刻渲染最终容器；内容流入用 token 增量填，**不允许 skeleton → card 跳变**。

### 12.1 各场景的流式 vs 完成态

| 场景 | 流式中 | 完成态 |
|---|---|---|
| Prose | 文字 + 光标 | 文字 |
| Tool call | spinner 12×12 + name + target | check 12×12 + name + target + dur |
| Code block | head + 部分代码 + 光标 | head + 完整代码 + copy 按钮 |
| done | 不渲染 | 末尾行内戳 |
| need_input | 左竖线 + 问题流式 + dashed pending 选项 | 左竖线 + 完整问题 + 可点选项 + reason |
| warning | 圆点定档 + label + body 流式 | 圆点 + label + 完整 body |
| blocked | 圆点 + label + body 流式（无 retry hint）| + retry hint inline link |
| proposal | 左竖紫线 + summary 流式 + preview 流式 + CTA (disabled, args 未解完) | 左竖紫线 + 完整 summary + preview + CTA enabled |
| invalid | **不渲染** | 末尾 append 一行 mute italic |
| inferred | **不渲染**（已删除） | — |

### 12.2 反模式（必须砍）

- `StreamingTalorSkeleton`（animate-pulse 灰条）
- `if (!isStreaming) renderInferredIntent` 的"换皮跳变"
- 流式中 code block padding / 底色 跟完成态不一致
- 已复制 2s 后变回 "复制" 类 transient 状态导致 button 尺寸变化

## 13. 输入区

底部 padding 14px 32px（**上下对称**，去掉之前的"floating in space"感）。

### 13.1 Input card

- 1px line border + 12px radius
- focus-within：border 升级 subtle + 3px outer ring `rgba(0,0,0,0.04)`（不再蓝色 glow）

### 13.2 结构

````

┌─ input card ──────────────────────────────────┐
│ [📁 ~/Documents/Talor] 权限：邮件·日历·文档 │ ← meta row（mono 工作目录 + 权限）
│ │
│ 给 秘书 发消息… │ ← textarea
│ │
│ [📎] [/] [发送 ↵] │ ← toolbar
└────────────────────────────────────────────────┘

```

- **meta row**：8px 14px 4px padding，11.5px mono mute 文本
- **textarea**：14px 主色文本，min-height 48px，placeholder subtle
- **toolbar**：4px 8px 8px padding；左侧 28×28 ghost icon button (附件 / slash 命令)；右端 `bg-text` solid 发送 button (5px 12px padding，含 ↵ mono kbd 提示)

## 14. 边界态

详见 `a-all-scenarios.html` 第 5 节 + `bottom-fix-v2.html`。

- **空 session**：居中 28px 渐变 "T" logo + "开始对话" + sub
- **API 错误**：消息流中 banner（`bg-red-50` border + body：error code + 描述 + retry link）
- **history snapshot**：dashed border pill，hover 展开
- **crystallize workbench**：dashed 横线分隔 + 居中 indigo label，2px 左竖线缩进；不再是紫色块

## 15. 实施考虑

### 15.1 改动量

| 文件 | 改动类型 | 估计行数 |
|---|---|---|
| `src/renderer/index.css` | tokens + globals 重写 | ~80 lines |
| `tailwind.config.js` | 替换 colors / 删 primary/accent | ~30 lines |
| `src/renderer/App.tsx` | 去 `bg-[#111827]`，统一 canvas | 1 line |
| `src/renderer/pages/Chat/index.tsx` | 1969 行重写 layout / 拆出子组件 | 全量 |
| `src/renderer/components/MessageBubble.tsx` | 去气泡 + 重写 prose | ~250 lines |
| `src/renderer/components/ToolCallMessage.tsx` | 改单行 log + 各 tool 类型 | ~200 lines |
| `src/renderer/components/TalorBlockRenderer.tsx` | 改无 label + 部分类型砍掉 | ~150 lines |
| `src/renderer/components/SessionItem.tsx` | 换浅色侧栏配色 | ~30 lines |
| `src/renderer/components/Header.tsx` | 检查是否还用 | ? |
| `src/renderer/components/WorkspaceSelector.tsx` | input area meta | ~10 lines |

### 15.2 拆分子组件

`Chat/index.tsx` 1969 行严重违反 patterns.md 的"小而专注"。借此机会拆出：

- `Chat/Sidebar.tsx` — 含 search、+、session 列表、settings
- `Chat/TopBar.tsx` — agent picker、model picker、导出 agent
- `Chat/MessageStream.tsx` — 消息列表（包括 streaming 状态）
- `Chat/InputArea.tsx` — meta + textarea + toolbar
- `Chat/index.tsx` 仅做 state hookup + 拼装

### 15.3 新增组件

- `components/markdown/Prose.tsx` — 替换 Tailwind prose-sm
- `components/tool-calls/ToolRow.tsx` — 通用单行（内置 + MCP 共用）
- `components/tool-calls/BashOutput.tsx` / `DiffView.tsx` / `GrepResults.tsx` / `LsTree.tsx` — **仅内置 7 工具的特化**
- `components/tool-calls/McpToolExpanded.tsx` — MCP 工具展开后的 JSON pretty-print
- `components/talor-blocks/DonePill.tsx` / `NeedInput.tsx` / `BlockedRow.tsx` / `WarningRow.tsx` / `Proposal.tsx` — 5 个 block 组件
- `shared/ui-rendering/blocks.ts` — Zod schema 单一可信源
- `main/prompt/plugins/UiBlockPlugin.ts` — 注入 block 协议到 system prompt
- `components/CommandPalette.tsx` — sidebar 顶部 search 点开后的面板

**显式不做**（之前 v1 设计想做的，因 MCP-agnostic 决策砍掉）：
- ~~`EmailCard.tsx`~~ / ~~`EmailListRenderer`~~ — gmail/outlook 等 MCP 工具不写专门 UI
- ~~`WebSearchResults.tsx`~~ — brave/tavily 等不写
- ~~`CalendarEvent.tsx`~~ / ~~`CalendarRenderer`~~ — gcal 等不写
- ~~`DraftEmail.tsx`~~ — 改用通用 `Proposal.tsx`
- ~~工具名 → 渲染器注册表~~ — 改为 LLM 用 block + markdown 表达

### 15.4 删除清单

- `src/renderer/components/MessageBubble.tsx` 中的：
  - 粉色 inline code (`text-pink-500`)
  - 紫色 crystallize variant 整套样式
  - tomorrow-night 黑底代码块（替换为浅色）
  - `inferIntent` 调用 + `InferredIntentCard` 渲染（仅保留底层数据流）
- `src/renderer/components/TalorBlockRenderer.tsx` 中的：
  - `StreamingTalorSkeleton`（animate-pulse + 灰条）
  - 所有 `draft_detected` 引用 → 改为 `proposal`（schema 泛化，能承载任意 tool + args）
  - 所有 UPPERCASE 大字 label 文本
  - `InvalidTalorBlockCard` 的 UI（仅保留 debug log 落点）
- `src/renderer/pages/Chat/index.tsx` 的内联 `style={{ background: 'linear-gradient(...)' }}` 全部替换为 token class
- `src/renderer/index.css` 中的 dark mode 残留 class（`dark:bg-zinc-900` 等）

### 15.5 测试要点

- Storybook 或 fixture page：每个组件覆盖 4-5 个状态（empty / normal / long / streaming / error）
- 视觉回归：保留 `final-v2.html` 作为 ground truth，CI 跑 percy / playwright screenshot diff
- 字符串测试：所有 talor block label 文本必须从源码中消失（grep `"need input"` `"blocked"` `"warning"` 应该 0 命中除了 type field）

## 16. 后续 spec / 不在本期

- Dark mode（基于本套 token 衍生暗色变体）
- 移动端响应式
- Crystallize 面板的"侧栏抽屉"形态（如果需要恢复独立入口）
- Settings 页面的同语言重设计（本期仅 sidebar 入口）
- Onboarding / 空 workspace 引导

## 17. 参考

| 可视化 | 内容 |
|---|---|
| `diagnosis.html` | 当前 UI 的 8 个根因 |
| `directions.html` | A/B/C 方向选型 |
| `a-refined.html` | A 方向精细化 token + 场景 |
| `a-all-scenarios.html` | 全部场景渲染（工具 / block / 富媒体 / 边界） |
| `a-markdown.html` | Markdown 完整规范 + 边界 case |
| `a-blocks-subtle.html` → `a-blocks-no-label.html` | block 弱化 → 隐藏 label 演进 |
| `a-streaming-consistency.html` | 流式 / 完成一致性 |
| `sidebar-a-styles.html` | sidebar header 4 种样式选 A2 |
| `bottom-fix-v2.html` | 底部割裂修复 |
| `settings-pin-bottom.html` | 设置贴底结构修复（移出 sb-list） |
| `mcp-rendering-rethink.html` | MCP 注册表 vs LLM-as-renderer 对比 |
| `mcp-llm-judges.html` | proposal block 设计 + LLM 选 block 机制 |
| `block-protocol.html` | Block 协议 6 环节（schema / prompt / parser / 安全门） |
| `competitors.html` | 6 个竞品（Manus / Claude.ai / ChatGPT / Cursor / Devin / v0）渲染策略对比 |
| `final-v2.html` | 整合后的终版完整设计图 |

均位于 `.superpowers/brainstorm/91391-1778854140/content/`。
```
