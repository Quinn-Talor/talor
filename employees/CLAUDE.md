# 数字员工定义规范

## 文件格式

每个业务数字员工对应一个 `.jsonc` 文件，员工手册为 `manuals/*.md`。

```
employees/
  code-reviewer.jsonc       # 代码审查员（参考示例）
  data-analyst.jsonc        # 数据分析师（参考示例）
  manuals/
    data-analyst.md         # 数据分析师手册（SOP / 领域知识）
```

> ⚠️ **禁止直接修改示例文件**（`code-reviewer.jsonc`、`data-analyst.jsonc`），作为模板保留。

---

## 字段说明

### 必填字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一标识，kebab-case，如 `code-reviewer` |
| `name` | string | 显示名称，如 `代码审查员` |
| `role.title` | string | 职位名称 |
| `role.persona` | string | 角色人设/背景描述 |
| `role.responsibilities` | string[] | 核心职责列表 |
| `delivery_standard.success_definition` | string | 成功定义（一句话） |

### 可选字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `kind` | `worker` | 可省略，加载时自动设为 `worker` |
| `scope` | `primary` / `subagent` / `both` | 调用范围，默认 `primary` |
| `capabilities` | object | 能力范畴（domains、proficiency、constraints） |
| `workflow` | object | 工作流程（type: sequential/parallel/event_driven，steps） |
| `dependencies` | object | 依赖（tools、sub_agents、skills、mcp_servers） |
| `input_spec` | object | 输入规范（fields、format、examples） |
| `delivery_standard` | object | 交付标准（deliverables、quality_criteria、acceptance_tests） |
| `manual` | string | 员工手册路径，如 `manuals/data-analyst.md` |
| `max_steps` | int | 最大执行步数，默认 50 |
| `model` | object | 指定模型，如 `{"provider_id": "anthropic", "model_id": "claude-sonnet-4-20250514"}` |

---

## 新员工创建步骤

1. 复制 `code-reviewer.jsonc` 为新文件（如 `hr-assistant.jsonc`）
2. 修改 `id`、`name`、`role`、`capabilities`、`workflow`
3. 按需创建 `manuals/<id>.md`（SOP / 领域知识文档）
4. 在 `manual` 字段中填写手册路径
5. 重启后端，通过 `GET /api/agents?kind=worker` 验证加载成功

---

## 系统提示词生成规则

后端 `build_structured_prompt()` 自动将字段渲染为中文结构化提示词：

```
[角色定义]      ← role.title / persona / responsibilities
[能力范畴]      ← capabilities.domains / proficiency / constraints
[工作流程]      ← workflow.type / steps
[输入规范]      ← input_spec.fields / format / examples
[交付标准]      ← delivery_standard.deliverables / quality_criteria

+ 员工手册内容  ← 追加 manual 文件全文（如有）
```
