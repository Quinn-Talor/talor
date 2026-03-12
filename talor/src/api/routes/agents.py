"""Agent Routes — AI Agent 平台。

提供 Agent 的查询和系统提示词生成接口。
"""

from fastapi import APIRouter, HTTPException, Query

from src.api.models import (
    AgentResponse,
    AgentSystemPromptResponse,
    RoleDefinitionResponse,
    CapabilityScopeResponse,
    WorkflowDefinitionResponse,
    WorkflowStepResponse,
    DependencySpecResponse,
    InputFieldResponse,
    InputSpecResponse,
    DeliverableSpecResponse,
    DeliveryStandardResponse,
)
from src.agent import (
    Agent,
    AgentKind,
    get_agent as agent_get,
    list_agents as agent_list,
)


router = APIRouter()


def _agent_to_response(agent: Agent) -> AgentResponse:
    """将 Agent 域模型转换为 API 响应模型。"""
    role_resp = None
    if agent.role:
        role_resp = RoleDefinitionResponse(
            title=agent.role.title,
            persona=agent.role.persona,
            responsibilities=agent.role.responsibilities,
        )

    cap_resp = None
    if agent.capabilities:
        cap_resp = CapabilityScopeResponse(
            domains=agent.capabilities.domains,
            input_types=agent.capabilities.input_types,
            output_types=agent.capabilities.output_types,
            proficiency=agent.capabilities.proficiency,
            constraints=agent.capabilities.constraints,
        )

    wf_resp = None
    if agent.workflow:
        wf_resp = WorkflowDefinitionResponse(
            type=agent.workflow.type,
            steps=[
                WorkflowStepResponse(
                    id=s.id,
                    name=s.name,
                    description=s.description,
                    tool=s.tool,
                    condition=s.condition,
                )
                for s in agent.workflow.steps
            ],
            max_iterations=agent.workflow.max_iterations,
        )

    dep_resp = None
    if agent.dependencies:
        dep_resp = DependencySpecResponse(
            tools=agent.dependencies.tools,
            sub_agents=agent.dependencies.sub_agents,
            skills=agent.dependencies.skills,
            mcp_servers=agent.dependencies.mcp_servers,
        )

    input_resp = None
    if agent.input_spec:
        input_resp = InputSpecResponse(
            fields=[
                InputFieldResponse(
                    name=f.name,
                    type=f.type,
                    description=f.description,
                    required=f.required,
                    validation=f.validation,
                )
                for f in agent.input_spec.fields
            ],
            format=agent.input_spec.format,
            examples=agent.input_spec.examples,
        )

    ds_resp = None
    if agent.delivery_standard:
        ds_resp = DeliveryStandardResponse(
            deliverables=[
                DeliverableSpecResponse(
                    name=d.name,
                    format=d.format,
                    description=d.description,
                    required=d.required,
                )
                for d in agent.delivery_standard.deliverables
            ],
            quality_criteria=agent.delivery_standard.quality_criteria,
            success_definition=agent.delivery_standard.success_definition,
            acceptance_tests=agent.delivery_standard.acceptance_tests,
        )

    return AgentResponse(
        id=agent.id,
        name=agent.name,
        description=agent.description,
        kind=agent.kind.value,
        scope=agent.scope.value,
        hidden=agent.hidden,
        is_worker=agent.is_worker,
        role=role_resp,
        capabilities=cap_resp,
        workflow=wf_resp,
        dependencies=dep_resp,
        input_spec=input_resp,
        delivery_standard=ds_resp,
        manual=agent.manual,
    )


@router.get("", response_model=list[AgentResponse])
async def list_agents(
    kind: str | None = Query(default=None, description="按类型过滤：platform / worker"),
) -> list[AgentResponse]:
    """列出所有 Agent。

    可通过 ?kind=worker 仅返回业务 Agent，?kind=platform 仅返回平台 Agent。
    """
    agent_kind = None
    if kind:
        try:
            agent_kind = AgentKind(kind)
        except ValueError:
            raise HTTPException(
                status_code=400, detail=f"无效的 kind 值：{kind}，应为 platform 或 worker"
            )

    agents = await agent_list(kind=agent_kind)
    return [_agent_to_response(a) for a in agents]


@router.get("/{agent_id}", response_model=AgentResponse)
async def get_agent(agent_id: str) -> AgentResponse:
    """获取指定 agent 详情。"""
    agent = await agent_get(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' 不存在")

    return _agent_to_response(agent)


@router.get("/{agent_id}/system-prompt", response_model=AgentSystemPromptResponse)
async def get_agent_system_prompt(agent_id: str) -> AgentSystemPromptResponse:
    """获取业务 Agent 的结构化系统提示词。

    仅业务 Agent（kind=worker）有结构化提示词。
    平台 Agent 返回空字符串。
    """
    agent = await agent_get(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' 不存在")

    return AgentSystemPromptResponse(
        agent_id=agent.id,
        system_prompt=agent.build_structured_prompt(),
    )
