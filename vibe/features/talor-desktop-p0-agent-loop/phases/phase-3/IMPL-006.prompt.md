# IMPL-006 执行 Prompt
# 工具分级 + confirm IPC 流程（主进程侧）

---

## 第一步：你要实现什么

<!-- from: phases/phase-3/impl.md §2 IMPL-006 -->

5 个文件变更：

1. **`src/main/tools/types.ts`**：新增 `riskLevel?: 'HIGH' | 'LOW'` 到 `ToolDefinition`

2. **`src/main/tools/builtin/bash.ts`、`write.ts`、`edit.ts`**：注册时加 `riskLevel: 'HIGH'`

3. **新建 `src/main/ipc/tool-confirm.ts`**：
   - `requestToolConfirm(mainWindow, req): Promise<boolean>` — 发送 confirm 事件，Promise.race(用户响应, 30s 超时)
   - `buildInputSummary(toolName, input): string` — 按工具生成摘要

4. **修改 `src/main/ipc/chat.ts`**：在 dynamicTool execute 回调中，执行工具前插入 confirm 流程

5. **修改 `src/preload/index.ts`**：新增 `chat.onToolConfirm` + `chat.sendToolConfirmResponse`

---

## 第二步：验收条件（AC）

<!-- from: requirements.md §1.8，原文复制 -->

**AC-003-01**：
- Given: talor-desktop 运行中，session 设置了 workspace，Agent 决策执行 `bash` 工具，command=`git status`
- When: ReAct loop 准备执行 bash 前
- Then:
  - `[事件]` 主进程发送 `chat:tool-confirm` IPC 事件，payload 含 `{toolName:"bash", input:{command:"git status"}, toolCallId:"call-xyz"}`
  - `[页面]` UI 显示 ToolConfirmDialog，标题含"bash"，正文显示命令 `git status`，有"执行"和"拒绝"按钮

**AC-003-03**：
- Given: AC-003-01 中确认弹框已显示
- When: 用户点击"拒绝"按钮
- Then:
  - `[页面]` 确认弹框关闭
  - `[数据]` messages 表写入 tool_result block，output 含"用户拒绝执行"，isError=true
  - `[事件]` bash 工具未被调用（可通过 log 确认无 bash 进程 spawn）
  - `[页面]` Agent 继续运行（ReAct loop 不中断），根据拒绝结果做后续决策

**AC-003-04**：
- Given: AC-003-01 中确认弹框已显示，用户无任何操作
- When: 30 秒超时
- Then:
  - `[页面]` 确认弹框自动关闭
  - `[数据]` messages 表写入 tool_result block，output 含"确认超时，自动拒绝"，isError=true
  - `[事件]` 主进程继续 ReAct loop（工具未执行）

**AC-003-05**：
- Given: talor-desktop 运行中，Agent 决策执行 `glob` 工具（LOW 级）
- When: ReAct loop 准备执行 glob
- Then:
  - `[事件]` 主进程不发送 `chat:tool-confirm` 事件
  - `[页面]` UI 不显示确认弹框
  - `[事件]` glob 工具直接执行，结果通过 `chat:tool-result` 事件推送

---

## 第三步：接口设计

<!-- from: feature.md §F.4，原文复制 -->

**requestToolConfirm 实现**：
```typescript
// src/main/ipc/tool-confirm.ts
import { BrowserWindow, ipcMain } from 'electron'
import type { ToolConfirmRequest } from '@shared/types/message'

export async function requestToolConfirm(
  mainWindow: BrowserWindow,
  req: ToolConfirmRequest
): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      ipcMain.removeListener('chat:tool-confirm-response', handler)
      resolve(false)  // 自动拒绝
    }, 30_000)

    const handler = (_event: Electron.IpcMainEvent, response: { toolCallId: string; decision: string }) => {
      if (response.toolCallId !== req.toolCallId) return  // 忽略其他 session 的响应
      clearTimeout(timeout)
      ipcMain.removeListener('chat:tool-confirm-response', handler)
      resolve(response.decision === 'approved')
    }

    ipcMain.on('chat:tool-confirm-response', handler)
    mainWindow.webContents.send('chat:tool-confirm', req)
  })
}
```

