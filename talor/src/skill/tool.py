"""Skill Tool for Talor.

This module provides the Skill tool that LLM uses to load skill instructions.

Following Claude Code's two-stage loading:
1. LLM sees skill descriptions in system prompt
2. LLM calls Skill tool to load full instructions

Reference: https://docs.claude.com/en/docs/claude-code/skills
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from pydantic import BaseModel, Field

from src.tool.tool import Tool, ToolInfo
from src.tool.context import ToolContext
from src.tool.output import ToolOutput

if TYPE_CHECKING:
    from src.skill.registry import SkillRegistry

logger = logging.getLogger(__name__)


class SkillParams(BaseModel):
    """Parameters for the Skill tool."""

    skill_name: str = Field(
        description="Name of the skill to load"
    )
    arguments: str = Field(
        default="",
        description="Arguments to pass to the skill (replaces $ARGUMENTS)"
    )


async def skill_execute(
    params: SkillParams,
    ctx: ToolContext,
) -> ToolOutput:
    """Execute the Skill tool.

    Loads full skill instructions and activates the skill for the session.

    Args:
        params: Skill parameters
        ctx: Tool execution context

    Returns:
        ToolOutput with skill instructions
    """
    # Get registry from context
    registry: SkillRegistry | None = ctx.extra.get("skill_registry")
    if not registry:
        return ToolOutput(
            title=f"Skill: {params.skill_name}",
            output="Error: Skill registry not available",
            metadata={"error": "Skill registry not configured"},
        )

    # Get skill info
    skill = await registry.get_skill(params.skill_name)
    if not skill:
        available = [s.name for s in await registry.get_all_skills()]
        return ToolOutput(
            title=f"Skill: {params.skill_name}",
            output=f"Skill '{params.skill_name}' not found.\n\n"
                   f"Available skills: {', '.join(available) if available else 'none'}",
            metadata={"error": f"Skill not found: {params.skill_name}"},
        )

    # Check if skill can be invoked by model
    if not skill.is_model_invocable:
        return ToolOutput(
            title=f"Skill: {params.skill_name}",
            output=f"Skill '{params.skill_name}' can only be invoked manually by the user "
                   f"using /{params.skill_name}",
            metadata={"error": "Skill has disable-model-invocation: true"},
        )

    # Load full instructions with preprocessing
    instructions = await registry.load_skill_instructions(
        name=params.skill_name,
        arguments=params.arguments,
        session_id=ctx.session_id,
    )

    if not instructions:
        return ToolOutput(
            title=f"Skill: {params.skill_name}",
            output=f"Skill '{params.skill_name}' has no instructions",
            error="Empty skill instructions",
        )

    # Activate skill for session (enables allowed_tools restrictions)
    registry.activate_skill(ctx.session_id, params.skill_name)

    # Build output with skill metadata
    output_parts = [
        f"# Skill: {skill.name}",
        "",
        instructions,
    ]

    # Add allowed tools info if restricted
    if skill.allowed_tools:
        output_parts.extend([
            "",
            f"**Allowed tools for this skill:** {', '.join(skill.allowed_tools)}",
        ])

    return ToolOutput(
        title=f"Skill: {skill.name}",
        output="\n".join(output_parts),
        metadata={
            "skill_name": skill.name,
            "allowed_tools": skill.allowed_tools,
            "model": skill.model,
            "context": skill.context,
            "agent": skill.agent,
        },
    )


def create_skill_tool() -> ToolInfo:
    """Create the Skill tool definition.

    Returns:
        ToolInfo for the Skill tool
    """
    return Tool.define(
        id="skill",
        description=(
            "Load a skill's full instructions. Skills are specialized capabilities "
            "that provide domain-specific expertise. When a user request matches "
            "a skill's purpose, use this tool to load its detailed instructions. "
            "The skill's instructions will guide you on how to complete the task."
        ),
        parameters=SkillParams,
        execute=skill_execute,
    )


# Pre-built tool instance
SkillTool = create_skill_tool()
