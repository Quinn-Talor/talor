"""Tests for CLI structure and command availability."""

import pytest
from click.testing import CliRunner

from talor.cli.main import cli


class TestCLIStructure:
    """Test CLI command structure and availability."""
    
    def test_cli_help(self):
        """Test that CLI help is displayed correctly."""
        runner = CliRunner()
        result = runner.invoke(cli, ["--help"])
        
        assert result.exit_code == 0
        assert "Talor - AI-powered coding assistant" in result.output
        assert "Commands:" in result.output
    
    def test_cli_version(self):
        """Test that CLI version is displayed."""
        runner = CliRunner()
        result = runner.invoke(cli, ["--version"])
        
        assert result.exit_code == 0
        assert "0.1.0" in result.output
    
    def test_run_command_exists(self):
        """Test that run command exists."""
        runner = CliRunner()
        result = runner.invoke(cli, ["run", "--help"])
        
        assert result.exit_code == 0
        assert "Execute a prompt with the AI agent" in result.output
    
    def test_serve_command_exists(self):
        """Test that serve command exists."""
        runner = CliRunner()
        result = runner.invoke(cli, ["serve", "--help"])
        
        assert result.exit_code == 0
        assert "Start the backend server" in result.output
    
    def test_auth_command_group_exists(self):
        """Test that auth command group exists."""
        runner = CliRunner()
        result = runner.invoke(cli, ["auth", "--help"])
        
        assert result.exit_code == 0
        assert "Manage authentication" in result.output
        assert "login" in result.output
        assert "logout" in result.output
    
    def test_session_command_group_exists(self):
        """Test that session command group exists."""
        runner = CliRunner()
        result = runner.invoke(cli, ["session", "--help"])
        
        assert result.exit_code == 0
        assert "Manage conversation sessions" in result.output
        assert "list" in result.output
        assert "show" in result.output
        assert "delete" in result.output
        assert "export" in result.output
        assert "import" in result.output
    
    def test_mcp_command_group_exists(self):
        """Test that mcp command group exists."""
        runner = CliRunner()
        result = runner.invoke(cli, ["mcp", "--help"])
        
        assert result.exit_code == 0
        assert "Manage MCP servers" in result.output
        assert "list" in result.output
        assert "add" in result.output
        assert "remove" in result.output
    
    def test_models_command_group_exists(self):
        """Test that models command group exists."""
        runner = CliRunner()
        result = runner.invoke(cli, ["models", "--help"])
        
        assert result.exit_code == 0
        assert "Manage LLM models" in result.output
        assert "list" in result.output
    
    def test_config_command_group_exists(self):
        """Test that config command group exists."""
        runner = CliRunner()
        result = runner.invoke(cli, ["config", "--help"])
        
        assert result.exit_code == 0
        assert "Manage configuration" in result.output
        assert "show" in result.output
        assert "set" in result.output
    
    def test_global_options(self):
        """Test that global options are available."""
        runner = CliRunner()
        result = runner.invoke(cli, ["--help"])
        
        assert result.exit_code == 0
        assert "--workspace" in result.output
        assert "--config" in result.output
        assert "--log-level" in result.output
