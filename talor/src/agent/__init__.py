"""Agent System for Talor — AI 数字员工平台。

平台两层架构：
- 平台员工（kind=platform）：基础执行能力（build/plan/explore/general），硬编码默认值
- 业务员工（kind=worker）：领域专家，从 employees/*.jsonc 加载，有完整员工契约

Usage:
    ```python
    from src.agent import (
        Agent, AgentKind, AgentScope,
        RoleDefinition, CapabilityScope, WorkflowDefinition,
        DependencySpec, InputSpec, DeliveryStandard,
        ModelConfig, PermissionRule, PermissionAction,
        configure, clear_cache, get_agent, list_agents,
        AgentExecutor,
    )

    # 配置模块
    configure(config_getter=my_config_getter, workspace=Path("."))

    # 列出所有业务员工
    workers = await list_agents(kind=AgentKind.WORKER)

    # 获取特定 agent
    agent = await get_agent("data-analyst")
    prompt = agent.build_structured_prompt()
    ```
"""

# 域模型
from src.agent.agent import (
    Agent,
    AgentKind,
    AgentScope,
    # 数字员工值对象
    RoleDefinition,
    CapabilityScope,
    WorkflowDefinition,
    WorkflowStep,
    WorkflowType,
    DependencySpec,
    InputField,
    InputSpec,
    DeliverableSpec,
    DeliveryStandard,
    # 执行配置
    ModelConfig,
    # 权限系统
    PermissionRule,
    PermissionAction,
    Permission,
    Ruleset,
)

# 模块级函数
from src.agent.agent import (
    configure,
    clear_cache,
    get_agent,
    list_agents,
    get_default_agent,
    list_agents_for_mode,
)

# AgentService（供执行器依赖注入）
from src.agent.agent import AgentService

# 执行器
from src.agent.executor import (
    AgentExecutor,
    SSEEvent,
    ExecutionStatus,
    AgentLoop,
    LoopConfig,
    LoopContext,
    LoopPhase,
    StopReason,
    Thought,
    ToolCall,
    Action,
    Observation,
)

__all__ = [
    # 域模型
    "Agent",
    "AgentKind",
    "AgentScope",
    # 数字员工值对象
    "RoleDefinition",
    "CapabilityScope",
    "WorkflowDefinition",
    "WorkflowStep",
    "WorkflowType",
    "DependencySpec",
    "InputField",
    "InputSpec",
    "DeliverableSpec",
    "DeliveryStandard",
    # 执行配置
    "ModelConfig",
    # 权限系统
    "PermissionRule",
    "PermissionAction",
    "Permission",
    "Ruleset",
    # 模块级函数
    "configure",
    "clear_cache",
    "get_agent",
    "list_agents",
    "get_default_agent",
    "list_agents_for_mode",
    # 服务
    "AgentService",
    # 执行器
    "AgentExecutor",
    "SSEEvent",
    "ExecutionStatus",
    "AgentLoop",
    "LoopConfig",
    "LoopContext",
    "LoopPhase",
    "StopReason",
    "Thought",
    "ToolCall",
    "Action",
    "Observation",
]
