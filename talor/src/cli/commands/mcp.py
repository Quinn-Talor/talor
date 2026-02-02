"""MCP CLI commands for Talor."""

import asyncio
from typing import Optional

import click


@click.group(name="mcp")
def mcp_cmd() -> None:
    """Manage MCP servers.
    
    Commands for managing Model Context Protocol (MCP) server connections.
    """
    pass


@mcp_cmd.command(name="list")
@click.pass_context
def list_servers(ctx: click.Context) -> None:
    """List all configured MCP servers."""
    from talor.mcp import MCP
    
    async def _list() -> None:
        servers = await MCP.list_servers()
        if not servers:
            click.echo("No MCP servers configured.")
            return
        
        click.echo("MCP Servers:")
        for server in servers:
            status = server["status"]["status"]
            tools = server["tools_count"]
            click.echo(f"  {server['name']}: {status} ({tools} tools)")
    
    asyncio.run(_list())


@mcp_cmd.command(name="add")
@click.argument("name")
@click.option("--command", "-c", required=True, help="Command to run the MCP server")
@click.option("--args", "-a", multiple=True, help="Arguments for the command")
@click.option("--url", "-u", help="URL for SSE/HTTP transport")
@click.option("--transport", "-t", type=click.Choice(["stdio", "sse", "http"]), default="stdio")
@click.pass_context
def add_server(
    ctx: click.Context,
    name: str,
    command: Optional[str],
    args: tuple[str, ...],
    url: Optional[str],
    transport: str,
) -> None:
    """Add a new MCP server configuration."""
    from talor.mcp import MCP, MCPServerConfig, MCPTransport
    
    async def _add() -> None:
        config = MCPServerConfig(
            transport=MCPTransport(transport),
            command=command,
            args=list(args),
            url=url,
        )
        status = await MCP.connect(name, config)
        click.echo(f"Server '{name}' added: {status.status}")
    
    asyncio.run(_add())


@mcp_cmd.command(name="remove")
@click.argument("name")
@click.pass_context
def remove_server(ctx: click.Context, name: str) -> None:
    """Remove an MCP server configuration."""
    from talor.mcp import MCP
    
    async def _remove() -> None:
        await MCP.disconnect(name)
        click.echo(f"Server '{name}' removed.")
    
    asyncio.run(_remove())


@mcp_cmd.command(name="tools")
@click.option("--server", "-s", help="Filter by server name")
@click.pass_context
def list_tools(ctx: click.Context, server: Optional[str]) -> None:
    """List available tools from MCP servers."""
    from talor.mcp import MCP
    
    async def _tools() -> None:
        tools = await MCP.tools(server)
        if not tools:
            click.echo("No tools available.")
            return
        
        click.echo("Available Tools:")
        for tool in tools:
            click.echo(f"  [{tool.server}] {tool.name}: {tool.description}")
    
    asyncio.run(_tools())
