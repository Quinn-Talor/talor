"""Tests for Provider API Routes.

Tests GET /api/providers, /api/providers/models, /api/providers/{id}/models
"""

import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch

import src.provider.provider as provider_module
from src.provider.provider import Provider, Model, ModelCapabilities, ModelCost, clear_cache
from src.api.app import app


# =============================================================================
# Fixtures
# =============================================================================

def _make_provider(provider_id: str, models: list[Model]) -> Provider:
    return Provider(id=provider_id, name=provider_id.title(), models=models)


def _make_model(model_id: str, provider_id: str, **cap_overrides) -> Model:
    caps = {"vision": False, "function_calling": True, "json_mode": False,
            "streaming": True, "reasoning": False}
    caps.update(cap_overrides)
    return Model(
        id=model_id,
        name=model_id,
        provider_id=provider_id,
        context_length=128000,
        max_output_tokens=4096,
        capabilities=ModelCapabilities(**caps),
        cost=ModelCost(input=1.0, output=2.0),
    )


FAKE_PROVIDERS = {
    "openai": _make_provider("openai", [
        _make_model("gpt-4o", "openai", vision=True, function_calling=True),
        _make_model("o3", "openai", reasoning=True, function_calling=True),
    ]),
    "ollama": _make_provider("ollama", [
        _make_model("deepseek-r1", "ollama", function_calling=False),
    ]),
}


@pytest.fixture(autouse=True)
def reset_cache():
    clear_cache()
    yield
    clear_cache()


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# =============================================================================
# GET /api/providers
# =============================================================================

class TestListProviders:
    @pytest.mark.asyncio
    async def test_returns_providers_list(self, client):
        with patch.object(provider_module, "_providers_cache", FAKE_PROVIDERS):
            resp = await client.get("/api/providers")
        assert resp.status_code == 200
        data = resp.json()
        ids = [p["id"] for p in data]
        assert "openai" in ids
        assert "ollama" in ids

    @pytest.mark.asyncio
    async def test_provider_has_models(self, client):
        with patch.object(provider_module, "_providers_cache", FAKE_PROVIDERS):
            resp = await client.get("/api/providers")
        openai = next(p for p in resp.json() if p["id"] == "openai")
        assert len(openai["models"]) == 2

    @pytest.mark.asyncio
    async def test_model_has_capabilities(self, client):
        with patch.object(provider_module, "_providers_cache", FAKE_PROVIDERS):
            resp = await client.get("/api/providers")
        openai = next(p for p in resp.json() if p["id"] == "openai")
        gpt4o = next(m for m in openai["models"] if m["id"] == "gpt-4o")
        caps = gpt4o["capabilities"]
        assert caps["vision"] is True
        assert caps["function_calling"] is True
        assert caps["reasoning"] is False

    @pytest.mark.asyncio
    async def test_model_has_cost(self, client):
        with patch.object(provider_module, "_providers_cache", FAKE_PROVIDERS):
            resp = await client.get("/api/providers")
        openai = next(p for p in resp.json() if p["id"] == "openai")
        gpt4o = next(m for m in openai["models"] if m["id"] == "gpt-4o")
        assert gpt4o["cost"]["input"] == 1.0
        assert gpt4o["cost"]["output"] == 2.0


# =============================================================================
# GET /api/providers/models
# =============================================================================

class TestListAllModels:
    @pytest.mark.asyncio
    async def test_returns_flat_model_list(self, client):
        with patch.object(provider_module, "_providers_cache", FAKE_PROVIDERS):
            resp = await client.get("/api/providers/models")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 3  # gpt-4o + o3 + deepseek-r1

    @pytest.mark.asyncio
    async def test_each_model_has_provider_id(self, client):
        with patch.object(provider_module, "_providers_cache", FAKE_PROVIDERS):
            resp = await client.get("/api/providers/models")
        for model in resp.json():
            assert "provider_id" in model

    @pytest.mark.asyncio
    async def test_reasoning_model_flagged(self, client):
        with patch.object(provider_module, "_providers_cache", FAKE_PROVIDERS):
            resp = await client.get("/api/providers/models")
        o3 = next(m for m in resp.json() if m["id"] == "o3")
        assert o3["capabilities"]["reasoning"] is True

    @pytest.mark.asyncio
    async def test_no_tool_call_model_flagged(self, client):
        with patch.object(provider_module, "_providers_cache", FAKE_PROVIDERS):
            resp = await client.get("/api/providers/models")
        ds = next(m for m in resp.json() if m["id"] == "deepseek-r1")
        assert ds["capabilities"]["function_calling"] is False


# =============================================================================
# GET /api/providers/{provider_id}/models
# =============================================================================

class TestListProviderModels:
    @pytest.mark.asyncio
    async def test_returns_models_for_provider(self, client):
        with patch.object(provider_module, "_providers_cache", FAKE_PROVIDERS):
            resp = await client.get("/api/providers/openai/models")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        ids = [m["id"] for m in data]
        assert "gpt-4o" in ids
        assert "o3" in ids

    @pytest.mark.asyncio
    async def test_404_for_unknown_provider(self, client):
        with patch.object(provider_module, "_providers_cache", FAKE_PROVIDERS):
            resp = await client.get("/api/providers/nonexistent/models")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_model_capabilities_complete(self, client):
        with patch.object(provider_module, "_providers_cache", FAKE_PROVIDERS):
            resp = await client.get("/api/providers/openai/models")
        o3 = next(m for m in resp.json() if m["id"] == "o3")
        caps = o3["capabilities"]
        # All capability fields present
        for field in ("vision", "function_calling", "json_mode", "streaming", "reasoning"):
            assert field in caps

    @pytest.mark.asyncio
    async def test_model_cost_fields_present(self, client):
        with patch.object(provider_module, "_providers_cache", FAKE_PROVIDERS):
            resp = await client.get("/api/providers/ollama/models")
        model = resp.json()[0]
        for field in ("input", "output", "cache_read", "cache_write"):
            assert field in model["cost"]