**buildInputSummary 规则**：
```typescript
export function buildInputSummary(toolName: string, input: unknown): string {
  const MAX = 500
  const obj = input as Record<string, unknown>
  if (toolName === 'bash') {
    return String(obj.command ?? '').slice(0, MAX)
  }
  if (toolName === 'write') {
    const lines = String(obj.content ?? '').split('\n').slice(0, 20).map(l => l.slice(0, 80))
    return `文件: ${obj.path}\n\n${lines.join('\n')}`.slice(0, MAX)
  }
  if (toolName === 'edit') {
    const lines = String(obj.old_str ?? '').split('\n').slice(0, 10).map(l => l.slice(0, 80))
    return `文件: ${obj.path}\n旧内容:\n${lines.join('\n')}`.slice(0, MAX)
  }
  return JSON.stringify(input).slice(0, MAX)
}
```

**chat.ts 中插入 confirm 流程（在 dynamicTool execute 回调内）**：
```typescript
const toolDef = toolRegistry.getTool(schema.name)
const isHighRisk = toolDef?.riskLevel === 'HIGH'

if (isHighRisk) {
  const confirmed = await requestToolConfirm(mainWindow, {
    sessionId,
    messageId,
    toolCallId: /* 从 chunk.toolCallId 获取，需在 onChunk 内 */,
    toolName: schema.name,
    inputSummary: buildInputSummary(schema.name, input),
    inputFull: input,
  })
  if (!confirmed) {
    // 拒绝或超时：写拒绝 tool_result（由调用方处理返回值）
    return { output: '用户拒绝执行', isError: true }
  }
}
```

> 注意：dynamicTool execute 回调在 onChunk 外，toolCallId 从 chunk 传入需调整参数传递。

**preload 新增 API**：
```typescript
// 追加到 talorAPI.chat
onToolConfirm: (callback: (event: ToolConfirmRequest) => void): (() => void) => {
  const handler = (_: Electron.IpcRendererEvent, data: ToolConfirmRequest) => callback(data)
  ipcRenderer.on('chat:tool-confirm', handler)
  return () => ipcRenderer.removeListener('chat:tool-confirm', handler)
},
sendToolConfirmResponse: (response: { toolCallId: string; decision: 'approved' | 'rejected' }): void => {
  ipcRenderer.send('chat:tool-confirm-response', response)
},
```

---

## 第四步：代码索引

| 文件 | 本任务变更 |
|------|-----------|
| `src/main/tools/types.ts` | 新增 `riskLevel?: 'HIGH' \| 'LOW'` |
| `src/main/tools/builtin/bash.ts` | 注册时加 `riskLevel: 'HIGH'` |
| `src/main/tools/builtin/write.ts` | 注册时加 `riskLevel: 'HIGH'` |
| `src/main/tools/builtin/edit.ts` | 注册时加 `riskLevel: 'HIGH'` |
| 新建 `src/main/ipc/tool-confirm.ts` | requestToolConfirm + buildInputSummary |
| `src/main/ipc/chat.ts` | 引入 requestToolConfirm，在工具执行前插入 |
| `src/preload/index.ts` | 新增 onToolConfirm + sendToolConfirmResponse |

---

## 第五步：声明

完成后更新 checkpoint：
```
上次停在：IMPL-006 完成
当前卡点：无
下次从：IMPL-007
```

---

## 第六步：验证

**Layer 1（log 验证）**：
```bash
# 发送"运行 git status 命令"，观察 main log
# 期望："[Chat] requesting tool confirm for: bash"
# 期望：确认框出现（Phase 3 IMPL-007 完成后可视觉验证）
# 当前阶段可通过 log 验证 IPC 事件是否发送
```

**Layer 2**：见 feature.md §F.8.1 AC-003-01, AC-003-05。

验证通过后：
1. 更新 checkpoint
2. 更新 implementation.md §4.0 IMPL 完成率（6/7）
