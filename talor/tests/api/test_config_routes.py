"""Tests for Config API Routes.

Tests the REST API endpoints for configuration management.
"""

import tempfile
from pathlib import Path

import pytest
from httpx import AsyncClient, ASGITransport

from src.api.app import app
from src.config import config


@pytest.fixture
async def temp_config_dir():
    """Create a temporary directory for config files."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
async def client(temp_config_dir):
    """Create test client with isolated config."""
    # Configure config module to use temp directory
    config.configure(
        workspace=temp_config_dir,
        worktree=temp_config_dir,
        bus=None,
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture(autouse=True)
async def reset_config():
    """Reset config cache before and after each test."""
    # Clear cache before test
    config.clear_cache()

    yield

    # Clear cache after test to ensure isolation
    config.clear_cache()



# =============================================================================
# General Config Tests
# =============================================================================

@pytest.mark.asyncio
async def test_get_config(client):
    """Test GET /api/config endpoint."""
    response = await client.get("/api/config")
    assert response.status_code == 200

    data = response.json()
    assert "default_agent" in data
    assert "default_model" in data
    assert "providers" in data
    assert "mcp" in data


@pytest.mark.asyncio
async def test_update_config(client):
    """Test PUT /api/config endpoint."""
    response = await client.put(
        "/api/config",
        json={
            "default_agent": "test-agent",
            "default_model": "test-model",
        }
    )
    assert response.status_code == 200
    assert response.json()["status"] == "updated"

    # Verify the update
    response = await client.get("/api/config")
    data = response.json()
    assert data["default_agent"] == "test-agent"
    assert data["default_model"] == "test-model"


# =============================================================================
# Provider Tests
# =============================================================================

@pytest.mark.asyncio
async def test_get_providers(client):
    """Test GET /api/config/providers endpoint."""
    response = await client.get("/api/config/providers")
    assert response.status_code == 200
    assert isinstance(response.json(), dict)


@pytest.mark.asyncio
async def test_add_provider(client):
    """Test POST /api/config/providers/{id} endpoint."""
    response = await client.post(
        "/api/config/providers/test-provider",
        json={
            "api_key": "test-key",
            "base_url": "https://test.example.com",
            "options": {"timeout": 30}
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "created"
    assert data["provider_id"] == "test-provider"

    # Verify the provider was added
    response = await client.get("/api/config/providers")
    providers = response.json()
    assert "test-provider" in providers
    assert providers["test-provider"]["api_key"] == "test-key"
    assert providers["test-provider"]["base_url"] == "https://test.example.com"


@pytest.mark.asyncio
async def test_update_provider(client):
    """Test PUT /api/config/providers/{id} endpoint."""
    # First add a provider
    await client.post(
        "/api/config/providers/test-provider",
        json={"api_key": "old-key"}
    )

    # Update the provider
    response = await client.put(
        "/api/config/providers/test-provider",
        json={
            "api_key": "new-key",
            "base_url": "https://new.example.com",
            "options": {}
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "updated"

    # Verify the update
    response = await client.get("/api/config/providers")
    providers = response.json()
    assert providers["test-provider"]["api_key"] == "new-key"
    assert providers["test-provider"]["base_url"] == "https://new.example.com"


@pytest.mark.asyncio
async def test_update_nonexistent_provider(client):
    """Test updating a provider that doesn't exist."""
    response = await client.put(
        "/api/config/providers/nonexistent",
        json={"api_key": "test-key"}
    )
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_delete_provider(client):
    """Test DELETE /api/config/providers/{id} endpoint."""
    # First add a provider
    await client.post(
        "/api/config/providers/test-provider",
        json={"api_key": "test-key"}
    )

    # Delete the provider
    response = await client.delete("/api/config/providers/test-provider")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "deleted"

    # Verify the provider was deleted
    response = await client.get("/api/config/providers")
    providers = response.json()
    assert "test-provider" not in providers


@pytest.mark.asyncio
async def test_delete_nonexistent_provider(client):
    """Test deleting a provider that doesn't exist."""
    response = await client.delete("/api/config/providers/nonexistent")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


# =============================================================================
# MCP Server Tests
# =============================================================================

@pytest.mark.asyncio
async def test_get_mcp_servers(client):
    """Test GET /api/config/mcp endpoint."""
    response = await client.get("/api/config/mcp")
    assert response.status_code == 200
    assert isinstance(response.json(), dict)


