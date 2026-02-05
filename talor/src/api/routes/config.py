"""Config Routes.

Provides REST API endpoints for configuration management.

Endpoints:
    GET /api/config - Get complete configuration
    PUT /api/config - Update complete configuration
    GET /api/config/providers - Get provider configurations
    POST /api/config/providers - Add provider
    PUT /api/config/providers/{id} - Update provider
    DELETE /api/config/providers/{id} - Delete provider
    GET /api/config/mcp - Get MCP server configurations
    POST /api/config/mcp - Add MCP server
    PUT /api/config/mcp/{id} - Update MCP server
    DELETE /api/config/mcp/{id} - Delete MCP server
    GET /api/config/workspace - Get workspace directories
    POST /api/config/workspace - Add workspace directory
    DELETE /api/config/workspace/{index} - Delete workspace directory
"""

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.api.models import ConfigResponse
from src.config import Config, reload


router = APIRouter()


# =============================================================================
# Request/Response Models
# =============================================================================

class ConfigUpdateRequest(BaseModel):
    """Request model for updating configuration."""
    default_agent: str | None = None
    default_model: str | None = None
    language: str | None = None
    theme: str | None = None
    providers: dict[str, Any] | None = None
    mcp: dict[str, Any] | None = None
    workspace: list[str] | None = None
    plugins: dict[str, Any] | None = None
    permission: dict[str, Any] | None = None
    agent: dict[str, Any] | None = None


class ProviderRequest(BaseModel):
    """Request model for provider configuration."""
    name: str | None = None
    api_key_env: str | None = None
    base_url: str | None = None
    auto_discover: bool = False
    models: list[dict[str, Any]] = []


class MCPServerRequest(BaseModel):
    """Request model for MCP server configuration."""
    command: str
    args: list[str] = []
    env: dict[str, str] = {}
    disabled: bool = False
    auto_approve: list[str] = []


class WorkspaceRequest(BaseModel):
    """Request model for workspace directory."""
    path: str


# =============================================================================
# General Config Endpoints
# =============================================================================

@router.get("", response_model=ConfigResponse)
async def get_config() -> ConfigResponse:
    """Get current configuration.

    Returns complete configuration including:
    - default_agent: Default agent name
    - default_model: Default model identifier
    - language: Application language
    - theme: Application theme
    - providers: Provider configurations
    - mcp: MCP server configurations
    - plugins: Plugin configurations
    - workspace: Workspace directories
    - permission: Permission rules
    - agent: Agent configurations
    """
    config = await Config.get()
    return ConfigResponse(
        default_agent=config.get("default_agent"),
        default_model=config.get("default_model"),
        language=config.get("language"),
        theme=config.get("theme"),
        providers=config.get("providers", {}),
        mcp=config.get("mcp", {}),
        plugins=config.get("plugins", {}),
        workspace=config.get("workspace", []),
        permission=config.get("permission", {}),
        agent=config.get("agent", {}),
    )


@router.put("")
async def update_config(request: ConfigUpdateRequest) -> dict:
    """Update configuration.

    Updates one or more configuration values. Only provided fields are updated.

    Args:
        request: Configuration update request

    Returns:
        Status message
    """
    # Update individual fields if provided
    if request.default_agent is not None:
        await Config.set("default_agent", request.default_agent)

    if request.default_model is not None:
        await Config.set("default_model", request.default_model)

    if request.language is not None:
        await Config.set("language", request.language)

    if request.theme is not None:
        await Config.set("theme", request.theme)

    if request.providers is not None:
        await Config.set("providers", request.providers)

    if request.mcp is not None:
        await Config.set("mcp", request.mcp)

    if request.workspace is not None:
        await Config.set("workspace", request.workspace)

    if request.plugins is not None:
        await Config.set("plugins", request.plugins)

    if request.permission is not None:
        await Config.set("permission", request.permission)

    if request.agent is not None:
        await Config.set("agent", request.agent)

    # Reload configuration to apply changes
    await reload()

    return {"status": "updated"}


# =============================================================================
# Provider Endpoints
# =============================================================================

@router.get("/providers")
async def get_providers() -> dict[str, Any]:
    """Get all provider configurations.

    Returns:
        Dictionary of provider configurations
    """
    config = await Config.get()
    return config.get("providers", {})


@router.post("/providers/{provider_id}")
async def add_provider(provider_id: str, request: ProviderRequest) -> dict:
    """Add or update a provider configuration.

    Args:
        provider_id: Provider identifier (e.g., "openai", "anthropic")
        request: Provider configuration

    Returns:
        Status message
    """
    config = await Config.get()
    providers = dict(config.get("providers", {}))  # Make a copy

    # Add or update provider
    providers[provider_id] = {
        "name": request.name or provider_id,
        "api_key_env": request.api_key_env,
        "base_url": request.base_url,
        "auto_discover": request.auto_discover,
        "models": request.models,
    }

    await Config.set("providers", providers)
    await reload()

    return {"status": "created", "provider_id": provider_id}


