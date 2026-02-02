"""Tests for CLI utility functions."""

import pytest
from click.testing import CliRunner

from src.cli.utils import (
    format_code_block,
    format_error,
    format_info,
    format_json,
    format_key_value,
    format_list,
    format_section,
    format_stream,
    format_success,
    format_table,
    format_warning,
)


class TestFormatting:
    """Test CLI formatting functions."""
    
    def test_format_table_simple(self, capsys):
        """Test simple table formatting."""
        headers = ["Name", "Age", "City"]
        rows = [
            ["Alice", "30", "NYC"],
            ["Bob", "25", "LA"],
        ]
        
        format_table(headers, rows, style="simple")
        captured = capsys.readouterr()
        
        assert "Name" in captured.out
        assert "Age" in captured.out
        assert "City" in captured.out
        assert "Alice" in captured.out
        assert "Bob" in captured.out
    
    def test_format_table_grid(self, capsys):
        """Test grid table formatting."""
        headers = ["ID", "Status"]
        rows = [["1", "Active"]]
        
        format_table(headers, rows, style="grid")
        captured = capsys.readouterr()
        
        assert "┌" in captured.out
        assert "│" in captured.out
        assert "└" in captured.out
    
    def test_format_table_minimal(self, capsys):
        """Test minimal table formatting."""
        headers = ["A", "B"]
        rows = [["1", "2"]]
        
        format_table(headers, rows, style="minimal")
        captured = capsys.readouterr()
        
        assert "A" in captured.out
        assert "B" in captured.out
    
    def test_format_table_empty(self, capsys):
        """Test table formatting with no rows."""
        headers = ["Name"]
        rows = []
        
        format_table(headers, rows)
        captured = capsys.readouterr()
        
        # Should not output anything for empty table
        assert captured.out == ""
    
    def test_format_stream_text(self, capsys):
        """Test streaming text response."""
        response = {
            "type": "text",
            "content": "Hello world",
        }
        
        format_stream(response)
        captured = capsys.readouterr()
        
        assert "Hello world" in captured.out
    
    def test_format_stream_tool_call(self, capsys):
        """Test streaming tool call response."""
        response = {
            "type": "tool_call",
            "content": {
                "name": "read_file",
                "arguments": {"path": "test.py"},
            },
        }
        
        format_stream(response)
        captured = capsys.readouterr()
        
        assert "read_file" in captured.out
        assert "path" in captured.out
    
    def test_format_stream_tool_result(self, capsys):
        """Test streaming tool result response."""
        response = {
            "type": "tool_result",
            "content": {
                "output": "File contents here",
            },
        }
        
        format_stream(response)
        captured = capsys.readouterr()
        
        assert "Result" in captured.out
    
    def test_format_stream_error(self, capsys):
        """Test streaming error response."""
        response = {
            "type": "error",
            "content": "Something went wrong",
        }
        
        format_stream(response)
        captured = capsys.readouterr()
        
        assert "Error" in captured.err
        assert "Something went wrong" in captured.err
    
    def test_format_error(self, capsys):
        """Test error formatting."""
        error = ValueError("Test error")
        
        format_error(error)
        captured = capsys.readouterr()
        
        assert "ValueError" in captured.err
        assert "Test error" in captured.err
    
    def test_format_success(self, capsys):
        """Test success message formatting."""
        format_success("Operation completed")
        captured = capsys.readouterr()
        
        assert "Operation completed" in captured.out
    
    def test_format_warning(self, capsys):
        """Test warning message formatting."""
        format_warning("Be careful")
        captured = capsys.readouterr()
        
        assert "Be careful" in captured.err
    
    def test_format_info(self, capsys):
        """Test info message formatting."""
        format_info("Information")
        captured = capsys.readouterr()
        
        assert "Information" in captured.out
    
    def test_format_list(self, capsys):
        """Test list formatting."""
        items = ["Item 1", "Item 2", "Item 3"]
        
        format_list(items)
        captured = capsys.readouterr()
        
        assert "Item 1" in captured.out
        assert "Item 2" in captured.out
        assert "Item 3" in captured.out
    
    def test_format_key_value(self, capsys):
        """Test key-value formatting."""
        format_key_value("Name", "Alice")
        captured = capsys.readouterr()
        
        assert "Name" in captured.out
        assert "Alice" in captured.out
    
    def test_format_section(self, capsys):
        """Test section formatting."""
        format_section("Section Title", "Section content")
        captured = capsys.readouterr()
        
        assert "Section Title" in captured.out
        assert "Section content" in captured.out
    
    def test_format_json(self, capsys):
        """Test JSON formatting."""
        data = {"key": "value", "number": 42}
        
        format_json(data)
        captured = capsys.readouterr()
        
        assert "key" in captured.out
        assert "value" in captured.out
        assert "42" in captured.out
    
    def test_format_code_block(self, capsys):
        """Test code block formatting."""
        code = "def hello():\n    print('Hello')"
        
        format_code_block(code, "python")
        captured = capsys.readouterr()
        
        assert "```python" in captured.out
        assert "def hello()" in captured.out
        assert "```" in captured.out
