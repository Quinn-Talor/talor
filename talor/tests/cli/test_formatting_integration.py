"""Integration tests for CLI formatting utilities."""

import pytest

from src.cli.utils import (
    format_error,
    format_stream,
    format_success,
    format_table,
    format_warning,
)


class TestFormattingIntegration:
    """Test CLI formatting utilities in realistic scenarios."""
    
    def test_session_list_formatting(self, capsys):
        """Test formatting session list output."""
        headers = ["ID", "Created", "Updated", "Messages", "Title"]
        rows = [
            ["01HQXYZ123...", "2024-01-15 10:30", "2024-01-15 11:45", "12", "Debug session"],
            ["01HQXYZ456...", "2024-01-14 09:00", "2024-01-14 09:30", "5", "Feature work"],
            ["01HQXYZ789...", "2024-01-13 14:20", "2024-01-13 15:10", "8", "(untitled)"],
        ]
        
        format_table(headers, rows)
        captured = capsys.readouterr()
        
        # Verify all data is present
        assert "ID" in captured.out
        assert "Created" in captured.out
        assert "Debug session" in captured.out
        assert "Feature work" in captured.out
        assert "12" in captured.out
    
    def test_model_list_formatting(self, capsys):
        """Test formatting model list output."""
        headers = ["Provider", "Model", "Default"]
        rows = [
            ["openai", "gpt-4", "✓"],
            ["openai", "gpt-3.5-turbo", ""],
            ["anthropic", "claude-3-opus", ""],
            ["anthropic", "claude-3-sonnet", ""],
        ]
        
        format_table(headers, rows, style="grid")
        captured = capsys.readouterr()
        
        # Verify grid style is used
        assert "┌" in captured.out
        assert "│" in captured.out
        assert "gpt-4" in captured.out
        assert "claude-3-opus" in captured.out
    
    def test_agent_streaming_workflow(self, capsys):
        """Test complete agent streaming workflow."""
        # Simulate agent streaming responses
        responses = [
            {"type": "text", "content": "I'll help you "},
            {"type": "text", "content": "read that file."},
            {
                "type": "tool_call",
                "content": {
                    "name": "read_file",
                    "arguments": {"path": "README.md"},
                },
            },
            {
                "type": "tool_result",
                "content": {
                    "output": "# Project Title\n\nThis is the README...",
                },
            },
            {"type": "text", "content": "Here's what I found: "},
            {"type": "text", "content": "The README contains..."},
            {
                "type": "done",
                "content": "",
                "metadata": {"token_count": 150},
            },
        ]
        
        for response in responses:
            format_stream(response)
        
        captured = capsys.readouterr()
        
        # Verify streaming output
        assert "I'll help you" in captured.out
        assert "read_file" in captured.out
        assert "README.md" in captured.out
        assert "Result" in captured.out
        assert "Tokens used: 150" in captured.out
    
    def test_error_handling_workflow(self, capsys):
        """Test error handling and formatting."""
        # Simulate various error scenarios
        errors = [
            ValueError("Invalid configuration"),
            FileNotFoundError("Config file not found"),
            RuntimeError("Connection failed"),
        ]
        
        for error in errors:
            format_error(error)
        
        captured = capsys.readouterr()
        
        # Verify all errors are formatted
        assert "ValueError" in captured.err
        assert "Invalid configuration" in captured.err
        assert "FileNotFoundError" in captured.err
        assert "Config file not found" in captured.err
        assert "RuntimeError" in captured.err
        assert "Connection failed" in captured.err
    
    def test_mixed_message_types(self, capsys):
        """Test formatting mixed message types."""
        format_success("Operation completed successfully")
        format_warning("This action cannot be undone")
        format_error(Exception("Something went wrong"))
        
        captured = capsys.readouterr()
        
        # Verify all message types are present
        assert "Operation completed successfully" in captured.out
        assert "This action cannot be undone" in captured.err
        assert "Something went wrong" in captured.err
    
    def test_mcp_server_list_formatting(self, capsys):
        """Test formatting MCP server list output."""
        headers = ["Name", "Command", "Status", "Tools"]
        rows = [
            ["filesystem", "uvx", "connected", "7"],
            ["github", "python", "connected", "12"],
            ["database", "node", "disconnected", "0"],
        ]
        
        format_table(headers, rows, style="simple")
        captured = capsys.readouterr()
        
        # Verify server information
        assert "filesystem" in captured.out
        assert "github" in captured.out
        assert "connected" in captured.out
        assert "disconnected" in captured.out
    
    def test_empty_list_handling(self, capsys):
        """Test handling of empty lists."""
        headers = ["Name", "Value"]
        rows = []
        
        format_table(headers, rows)
        captured = capsys.readouterr()
        
        # Should not output anything for empty table
        assert captured.out == ""
    
    def test_long_content_truncation(self, capsys):
        """Test truncation of long content in streaming."""
        # Tool call with very long arguments
        response = {
            "type": "tool_call",
            "content": {
                "name": "write_file",
                "arguments": {
                    "path": "test.py",
                    "content": "x" * 200,  # Very long content
                },
            },
        }
        
        format_stream(response)
        captured = capsys.readouterr()
        
        # Verify truncation occurs
        assert "write_file" in captured.out
        assert "..." in captured.out  # Truncation indicator
    
    def test_tool_result_with_error(self, capsys):
        """Test formatting tool result with error."""
        response = {
            "type": "tool_result",
            "content": {
                "output": "",
                "error": "Permission denied: Cannot write to /etc/passwd",
            },
        }
        
        format_stream(response)
        captured = capsys.readouterr()
        
        # Verify error is displayed
        assert "Error" in captured.out
        assert "Permission denied" in captured.out
