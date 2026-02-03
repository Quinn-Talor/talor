"""Agent Routes.

Uses module-level functions from src.agent for agent management.
"""

from fastapi import APIRouter, HTTPException

from src.api.models import AgentResponse
from src.agent import (
    get_agent as agent_get,
    list_agents as agent_list,
)


router = APIRouter()


@router.get("", response_model=list[AgentResponse])
async def list_agents() -> list[AgentResponse]:
    """List available agents."""
    agents = await agent_list()
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
) -> AgentResponse:
    """Get an agent by name."""
    agent = await agent_get(agent_name)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    return AgentResponse(
        name=agent.name,
        description=agent.description,
        mode=agent.mode,
        native=agent.native,
        hidden=agent.hidden,
    )
