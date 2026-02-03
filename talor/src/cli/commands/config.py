"""Config command group - Configuration management."""

import asyncio
import json

import click

from src.cli.utils import async_command, format_error
from src.core.config import ConfigManager
from src.core.logging import Logger

logger = Logger(__name__)


@click.group(name="config")
def config_cmd() -> None:
    """Manage configuration.

    Commands for viewing and modifying configuration settings.
    """
    pass


@config_cmd.command()
@click.option(
    "--format",
    "output_format",
    type=click.Choice(["json"]),
    default="json",
    help="Output format (default: json)",
)
@click.pass_context
@async_command
async def show(ctx: click.Context, output_format: str) -> None:
    """Show current configuration.

    Examples:

        talor config show
    """
    config_path = ctx.obj["config"]

    try:
        config_manager = ConfigManager(config_path)
        await config_manager.load()

        config_dict = config_manager.config.model_dump()
        click.echo(json.dumps(config_dict, indent=2, default=str))

    except Exception as e:
        format_error(e)
        raise click.Abort()


@config_cmd.command()
@click.argument("key", required=True)
@click.argument("value", required=True)
@click.pass_context
@async_command
async def set(ctx: click.Context, key: str, value: str) -> None:
    """Set a configuration value.

    The key should be in dot notation (e.g., logging.level).
    The value will be parsed as JSON if possible, otherwise treated as a string.

    Examples:

        talor config set logging.level INFO

        talor config set storage.database_path /path/to/db.sqlite
    """
    config_path = ctx.obj["config"]

    try:
        config_manager = ConfigManager(config_path)
        await config_manager.load()

        # Try to parse value as JSON
        try:
            parsed_value = json.loads(value)
        except json.JSONDecodeError:
            parsed_value = value

        # Set the value
        await config_manager.set(key, parsed_value)

        click.echo(f"✓ Configuration updated: {key} = {parsed_value}")

    except Exception as e:
        format_error(e)
        raise click.Abort()
