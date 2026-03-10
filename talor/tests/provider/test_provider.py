"""Tests for provider module.

Covers:
- _build_litellm_model_str: model string construction
- _build_reasoning_params: reasoning/thinking parameter generation
- _normalize_chunk / _normalize_response: response normalization
- parse_model: model string parsing
- complete(): tool call suppression for non-function-calling models
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch, AsyncMock

from src.provider.provider import (
    _build_litellm_model_str,
    _build_reasoning_params,
    _normalize_chunk,
    _normalize_response,
    parse_model,
    ModelCapabilities,
    ModelCost,
    Model,
    Provider,
    clear_cache,
    configure,
    _providers_cache,
)


# =============================================================================
# _build_litellm_model_str
# =============================================================================

class TestBuildLitellmModelStr:
    def test_openai_model(self):
        result = _build_litellm_model_str("openai", "gpt-4o", None)
        assert result == "openai/gpt-4o"

    def test_anthropic_model(self):
        result = _build_litellm_model_str("anthropic", "claude-sonnet-4-20250514", None)
        assert result == "anthropic/claude-sonnet-4-20250514"

    def test_ollama_uses_ollama_chat_prefix(self):
        result = _build_litellm_model_str("ollama", "llama3", "http://localhost:11434/v1")
        assert result == "ollama_chat/llama3"

    def test_google_model(self):
        result = _build_litellm_model_str("google", "gemini-2.5-pro", None)
        assert result == "google/gemini-2.5-pro"


# =============================================================================
# _build_reasoning_params
# =============================================================================

class TestBuildReasoningParams:
    """Tests for reasoning parameter construction."""

    # --- No reasoning ---

    def test_no_reasoning_returns_empty(self):
        result = _build_reasoning_params("anthropic", "claude-sonnet-4-20250514")
        assert result == {}

    def test_reasoning_false_returns_empty(self):
        result = _build_reasoning_params("openai", "o3", reasoning=False)
        assert result == {}

    # --- Anthropic extended thinking ---

    def test_anthropic_thinking_default_budget(self):
        result = _build_reasoning_params("anthropic", "claude-sonnet-4-20250514", reasoning=True)
        assert result == {"thinking": {"type": "enabled", "budget_tokens": 8000}}

    def test_anthropic_thinking_custom_budget(self):
        result = _build_reasoning_params(
            "anthropic", "claude-sonnet-4-20250514", reasoning=True, thinking_budget=16000
        )
        assert result["thinking"]["budget_tokens"] == 16000

    def test_anthropic_reasoning_effort_ignored(self):
        # Anthropic doesn't use reasoning_effort
        result = _build_reasoning_params(
            "anthropic", "claude-sonnet-4-20250514",
            reasoning=True, reasoning_effort="high"
        )
        assert "reasoning_effort" not in result
        assert "thinking" in result

    # --- OpenAI o-series reasoning_effort ---

    def test_openai_o1_default_effort(self):
        result = _build_reasoning_params("openai", "o1", reasoning=True)
        assert result == {"reasoning_effort": "medium"}

    def test_openai_o3_custom_effort(self):
        result = _build_reasoning_params("openai", "o3", reasoning=True, reasoning_effort="high")
        assert result == {"reasoning_effort": "high"}

    def test_openai_o4_mini_low_effort(self):
        result = _build_reasoning_params("openai", "o4-mini", reasoning=True, reasoning_effort="low")
        assert result == {"reasoning_effort": "low"}

    def test_openai_non_reasoning_model_returns_empty(self):
        # gpt-4o doesn't support reasoning_effort
        result = _build_reasoning_params("openai", "gpt-4o", reasoning=True)
        assert result == {}

    def test_openai_reasoning_effort_invalid_value_raises(self):
        with pytest.raises(ValueError, match="reasoning_effort"):
            _build_reasoning_params("openai", "o3", reasoning=True, reasoning_effort="ultra")

    # --- Google Gemini thinking ---

    def test_google_thinking_default_budget(self):
        result = _build_reasoning_params("google", "gemini-2.5-pro", reasoning=True)
        assert "thinking_config" in result
        assert result["thinking_config"]["thinking_budget"] == 8000

    def test_google_thinking_custom_budget(self):
        result = _build_reasoning_params(
            "google", "gemini-2.5-pro", reasoning=True, thinking_budget=4000
        )
        assert result["thinking_config"]["thinking_budget"] == 4000

    # --- Ollama (no reasoning support) ---

    def test_ollama_reasoning_returns_empty(self):
        result = _build_reasoning_params("ollama", "deepseek-r1", reasoning=True)
        assert result == {}


# =============================================================================
# _normalize_chunk
# =============================================================================

class TestNormalizeChunk:
    def _make_chunk(self, content="", thinking=None, tool_calls=None, finish_reason=None):
        delta = MagicMock()
        delta.content = content
        delta.thinking = thinking
        delta.tool_calls = tool_calls
        choice = MagicMock()
        choice.delta = delta
        choice.finish_reason = finish_reason
        chunk = MagicMock()
        chunk.choices = [choice]
        return chunk

    def test_text_content(self):
        chunk = self._make_chunk(content="hello")
        result = _normalize_chunk(chunk)
        assert result["content"] == "hello"
        assert result["reasoning"] is None

    def test_thinking_content(self):
        chunk = self._make_chunk(thinking="let me think...")
        result = _normalize_chunk(chunk)
        assert result["reasoning"] == "let me think..."

    def test_finish_reason(self):
        chunk = self._make_chunk(finish_reason="stop")
        result = _normalize_chunk(chunk)
        assert result["finish_reason"] == "stop"

    def test_empty_choices(self):
        chunk = MagicMock()
        chunk.choices = []
        result = _normalize_chunk(chunk)
        assert result["content"] == ""
        assert result["reasoning"] is None


# =============================================================================
# _normalize_response
# =============================================================================

class TestNormalizeResponse:
    def _make_response(self, content="", thinking=None, tool_calls=None, finish_reason="stop"):
        message = MagicMock()
        message.content = content
        message.thinking = thinking
        message.tool_calls = tool_calls
        choice = MagicMock()
        choice.message = message
        choice.finish_reason = finish_reason
        usage = MagicMock()
        usage.prompt_tokens = 10
        usage.completion_tokens = 20
        response = MagicMock()
        response.choices = [choice]
        response.usage = usage
        response.model = "test-model"
        return response

    def test_basic_content(self):
        response = self._make_response(content="answer")
        result = _normalize_response(response)
        assert result["content"] == "answer"
        assert result["reasoning"] is None
        assert result["finish_reason"] == "stop"

    def test_thinking_content(self):
        response = self._make_response(thinking="my reasoning")
        result = _normalize_response(response)
        assert result["reasoning"] == "my reasoning"

    def test_usage_tokens(self):
        response = self._make_response()
        result = _normalize_response(response)
        assert result["usage"]["input"] == 10
        assert result["usage"]["output"] == 20


# =============================================================================
# parse_model
# =============================================================================

class TestParseModel:
    def test_provider_slash_model(self):
        result = parse_model("openai/gpt-4o")
        assert result == {"provider_id": "openai", "model_id": "gpt-4o"}

    def test_known_model_without_provider(self):
        result = parse_model("gpt-4o")
        assert result["provider_id"] == "openai"
        assert result["model_id"] == "gpt-4o"

    def test_unknown_model_defaults_to_ollama(self):
        result = parse_model("some-local-model")
        assert result["provider_id"] == "ollama"
        assert result["model_id"] == "some-local-model"

    def test_anthropic_model_without_provider(self):
        result = parse_model("claude-sonnet-4-20250514")
        assert result["provider_id"] == "anthropic"


# =============================================================================
# complete() — tool call suppression
# =============================================================================

import src.provider.provider as provider_module


def _make_provider_with_model(function_calling: bool) -> Provider:
    """Helper: build a Provider with one model that has given function_calling cap."""
    model = Model(
        id="test-model",
        name="Test Model",
        provider_id="testprovider",
        capabilities=ModelCapabilities(function_calling=function_calling),
    )
    return Provider(
        id="testprovider",
        name="Test Provider",
        models=[model],
    )


@pytest.fixture(autouse=True)
def reset_provider_cache():
    """Reset module-level cache before each test."""
    clear_cache()
    yield
    clear_cache()


class TestCompleteToolSuppression:
    """complete() tool suppression logic.

    Priority (highest to lowest):
    1. config function_calling=False  → always suppress (explicit override)
    2. litellm.supports_function_calling → authoritative for known models
    3. default True                   → permissive for unknown/new models
    """

    TOOLS = [{"type": "function", "function": {"name": "bash", "parameters": {}}}]
    MESSAGES = [{"role": "user", "content": "hello"}]

    def _make_mock_response(self, model="test-model"):
        r = MagicMock()
        r.choices = [MagicMock()]
        r.choices[0].message.content = "ok"
        r.choices[0].message.tool_calls = None
        r.choices[0].message.thinking = None
        r.choices[0].finish_reason = "stop"
        r.usage = MagicMock(prompt_tokens=5, completion_tokens=5)
        r.model = model
        return r

    async def _run(self, model_str, provider, litellm_supports, tools="__default__"):
        """Helper: run complete() with mocked provider cache and litellm."""
        if tools == "__default__":
            tools = self.TOOLS
        captured: dict = {}

        async def fake_acompletion(**kwargs):
            captured.update(kwargs)
            return self._make_mock_response()

        provider_id = model_str.split("/")[0]
        with patch.object(provider_module, "_providers_cache", {provider_id: provider}):
            import litellm as _litellm
            with patch.object(_litellm, "acompletion", side_effect=fake_acompletion):
                with patch.object(
                    _litellm, "supports_function_calling", return_value=litellm_supports
                ):
                    await provider_module.complete(
                        model=model_str,
                        messages=self.MESSAGES,
                        tools=tools,
                    )
        return captured

    # --- config=False always wins ---

    @pytest.mark.asyncio
    async def test_config_false_suppresses_even_if_litellm_says_true(self):
        """Explicit config override: function_calling=False beats LiteLLM True."""
        provider = _make_provider_with_model(function_calling=False)
        captured = await self._run("testprovider/test-model", provider, litellm_supports=True)
        assert "tools" not in captured

    # --- LiteLLM is authoritative when config has no opinion ---

    @pytest.mark.asyncio
    async def test_litellm_false_suppresses_when_model_not_in_config(self):
        """LiteLLM says no → suppress, even though model not in our config."""
        provider = Provider(id="ollama", name="Ollama", models=[])  # no model registered
        captured = await self._run("ollama/deepseek-r1", provider, litellm_supports=False)
        assert "tools" not in captured

    @pytest.mark.asyncio
    async def test_litellm_true_passes_tools_when_model_not_in_config(self):
        """LiteLLM says yes → pass tools, even though model not in our config."""
        provider = Provider(id="ollama", name="Ollama", models=[])
        captured = await self._run("ollama/llama3", provider, litellm_supports=True)
        assert "tools" in captured

    # --- config=True + LiteLLM=True → pass ---

    @pytest.mark.asyncio
    async def test_both_true_passes_tools(self):
        """Both config and LiteLLM agree: pass tools."""
        provider = _make_provider_with_model(function_calling=True)
        captured = await self._run("testprovider/test-model", provider, litellm_supports=True)
        assert "tools" in captured
        assert captured["tools"] == self.TOOLS

    # --- config=True but LiteLLM=False → still pass (config is explicit opt-in) ---

    @pytest.mark.asyncio
    async def test_config_true_overrides_litellm_false(self):
        """Config explicitly enables tool call → trust it over LiteLLM False."""
        provider = _make_provider_with_model(function_calling=True)
        captured = await self._run("testprovider/test-model", provider, litellm_supports=False)
        assert "tools" in captured

    # --- no tools passed → nothing to suppress ---

    @pytest.mark.asyncio
    async def test_no_tools_arg_never_adds_tools(self):
        """When caller passes no tools, tools key never appears in request."""
        provider = _make_provider_with_model(function_calling=True)
        captured = await self._run(
            "testprovider/test-model", provider, litellm_supports=True, tools=None
        )
        assert "tools" not in captured


# =============================================================================
# _parse_model_config — LiteLLM auto-fill + config override
# =============================================================================

from src.provider.provider import _parse_model_config


class TestParseModelConfig:
    """_parse_model_config: capabilities and cost auto-filled from LiteLLM.

    Priority: config value > LiteLLM database > default
    """

    # --- LiteLLM known model: auto-fill capabilities ---

    def test_known_model_vision_from_litellm(self):
        """claude-sonnet-4 supports vision per LiteLLM — no config needed."""
        model = _parse_model_config("anthropic", {"id": "claude-sonnet-4-20250514"})
        assert model.capabilities.vision is True

    def test_known_model_function_calling_from_litellm(self):
        model = _parse_model_config("anthropic", {"id": "claude-sonnet-4-20250514"})
        assert model.capabilities.function_calling is True

    def test_known_model_reasoning_from_litellm(self):
        """claude-sonnet-4 supports reasoning per LiteLLM."""
        model = _parse_model_config("anthropic", {"id": "claude-sonnet-4-20250514"})
        assert model.capabilities.reasoning is True

    def test_known_model_cost_from_litellm(self):
        """Cost auto-converted from per-token to per-1M-tokens."""
        model = _parse_model_config("anthropic", {"id": "claude-sonnet-4-20250514"})
        # LiteLLM: input_cost_per_token = 3e-6 → 3.0 per 1M
        assert abs(model.cost.input - 3.0) < 0.01
        # LiteLLM: output_cost_per_token = 1.5e-5 → 15.0 per 1M
        assert abs(model.cost.output - 15.0) < 0.01

    def test_known_model_context_length_from_litellm(self):
        """Context length auto-filled from LiteLLM max_input_tokens."""
        model = _parse_model_config("anthropic", {"id": "claude-sonnet-4-20250514"})
        assert model.context_length == 1000000

    # --- Config overrides LiteLLM ---

    def test_config_vision_false_overrides_litellm_true(self):
        """Explicit config=False beats LiteLLM True."""
        model = _parse_model_config(
            "anthropic",
            {"id": "claude-sonnet-4-20250514", "capabilities": {"vision": False}},
        )
        assert model.capabilities.vision is False

    def test_config_function_calling_false_overrides_litellm_true(self):
        model = _parse_model_config(
            "anthropic",
            {"id": "claude-sonnet-4-20250514", "capabilities": {"function_calling": False}},
        )
        assert model.capabilities.function_calling is False

    def test_config_cost_overrides_litellm(self):
        """Explicit cost in config beats LiteLLM value."""
        model = _parse_model_config(
            "anthropic",
            {"id": "claude-sonnet-4-20250514", "cost": {"input": 99.0, "output": 199.0}},
        )
        assert model.cost.input == 99.0
        assert model.cost.output == 199.0

    def test_config_context_length_overrides_litellm(self):
        model = _parse_model_config(
            "anthropic",
            {"id": "claude-sonnet-4-20250514", "context_length": 50000},
        )
        assert model.context_length == 50000

    # --- Unknown model: use defaults ---

    def test_unknown_model_defaults_function_calling_true(self):
        """Unknown model not in LiteLLM → default function_calling=True (permissive)."""
        model = _parse_model_config("ollama", {"id": "my-custom-local-model"})
        assert model.capabilities.function_calling is True

    def test_unknown_model_defaults_vision_false(self):
        model = _parse_model_config("ollama", {"id": "my-custom-local-model"})
        assert model.capabilities.vision is False

    def test_unknown_model_defaults_reasoning_false(self):
        model = _parse_model_config("ollama", {"id": "my-custom-local-model"})
        assert model.capabilities.reasoning is False

    def test_unknown_model_defaults_cost_zero(self):
        model = _parse_model_config("ollama", {"id": "my-custom-local-model"})
        assert model.cost.input == 0.0
        assert model.cost.output == 0.0

    def test_unknown_model_config_overrides_default(self):
        """Config can still override defaults for unknown models."""
        model = _parse_model_config(
            "ollama",
            {
                "id": "my-custom-local-model",
                "capabilities": {"function_calling": False, "vision": True},
            },
        )
        assert model.capabilities.function_calling is False
        assert model.capabilities.vision is True

    # --- Model metadata ---

    def test_model_id_and_provider_id(self):
        model = _parse_model_config("openai", {"id": "gpt-4o"})
        assert model.id == "gpt-4o"
        assert model.provider_id == "openai"

    def test_model_name_defaults_to_id(self):
        model = _parse_model_config("ollama", {"id": "llama3"})
        assert model.name == "llama3"

    def test_model_name_from_config(self):
        model = _parse_model_config("ollama", {"id": "llama3", "name": "Llama 3"})
        assert model.name == "Llama 3"


# =============================================================================
# _discover_openai_compatible_models
# =============================================================================

import httpx
from src.provider.provider import _discover_openai_compatible_models


class TestDiscoverOpenAICompatibleModels:
    """_discover_openai_compatible_models: fetch model list from /v1/models."""

    def _make_response(self, model_ids: list[str], status_code: int = 200):
        data = {"data": [{"id": mid, "object": "model"} for mid in model_ids]}
        return httpx.Response(status_code, json=data)

    @pytest.mark.asyncio
    async def test_returns_models_from_api(self):
        """Successful /v1/models response → Model list."""
        resp = self._make_response(["deepseek-chat", "deepseek-reasoner"])
        with patch("httpx.AsyncClient.get", return_value=resp):
            models = await _discover_openai_compatible_models(
                provider_id="deepseek",
                base_url="https://api.deepseek.com/v1",
                api_key="sk-test",
            )
        assert len(models) == 2
        ids = [m.id for m in models]
        assert "deepseek-chat" in ids
        assert "deepseek-reasoner" in ids

    @pytest.mark.asyncio
    async def test_model_provider_id_set_correctly(self):
        resp = self._make_response(["deepseek-chat"])
        with patch("httpx.AsyncClient.get", return_value=resp):
            models = await _discover_openai_compatible_models(
                provider_id="deepseek",
                base_url="https://api.deepseek.com/v1",
                api_key="sk-test",
            )
        assert models[0].provider_id == "deepseek"

    @pytest.mark.asyncio
    async def test_capabilities_filled_from_litellm(self):
        """Known model → capabilities auto-filled from LiteLLM database."""
        resp = self._make_response(["deepseek-chat"])
        with patch("httpx.AsyncClient.get", return_value=resp):
            models = await _discover_openai_compatible_models(
                provider_id="deepseek",
                base_url="https://api.deepseek.com/v1",
                api_key="sk-test",
            )
        chat = models[0]
        assert chat.capabilities.function_calling is True

    @pytest.mark.asyncio
    async def test_unknown_model_uses_defaults(self):
        """Unknown model not in LiteLLM → safe defaults."""
        resp = self._make_response(["my-custom-model-xyz"])
        with patch("httpx.AsyncClient.get", return_value=resp):
            models = await _discover_openai_compatible_models(
                provider_id="deepseek",
                base_url="https://api.deepseek.com/v1",
                api_key="sk-test",
            )
        assert len(models) == 1
        assert models[0].capabilities.function_calling is True  # permissive default

    @pytest.mark.asyncio
    async def test_http_error_returns_empty_list(self):
        """Network error → empty list, no exception raised."""
        with patch("httpx.AsyncClient.get", side_effect=httpx.ConnectError("refused")):
            models = await _discover_openai_compatible_models(
                provider_id="deepseek",
                base_url="https://api.deepseek.com/v1",
                api_key="sk-test",
            )
        assert models == []

    @pytest.mark.asyncio
    async def test_non_200_returns_empty_list(self):
        """Non-200 response → empty list."""
        resp = httpx.Response(401, json={"error": "unauthorized"})
        with patch("httpx.AsyncClient.get", return_value=resp):
            models = await _discover_openai_compatible_models(
                provider_id="deepseek",
                base_url="https://api.deepseek.com/v1",
                api_key="bad-key",
            )
        assert models == []

    @pytest.mark.asyncio
    async def test_no_api_key_still_calls_endpoint(self):
        """No API key → still attempt (some providers don't require it)."""
        resp = self._make_response(["llama3"])
        with patch("httpx.AsyncClient.get", return_value=resp) as mock_get:
            await _discover_openai_compatible_models(
                provider_id="ollama",
                base_url="http://localhost:11434/v1",
                api_key=None,
            )
        mock_get.assert_called_once()
