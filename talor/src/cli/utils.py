"""Utility functions for CLI commands."""

import asyncio
import functools
import sys
from typing import Any, Callable

import click


def async_command(func: Callable) -> Callable:
    """Decorator to run async Click commands.
    
    This allows Click commands to be defined as async functions.
    """
    @functools.wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        return asyncio.run(func(*args, **kwargs))
    
    return wrapper


def format_error(error: Exception, show_traceback: bool = False) -> None:
    """Format and display an error message.
    
    Args:
        error: The exception to format
        show_traceback: Whether to show the full traceback
    """
    import traceback
    
    error_type = type(error).__name__
    error_msg = str(error)
    
    # Display error with styling
    click.echo(click.style(f"✗ Error ({error_type})", fg="red", bold=True), err=True)
    click.echo(f"  {error_msg}", err=True)
    
    # Show traceback if requested
    if show_traceback:
        click.echo("\nTraceback:", err=True)
        click.echo(traceback.format_exc(), err=True)


def format_stream(response: dict[str, Any]) -> None:
    """Format and display a streaming agent response.
    
    Args:
        response: The response dictionary from the agent
    """
    response_type = response.get("type")
    content = response.get("content")
    metadata = response.get("metadata", {})
    
    if response_type == "text":
        # Stream text tokens
        click.echo(content, nl=False)
        sys.stdout.flush()
    
    elif response_type == "tool_call":
        # Display tool call with styling
        tool_name = content.get("name", "unknown")
        arguments = content.get("arguments", {})
        
        click.echo("\n")
        click.echo(click.style(f"🔧 Tool Call: {tool_name}", fg="cyan", bold=True))
        
        # Show arguments if present
        if arguments:
            click.echo(click.style("   Arguments:", fg="cyan"))
            for key, value in arguments.items():
                # Truncate long values
                value_str = str(value)
                if len(value_str) > 100:
                    value_str = value_str[:97] + "..."
                click.echo(f"     {key}: {value_str}")
    
    elif response_type == "tool_result":
        # Display tool result
        output = content.get("output", "")
        error = content.get("error")
        
        if error:
            click.echo(click.style(f"   ✗ Error: {error}", fg="red"))
        else:
            # Truncate long output
            output_str = str(output)
            if len(output_str) > 200:
                output_str = output_str[:197] + "..."
            click.echo(click.style(f"   ✓ Result: {output_str}", fg="green"))
        click.echo()
    
    elif response_type == "error":
        # Display error
        click.echo("\n")
        click.echo(click.style(f"✗ Error: {content}", fg="red", bold=True), err=True)
        click.echo()
    
    elif response_type == "thinking":
        # Display thinking/reasoning
        click.echo(click.style(f"\n💭 {content}", fg="yellow"))
    
    elif response_type == "done":
        # Response complete
        click.echo("\n")
        if metadata.get("token_count"):
            click.echo(click.style(
                f"Tokens used: {metadata['token_count']}",
                fg="blue",
                dim=True
            ))


def format_table(
    headers: list[str],
    rows: list[list[str]],
    style: str = "simple"
) -> None:
    """Format and display data as a table.
    
    Args:
        headers: List of column headers
        rows: List of rows, where each row is a list of cell values
        style: Table style ('simple', 'grid', or 'minimal')
    """
    if not rows:
        return
    
    # Calculate column widths
    col_widths = [len(h) for h in headers]
    
    for row in rows:
        for i, cell in enumerate(row):
            if i < len(col_widths):
                col_widths[i] = max(col_widths[i], len(str(cell)))
    
    if style == "grid":
        # Grid style with borders
        top_border = "┌" + "┬".join("─" * (w + 2) for w in col_widths) + "┐"
        separator = "├" + "┼".join("─" * (w + 2) for w in col_widths) + "┤"
        bottom_border = "└" + "┴".join("─" * (w + 2) for w in col_widths) + "┘"
        
        click.echo(top_border)
        
        # Header
        header_line = "│ " + " │ ".join(
            click.style(h.ljust(w), bold=True) for h, w in zip(headers, col_widths)
        ) + " │"
        click.echo(header_line)
        click.echo(separator)
        
        # Rows
        for row in rows:
            row_line = "│ " + " │ ".join(
                str(cell).ljust(w) for cell, w in zip(row, col_widths)
            ) + " │"
            click.echo(row_line)
        
        click.echo(bottom_border)
    
    elif style == "minimal":
        # Minimal style with no borders
        header_line = "  ".join(
            click.style(h.ljust(w), bold=True) for h, w in zip(headers, col_widths)
        )
        click.echo(header_line)
        
        for row in rows:
            row_line = "  ".join(
                str(cell).ljust(w) for cell, w in zip(row, col_widths)
            )
            click.echo(row_line)
    
    else:
        # Simple style (default)
        header_line = " | ".join(
            click.style(h.ljust(w), bold=True) for h, w in zip(headers, col_widths)
        )
        separator = "-+-".join("-" * w for w in col_widths)
        
        click.echo(header_line)
        click.echo(separator)
        
        for row in rows:
            row_line = " | ".join(
                str(cell).ljust(w) for cell, w in zip(row, col_widths)
            )
            click.echo(row_line)


def format_success(message: str) -> None:
    """Format and display a success message.
    
    Args:
        message: The success message to display
    """
    click.echo(click.style(f"✓ {message}", fg="green"))


def format_warning(message: str) -> None:
    """Format and display a warning message.
    
    Args:
        message: The warning message to display
    """
    click.echo(click.style(f"⚠ {message}", fg="yellow"), err=True)


def format_info(message: str) -> None:
    """Format and display an info message.
    
    Args:
        message: The info message to display
    """
    click.echo(click.style(f"ℹ {message}", fg="blue"))


def format_progress(message: str) -> None:
    """Format and display a progress message.
    
    Args:
        message: The progress message to display
    """
    click.echo(f"⋯ {message}")


def format_json(data: Any, indent: int = 2) -> None:
    """Format and display JSON data.
    
    Args:
        data: The data to format as JSON
        indent: Number of spaces for indentation
    """
    import json
    click.echo(json.dumps(data, indent=indent, default=str))


def format_list(items: list[str], bullet: str = "•") -> None:
    """Format and display a list of items.
    
    Args:
        items: List of items to display
        bullet: Bullet character to use
    """
    for item in items:
        click.echo(f"{bullet} {item}")


def format_key_value(key: str, value: Any, indent: int = 0) -> None:
    """Format and display a key-value pair.
    
    Args:
        key: The key to display
        value: The value to display
        indent: Number of spaces to indent
    """
    indent_str = " " * indent
    click.echo(f"{indent_str}{click.style(key, bold=True)}: {value}")


def format_section(title: str, content: str | None = None) -> None:
    """Format and display a section with a title.
    
    Args:
        title: The section title
        content: Optional content to display below the title
    """
    click.echo(click.style(f"\n{title}", bold=True, underline=True))
    if content:
        click.echo(content)


def format_code_block(code: str, language: str = "") -> None:
    """Format and display a code block.
    
    Args:
        code: The code to display
        language: Optional language identifier
    """
    if language:
        click.echo(f"```{language}")
    else:
        click.echo("```")
    click.echo(code)
    click.echo("```")


def format_spinner(message: str) -> None:
    """Display a spinner with a message (for long-running operations).
    
    Args:
        message: The message to display with the spinner
    """
    # Simple text-based spinner
    click.echo(f"⏳ {message}...", nl=False)
    sys.stdout.flush()


def clear_line() -> None:
    """Clear the current line in the terminal."""
    click.echo("\r\033[K", nl=False)
    sys.stdout.flush()
