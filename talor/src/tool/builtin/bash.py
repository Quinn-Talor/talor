"""Bash Tool for Talor.

This module provides the bash tool for executing shell commands.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shlex
from pathlib import Path

from pydantic import BaseModel, Field

from src.tool import Tool, ToolContext, ToolOutput
from src.core import workspace


logger = logging.getLogger(__name__)


class BashParams(BaseModel):
    """Parameters for bash tool."""

    command: str = Field(
        description="The shell command to execute"
    )
    description: str = Field(
        description="Brief description of what this command does (for logging)"
    )
    timeout: int | None = Field(
        default=120,
        description="Timeout in seconds (default: 120)"
    )
    workdir: str | None = Field(
        default=None,
        description="Working directory for the command (relative to workspace)"
    )


async def bash_execute(params: BashParams, ctx: ToolContext) -> ToolOutput:
    """Execute the bash tool.

    Args:
        params: Bash parameters
        ctx: Tool execution context

    Returns:
        ToolOutput with command result
    """
    # Determine working directory
    if params.workdir:
        workdir = Path(params.workdir)
        if not workdir.is_absolute():
            workdir = ctx.worktree / workdir
    else:
        # Use first workspace as default cwd if workspaces are configured
        workspaces = workspace.get_workspaces()
        if workspaces:
            workdir = workspaces[0]
        else:
            workdir = ctx.worktree

    # Validate workspace access
    try:
        workdir = workspace.validate_path(workdir)
    except PermissionError as e:
        return ToolOutput.error(
            str(e),
            title="Access Denied"
        )

    # Validate working directory
    if not workdir.exists():
        return ToolOutput.error(
            f"Working directory not found: {workdir}",
            title="Bash Error"
        )

    try:
        # Create subprocess
        process = await asyncio.create_subprocess_shell(
            params.command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(workdir),
            env={**os.environ, "TERM": "dumb"},
        )

        # Wait for completion with timeout
        timeout = params.timeout or 120
        try:
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=timeout
            )
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            return ToolOutput.error(
                f"Command timed out after {timeout} seconds",
                title="Bash Timeout",
                metadata={"command": params.command, "timeout": timeout}
            )

        # Decode output
        stdout_str = stdout.decode("utf-8", errors="replace")
        stderr_str = stderr.decode("utf-8", errors="replace")

        # Build output
        output_parts = []
        if stdout_str:
            output_parts.append(f"STDOUT:\n{stdout_str}")
        if stderr_str:
            output_parts.append(f"STDERR:\n{stderr_str}")

        output = "\n\n".join(output_parts) if output_parts else "(no output)"

        # Build metadata
        metadata = {
            "command": params.command,
            "description": params.description,
            "exit_code": process.returncode,
            "workdir": str(workdir),
            "stdout_lines": len(stdout_str.splitlines()),
            "stderr_lines": len(stderr_str.splitlines()),
        }

        # Determine success
        if process.returncode == 0:
            return ToolOutput(
                title=f"$ {params.command[:50]}{'...' if len(params.command) > 50 else ''}",
                output=output,
                metadata=metadata,
            )
        else:
            return ToolOutput(
                title=f"$ {params.command[:50]}{'...' if len(params.command) > 50 else ''} (exit {process.returncode})",
                output=output,
                metadata={**metadata, "error": True},
            )

    except Exception as e:
        logger.error(f"Error executing command: {e}")
        return ToolOutput.error(
            f"Error executing command: {e}",
            title="Bash Error"
        )


# Define the bash tool
BashTool = Tool.define(
    id="bash",
    description="""Execute a shell command in the workspace.

Use this tool to run shell commands. Always provide a description of what
the command does for logging purposes.

IMPORTANT:
- Commands run in the workspace directory by default
- Use 'workdir' to run in a subdirectory
- Long-running commands will timeout (default: 120s)
- Avoid interactive commands that require user input

Examples:
- List files: {"command": "ls -la", "description": "List all files"}
- Run tests: {"command": "pytest tests/", "description": "Run test suite"}
- Install deps: {"command": "pip install -r requirements.txt", "description": "Install dependencies"}
""",
    parameters=BashParams,
    execute=bash_execute,
)
