"""Dependency Injection Container for Talor.

This module provides a simple DI container for managing application services.
All services are instantiated as objects, not classes with static methods.

Example:
    ```python
    # At application startup
    container = Container()
    container.configure(
        workspace=Path("/path/to/workspace"),
        storage=storage_instance,
    )

    # Get services
    session_service = container.session_service
    agent_executor = container.agent_executor
    ```
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from src.bus import Bus
    from src.tool.registry import ToolRegistry
    from src.agent.executor import AgentExecutor


logger = logging.getLogger(__name__)


class Container:
    """Dependency Injection Container.

    Central registry for all application services.
    Services are lazily instantiated on first access.
    """

    _instance: "Container | None" = None

    def __init__(self) -> None:
        """Initialize container."""
        # Configuration
        self._workspace: Path = Path(".")
        self._worktree: Path = Path(".")
        self._storage: Any | None = None
        self._bus: Any | None = None

        # Service instances (lazy)
        self._session_repository: Any | None = None
        self._session_service: Any | None = None
        self._provider_service: Any | None = None
        self._agent_service: Any | None = None
        self._agent_executor: Any | None = None
        self._tool_registry: Any | None = None
        self._config_service: Any | None = None

        self._configured = False

    @classmethod
    def get_instance(cls) -> "Container":
        """Get singleton container instance."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @classmethod
    def reset(cls) -> None:
        """Reset singleton (for testing)."""
        cls._instance = None

    def configure(
        self,
        workspace: Path | None = None,
        worktree: Path | None = None,
        storage: Any | None = None,
        bus: Any | None = None,
    ) -> "Container":
        """Configure the container.

        Args:
            workspace: Workspace directory
            worktree: Working tree directory
            storage: Storage system instance
            bus: Event bus instance (if None, creates a new Bus instance)

        Returns:
            Self for chaining
        """
        if workspace:
            self._workspace = workspace
        if worktree:
            self._worktree = worktree
        if storage is not None:
            self._storage = storage
        if bus is not None:
            self._bus = bus
        elif self._bus is None:
            # Create default Bus instance if not provided
            from src.bus import Bus
            self._bus = Bus(directory=str(self._workspace))

        self._configured = True
        logger.debug(f"Container configured: workspace={self._workspace}")
        return self

    # =========================================================================
    # Properties - Lazy Service Instantiation
    # =========================================================================

    @property
    def workspace(self) -> Path:
        """Get workspace path."""
        return self._workspace

    @property
    def worktree(self) -> Path:
        """Get worktree path."""
        return self._worktree

    @property
    def storage(self) -> Any:
        """Get storage system."""
        return self._storage

    @property
    def bus(self) -> Any:
        """Get event bus."""
        return self._bus

    @property
    def session_repository(self) -> Any:
        """Get session repository instance."""
        if self._session_repository is None:
            from src.session.repository import SessionRepositoryImpl
            self._session_repository = SessionRepositoryImpl(
                storage=self._storage,
                directory=str(self._workspace),
            )
        return self._session_repository

    @property
    def session_service(self) -> Any:
        """Get session service instance."""
        if self._session_service is None:
            from src.session.service import SessionService
            self._session_service = SessionService(
                repository=self.session_repository,
                bus=self._bus,
            )
        return self._session_service

    @property
    def provider_service(self) -> Any:
        """Get provider service instance."""
        if self._provider_service is None:
            from src.provider.service import ProviderService
            self._provider_service = ProviderService(
                config_service=self.config_service,
            )
        return self._provider_service

    @property
    def agent_service(self) -> Any:
        """Get agent service instance."""
        if self._agent_service is None:
            from src.agent.service import AgentService
            self._agent_service = AgentService(
                config_service=self.config_service,
            )
        return self._agent_service

    @property
    def tool_registry(self) -> "ToolRegistry":
        """Get tool registry instance."""
        if self._tool_registry is None:
            from src.tool.registry import ToolRegistry
            self._tool_registry = ToolRegistry(bus=self._bus)
        return self._tool_registry

    @tool_registry.setter
    def tool_registry(self, registry: "ToolRegistry") -> None:
        """Set tool registry (for external configuration)."""
        self._tool_registry = registry

    @property
    def config_service(self) -> Any:
        """Get config service instance."""
        if self._config_service is None:
            from src.config.service import ConfigService
            self._config_service = ConfigService(
                directory=self._workspace,
                worktree=self._worktree,
                bus=self._bus,
            )
        return self._config_service

    @property
    def agent_executor(self) -> "AgentExecutor":
        """Get agent executor instance."""
        if self._agent_executor is None:
            from src.agent.executor import AgentExecutor
            self._agent_executor = AgentExecutor(
                session_service=self.session_service,
                provider_service=self.provider_service,
                tool_registry=self.tool_registry,
                bus=self._bus,
                workspace=self._workspace,
                worktree=self._worktree,
            )
        return self._agent_executor


# Global container accessor
def get_container() -> Container:
    """Get the global container instance."""
    return Container.get_instance()
