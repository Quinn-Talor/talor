"""Agent Domain Model for Talor — AI Agent 平台。

Agent 平台的核心模型：
- 平台 Agent（kind=platform）：提供基础执行能力（build/plan/explore/general）
- 业务 Agent（kind=worker）：有完整 Agent 契约（role/capabilities/workflow/input_spec/delivery_standard）

Agent 通过 agents/*.jsonc 配置文件定义业务 Agent，
平台 Agent 硬编码为默认值，支持通过 .talor/agents/*.jsonc 覆盖。
"""

from __future__ import annotations

import fnmatch
import json
import logging
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Awaitable

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# =============================================================================
# Module-level State
# =============================================================================

_config_getter: Callable[[], Awaitable[dict[str, Any]]] | None = None
_agents_cache: dict[str, "Agent"] | None = None
_workspace: Path | None = None


def configure(
    config_getter: Callable[[], Awaitable[dict[str, Any]]] | None = None,
    workspace: Path | None = None,
) -> None:
    """配置模块状态。"""
    global _config_getter, _workspace
    _config_getter = config_getter
    if workspace is not None:
        _workspace = workspace


def clear_cache() -> None:
    """清除 agent 缓存（用于测试）。"""
    global _agents_cache
    _agents_cache = None


# =============================================================================
# Value Objects — 权限系统
# =============================================================================


class PermissionAction(str, Enum):
    ALLOW = "allow"
    DENY = "deny"
    ASK = "ask"


class PermissionRule(BaseModel):
    permission: str  # 工具名 或 "*"
    action: PermissionAction
    pattern: str = "*"  # 路径匹配模式（glob 风格）

    def matches(self, tool: str, path: str | None = None) -> bool:
        if self.permission != "*" and not fnmatch.fnmatch(tool, self.permission):
            return False
        if path and self.pattern != "*":
            if not fnmatch.fnmatch(path, self.pattern):
                return False
        return True


Ruleset = list[PermissionRule]


def _check_permission(
    ruleset: Ruleset,
    tool: str,
    path: str | None = None,
) -> PermissionAction:
    matching = [r for r in ruleset if r.matches(tool, path)]
    if not matching:
        return PermissionAction.ASK

    def specificity(rule: PermissionRule) -> int:
        return (10 if rule.permission != "*" else 0) + (5 if rule.pattern != "*" else 0)

    matching.sort(key=specificity, reverse=True)
    return matching[0].action


class Permission:
    """权限管理工具（保留供执行器兼容使用）。"""

    @staticmethod
    def check(ruleset: Ruleset, tool: str, path: str | None = None) -> PermissionAction:
        return _check_permission(ruleset, tool, path)

    @staticmethod
    def from_config(config: dict[str, Any]) -> Ruleset:
        rules: Ruleset = []
        for permission, value in config.items():
            if isinstance(value, str):
                rules.append(
                    PermissionRule(
                        permission=permission,
                        action=PermissionAction(value),
                    )
                )
            elif isinstance(value, dict):
                for pattern, action_str in value.items():
                    rules.append(
                        PermissionRule(
                            permission=permission,
                            action=PermissionAction(action_str),
                            pattern=pattern,
                        )
                    )
        return rules

    @staticmethod
    def merge(*rulesets: Ruleset) -> Ruleset:
        result: Ruleset = []
        for ruleset in rulesets:
            for rule in ruleset:
                if rule.pattern == "*":
                    result = [r for r in result if r.permission != rule.permission]
                else:
                    result = [
                        r
                        for r in result
                        if not (r.permission == rule.permission and r.pattern == rule.pattern)
                    ]
                result.append(rule)
        return result


# =============================================================================
# Value Objects — Agent 类型
# =============================================================================


class AgentKind(str, Enum):
    PLATFORM = "platform"  # 平台 Agent（基础设施：build/plan/explore/general）
    WORKER = "worker"  # 业务 Agent（领域专家，有完整 Agent 契约）


class AgentScope(str, Enum):
    PRIMARY = "primary"  # 可由用户直接调用
    SUBAGENT = "subagent"  # 仅可被其他 agent 调用
    BOTH = "both"  # 两者均可


# =============================================================================
# Value Objects — Agent 模型
# =============================================================================


