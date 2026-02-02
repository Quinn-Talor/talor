"""Main CLI entry point for Talor."""

import sys
from pathlib import Path
from typing import Optional

import click

from talor.cli.commands import config, mcp, serve


@click.group()
@click.version_option(version="0.1.0")
@click.option(
    "--workspace",
    type=click.Path(exists=True, file_okay=False, dir_okay=True, path_type=Path),
    default=None,
    help="Workspace directory (defaults to current directory)",
)
@click.option(
    "--config",
    type=click.Path(exists=True, file_okay=True, dir_okay=False, path_type=Path),
    default=None,
    help="Configuration file path",
)
@click.option(
    "--log-level",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"], case_sensitive=False),
    default="INFO",
    help="Logging level",
)
@click.pass_context
def cli(
    ctx: click.Context,
    workspace: Optional[Path],
    config: Optional[Path],
    log_level: str,
) -> None:
    """Talor - AI-powered coding assistant.
    
    A Python reimplementation of opencode with MCP integration and multi-provider LLM support.
    """
    # Ensure context object exists
    ctx.ensure_object(dict)
    
    # Store global options in context
    ctx.obj["workspace"] = workspace or Path.cwd()
    ctx.obj["config"] = config
    ctx.obj["log_level"] = log_level


# Register command groups
cli.add_command(serve.serve)
cli.add_command(config.config_cmd)
cli.add_command(mcp.mcp_cmd)


def main() -> None:
    """Main entry point for the CLI."""
    try:
        cli(obj={})
    except KeyboardInterrupt:
        click.echo("\nInterrupted by user", err=True)
        sys.exit(130)
    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
