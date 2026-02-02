"""Error class hierarchy for Talor.

This module defines the base error classes and specific error types used throughout
the Talor system. All errors inherit from TalorError and include context information
for better debugging and error reporting.
"""


class TalorError(Exception):
    """Base error class for all Talor exceptions.
    
    All Talor errors should inherit from this class to provide consistent
    error handling and context information.
    
    Attributes:
        message: Human-readable error message
        context: Additional context information as a dictionary
    """
    
    def __init__(self, message: str, context: dict | None = None) -> None:
        """Initialize a TalorError.
        
        Args:
            message: Human-readable error message
            context: Optional dictionary with additional context information
        """
        self.message = message
        self.context = context or {}
        super().__init__(message)
    
    def __str__(self) -> str:
        """Return string representation of the error."""
        if self.context:
            context_str = ", ".join(f"{k}={v}" for k, v in self.context.items())
            return f"{self.message} ({context_str})"
        return self.message


class ConfigError(TalorError):
    """Configuration-related errors.
    
    Raised when there are issues with configuration loading, validation,
    or parsing.
    """
    pass


class StorageError(TalorError):
    """Storage-related errors.
    
    Raised when there are issues with database operations, file storage,
    or data persistence.
    """
    pass


class ProviderError(TalorError):
    """LLM provider errors.
    
    Raised when there are issues with LLM provider communication,
    authentication, or API calls.
    """
    pass


class MCPError(TalorError):
    """MCP-related errors.
    
    Raised when there are issues with MCP server connections, tool calls,
    or resource access.
    """
    pass


class LSPError(TalorError):
    """LSP-related errors.
    
    Raised when there are issues with language server communication,
    initialization, or requests.
    """
    pass


class PermissionError(TalorError):
    """Permission-related errors.
    
    Raised when tool execution is denied or permission checks fail.
    Note: This shadows the built-in PermissionError, which is intentional
    for Talor's permission system.
    """
    pass


class FileSystemError(TalorError):
    """File system errors.
    
    Raised when there are issues with file operations, path validation,
    or workspace boundaries.
    """
    pass


class PTYError(TalorError):
    """PTY-related errors.
    
    Raised when there are issues with process execution, terminal operations,
    or process management.
    """
    pass


class SkillError(TalorError):
    """Skill-related errors.
    
    Raised when there are issues with skill loading, validation,
    dependency resolution, or execution.
    """
    pass


class AuthError(TalorError):
    """Authentication-related errors.
    
    Raised when there are issues with authentication, token management,
    or credential storage.
    """
    pass


# =============================================================================
# Tool System Errors
# =============================================================================

class ToolError(TalorError):
    """Tool error base class.
    
    Base class for all tool-related errors in the unified tool system.
    """
    pass


class ToolNotFoundError(ToolError):
    """Tool not found error.
    
    Raised when a requested tool is not found in the registry.
    """
    pass


class ToolExecutionError(ToolError):
    """Tool execution failed error.
    
    Raised when tool execution fails due to runtime errors.
    """
    pass


class ToolRegistrationError(ToolError):
    """Tool registration failed error.
    
    Raised when tool registration fails (e.g., duplicate name).
    """
    pass


class ToolValidationError(ToolError):
    """Parameter validation failed error.
    
    Raised when tool arguments fail validation.
    """
    pass


class ToolTimeoutError(ToolError):
    """Tool execution timeout error.
    
    Raised when tool execution exceeds the allowed time limit.
    """
    pass
