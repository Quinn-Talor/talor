"""Tool Execution Context for Talor.

This module provides the ToolContext class that corresponds to
opencode's Tool.Context, providing execution context for tools.

Features:
- Session and message information
- Abort signal for cancellation
- Permission request via ask()
- Metadata updates via metadata()
- Workspace and worktree paths
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, TYPE_CHECKING
from uuid import uuid4

if TYPE_CHECKING:
    from talor.bus import Bus


logger = logging.getLogger(__name__)


@dataclass
class ToolContext:
    """Tool execution context.
    
    Corresponds to opencode's Tool.Context<M>.
    Provides session info, abort signal, and methods for permission/metadata.
    
    Attributes:
        session_id: Current session ID
        message_id: Current message ID
        agent: Agent identifier
        abort: Abort signal for cancellation
        call_id: Tool call ID (optional)
        extra: Extra context data
        messages: Conversation messages (for context)
    """
    
    session_id: str
    message_id: str
    agent: str
    abort: asyncio.Event | None = None
    call_id: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)
    messages: list[dict] = field(default_factory=list)
    
    # Internal references (not serialized)
    _bus: Any | None = field(default=None, repr=False)
    _workspace: Path | None = field(default=None, repr=False)
    _worktree: Path | None = field(default=None, repr=False)
    _permission_responses: dict[str, asyncio.Future] = field(default_factory=dict, repr=False)
    
    async def ask(
        self,
        permission: str,
        patterns: list[str],
        always: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Request permission from user.
        
        Corresponds to opencode's ctx.ask().
        Publishes permission request event and waits for response.
        
        Args:
            permission: Permission type (read, edit, bash, etc.)
            patterns: Patterns for the permission request
            always: Patterns to always allow
            metadata: Additional metadata for the request
        
        Raises:
            PermissionDenied: If permission is denied
        """
        if not self._bus:
            # No bus, auto-grant
            return
        
        from talor.bus.events import PermissionRequested, PermissionRequestedData
        
        request_id = str(uuid4())
        
        # Create future for response
        loop = asyncio.get_event_loop()
        future: asyncio.Future[bool] = loop.create_future()
        self._permission_responses[request_id] = future
        
        # Publish permission request
        await self._bus.publish(
            PermissionRequested,
            PermissionRequestedData(
                session_id=self.session_id,
                request_id=request_id,
                tool=self.call_id or "unknown",
                permission=permission,
                patterns=patterns,
                always=always or [],
                metadata=metadata or {},
            )
        )
        
        # Wait for response with timeout
        try:
            granted = await asyncio.wait_for(future, timeout=300.0)  # 5 minute timeout
            if not granted:
                raise PermissionDenied(f"Permission denied: {permission}")
        except asyncio.TimeoutError:
            raise PermissionDenied(f"Permission request timed out: {permission}")
        finally:
            self._permission_responses.pop(request_id, None)
    
    def resolve_permission(self, request_id: str, granted: bool) -> None:
        """Resolve a pending permission request.
        
        Called when user responds to permission request.
        
        Args:
            request_id: Request ID from permission event
            granted: Whether permission was granted
        """
        future = self._permission_responses.get(request_id)
        if future and not future.done():
            future.set_result(granted)
    
    def metadata(
        self,
        title: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Update tool metadata (for streaming updates).
        
        Corresponds to opencode's ctx.metadata().
        Fire-and-forget event publishing.
        
        Args:
            title: Optional title update
            metadata: Metadata to merge
        """
        if not self._bus:
            return
        
        from talor.bus.events import ToolMetadata, ToolMetadataData
        
        # Fire and forget - don't await
        asyncio.create_task(
            self._bus.publish(
                ToolMetadata,
                ToolMetadataData(
                    session_id=self.session_id,
                    call_id=self.call_id,
                    title=title,
                    metadata=metadata or {},
                )
            )
        )
    
    @property
    def directory(self) -> Path:
        """Current working directory."""
        return self._workspace or Path.cwd()
    
    @property
    def worktree(self) -> Path:
        """Project worktree root."""
        return self._worktree or self.directory
    
    @property
    def is_aborted(self) -> bool:
        """Check if execution has been aborted."""
        return self.abort is not None and self.abort.is_set()
    
    def check_abort(self) -> None:
        """Check if aborted and raise if so.
        
        Raises:
            asyncio.CancelledError: If aborted
        """
        if self.is_aborted:
            raise asyncio.CancelledError("Tool execution aborted")


class PermissionDenied(Exception):
    """Exception raised when permission is denied."""
    pass
