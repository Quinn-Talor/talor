"""MCP Tool Integration for Talor."""

from __future__ import annotations

import json
import logging
from typing import Any

from pydantic import BaseModel

from src.tool.tool import ToolInfo
from src.tool.output import ToolOutput
from src.tool import ToolRegistry
from src.mcp_client import MCP


logger = logging.getLogger(__name__)


class MCPToolInfo(ToolInfo):
    """ToolInfo subclass for MCP tools with custom JSON schema."""

    def __init__(self, json_schema: dict, **kwargs):
        super().__init__(**kwargs)
        self._json_schema = json_schema

    def get_parameters_schema(self) -> dict:
        """Return the MCP tool's JSON schema directly."""
        schema = self._json_schema.copy()
        schema.setdefault("type", "object")
        schema.setdefault("properties", {})
        schema["additionalProperties"] = False
        return schema

    async def __call__(self, args: dict, ctx: Any) -> ToolOutput:
        """Execute the MCP tool without strict Pydantic validation."""
        class SimpleParams:
            def model_dump(self, **kwargs):
                return args
        return await self.execute(SimpleParams(), ctx)


async def register_mcp_tools(registry: ToolRegistry) -> None:
    """Register MCP tools to the ToolRegistry."""
    mcp_tools = await MCP.tools()

    for mcp_tool in mcp_tools:
        server_name = mcp_tool.server
        tool_name = mcp_tool.name

        class MCPParams(BaseModel):
            class Config:
                extra = "allow"

        _server = server_name
        _tool = tool_name

        async def execute_mcp_tool(
            params: MCPParams,
            ctx: Any,
            server: str = _server,
            tool: str = _tool,
        ) -> ToolOutput:
            """Execute MCP tool."""
            try:
                args = params.model_dump(exclude_unset=True)
                result = await MCP.call_tool(server, tool, args)

                if isinstance(result, list):
                    output_parts = []
                    for item in result:
                        if isinstance(item, dict):
                            if item.get("type") == "text":
                                output_parts.append(item.get("text", ""))
                            else:
                                output_parts.append(str(item))
                        else:
                            output_parts.append(str(item))
                    output = "\n".join(output_parts)
                elif isinstance(result, dict):
                    output = json.dumps(result, indent=2)
                else:
                    output = str(result)

                return ToolOutput(
                    title=f"MCP: {tool}",
                    output=output,
                    metadata={"server": server, "tool": tool},
                )
            except Exception as e:
                return ToolOutput(
                    title=f"MCP Error: {tool}",
                    output=f"Error: {str(e)}",
                    metadata={"server": server, "tool": tool, "error": True},
                )

        prefixed_name = f"mcp_{server_name}_{tool_name}"

        tool_info = MCPToolInfo(
            id=prefixed_name,
            description=mcp_tool.description or f"MCP tool: {tool_name} from {server_name}",
            parameters=MCPParams,
            execute=execute_mcp_tool,
            json_schema=mcp_tool.input_schema or {"type": "object", "properties": {}},
        )

        try:
            await registry.register(tool_info, source="mcp")
            logger.debug(f"Registered MCP tool: {prefixed_name}")
        except ValueError as e:
            logger.warning(f"Failed to register MCP tool {prefixed_name}: {e}")

    logger.info(f"Registered {len(mcp_tools)} MCP tools")
