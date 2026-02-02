"""Tool Definition for Talor.

This module provides the Tool namespace for defining tools
that agents can use during the ReAct cycle.

Example:
    ```python
    from src.tool import Tool
    from pydantic import BaseModel

    class ReadParams(BaseModel):
        file_path: str
        offset: int = 0

    async def read_handler(params: ReadParams, ctx: Tool.Context) -> Tool.Output:
        content = await read_file(params.file_path)
        return Tool.Output(title=f"Read {params.file_path}", output=content)

    ReadTool = Tool.define(
        "read",
        description="Read file content",
        parameters=ReadParams,
        execute=read_handler,
    )
    ```
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Generic, TypeVar, TYPE_CHECKING

from pydantic import BaseModel, ValidationError

from src.tool.context import ToolContext
from src.tool.output import ToolOutput


logger = logging.getLogger(__name__)


# Type variable for parameters
P = TypeVar("P", bound=BaseModel)


@dataclass
class ToolInfo(Generic[P]):
    """Tool information and implementation.

    Defines a tool that can be used by agents during the ReAct cycle.

    Attributes:
        id: Tool unique identifier
        description: Tool description for LLM
        parameters: Pydantic model class for parameters
        execute: Async function to execute the tool
        format_validation_error: Optional custom error formatter
    """

    id: str
    description: str
    parameters: type[P]
    execute: Callable[[P, ToolContext], Awaitable[ToolOutput]]
    format_validation_error: Callable[[ValidationError], str] | None = None

    def get_parameters_schema(self) -> dict[str, Any]:
        """Get JSON Schema for parameters.

        Returns:
            JSON Schema dictionary
        """
        return self.parameters.model_json_schema()

    async def __call__(self, args: dict[str, Any], ctx: ToolContext) -> ToolOutput:
        """Execute the tool with validation.

        Args:
            args: Raw arguments dictionary
            ctx: Tool execution context

        Returns:
            ToolOutput with result

        Raises:
            ValueError: If validation fails
        """
        # Validate arguments using Pydantic
        try:
            validated = self.parameters.model_validate(args)
        except ValidationError as e:
            if self.format_validation_error:
                raise ValueError(self.format_validation_error(e)) from e
            raise ValueError(
                f"The {self.id} tool was called with invalid arguments: {e}.\n"
                "Please rewrite the input so it satisfies the expected schema."
            ) from e

        # Execute tool
        return await self.execute(validated, ctx)


class Tool:
    """Tool namespace providing factory methods.

    Provides methods for defining and creating tools.

    Usage:
        ```python
        # Simple definition
        MyTool = Tool.define(
            "my_tool",
            description="Does something",
            parameters=MyParams,
            execute=my_handler,
        )

        # With init function (for dynamic description)
        MyTool = await Tool.define_async(
            "my_tool",
            init=my_init_function,
        )
        ```
    """

    # Type aliases for convenience
    Context = ToolContext
    Output = ToolOutput
    Info = ToolInfo

    @staticmethod
    def define(
        id: str,
        description: str | None = None,
        parameters: type[BaseModel] | None = None,
        execute: Callable[[Any, ToolContext], Awaitable[ToolOutput]] | None = None,
        init: ToolInfo | None = None,
        format_validation_error: Callable[[ValidationError], str] | None = None,
    ) -> ToolInfo:
        """Define a new tool.

        Two usage patterns:
        1. Direct definition with description, parameters, execute
        2. Pass a pre-built ToolInfo via init

        Args:
            id: Tool unique identifier
            description: Tool description (required if not using init)
            parameters: Pydantic model for parameters (required if not using init)
            execute: Async execute function (required if not using init)
            init: Optional pre-built ToolInfo
            format_validation_error: Optional custom validation error formatter

        Returns:
            ToolInfo instance

        Raises:
            ValueError: If required arguments are missing
        """
        if init is not None:
            return init

        # Direct definition
        if description is None:
            raise ValueError("description is required when not using init")
        if parameters is None:
            raise ValueError("parameters is required when not using init")
        if execute is None:
            raise ValueError("execute is required when not using init")

        return ToolInfo(
            id=id,
            description=description,
            parameters=parameters,
            execute=execute,
            format_validation_error=format_validation_error,
        )

    @staticmethod
    async def define_async(
        id: str,
        init: Callable[[], Awaitable[ToolInfo]],
    ) -> ToolInfo:
        """Define a tool with async initialization.

        Used when tool description or parameters need async computation.

        Args:
            id: Tool unique identifier
            init: Async function returning ToolInfo

        Returns:
            ToolInfo instance
        """
        return await init()

    @staticmethod
    def from_function(
        id: str,
        description: str,
        func: Callable[..., Awaitable[str]],
        parameters: type[BaseModel],
    ) -> ToolInfo:
        """Create a tool from a simple async function.

        Convenience method for functions that just return a string.

        Args:
            id: Tool unique identifier
            description: Tool description
            func: Async function that takes params and returns string
            parameters: Pydantic model for parameters

        Returns:
            ToolInfo instance
        """
        async def execute(params: BaseModel, ctx: ToolContext) -> ToolOutput:
            result = await func(**params.model_dump())
            return ToolOutput(title="", output=result)

        return ToolInfo(
            id=id,
            description=description,
            parameters=parameters,
            execute=execute,
        )
