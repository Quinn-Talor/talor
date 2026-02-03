"""Agent Routes."""

from fastapi import APIRouter, HTTPException, Depends

from src.api.models import AgentResponse
from src.core.container import get_container
from src.agent.service import AgentService


router = APIRouter()


def get_agent_service() -> AgentService:
    """Get agent service from container."""
    return get_container().agent_service


@router.get("", response_model=list[AgentResponse])
async def list_agents(
    service: AgentService = Depends(get_agent_service),
) -> list[AgentResponse]:
    """List available agents."""
    agents = await service.list_agents()
    return [
        AgentResponse(
            name=a.name,
            description=a.description,
            mode=a.mode,
            native=a.native,
            hidden=a.hidden,
        )
        for a in agents
    ]


@router.get("/{agent_name}", response_model=AgentResponse)
async def get_agent(
    agent_name: str,
    service: AgentService = Depends(get_agent_service),
) -> AgentResponse:
    """Get an agent by name."""
    agent = await service.get_agent(agent_name)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    return AgentResponse(
        name=agent.name,
        description=agent.description,
        mode=agent.mode,
        native=agent.native,
        hidden=agent.hidden,
    )
