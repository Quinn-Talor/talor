"""Tests for the error class hierarchy."""

import pytest

from talor.core.errors import (
    ConfigError,
    FileSystemError,
    LSPError,
    MCPError,
    PTYError,
    PermissionError,
    ProviderError,
    StorageError,
    TalorError,
)


def test_talor_error_basic():
    """Test basic TalorError creation and string representation."""
    error = TalorError("Something went wrong")
    assert error.message == "Something went wrong"
    assert error.context == {}
    assert str(error) == "Something went wrong"


def test_talor_error_with_context():
    """Test TalorError with context information."""
    context = {"file": "test.py", "line": 42}
    error = TalorError("Parse error", context=context)
    
    assert error.message == "Parse error"
    assert error.context == context
    assert "file=test.py" in str(error)
    assert "line=42" in str(error)


def test_config_error_inheritance():
    """Test ConfigError inherits from TalorError."""
    error = ConfigError("Invalid config")
    assert isinstance(error, TalorError)
    assert isinstance(error, ConfigError)
    assert error.message == "Invalid config"


def test_storage_error_inheritance():
    """Test StorageError inherits from TalorError."""
    error = StorageError("Database locked")
    assert isinstance(error, TalorError)
    assert isinstance(error, StorageError)


def test_provider_error_inheritance():
    """Test ProviderError inherits from TalorError."""
    error = ProviderError("API key invalid")
    assert isinstance(error, TalorError)
    assert isinstance(error, ProviderError)


def test_mcp_error_inheritance():
    """Test MCPError inherits from TalorError."""
    error = MCPError("Server disconnected")
    assert isinstance(error, TalorError)
    assert isinstance(error, MCPError)


def test_lsp_error_inheritance():
    """Test LSPError inherits from TalorError."""
    error = LSPError("Language server crashed")
    assert isinstance(error, TalorError)
    assert isinstance(error, LSPError)


def test_permission_error_inheritance():
    """Test PermissionError inherits from TalorError."""
    error = PermissionError("Access denied")
    assert isinstance(error, TalorError)
    assert isinstance(error, PermissionError)


def test_filesystem_error_inheritance():
    """Test FileSystemError inherits from TalorError."""
    error = FileSystemError("File not found")
    assert isinstance(error, TalorError)
    assert isinstance(error, FileSystemError)


def test_pty_error_inheritance():
    """Test PTYError inherits from TalorError."""
    error = PTYError("Process failed")
    assert isinstance(error, TalorError)
    assert isinstance(error, PTYError)


def test_error_can_be_raised():
    """Test that errors can be raised and caught."""
    with pytest.raises(TalorError) as exc_info:
        raise TalorError("Test error")
    
    assert exc_info.value.message == "Test error"


def test_specific_error_can_be_caught_as_base():
    """Test that specific errors can be caught as TalorError."""
    with pytest.raises(TalorError):
        raise ConfigError("Config error")


def test_error_context_preserved():
    """Test that error context is preserved when raised."""
    context = {"operation": "read", "path": "/test/file.txt"}
    
    with pytest.raises(FileSystemError) as exc_info:
        raise FileSystemError("Cannot read file", context=context)
    
    assert exc_info.value.context == context
    assert exc_info.value.context["operation"] == "read"
    assert exc_info.value.context["path"] == "/test/file.txt"
