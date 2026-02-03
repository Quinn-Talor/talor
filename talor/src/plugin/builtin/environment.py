"""Environment Plugin for Talor.

This plugin injects runtime environment information into the prompt.

Features:
- Operating system information
- Current working directory
- Project root path
- Current timestamp
- Custom environment variables
"""

from __future__ import annotations

import platform
from datetime import datetime

from src.plugin.base import PromptPlugin, PluginPriority
from src.plugin.context import PluginContext
from src.plugin.result import PluginResult


class EnvironmentPlugin(PromptPlugin):
    """Environment Plugin - Runtime environment information.

    Responsibilities:
    - Inject operating system information
    - Inject current working directory
    - Inject project root path
    - Inject current timestamp
    - Include custom environment variables
    """

    def __init__(self) -> None:
        """Initialize the environment plugin."""
        super().__init__(
            name="environment",
            priority=PluginPriority.ENVIRONMENT,
            enabled=True,
            required=True,
        )
        self._custom_vars: dict[str, str] = {}

    def set_custom_variable(self, key: str, value: str) -> None:
        """Set a custom environment variable.

        Args:
            key: Variable name
            value: Variable value
        """
        self._custom_vars[key] = value

    async def build(self, context: PluginContext) -> PluginResult:
        """Build environment information.

        Args:
            context: Plugin execution context

        Returns:
            PluginResult with environment information
        """
        # Build environment info
        env_lines = [
            f"Operating System: {platform.system()} {platform.release()}",
            f"Current Directory: {context.cwd}",
            f"Project Root: {context.worktree}",
            f"Current Time: {datetime.now().isoformat()}",
            f"Platform: {context.platform or platform.platform()}",
        ]

        # Add custom variables
        for key, value in self._custom_vars.items():
            env_lines.append(f"{key}: {value}")

        env_info = "<environment>\n" + "\n".join(env_lines) + "\n</environment>"

        return PluginResult(
            content=env_info,
            section="environment",
            metadata={
                "os": platform.system(),
                "cwd": str(context.cwd),
                "worktree": str(context.worktree),
            },
        )
