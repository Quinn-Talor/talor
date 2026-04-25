# IMPL-007 执行 Prompt
# ToolConfirmDialog UI + chatStore 状态

---

## 第一步：你要实现什么

<!-- from: phases/phase-3/impl.md §2 IMPL-007 -->

4 个文件变更：

1. **`src/renderer/store/chatStore.ts`**：新增 `pendingToolConfirm: ToolConfirmRequest | null` + `setPendingToolConfirm`

2. **`src/renderer/hooks/useStreamingMessage.ts`**：新增订阅 `talorAPI.chat.onToolConfirm`，收到事件时调用 `chatStore.setPendingToolConfirm`

3. **新建 `src/renderer/components/ToolConfirmDialog.tsx`**：确认弹框组件

4. **修改 `src/renderer/pages/Chat/index.tsx`**：读取 `pendingToolConfirm`，渲染 ToolConfirmDialog，处理 approve/reject

---

## 第二步：验收条件（AC）

<!-- from: requirements.md §1.8，原文复制 -->

**AC-003-01**：
- Given: talor-desktop 运行中，session 设置了 workspace，Agent 决策执行 `bash` 工具，command=`git status`
- When: ReAct loop 准备执行 bash 前
- Then:
  - `[事件]` 主进程发送 `chat:tool-confirm` IPC 事件，payload 含 `{toolName:"bash", input:{command:"git status"}, toolCallId:"call-xyz"}`
  - `[页面]` UI 显示 ToolConfirmDialog，标题含"bash"，正文显示命令 `git status`，有"执行"和"拒绝"按钮

**AC-003-02**：
- Given: AC-003-01 中确认弹框已显示
- When: 用户点击"执行"按钮
- Then:
  - `[页面]` 确认弹框关闭
  - `[事件]` 主进程收到 approved 响应，bash 工具正常执行
  - `[数据]` messages 表写入对应 tool_result block，isError=false（假设命令成功）

**AC-003-06**：
- Given: Agent 决策执行 `write` 工具，path="src/main/index.ts", content 为 300 行代码
- When: 确认弹框显示
- Then:
  - `[页面]` 弹框正文显示文件路径 "src/main/index.ts"
  - `[页面]` 弹框正文显示内容前 20 行预览（超出部分折叠或截断）

---

## 第三步：接口设计

<!-- from: feature.md §F.4 ToolConfirmRequest + §F.3 ToolConfirmState，原文复制 -->

**ToolConfirmDialog Props**：
```typescript
interface ToolConfirmDialogProps {
  request: ToolConfirmRequest   // { sessionId, messageId, toolCallId, toolName, inputSummary, inputFull }
  onApprove: () => void
  onReject: () => void
}
```

**UI 结构**（Tailwind CSS）：
```
// 全屏遮罩
<div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
  // 弹框
  <div className="bg-white rounded-xl shadow-2xl w-full max-w-[560px] mx-4 overflow-hidden">
    // 标题区
    <div className="px-5 py-4 bg-gray-50 border-b border-gray-200">
      <p className="text-sm text-gray-500">执行工具</p>
      <p className="text-lg font-semibold font-mono text-gray-900">{request.toolName}</p>
    </div>
    // 内容区（terminal 风格）
    <div className="px-5 py-4 bg-gray-950 max-h-64 overflow-y-auto">
      <pre className="text-sm font-mono text-green-400 whitespace-pre-wrap break-words">
        {request.inputSummary}
      </pre>
    </div>
    // 操作区
    <div className="px-5 py-4 flex justify-end gap-3 border-t border-gray-200">
      <button onClick={onReject}
        className="px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">
        拒绝
      </button>
      <button onClick={onApprove}
        className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
        执行
      </button>
    </div>
  </div>
</div>
```

**chatStore 新增状态**：
```typescript
// 在 ChatState interface 中新增
pendingToolConfirm: ToolConfirmRequest | null
setPendingToolConfirm: (req: ToolConfirmRequest | null) => void

// 在 create 中：
pendingToolConfirm: null,
setPendingToolConfirm: (req) => set({ pendingToolConfirm: req }),
```

**useStreamingMessage 新增订阅**：
```typescript
// 在现有 3 个 unsubscribe 之后新增
const unsubscribeToolConfirm = talorAPI.chat.onToolConfirm((event: ToolConfirmRequest) => {
  if (event.sessionId !== sessionId) return
  useChatStore.getState().setPendingToolConfirm(event)
})
// return 中加入 unsubscribeToolConfirm()
```

**Chat/index.tsx approve/reject 处理**：
```typescript
const { pendingToolConfirm, setPendingToolConfirm } = useChatStore()

const handleToolConfirmApprove = () => {
  if (!pendingToolConfirm) return
  talorAPI.chat.sendToolConfirmResponse({
    toolCallId: pendingToolConfirm.toolCallId,
    decision: 'approved'
  })
  setPendingToolConfirm(null)
}

const handleToolConfirmReject = () => {
  if (!pendingToolConfirm) return
  talorAPI.chat.sendToolConfirmResponse({
    toolCallId: pendingToolConfirm.toolCallId,
    decision: 'rejected'
  })
  setPendingToolConfirm(null)
}

// 在 JSX 末尾渲染
{pendingToolConfirm && (
  <ToolConfirmDialog
    request={pendingToolConfirm}
    onApprove={handleToolConfirmApprove}
    onReject={handleToolConfirmReject}
  />
)}
```

---

## 第四步：代码索引

| 文件 | 本任务变更 |
|------|-----------|
| `src/renderer/store/chatStore.ts` | 新增 pendingToolConfirm 状态 |
| `src/renderer/hooks/useStreamingMessage.ts` | 新增 onToolConfirm 订阅 |
| 新建 `src/renderer/components/ToolConfirmDialog.tsx` | 确认弹框组件 |
| `src/renderer/pages/Chat/index.tsx` | 渲染 ToolConfirmDialog + approve/reject 处理 |

**现有文件关键位置**（来自已读代码）：
- `chatStore.ts` 第 12-37 行：ChatState interface → 追加新字段
- `useStreamingMessage.ts` 第 37-50 行：现有订阅 → 仿照格式新增
- `Chat/index.tsx` 第 625-635 行：ConfirmDialog 渲染区域 → 仿照格式新增

---

## 第五步：声明

完成后更新 checkpoint：
```
上次停在：IMPL-007 完成（Phase 3 全部 IMPL 完成）
当前卡点：等待 AC 验证 + certificate 签收
下次从：归档迭代
```

---

## 第六步：验证

**Layer 1（视觉验证）**：
```bash
# npm run dev，触发 bash 工具调用
# 视觉验证：
# 1. 弹框出现，标题显示"bash"
# 2. terminal 风格内容区显示命令
# 3. "执行"和"拒绝"按钮可点击
# 4. 点击"执行"后弹框关闭，工具继续执行
# 5. 点击"拒绝"后弹框关闭，DB 中写入 isError=true 的 tool_result

# TypeScript 编译验证
npx tsc --noEmit
# 期望：0 错误
```

**Layer 2**：见 feature.md §F.8.1 AC-003-01, AC-003-02, AC-003-06。

验证通过后：
1. 更新 checkpoint
2. 更新 implementation.md §4.0 IMPL 完成率（7/7）
3. 填写 phase-3/impl.md §5 所有 AC 验证证据
4. 请求用户签收 Phase 3 certificate
5. 执行迭代归档协议（klook-vibe-project archive 模式）