class WorkflowType(str, Enum):
    SEQUENTIAL = "sequential"
    PARALLEL = "parallel"
    EVENT_DRIVEN = "event_driven"


class WorkflowStep(BaseModel):
    id: str
    name: str
    description: str
    tool: str | None = None  # 关联工具
    condition: str | None = None  # 执行条件


class WorkflowDefinition(BaseModel):
    type: WorkflowType = WorkflowType.SEQUENTIAL
    steps: list[WorkflowStep] = []
    max_iterations: int | None = None


class RoleDefinition(BaseModel):
    title: str  # 职位名称
    persona: str  # 角色人设 / 背景描述
    responsibilities: list[str] = []  # 核心职责


class CapabilityScope(BaseModel):
    domains: list[str] = []  # 专业领域
    input_types: list[str] = []  # 可接受的输入类型
    output_types: list[str] = []  # 可输出类型
    proficiency: dict[str, str] = {}  # 技能熟练度（技能名 → 等级）
    constraints: list[str] = []  # 能力边界说明


class DependencySpec(BaseModel):
    tools: list[str] = []  # 工具名称列表
    sub_agents: list[str] = []  # 子 agent 名称
    skills: list[str] = []  # 技能（skill）名称
    mcp_servers: list[str] = []  # MCP 服务器


class InputField(BaseModel):
    name: str
    type: str = "string"  # string / file / json / number / boolean
    description: str
    required: bool = True
    validation: str | None = None  # 校验规则描述


class InputSpec(BaseModel):
    fields: list[InputField] = []
    format: str = "natural_language"  # natural_language / structured / both
    examples: list[str] = []


class DeliverableSpec(BaseModel):
    name: str
    format: str  # markdown / json / file / code / report
    description: str
    required: bool = True


class DeliveryStandard(BaseModel):
    deliverables: list[DeliverableSpec] = []
    quality_criteria: list[str] = []  # 质量标准
    success_definition: str = ""  # 成功定义
    acceptance_tests: list[str] = []  # 验收测试描述


# =============================================================================
# Value Objects — 执行配置
# =============================================================================


class ModelConfig(BaseModel):
    provider_id: str
    model_id: str

    def to_string(self) -> str:
        return f"{self.provider_id}/{self.model_id}"


# =============================================================================
# Agent Entity
# =============================================================================


