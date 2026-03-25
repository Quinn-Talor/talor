# Phase 5 会话启动检查

> 本文件是 Phase 5 的会话启动锚点。**每次本阶段会话开始前必须检查**。

---

## Step 1：读取当前状态

```
# 读取 IMPL 仪表盘
cat phases/phase-5/IMPL.md §P.0

# 读取 Checkpoint
cat phases/phase-5/IMPL.md §P.2
```

**当前阶段状态**：
- IMPL 完成率：0/1 (0%)
- AC 验证率：0/0
- 阶段状态：⬜ 未开始（接口设计阶段）
- 上次完成到：无

---

## Step 2：确认进入条件

| 条件 | 状态 | 说明 |
|------|------|------|
| Phase 4 已签收 | ✅ | certificate.md 已完成 |
| requirements.md 已 approved | ✅ | v1.2 |
| feature.md 已 approved | ✅ | v1.2 |
| implementation.md 已 approved | ✅ | v2.0 |

**结论**：✅ Phase 5 可以开始

---

## Step 3：加载上下文

**实施前必读**（按顺序）：
1. `src/main/tools/registry.ts` — 现有注册表实现
2. `src/main/tools/types.ts` — 现有类型定义

**按需参考**：
- MCP 协议规范

---

## Step 4：命名一致性确认

**术语表**（来自 `../../requirements.md §1.3`）：
- 工具注册表（Tool Registry）：管理所有可用工具的注册和执行
- MCP 工具（MCP Tool）：通过 MCP 协议接入的外部工具
- 工具提供者（Tool Provider）：提供工具的实体

---

## Step 5：验证执行环境

| 项目 | 值 |
|------|-----|
| 项目根目录 | `/Users/quinn.li/Desktop/talor/talor-desktop` |
| Layer 1 测试命令 | `npx vitest run` |
| 工具目录 | `src/main/tools/` |

**前置条件**：
1. ✅ npm 依赖已安装
2. ✅ 测试框架可运行

---

## 实施顺序

按 `IMPL.md §P.1` 优先级：

1. **IMPL-019** (P0)：MCP 工具注册表接口设计

---

## 预期产出

- `src/main/tools/types.ts` — 新增 MCPToolProvider 接口
- `src/main/tools/registry.ts` — 扩展支持外部工具
- `src/main/tools/registry.test.ts` — 新增测试用例
