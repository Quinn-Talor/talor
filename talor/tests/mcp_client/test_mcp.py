"""Tests for MCPManager instance-based design."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from src.mcp_client.mcp import (
    MCPManager,
    MCPServerConfig,
    MCPStatusType,
    MCPTransport,
    MCPAuthConfig,
    MCPAuthType,
    _load_presets,
    _merge_with_preset,
)


@pytest.mark.asyncio
async def test_mcp_manager_instance_isolation():
    """Two MCPManager instances should not share state."""
    manager1 = MCPManager()
    manager2 = MCPManager()

    # Directly set a fake client in manager1
    manager1._clients["fake-server"] = MagicMock()

    # manager2 should have no clients
    assert len(manager2._clients) == 0
    assert "fake-server" not in manager2._clients


@pytest.mark.asyncio
async def test_mcp_manager_configure():
    """configure() should update bus and config."""
    manager = MCPManager()
    assert manager._bus is None
    assert manager._config is None

    fake_bus = MagicMock()
    fake_config = MagicMock()
    manager.configure(bus=fake_bus, config=fake_config)

    assert manager._bus is fake_bus
    assert manager._config is fake_config


@pytest.mark.asyncio
async def test_mcp_manager_clear():
    """clear() should remove all clients."""
    manager = MCPManager()
    manager._clients["fake"] = MagicMock()
    manager.clear()
    assert len(manager._clients) == 0


@pytest.mark.asyncio
async def test_mcp_manager_list_servers_empty():
    """list_servers() should return empty list when no servers."""
    manager = MCPManager()
    servers = await manager.list_servers()
    assert servers == []


@pytest.mark.asyncio
async def test_mcp_manager_tools_empty():
    """tools() should return empty list when no servers."""
    manager = MCPManager()
    tools = await manager.tools()
    assert tools == []


@pytest.mark.asyncio
async def test_mcp_manager_call_tool_not_found():
    """call_tool() should raise ValueError when server not found."""
    manager = MCPManager()
    with pytest.raises(ValueError, match="MCP server not found"):
        await manager.call_tool("nonexistent", "some_tool", {})


@pytest.mark.asyncio
async def test_mcp_manager_status_not_found():
    """status() should return None when server not found."""
    manager = MCPManager()
    result = await manager.status("nonexistent")
    assert result is None


def test_mcp_backward_compat_alias():
    """MCP should be an alias for MCPManager."""
    from src.mcp_client.mcp import MCP, MCPManager
    assert MCP is MCPManager


@pytest.mark.asyncio
async def test_mcp_manager_disabled_server():
    """Disabled server should set DISABLED status without connecting."""
    manager = MCPManager()
    config = MCPServerConfig(command="npx", disabled=True)

    # No mock needed: connect() returns early for disabled servers (no network call)
    status = await manager.connect("test-server", config)

    assert status.status == MCPStatusType.DISABLED


@pytest.mark.asyncio
async def test_mcp_auth_config_needs_auth():
    """Auth-required server with missing token should set NEEDS_AUTH."""
    from src.mcp_client.mcp import MCPClientWrapper
    config = MCPServerConfig(
        command="npx",
        args=["some-mcp"],
        auth=MCPAuthConfig(type=MCPAuthType.BEARER, token_ref="keyring:missing-key"),
    )
    wrapper = MCPClientWrapper(name="test", config=config)

    with patch("src.config.keyring_manager.get_key", return_value=None):
        await wrapper.connect()

    assert wrapper.status.status == MCPStatusType.NEEDS_AUTH


def test_mcp_auth_build_bearer_headers():
    """Bearer auth should build correct Authorization header."""
    from src.mcp_client.mcp import MCPClientWrapper
    config = MCPServerConfig(
        url="http://example.com",
        transport=MCPTransport.HTTP,
        auth=MCPAuthConfig(type=MCPAuthType.BEARER, token="my-secret-token"),
    )
    wrapper = MCPClientWrapper(name="test", config=config)
    headers = wrapper._build_auth_headers()
    assert headers == {"Authorization": "Bearer my-secret-token"}


def test_mcp_auth_build_api_key_headers():
    """API key auth should build correct custom header."""
    from src.mcp_client.mcp import MCPClientWrapper
    config = MCPServerConfig(
        url="http://example.com",
        transport=MCPTransport.HTTP,
        auth=MCPAuthConfig(
            type=MCPAuthType.API_KEY,
            token="my-api-key",
            header_name="X-API-Key",
        ),
    )
    wrapper = MCPClientWrapper(name="test", config=config)
    headers = wrapper._build_auth_headers()
    assert headers == {"X-API-Key": "my-api-key"}


def test_mcp_auth_env_injection():
    """stdio auth should inject token as env var."""
    from src.mcp_client.mcp import MCPClientWrapper
    config = MCPServerConfig(
        command="npx",
        auth=MCPAuthConfig(
            type=MCPAuthType.API_KEY,
            token="brave-api-key",
            env_var="BRAVE_API_KEY",
        ),
    )
    wrapper = MCPClientWrapper(name="test", config=config)
    env = wrapper._build_auth_env()
    assert env == {"BRAVE_API_KEY": "brave-api-key"}


# =============================================================================
# Preset tests
# =============================================================================

def test_load_presets_returns_dict():
    """_load_presets() should return a dict keyed by preset id."""
    presets = _load_presets()
    assert isinstance(presets, dict)
    # Should contain at least the built-in presets
    assert "playwright" in presets
    assert "filesystem" in presets
    assert "brave-search" in presets


def test_preset_has_required_fields():
    """Each preset should have id, name, command/url."""
    presets = _load_presets()
    for pid, preset in presets.items():
        assert "id" in preset, f"Preset '{pid}' missing 'id'"
        assert "name" in preset, f"Preset '{pid}' missing 'name'"
        # Must have either command (stdio) or url (sse/http)
        has_transport = "command" in preset or "url" in preset
        assert has_transport, f"Preset '{pid}' missing command/url"


def test_merge_with_preset_uses_preset_defaults():
    """Config with no command should get preset defaults merged in."""
    presets = {"playwright": {"command": "npx", "args": ["@playwright/mcp@latest"]}}
    merged = _merge_with_preset("playwright", {}, presets)
    assert merged["command"] == "npx"
    assert merged["args"] == ["@playwright/mcp@latest"]


def test_merge_with_preset_user_wins():
    """User-provided values should override preset defaults."""
    presets = {"playwright": {"command": "npx", "args": ["@playwright/mcp@latest"]}}
    user_config = {"command": "custom-cmd", "args": ["--custom"]}
    merged = _merge_with_preset("playwright", user_config, presets)
    assert merged["command"] == "custom-cmd"
    assert merged["args"] == ["--custom"]


def test_merge_with_preset_skips_when_command_provided():
    """Config that already has command should not be altered by preset."""
    presets = {"playwright": {"command": "npx", "args": ["@playwright/mcp@latest"]}}
    user_config = {"command": "my-cmd"}
    merged = _merge_with_preset("playwright", user_config, presets)
    assert merged == user_config


def test_merge_with_preset_unknown_name():
    """Unknown server name should return user config unchanged."""
    presets = {}
    user_config = {"disabled": True}
    merged = _merge_with_preset("unknown-server", user_config, presets)
    assert merged == user_config