class Agent(BaseModel):
    """Agent 完整模型。

    平台 Agent（kind=platform）：
        提供基础执行能力，无角色/能力/流程字段，行为由 permission 和执行器默认逻辑决定。

    业务 Agent（kind=worker）：
        有完整 Agent 契约（role/capabilities/workflow/input_spec/delivery_standard），
        通过 build_structured_prompt() 生成结构化系统提示词。
        可通过 manual 字段引用外部 Agent 手册文件（SOP/领域知识）。
    """

    # 基础标识
    id: str
    name: str
    description: str | None = None
    version: str = "1.0.0"
    enabled: bool = True
    hidden: bool = False

    # Agent 类型与调用范围
    kind: AgentKind = AgentKind.WORKER
    scope: AgentScope = AgentScope.PRIMARY

    # ── 业务 Agent 定义（kind=worker 时填写）────────────────────────────
    role: RoleDefinition | None = None
    capabilities: CapabilityScope | None = None
    workflow: WorkflowDefinition | None = None
    dependencies: DependencySpec | None = None
    input_spec: InputSpec | None = None
    delivery_standard: DeliveryStandard | None = None
    manual: str | None = None  # Agent 手册文件路径（.md，追加在结构化定义之后）

    # ── 执行配置 ──────────────────────────────────────────────────────
    model: ModelConfig | None = None
    temperature: float | None = None
    max_steps: int = 50
    permission: list[PermissionRule] = Field(default_factory=list)

    # ── 属性 ──────────────────────────────────────────────────────────

    @property
    def is_worker(self) -> bool:
        """是否为业务 Agent。"""
        return self.kind == AgentKind.WORKER

    @property
    def is_platform(self) -> bool:
        """是否为平台 Agent。"""
        return self.kind == AgentKind.PLATFORM

    @property
    def is_primary(self) -> bool:
        """是否可由用户直接调用。"""
        return self.scope in (AgentScope.PRIMARY, AgentScope.BOTH)

    @property
    def is_subagent(self) -> bool:
        """是否可被其他 agent 调用。"""
        return self.scope in (AgentScope.SUBAGENT, AgentScope.BOTH)

    @property
    def is_visible(self) -> bool:
        """是否在 UI 中可见。"""
        return not self.hidden

    @property
    def prompt_path(self) -> str | None:
        """Agent 手册路径（供执行器加载 manual 文件）。"""
        return self.manual

    # ── 系统提示词构建 ────────────────────────────────────────────────

    def build_structured_prompt(self) -> str:
        """将 Agent 定义渲染为结构化中文系统提示词（纯函数，无 I/O）。

        章节顺序：角色定义 → 能力范畴 → 工作流程 → 输入规范 → 交付标准
        无 role 定义时返回空字符串（平台 Agent 走此路径）。
        """
        if not self.role:
            return ""

        sections: list[str] = []

        # 角色定义
        role_lines = [
            f"## 你的身份与职责",
            f"你是**{self.role.title}**。",
            "",
            self.role.persona,
        ]
        if self.role.responsibilities:
            role_lines += ["", "### 核心职责"]
            role_lines += [f"- {r}" for r in self.role.responsibilities]
        sections.append("\n".join(role_lines))

        # 能力范畴
        if self.capabilities:
            cap = self.capabilities
            cap_lines = ["## 能力范畴"]
            if cap.domains:
                cap_lines.append(f"**专业领域**：{', '.join(cap.domains)}")
            if cap.input_types:
                cap_lines.append(f"**可接受输入**：{', '.join(cap.input_types)}")
            if cap.output_types:
                cap_lines.append(f"**可输出类型**：{', '.join(cap.output_types)}")
            if cap.proficiency:
                prof_strs = [f"{k}（{v}）" for k, v in cap.proficiency.items()]
                cap_lines.append(f"**技能熟练度**：{', '.join(prof_strs)}")
            if cap.constraints:
                cap_lines += ["", "**能力边界**："]
                cap_lines += [f"- {c}" for c in cap.constraints]
            sections.append("\n".join(cap_lines))

        # 工作流程
        if self.workflow and self.workflow.steps:
            wf = self.workflow
            wf_type_map = {
                "sequential": "顺序执行",
                "parallel": "并行执行",
                "event_driven": "事件驱动",
            }
            wf_lines = [
                "## 工作流程",
                f"执行方式：{wf_type_map.get(wf.type, wf.type)}",
                "",
                "**工作步骤**：",
            ]
            for i, step in enumerate(wf.steps, 1):
                step_line = f"{i}. **{step.name}**：{step.description}"
                if step.condition:
                    step_line += f"（条件：{step.condition}）"
                wf_lines.append(step_line)
            if wf.max_iterations:
                wf_lines.append(f"\n最大迭代次数：{wf.max_iterations}")
            sections.append("\n".join(wf_lines))

        # 输入规范
        if self.input_spec and self.input_spec.fields:
            spec = self.input_spec
            spec_lines = ["## 输入规范"]
            required = [f for f in spec.fields if f.required]
            optional = [f for f in spec.fields if not f.required]
            if required:
                spec_lines.append("**必需输入**：")
                for field in required:
                    line = f"- `{field.name}`（{field.type}）：{field.description}"
                    if field.validation:
                        line += f"，验证：{field.validation}"
                    spec_lines.append(line)
            if optional:
                spec_lines.append("**可选输入**：")
                for field in optional:
                    spec_lines.append(f"- `{field.name}`（{field.type}）：{field.description}")
            if spec.examples:
                spec_lines += ["", "**示例**："]
                spec_lines += [f"- {ex}" for ex in spec.examples]
            sections.append("\n".join(spec_lines))

        # 交付标准
        if self.delivery_standard:
            ds = self.delivery_standard
            ds_lines = ["## 交付标准"]
            if ds.deliverables:
                ds_lines.append("**交付物**：")
                for d in ds.deliverables:
                    req = "（必须）" if d.required else "（可选）"
                    ds_lines.append(f"- **{d.name}**{req}：{d.description}，格式：{d.format}")
            if ds.quality_criteria:
                ds_lines += ["", "**质量标准**："]
                ds_lines += [f"- {c}" for c in ds.quality_criteria]
            if ds.success_definition:
                ds_lines += ["", f"**成功定义**：{ds.success_definition}"]
            if ds.acceptance_tests:
                ds_lines += ["", "**验收测试**："]
                ds_lines += [f"- {t}" for t in ds.acceptance_tests]
            sections.append("\n".join(ds_lines))

        prompt = "\n\n".join(sections)

        # 追加 Agent 手册内容（如有）
        if self.manual and _workspace:
            manual_path = _workspace / self.manual
            if manual_path.is_file():
                manual_content = manual_path.read_text(encoding="utf-8").strip()
                if manual_content:
                    prompt = prompt + "\n\n" + manual_content

        return prompt

    # ── 权限检查 ──────────────────────────────────────────────────────

    def check_permission(self, tool_name: str, path: str | None = None) -> PermissionAction:
        return _check_permission(self.permission, tool_name, path)

    def is_tool_allowed(self, tool_name: str, path: str | None = None) -> bool:
        return self.check_permission(tool_name, path) == PermissionAction.ALLOW

    def is_tool_denied(self, tool_name: str, path: str | None = None) -> bool:
        return self.check_permission(tool_name, path) == PermissionAction.DENY

    def requires_permission(self, tool_name: str, path: str | None = None) -> bool:
        return self.check_permission(tool_name, path) == PermissionAction.ASK

    def get_permission_ruleset(self) -> Ruleset:
        return self.permission