@pytest.mark.asyncio
async def test_add_mcp_server(client):
    """Test POST /api/config/mcp/{id} endpoint."""
    response = await client.post(
        "/api/config/mcp/test-server",
        json={
            "command": "npx",
            "args": ["-y", "@test/server"],
            "env": {"TEST_VAR": "value"},
            "disabled": False,
            "auto_approve": ["tool1", "tool2"]
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "created"
    assert data["server_id"] == "test-server"

    # Verify the server was added
    response = await client.get("/api/config/mcp")
    servers = response.json()
    assert "test-server" in servers
    assert servers["test-server"]["command"] == "npx"
    assert servers["test-server"]["args"] == ["-y", "@test/server"]


@pytest.mark.asyncio
async def test_update_mcp_server(client):
    """Test PUT /api/config/mcp/{id} endpoint."""
    # First add a server
    await client.post(
        "/api/config/mcp/test-server",
        json={"command": "old-command", "args": []}
    )

    # Update the server
    response = await client.put(
        "/api/config/mcp/test-server",
        json={
            "command": "new-command",
            "args": ["--flag"],
            "env": {},
            "disabled": True,
            "auto_approve": []
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "updated"

    # Verify the update
    response = await client.get("/api/config/mcp")
    servers = response.json()
    assert servers["test-server"]["command"] == "new-command"
    assert servers["test-server"]["disabled"] is True


@pytest.mark.asyncio
async def test_update_nonexistent_mcp_server(client):
    """Test updating an MCP server that doesn't exist."""
    response = await client.put(
        "/api/config/mcp/nonexistent",
        json={"command": "test", "args": []}
    )
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_delete_mcp_server(client):
    """Test DELETE /api/config/mcp/{id} endpoint."""
    # First add a server
    await client.post(
        "/api/config/mcp/test-server",
        json={"command": "test", "args": []}
    )

    # Delete the server
    response = await client.delete("/api/config/mcp/test-server")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "deleted"

    # Verify the server was deleted
    response = await client.get("/api/config/mcp")
    servers = response.json()
    assert "test-server" not in servers


@pytest.mark.asyncio
async def test_delete_nonexistent_mcp_server(client):
    """Test deleting an MCP server that doesn't exist."""
    response = await client.delete("/api/config/mcp/nonexistent")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


# =============================================================================
# Workspace Tests
# =============================================================================

@pytest.mark.asyncio
async def test_get_workspace_directories(client):
    """Test GET /api/config/workspace endpoint."""
    response = await client.get("/api/config/workspace")
    assert response.status_code == 200
    data = response.json()
    assert "directories" in data
    assert isinstance(data["directories"], list)


@pytest.mark.asyncio
async def test_add_workspace_directory(client):
    """Test POST /api/config/workspace endpoint."""
    response = await client.post(
        "/api/config/workspace",
        json={"path": "/test/workspace"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "added"
    assert data["path"] == "/test/workspace"

    # Verify the directory was added
    response = await client.get("/api/config/workspace")
    data = response.json()
    assert "/test/workspace" in data["directories"]


@pytest.mark.asyncio
async def test_add_duplicate_workspace_directory(client):
    """Test adding a workspace directory that already exists."""
    # Add directory first time
    await client.post(
        "/api/config/workspace",
        json={"path": "/test/workspace"}
    )

    # Try to add again
    response = await client.post(
        "/api/config/workspace",
        json={"path": "/test/workspace"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "already_exists"


@pytest.mark.asyncio
async def test_delete_workspace_directory(client):
    """Test DELETE /api/config/workspace/{index} endpoint."""
    # Add a directory
    await client.post(
        "/api/config/workspace",
        json={"path": "/test/workspace"}
    )

    # Get the current directories to find the index
    response = await client.get("/api/config/workspace")
    directories = response.json()["directories"]
    index = directories.index("/test/workspace")

    # Delete the directory
    response = await client.delete(f"/api/config/workspace/{index}")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "deleted"
    assert data["path"] == "/test/workspace"

    # Verify the directory was deleted
    response = await client.get("/api/config/workspace")
    data = response.json()
    assert "/test/workspace" not in data["directories"]


@pytest.mark.asyncio
async def test_delete_workspace_directory_invalid_index(client):
    """Test deleting a workspace directory with invalid index."""
    response = await client.delete("/api/config/workspace/999")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


# =============================================================================
# Integration Tests
# =============================================================================

@pytest.mark.asyncio
async def test_config_crud_workflow(client):
    """Test complete CRUD workflow for configuration."""
    # 1. Add provider
    await client.post(
        "/api/config/providers/openai",
        json={"api_key": "sk-test", "base_url": None, "options": {}}
    )

    # 2. Add MCP server
    await client.post(
        "/api/config/mcp/filesystem",
        json={
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-filesystem"],
            "env": {},
            "disabled": False,
            "auto_approve": []
        }
    )

    # 3. Add workspace directory
    await client.post(
        "/api/config/workspace",
        json={"path": "/home/user/projects"}
    )

    # 4. Update general config
    await client.put(
        "/api/config",
        json={
            "default_agent": "build",
            "default_model": "openai/gpt-4"
        }
    )

    # 5. Verify all changes
    response = await client.get("/api/config")
    config_data = response.json()

    assert config_data["default_agent"] == "build"
    assert config_data["default_model"] == "openai/gpt-4"
    assert "openai" in config_data["providers"]
    assert "filesystem" in config_data["mcp"]

    response = await client.get("/api/config/workspace")
    workspace_data = response.json()
    assert "/home/user/projects" in workspace_data["directories"]

    # 6. Delete provider
    await client.delete("/api/config/providers/openai")

    # 7. Verify deletion
    response = await client.get("/api/config/providers")
    providers = response.json()
    assert "openai" not in providers
