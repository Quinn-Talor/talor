"""Logging system for Talor using structlog.

This module provides structured logging with:
- JSON formatted logs for machine parsing
- Log level filtering
- Log file rotation
- Context-aware logging with metadata
"""

import logging
import sys
from pathlib import Path
from typing import Any

import structlog
from structlog.types import FilteringBoundLogger

from src.core.errors import TalorError


class Logger:
    """Structured logger using structlog.
    
    Provides structured logging with JSON output, log level filtering,
    and automatic log file rotation. All log entries include:
    - Timestamp
    - Log level
    - Logger name
    - Message
    - Additional context fields
    
    Example:
        ```python
        logger = Logger("talor.agent")
        logger.info("Task started", task_id="123", user="alice")
        logger.error("Task failed", task_id="123", error="timeout")
        ```
    """
    
    _configured = False
    
    def __init__(self, name: str) -> None:
        """Initialize a logger instance.
        
        Args:
            name: Logger name (typically module path like "talor.agent")
        """
        self._name = name
        self._logger: FilteringBoundLogger = structlog.get_logger(name)
    
    @classmethod
    def configure(
        cls,
        level: str = "INFO",
        log_dir: str | None = None,
        enable_console: bool = True,
        enable_file: bool = True
    ) -> None:
        """Configure the logging system globally.
        
        This should be called once at application startup before creating
        any logger instances.
        
        Args:
            level: Log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
            log_dir: Directory for log files (None for default platform location)
            enable_console: Whether to log to console/stdout
            enable_file: Whether to log to files
        
        Raises:
            TalorError: If configuration fails
        """
        if cls._configured:
            return
        
        try:
            # Convert level string to logging constant
            log_level = getattr(logging, level.upper(), logging.INFO)
            
            # Configure standard library logging
            logging.basicConfig(
                format="%(message)s",
                level=log_level,
                stream=sys.stdout if enable_console else None
            )
            
            # Prepare processors
            processors = [
                structlog.contextvars.merge_contextvars,
                structlog.processors.add_log_level,
                structlog.processors.TimeStamper(fmt="iso"),
                structlog.processors.StackInfoRenderer(),
            ]
            
            # Add console or file renderer
            if enable_console:
                processors.append(
                    structlog.dev.ConsoleRenderer()
                )
            else:
                processors.append(
                    structlog.processors.JSONRenderer()
                )
            
            # Configure structlog
            structlog.configure(
                processors=processors,
                wrapper_class=structlog.make_filtering_bound_logger(log_level),
                context_class=dict,
                logger_factory=structlog.PrintLoggerFactory(),
                cache_logger_on_first_use=True,
            )
            
            # Setup file logging if enabled
            if enable_file:
                cls._setup_file_logging(log_dir, log_level)
            
            cls._configured = True
            
        except Exception as e:
            raise TalorError(
                "Failed to configure logging system",
                context={"error": str(e)}
            )
    
    @classmethod
    def _setup_file_logging(cls, log_dir: str | None, log_level: int) -> None:
        """Setup file-based logging with rotation.
        
        Args:
            log_dir: Directory for log files
            log_level: Logging level
        """
        from logging.handlers import RotatingFileHandler
        
        # Determine log directory
        if log_dir is None:
            log_dir = cls._get_default_log_dir()
        
        log_path = Path(log_dir)
        log_path.mkdir(parents=True, exist_ok=True)
        
        # Create rotating file handler
        log_file = log_path / "talor.log"
        handler = RotatingFileHandler(
            log_file,
            maxBytes=10 * 1024 * 1024,  # 10 MB
            backupCount=5
        )
        handler.setLevel(log_level)
        
        # Use JSON formatter for file logs
        formatter = logging.Formatter('%(message)s')
        handler.setFormatter(formatter)
        
        # Add handler to root logger
        root_logger = logging.getLogger()
        root_logger.addHandler(handler)
    
    @classmethod
    def _get_default_log_dir(cls) -> str:
        """Get default log directory based on platform.
        
        Returns:
            Path to default log directory
        """
        import platform
        
        system = platform.system()
        if system == "Windows":
            log_dir = Path.home() / "AppData" / "Local" / "talor" / "logs"
        else:
            # Linux/macOS
            import os
            xdg_data = os.environ.get("XDG_DATA_HOME")
            if xdg_data:
                log_dir = Path(xdg_data) / "talor" / "logs"
            else:
                log_dir = Path.home() / ".local" / "share" / "talor" / "logs"
        
        return str(log_dir)
    
    def debug(self, message: str, **context: Any) -> None:
        """Log a debug message.
        
        Args:
            message: Log message
            **context: Additional context fields to include in log
        """
        self._logger.debug(message, **context)
    
    def info(self, message: str, **context: Any) -> None:
        """Log an info message.
        
        Args:
            message: Log message
            **context: Additional context fields to include in log
        """
        self._logger.info(message, **context)
    
    def warning(self, message: str, **context: Any) -> None:
        """Log a warning message.
        
        Args:
            message: Log message
            **context: Additional context fields to include in log
        """
        self._logger.warning(message, **context)
    
    def error(self, message: str, **context: Any) -> None:
        """Log an error message.
        
        Args:
            message: Log message
            **context: Additional context fields to include in log
        """
        self._logger.error(message, **context)
    
    def critical(self, message: str, **context: Any) -> None:
        """Log a critical message.
        
        Args:
            message: Log message
            **context: Additional context fields to include in log
        """
        self._logger.critical(message, **context)