# =============================================================================
# 平台 Agent 默认配置
# =============================================================================


def _default_platform_rules() -> list[PermissionRule]:
    """平台 Agent 通用默认权限规则。"""
    return Permission.merge(
        Permission.from_config(
            {
                "*": "allow",
                "doom_loop": "ask",
                "external_directory": "ask",
                "read": {
                    "*": "allow",
                    "*.env": "ask",
                    "*.env.*": "ask",
                    "*.env.example": "allow",
                },
            }
        )
    )


_PLATFORM_AGENTS_DEFAULTS: dict[str, dict[str, Any]] = {
    "build": {
        "id": "build",
        "name": "通用执行员",
        "description": "核心执行引擎，负责工具调用和任务执行。",
        "kind": AgentKind.PLATFORM,
        "scope": AgentScope.PRIMARY,
        "max_steps": 50,
        "permission": Permission.merge(
            _default_platform_rules(),
            Permission.from_config(
                {
                    "question": "allow",
                    "plan_enter": "allow",
                }
            ),
        ),
    },
    "plan": {
        "id": "plan",
        "name": "任务规划员",
        "description": "规划模式，禁止编辑操作，用于复杂任务分解和规划。",
        "kind": AgentKind.PLATFORM,
        "scope": AgentScope.PRIMARY,
        "max_steps": 50,
        "permission": Permission.merge(
            _default_platform_rules(),
            Permission.from_config(
                {
                    "question": "allow",
                    "plan_exit": "allow",
                    "edit": "deny",
                    "write": "deny",
                }
            ),
        ),
    },
    "general": {
        "id": "general",
        "name": "通用研究员",
        "description": "通用子 agent，可被业务 Agent 委派执行复杂多步任务。",
        "kind": AgentKind.PLATFORM,
        "scope": AgentScope.SUBAGENT,
        "max_steps": 50,
        "permission": Permission.merge(
            _default_platform_rules(),
            Permission.from_config(
                {
                    "todoread": "deny",
                    "todowrite": "deny",
                }
            ),
        ),
    },
    "explore": {
        "id": "explore",
        "name": "信息探索员",
        "description": "快速信息探索子 agent，专用于文件/代码库搜索。",
        "kind": AgentKind.PLATFORM,
        "scope": AgentScope.SUBAGENT,
        "max_steps": 50,
        "permission": Permission.merge(
            Permission.from_config(
                {
                    "*": "deny",
                    "grep": "allow",
                    "glob": "allow",
                    "ls": "allow",
                    "bash": "allow",
                    "read": "allow",
                }
            ),
        ),
    },
    "title": {
        "id": "title",
        "name": "标题生成员",
        "description": "生成会话标题。",
        "kind": AgentKind.PLATFORM,
        "scope": AgentScope.PRIMARY,
        "hidden": True,
        "temperature": 0.5,
        "max_steps": 5,
        "permission": Permission.from_config({"*": "deny"}),
    },
    "summary": {
        "id": "summary",
        "name": "摘要生成员",
        "description": "生成会话摘要。",
        "kind": AgentKind.PLATFORM,
        "scope": AgentScope.PRIMARY,
        "hidden": True,
        "max_steps": 10,
        "permission": Permission.from_config({"*": "deny"}),
    },
}


