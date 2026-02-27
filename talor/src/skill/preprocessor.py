"""Skill Preprocessor for Talor.

This module provides preprocessing for skill instructions:
- $ARGUMENTS replacement (full arguments string)
- $ARGUMENTS[N] or $N replacement (positional arguments)
- ${CLAUDE_SESSION_ID} replacement
- !`command` dynamic context injection

Reference: https://docs.claude.com/en/docs/claude-code/skills
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import subprocess
from typing import Any

logger = logging.getLogger(__name__)


class SkillPreprocessor:
    """Preprocessor for skill instructions.

    Handles variable substitution and dynamic command execution
    following Claude Code specification.
    """

    # Pattern for $ARGUMENTS[N] or $N
    POSITIONAL_ARG_PATTERN = re.compile(r'\$(?:ARGUMENTS\[(\d+)\]|(\d+))')

    # Pattern for ${VARIABLE_NAME}
    ENV_VAR_PATTERN = re.compile(r'\$\{([A-Z_][A-Z0-9_]*)\}')

    # Pattern for !`command`
    COMMAND_PATTERN = re.compile(r'!\`([^`]+)\`')

    @classmethod
    def process(
        cls,
        instructions: str,
        arguments: str = "",
        session_id: str | None = None,
        execute_commands: bool = True,
    ) -> str:
        """Process skill instructions with variable substitution.

        Args:
            instructions: Raw skill instructions
            arguments: Arguments passed when invoking skill
            session_id: Current session ID for ${CLAUDE_SESSION_ID}
            execute_commands: Whether to execute !`command` blocks

        Returns:
            Processed instructions string
        """
        result = instructions

        # 1. Replace $ARGUMENTS with full arguments string
        if "$ARGUMENTS" in result:
            # Check if $ARGUMENTS is used (not $ARGUMENTS[N])
            if re.search(r'\$ARGUMENTS(?!\[)', result):
                result = re.sub(r'\$ARGUMENTS(?!\[)', arguments, result)
            else:
                # If $ARGUMENTS not present but arguments provided, append
                if arguments and "$ARGUMENTS" not in instructions:
                    result += f"\n\nARGUMENTS: {arguments}"

        # 2. Replace positional arguments $ARGUMENTS[N] or $N
        args_list = cls._split_arguments(arguments)
        result = cls.POSITIONAL_ARG_PATTERN.sub(
            lambda m: cls._get_positional_arg(m, args_list),
            result
        )

        # 3. Replace environment variables ${VAR_NAME}
        result = cls.ENV_VAR_PATTERN.sub(
            lambda m: cls._get_env_var(m, session_id),
            result
        )

        # 4. Execute !`command` blocks if enabled
        if execute_commands:
            result = cls.COMMAND_PATTERN.sub(
                lambda m: cls._execute_command(m.group(1)),
                result
            )

        return result

    @classmethod
    async def process_async(
        cls,
        instructions: str,
        arguments: str = "",
        session_id: str | None = None,
        execute_commands: bool = True,
        cwd: str | None = None,
    ) -> str:
        """Process skill instructions asynchronously.

        Async version that handles !`command` execution without blocking.

        Args:
            instructions: Raw skill instructions
            arguments: Arguments passed when invoking skill
            session_id: Current session ID
            execute_commands: Whether to execute !`command` blocks
            cwd: Working directory for command execution

        Returns:
            Processed instructions string
        """
        result = instructions

        # 1. Replace $ARGUMENTS
        if "$ARGUMENTS" in result:
            if re.search(r'\$ARGUMENTS(?!\[)', result):
                result = re.sub(r'\$ARGUMENTS(?!\[)', arguments, result)
        elif arguments:
            result += f"\n\nARGUMENTS: {arguments}"

        # 2. Replace positional arguments
        args_list = cls._split_arguments(arguments)
        result = cls.POSITIONAL_ARG_PATTERN.sub(
            lambda m: cls._get_positional_arg(m, args_list),
            result
        )

        # 3. Replace environment variables
        result = cls.ENV_VAR_PATTERN.sub(
            lambda m: cls._get_env_var(m, session_id),
            result
        )

        # 4. Execute !`command` blocks asynchronously
        if execute_commands:
            commands = cls.COMMAND_PATTERN.findall(result)
            if commands:
                outputs = await asyncio.gather(*[
                    cls._execute_command_async(cmd, cwd)
                    for cmd in commands
                ])
                for cmd, output in zip(commands, outputs):
                    result = result.replace(f"!`{cmd}`", output, 1)

        return result

    @classmethod
    def _split_arguments(cls, arguments: str) -> list[str]:
        """Split arguments string into list.

        Handles quoted strings and escapes.

        Args:
            arguments: Arguments string

        Returns:
            List of argument strings
        """
        if not arguments:
            return []

        # Simple split by whitespace, respecting quotes
        args = []
        current = ""
        in_quotes = False
        quote_char = None

        for char in arguments:
            if char in ('"', "'") and not in_quotes:
                in_quotes = True
                quote_char = char
            elif char == quote_char and in_quotes:
                in_quotes = False
                quote_char = None
            elif char.isspace() and not in_quotes:
                if current:
                    args.append(current)
                    current = ""
            else:
                current += char

        if current:
            args.append(current)

        return args

    @classmethod
    def _get_positional_arg(cls, match: re.Match, args: list[str]) -> str:
        """Get positional argument by index.

        Args:
            match: Regex match object
            args: List of arguments

        Returns:
            Argument value or empty string if out of range
        """
        # Group 1 is from $ARGUMENTS[N], group 2 is from $N
        index_str = match.group(1) or match.group(2)
        try:
            index = int(index_str)
            if 0 <= index < len(args):
                return args[index]
        except (ValueError, IndexError):
            pass
        return ""

    @classmethod
    def _get_env_var(cls, match: re.Match, session_id: str | None) -> str:
        """Get environment variable value.

        Args:
            match: Regex match object
            session_id: Current session ID

        Returns:
            Variable value or original placeholder if not found
        """
        var_name = match.group(1)

        # Special handling for CLAUDE_SESSION_ID
        if var_name == "CLAUDE_SESSION_ID":
            return session_id or ""

        # Check environment
        return os.environ.get(var_name, match.group(0))

    @classmethod
    def _execute_command(cls, command: str) -> str:
        """Execute a shell command synchronously.

        Args:
            command: Shell command to execute

        Returns:
            Command output or error message
        """
        try:
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=30,
            )
            output = result.stdout.strip()
            if result.returncode != 0 and result.stderr:
                output += f"\n[Error: {result.stderr.strip()}]"
            return output
        except subprocess.TimeoutExpired:
            return "[Command timed out after 30 seconds]"
        except Exception as e:
            logger.warning(f"Failed to execute command '{command}': {e}")
            return f"[Error executing command: {e}]"

    @classmethod
    async def _execute_command_async(
        cls,
        command: str,
        cwd: str | None = None,
    ) -> str:
        """Execute a shell command asynchronously.

        Args:
            command: Shell command to execute
            cwd: Working directory

        Returns:
            Command output or error message
        """
        try:
            proc = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd,
            )

            try:
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(),
                    timeout=30,
                )
            except asyncio.TimeoutError:
                proc.kill()
                return "[Command timed out after 30 seconds]"

            output = stdout.decode().strip()
            if proc.returncode != 0 and stderr:
                output += f"\n[Error: {stderr.decode().strip()}]"
            return output

        except Exception as e:
            logger.warning(f"Failed to execute command '{command}': {e}")
            return f"[Error executing command: {e}]"