@router.put("/providers/{provider_id}")
async def update_provider(provider_id: str, request: ProviderRequest) -> dict:
    """Update a provider configuration.

    Args:
        provider_id: Provider identifier
        request: Provider configuration

    Returns:
        Status message

    Raises:
        HTTPException: If provider not found
    """
    config = await Config.get()
    providers = dict(config.get("providers", {}))  # Make a copy

    if provider_id not in providers:
        raise HTTPException(status_code=404, detail=f"Provider '{provider_id}' not found")

    # Update provider
    providers[provider_id] = {
        "name": request.name or provider_id,
        "api_key_env": request.api_key_env,
        "base_url": request.base_url,
        "auto_discover": request.auto_discover,
        "models": request.models,
    }

    await Config.set("providers", providers)
    await reload()

    return {"status": "updated", "provider_id": provider_id}


@router.delete("/providers/{provider_id}")
async def delete_provider(provider_id: str) -> dict:
    """Delete a provider configuration.

    Args:
        provider_id: Provider identifier

    Returns:
        Status message

    Raises:
        HTTPException: If provider not found
    """
    config = await Config.get()
    providers = dict(config.get("providers", {}))  # Make a copy to avoid cache issues

    if provider_id not in providers:
        raise HTTPException(status_code=404, detail=f"Provider '{provider_id}' not found")

    # Delete provider
    del providers[provider_id]

    await Config.set("providers", providers)
    await reload()

    return {"status": "deleted", "provider_id": provider_id}


# =============================================================================
# MCP Server Endpoints
# =============================================================================

@router.get("/mcp")
async def get_mcp_servers() -> dict[str, Any]:
    """Get all MCP server configurations.

    Returns:
        Dictionary of MCP server configurations
    """
    config = await Config.get()
    return config.get("mcp", {})


@router.post("/mcp/{server_id}")
async def add_mcp_server(server_id: str, request: MCPServerRequest) -> dict:
    """Add or update an MCP server configuration.

    Args:
        server_id: MCP server identifier
        request: MCP server configuration

    Returns:
        Status message
    """
    config = await Config.get()
    mcp_servers = dict(config.get("mcp", {}))  # Make a copy

    # Add or update MCP server
    mcp_servers[server_id] = {
        "command": request.command,
        "args": request.args,
        "env": request.env,
        "disabled": request.disabled,
        "auto_approve": request.auto_approve,
    }

    await Config.set("mcp", mcp_servers)
    await reload()

    return {"status": "created", "server_id": server_id}


@router.put("/mcp/{server_id}")
async def update_mcp_server(server_id: str, request: MCPServerRequest) -> dict:
    """Update an MCP server configuration.

    Args:
        server_id: MCP server identifier
        request: MCP server configuration

    Returns:
        Status message

    Raises:
        HTTPException: If MCP server not found
    """
    config = await Config.get()
    mcp_servers = dict(config.get("mcp", {}))  # Make a copy

    if server_id not in mcp_servers:
        raise HTTPException(status_code=404, detail=f"MCP server '{server_id}' not found")

    # Update MCP server
    mcp_servers[server_id] = {
        "command": request.command,
        "args": request.args,
        "env": request.env,
        "disabled": request.disabled,
        "auto_approve": request.auto_approve,
    }

    await Config.set("mcp", mcp_servers)
    await reload()

    return {"status": "updated", "server_id": server_id}


@router.delete("/mcp/{server_id}")
async def delete_mcp_server(server_id: str) -> dict:
    """Delete an MCP server configuration.

    Args:
        server_id: MCP server identifier

    Returns:
        Status message

    Raises:
        HTTPException: If MCP server not found
    """
    config = await Config.get()
    mcp_servers = dict(config.get("mcp", {}))  # Make a copy to avoid cache issues

    if server_id not in mcp_servers:
        raise HTTPException(status_code=404, detail=f"MCP server '{server_id}' not found")

    # Delete MCP server
    del mcp_servers[server_id]

    await Config.set("mcp", mcp_servers)
    await reload()

    return {"status": "deleted", "server_id": server_id}


# =============================================================================
# Workspace Endpoints
# =============================================================================

@router.get("/workspace")
async def get_workspace_directories() -> dict[str, list[str]]:
    """Get workspace directories.

    Returns:
        Dictionary with workspace directories list
    """
    config = await Config.get()
    return {"directories": config.get("workspace", [])}


@router.post("/workspace")
async def add_workspace_directory(request: WorkspaceRequest) -> dict:
    """Add a workspace directory.

    Args:
        request: Workspace directory request

    Returns:
        Status message
    """
    config = await Config.get()
    workspace_dirs = list(config.get("workspace", []))  # Make a copy

    # Add directory if not already present
    if request.path not in workspace_dirs:
        workspace_dirs.append(request.path)
        await Config.set("workspace", workspace_dirs)
        await reload()

        return {"status": "added", "path": request.path}
    else:
        return {"status": "already_exists", "path": request.path}


@router.delete("/workspace/{index}")
async def delete_workspace_directory(index: int) -> dict:
    """Delete a workspace directory by index.

    Args:
        index: Index of the directory to delete

    Returns:
        Status message

    Raises:
        HTTPException: If index is out of range
    """
    config = await Config.get()
    workspace_dirs = list(config.get("workspace", []))  # Make a copy to avoid cache issues

    if index < 0 or index >= len(workspace_dirs):
        raise HTTPException(status_code=404, detail=f"Workspace directory at index {index} not found")

    # Remove directory
    removed_path = workspace_dirs.pop(index)

    await Config.set("workspace", workspace_dirs)
    await reload()

    return {"status": "deleted", "path": removed_path}