def _build_platform_agent(agent_id: str, defaults: dict[str, Any]) -> Agent:
    """从默认配置构建平台 Agent 实例。"""
    return Agent(
        id=defaults["id"],
        name=defaults["name"],
        description=defaults.get("description"),
        kind=defaults.get("kind", AgentKind.PLATFORM),
        scope=defaults.get("scope", AgentScope.PRIMARY),
        hidden=defaults.get("hidden", False),
        temperature=defaults.get("temperature"),
        max_steps=defaults.get("max_steps", 50),
        permission=defaults.get("permission", []),
    )


def _parse_jsonc(text: str) -> Any:
    """解析 JSONC（去除注释后解析 JSON）。"""
    import re

    # 去除单行注释
    text = re.sub(r"//[^\n]*", "", text)
    # 去除多行注释
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    return json.loads(text)


def _load_agent_from_file(path: Path, default_kind: AgentKind) -> Agent | None:
    """从 JSONC 文件加载 agent 配置。"""
    try:
        text = path.read_text(encoding="utf-8")
        data = _parse_jsonc(text)
    except Exception as e:
        logger.warning(f"加载 agent 配置文件失败 {path}: {e}")
        return None

    # 强制设置 kind
    data["kind"] = default_kind.value

    # 若无 id，使用文件名（不含扩展名）
    if "id" not in data:
        data["id"] = path.stem

    # 若无 name，使用 id
    if "name" not in data:
        data["name"] = data["id"]

    try:
        return _parse_agent_from_dict(data)
    except Exception as e:
        logger.warning(f"解析 agent 配置失败 {path}: {e}")
        return None


def _parse_agent_from_dict(data: dict[str, Any]) -> Agent:
    """从字典解析 Agent（含嵌套值对象）。"""
    # 解析枚举
    if "kind" in data:
        data["kind"] = AgentKind(data["kind"])
    if "scope" in data:
        data["scope"] = AgentScope(data["scope"])

    # 解析权限规则
    if "permission" in data:
        rules = []
        for item in data["permission"]:
            if isinstance(item, dict):
                rules.append(PermissionRule(**item))
        data["permission"] = rules

    # 解析 model
    if "model" in data and isinstance(data["model"], dict):
        data["model"] = ModelConfig(**data["model"])

    # 解析 role
    if "role" in data and isinstance(data["role"], dict):
        data["role"] = RoleDefinition(**data["role"])

    # 解析 capabilities
    if "capabilities" in data and isinstance(data["capabilities"], dict):
        data["capabilities"] = CapabilityScope(**data["capabilities"])

    # 解析 workflow
    if "workflow" in data and isinstance(data["workflow"], dict):
        wf_data = data["workflow"]
        if "type" in wf_data:
            wf_data["type"] = WorkflowType(wf_data["type"])
        if "steps" in wf_data:
            wf_data["steps"] = [WorkflowStep(**s) for s in wf_data["steps"]]
        data["workflow"] = WorkflowDefinition(**wf_data)

    # 解析 dependencies
    if "dependencies" in data and isinstance(data["dependencies"], dict):
        data["dependencies"] = DependencySpec(**data["dependencies"])

    # 解析 input_spec
    if "input_spec" in data and isinstance(data["input_spec"], dict):
        spec_data = data["input_spec"]
        if "fields" in spec_data:
            spec_data["fields"] = [InputField(**f) for f in spec_data["fields"]]
        data["input_spec"] = InputSpec(**spec_data)

    # 解析 delivery_standard
    if "delivery_standard" in data and isinstance(data["delivery_standard"], dict):
        ds_data = data["delivery_standard"]
        if "deliverables" in ds_data:
            ds_data["deliverables"] = [DeliverableSpec(**d) for d in ds_data["deliverables"]]
        data["delivery_standard"] = DeliveryStandard(**ds_data)

    return Agent(**data)


