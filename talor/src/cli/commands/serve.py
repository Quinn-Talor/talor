"""Serve command - Start the backend server for GUI access."""

import asyncio
from pathlib import Path

import click
import uvicorn

from src.cli.utils import async_command, format_error
from src.core.logging import Logger

logger = Logger(__name__)


@click.command()
@click.option(
    "--host",
    default="127.0.0.1",
    help="Host to bind to (default: 127.0.0.1)",
)
@click.option(
    "--port",
    default=8000,
    type=int,
    help="Port to bind to (default: 8000)",
)
@click.option(
    "--reload",
    is_flag=True,
    help="Enable auto-reload on code changes",
)
@click.pass_context
def serve(
    ctx: click.Context,
    host: str,
    port: int,
    reload: bool,
) -> None:
    """Start the backend server for GUI access.
    
    This starts a FastAPI server with WebSocket support for the React frontend.
    
    Examples:
    
        talor serve
        
        talor serve --host 0.0.0.0 --port 3000
        
        talor serve --reload  # Development mode with auto-reload
    """
    workspace: Path = ctx.obj["workspace"]
    config_path: Path | None = ctx.obj["config"]
    
    try:
        click.echo(f"Starting Talor server...")
        click.echo(f"Workspace: {workspace}")
        click.echo(f"Host: {host}")
        click.echo(f"Port: {port}")
        
        if reload:
            click.echo("Auto-reload: enabled")
        
        click.echo("\nServer will be available at:")
        click.echo(f"  http://{host}:{port}")
        click.echo("\nPress Ctrl+C to stop")
        
        # Start uvicorn server
        # Note: The actual FastAPI app will be implemented in task 21
        uvicorn.run(
            "talor.api.app:app",
            host=host,
            port=port,
            reload=reload,
            log_level="info",
        )
        
    except Exception as e:
        format_error(e)
        raise click.Abort()
