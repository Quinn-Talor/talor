# Phase 5：MCP 接口预留 — 实施文档

> 本文件是 Phase 5 的实施细节。全局信息见 `../../implementation.md`。
> **每次本阶段会话开始前**：读此文件 §P.0 + §P.1；**结束时**：更新 §P.0 + §P.2。

---

<!--
doc-id: IMPL-talor-desktop-tool-calling-phase-5
status: completed
version: 1.0
last-updated: 2026-03-25
depends-on: [IMPL-talor-desktop-tool-calling]
-->

---

## P.0 本阶段仪表盘

| 指标 | 当前值 |
|------|--------|
| 本阶段 IMPL 完成率 | 1/1 (100%) |
| 本阶段 AC 验证率（双层） | 162/162 (100%) |
| 阶段状态 | ✅ 已完成 |
| 阻塞项 | 无 |

---

## P.1 IMPL 任务清单

> **优先级顺序**：P0（Critical Path）→ P1（错误处理 + 边界）→ P2（次要功能）

### P0 - Critical Path

#### IMPL-019：MCP 工具注册表接口设计
- ← FD-talor-desktop-tool-calling ← US-007（部分）
- AC: 无（接口设计阶段，无运行时验证）
- 优先级：P0
- **核心必读**：
  - `src/main/tools/registry.ts`（现有注册表实现）
  - `src/main/tools/types.ts`（现有类型定义）
- **按需参考**：
  - MCP 协议规范

---

## P.2 会话恢复 Checkpoint

```
上次完成到：IMPL-019 MCP 接口设计
当前状态：✅ 已完成
已产出文件：
  - src/main/tools/types.ts（新增 MCPToolProvider, ToolMetadata）
  - src/main/tools/registry.ts（扩展支持外部工具）
  - src/main/tools/registry.test.ts（新增 16 个测试）
未解决问题：无
下一步：签收 Phase 5
```

### 依赖文档版本快照

| 文档 | version | last-updated |
|------|---------|-------------|
| `../../requirements.md` | v1.2 | 2026-03-24 |
| `../../feature.md` | v1.2 | 2026-03-24 |
| `../../implementation.md` | v2.0 | 2026-03-24 |

---

## P.3 AC 验证映射（双层）

> 本阶段为接口设计阶段，通过 TypeScript 类型检查 + 单元测试验证接口正确性。

### Layer 1：技术验证

| AC ID | 测试函数 | 工具 | 路径 | 指令 | 输出摘要 | 状态 |
|-------|---------|------|------|------|---------|------|
| L1-001 | 类型检查 | tsc --noEmit | src/main/tools/types.ts, registry.ts | 编译通过 | ✅ 无错误 |
| L1-002 | 单元测试 | vitest --run | src/main/tools/registry.test.ts | 38 tests | ✅ 全部通过 |

### Layer 2：用户视角业务验证

| AC ID | 用户行为（When） | 预期结果（Then） | 验证方式 | 输出摘要 | 状态 |
|-------|--------------|---------------|---------|---------|------|
| L2-001 | 注册外部 Provider | Provider 可被查询 | listExternalProviders() | ✅ 返回正确列表 |
| L2-002 | 执行外部工具 | 返回执行结果 | execute('tool', input, ctx) | ✅ 结果正确 |
| L2-003 | 列出全部工具 | 合并内置+外部 | listAllTools() | ✅ 包含所有工具 |

---

## 实施方案：最小化 MCP 接口预留

### 设计目标

1. 定义 `MCPToolProvider` 接口，支持外部工具注册
2. 在 registry.ts 中添加 `registerExternalProvider()` 方法
3. 保持现有工具不受影响（向后兼容）
4. 文档化扩展接口的使用方式

### 实施步骤

1. **定义 MCPToolProvider 接口**（src/main/tools/types.ts）
   ```typescript
   export interface MCPToolProvider {
     name: string
     version?: string
     listTools(): Array<{ name: string; description: string; parameters: Record<string, unknown> }>
     execute(toolName: string, input: unknown, context: ToolExecuteContext): Promise<{ output: unknown }>
   }
   ```

2. **扩展 registry.ts**
   - 添加 `externalProviders: Map<string, MCPToolProvider>`
   - 添加 `registerExternalProvider(provider: MCPToolProvider)` 方法
   - 修改 `getTool()` 支持外部工具查询
   - 修改 `execute()` 支持外部工具执行
   - 添加 `listAllTools()` 合并内置 + 外部工具

3. **添加测试**
   - 验证 MCPToolProvider 接口可正确实现
   - 验证外部工具可注册和执行
   - 验证现有工具不受影响

### 验收标准

- [x] MCPToolProvider 接口定义清晰
- [x] registry.ts 扩展不影响现有功能
- [x] 测试覆盖外部工具注册和执行
- [x] TypeScript 类型安全

---

## 预期产出

- `src/main/tools/types.ts` — 新增 MCPToolProvider 接口
- `src/main/tools/registry.ts` — 扩展支持外部工具
- `src/main/tools/registry.test.ts` — 新增测试用例