# =============================================================================
# Module-level Functions
# =============================================================================


async def _load_agents() -> dict[str, Agent]:
    """加载所有 agent。

    加载顺序：
    1. 平台 Agent 硬编码默认值
    2. 从 .talor/agents/*.jsonc 覆盖平台 Agent 配置（可选）
    3. 从 agents/*.jsonc 加载业务 Agent
    """
    global _agents_cache

    if _agents_cache is not None:
        return _agents_cache

    agents: dict[str, Agent] = {}

    # 1. 平台 Agent 默认值
    for agent_id, defaults in _PLATFORM_AGENTS_DEFAULTS.items():
        agents[agent_id] = _build_platform_agent(agent_id, defaults)

    # 2. 从配置目录覆盖平台 Agent（可选）
    workspace = _workspace
    if workspace:
        platform_agents_dir = workspace / ".talor" / "agents"
        if platform_agents_dir.is_dir():
            for path in sorted(platform_agents_dir.glob("*.jsonc")):
                agent_id = path.stem
                agent = _load_agent_from_file(path, AgentKind.PLATFORM)
                if agent:
                    if agent_id in agents:
                        agents[agent_id] = agent
                        logger.debug(f"平台 Agent 配置已覆盖：{agent_id}")
                    else:
                        agents[agent_id] = agent
                        logger.debug(f"新增平台 Agent：{agent_id}")

        # 3. 业务 Agent
        agents_dir = workspace / "agents"
        if agents_dir.is_dir():
            for path in sorted(agents_dir.glob("*.jsonc")):
                agent = _load_agent_from_file(path, AgentKind.WORKER)
                if agent:
                    agents[agent.id] = agent
                    logger.debug(f"业务 Agent 已加载：{agent.id}")

    _agents_cache = agents
    return agents


async def get_agent(name: str) -> Agent | None:
    """通过 id 或 name 获取 agent。"""
    agents = await _load_agents()
    # 优先通过 id 匹配
    if name in agents:
        return agents[name]
    # 回退到 name 匹配
    for agent in agents.values():
        if agent.name == name:
            return agent
    return None


async def list_agents(
    include_hidden: bool = False,
    kind: AgentKind | None = None,
) -> list[Agent]:
    """列出所有 agent。

    Args:
        include_hidden: 是否包含隐藏 agent
        kind: 按类型过滤（platform / worker）
    """
    agents = await _load_agents()
    result = list(agents.values())

    if not include_hidden:
        result = [a for a in result if not a.hidden]

    if kind is not None:
        result = [a for a in result if a.kind == kind]

    # 排序：主要 agent 优先，再按 id
    result.sort(key=lambda a: (a.kind != AgentKind.PLATFORM, not a.is_primary, a.id))
    return result


async def get_default_agent() -> str:
    """获取默认 agent id。"""
    default_id = "build"

    if _config_getter:
        config = await _config_getter()
        default_id = config.get("default_agent", "build")

    agents = await _load_agents()

    if default_id in agents:
        return default_id

    # 回退：找第一个主要且可见的 agent
    for agent in agents.values():
        if agent.is_primary and agent.is_visible:
            return agent.id

    raise ValueError("找不到可用的主要 agent")


async def list_agents_for_mode(mode: str) -> list[Agent]:
    """按旧版 mode 字段列出 agent（兼容执行器调用）。"""
    all_agents = await list_agents(include_hidden=False)
    if mode == "primary":
        return [a for a in all_agents if a.is_primary]
    elif mode == "subagent":
        return [a for a in all_agents if a.is_subagent]
    return all_agents


# =============================================================================
# AgentService — 供执行器依赖注入使用
# =============================================================================


class AgentService:
    """Agent 服务（供执行器通过依赖注入使用）。"""

    async def get_agent(self, name: str) -> Agent | None:
        return await get_agent(name)

    async def list_agents(self, include_hidden: bool = False) -> list[Agent]:
        return await list_agents(include_hidden=include_hidden)

    async def get_default_agent(self) -> str:
        return await get_default_agent()

    async def list_agents_for_mode(self, mode: str) -> list[Agent]:
        return await list_agents_for_mode(mode)

    def clear_cache(self) -> None:
        clear_cache()
