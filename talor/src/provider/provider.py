"""Provider Module for Talor.

This module provides LLM provider management with rich domain models and
module-level functions for provider operations.

Provides:
- Provider and Model entities with behavior
- Module-level functions for provider discovery and LLM completion
- Cost calculation, capability checking encapsulated in entities
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any, AsyncIterator, Callable, Awaitable, TYPE_CHECKING

import httpx
from pydantic import BaseModel, Field

if TYPE_CHECKING:
    pass


logger = logging.getLogger(__name__)


# =============================================================================
# Module-level State (replaces ProviderService instance state)
# =============================================================================

_config_getter: Callable[[], Awaitable[dict[str, Any]]] | None = None
_providers_cache: dict[str, "Provider"] | None = None
_ollama_models_cache: list["Model"] | None = None
_ollama_cache_time: float = 0
_ollama_cache_ttl: float = 300  # 5 minutes


def configure(config_getter: Callable[[], Awaitable[dict[str, Any]]] | None = None) -> None:
    """Configure module-level state.

    Args:
        config_getter: Async function that returns config dict
    """
    global _config_getter
    _config_getter = config_getter


def clear_cache() -> None:
    """Clear all caches (useful for testing)."""
    global _providers_cache, _ollama_models_cache, _ollama_cache_time
    _providers_cache = None
    _ollama_models_cache = None
    _ollama_cache_time = 0


# =============================================================================
# Value Objects
# =============================================================================

class ModelCapabilities(BaseModel):
    """Model capabilities (Value Object)."""
    vision: bool = False
    function_calling: bool = True
    json_mode: bool = False
    streaming: bool = True
    reasoning: bool = False  # Extended thinking / reasoning mode support

    def supports(self, capability: str) -> bool:
        """Check if a capability is supported."""
        return getattr(self, capability, False)


class ModelCost(BaseModel):
    """Model cost per token (Value Object)."""
    input: float = 0.0  # Cost per 1M input tokens
    output: float = 0.0  # Cost per 1M output tokens
    cache_read: float = 0.0
    cache_write: float = 0.0

    @property
    def is_free(self) -> bool:
        """Check if model is free to use."""
        return self.input == 0.0 and self.output == 0.0


# =============================================================================
# Model Entity (Rich Domain Model)
# =============================================================================

class Model(BaseModel):
    """Model entity with state and behavior.

    A rich domain model that encapsulates:
    - Model configuration (state)
    - Cost calculation (behavior)
    - Token budget management (behavior)
    - Capability checking (behavior)
    """

    id: str
    name: str
    provider_id: str
    context_length: int = 128000
    max_output_tokens: int = 4096
    capabilities: ModelCapabilities = Field(default_factory=ModelCapabilities)
    cost: ModelCost = Field(default_factory=ModelCost)

    # =========================================================================
    # Properties
    # =========================================================================

    @property
    def full_id(self) -> str:
        """Get full model ID in provider/model format."""
        return f"{self.provider_id}/{self.id}"

    @property
    def is_free(self) -> bool:
        """Check if model is free to use."""
        return self.cost.is_free

    @property
    def supports_vision(self) -> bool:
        """Check if model supports vision."""
        return self.capabilities.vision

    @property
    def supports_tools(self) -> bool:
        """Check if model supports function calling."""
        return self.capabilities.function_calling

    @property
    def supports_streaming(self) -> bool:
        """Check if model supports streaming."""
        return self.capabilities.streaming

    # =========================================================================
    # Cost Calculation Behavior
    # =========================================================================

    def calculate_cost(self, input_tokens: int, output_tokens: int) -> float:
        """Calculate cost for a request.

        Args:
            input_tokens: Number of input tokens
            output_tokens: Number of output tokens

        Returns:
            Cost in dollars
        """
        input_cost = (input_tokens / 1_000_000) * self.cost.input
        output_cost = (output_tokens / 1_000_000) * self.cost.output
        return input_cost + output_cost

    def estimate_cost(self, text: str, estimated_output_tokens: int = 1000) -> float:
        """Estimate cost for a text input.

        Args:
            text: Input text
            estimated_output_tokens: Estimated output tokens

        Returns:
            Estimated cost in dollars
        """
        # Rough estimate: 4 chars per token
        input_tokens = len(text) // 4
        return self.calculate_cost(input_tokens, estimated_output_tokens)

    # =========================================================================
    # Token Budget Behavior
    # =========================================================================

    def get_available_context(self, reserved_output: int | None = None) -> int:
        """Get available context tokens for input.

        Args:
            reserved_output: Tokens to reserve for output

        Returns:
            Available input tokens
        """
        output_reserve = reserved_output or self.max_output_tokens
        return self.context_length - output_reserve

    def fits_in_context(self, token_count: int, output_reserve: int | None = None) -> bool:
        """Check if token count fits in context.

        Args:
            token_count: Number of tokens
            output_reserve: Tokens to reserve for output

        Returns:
            True if fits
        """
        available = self.get_available_context(output_reserve)
        return token_count <= available

    def get_summarization_threshold(self, ratio: float = 0.8) -> int:
        """Get token count that triggers summarization.

        Args:
            ratio: Threshold ratio (default 80%)

        Returns:
            Token count threshold
        """
        return int(self.context_length * ratio)

    # =========================================================================
    # Capability Checking Behavior
    # =========================================================================

    def validate_for_task(self, requires_vision: bool = False, requires_tools: bool = False) -> None:
        """Validate model capabilities for a task.

        Args:
            requires_vision: Task requires vision
            requires_tools: Task requires tool calling

        Raises:
            ValueError: If model doesn't support required capabilities
        """
        if requires_vision and not self.supports_vision:
            raise ValueError(f"Model {self.id} does not support vision")
        if requires_tools and not self.supports_tools:
            raise ValueError(f"Model {self.id} does not support function calling")


# =============================================================================
# Provider Entity (Rich Domain Model)
# =============================================================================

class Provider(BaseModel):
    """Provider entity with state and behavior.

    A rich domain model that encapsulates:
    - Provider configuration (state)
    - Model lookup (behavior)
    - API key management (behavior)
    - URL construction (behavior)
    """

    id: str
    name: str
    api_key_env: str | None = None
    base_url: str | None = None
    auto_discover: bool = False
    models: list[Model] = Field(default_factory=list)

    # =========================================================================
    # Properties
    # =========================================================================

    @property
    def requires_api_key(self) -> bool:
        """Check if provider requires an API key."""
        return self.api_key_env is not None

    @property
    def model_count(self) -> int:
        """Get number of available models."""
        return len(self.models)

    @property
    def model_ids(self) -> list[str]:
        """Get list of model IDs."""
        return [m.id for m in self.models]

    # =========================================================================
    # Model Lookup Behavior
    # =========================================================================

    def get_model(self, model_id: str) -> Model | None:
        """Get a model by ID.

        Args:
            model_id: Model ID

        Returns:
            Model or None
        """
        for model in self.models:
            if model.id == model_id:
                return model
        return None

    def has_model(self, model_id: str) -> bool:
        """Check if provider has a model.

        Args:
            model_id: Model ID

        Returns:
            True if model exists
        """
        return self.get_model(model_id) is not None

    def get_cheapest_model(self) -> Model | None:
        """Get the cheapest model.

        Returns:
            Cheapest Model or None
        """
        if not self.models:
            return None
        return min(self.models, key=lambda m: m.cost.input + m.cost.output)

    def get_models_with_capability(self, capability: str) -> list[Model]:
        """Get models with a specific capability.

        Args:
            capability: Capability name (vision, function_calling, etc.)

        Returns:
            List of matching models
        """
        return [m for m in self.models if m.capabilities.supports(capability)]

    def add_model(self, model: Model) -> "Provider":
        """Add a model to the provider.

        Creates a new Provider with the model added.

        Args:
            model: Model to add

        Returns:
            New Provider with model added

        Raises:
            ValueError: If model with same ID already exists
        """
        if self.has_model(model.id):
            raise ValueError(f"Model '{model.id}' already exists in provider '{self.id}'")

        new_models = list(self.models) + [model]
        return self.model_copy(update={"models": new_models})

    def replace_models(self, models: list[Model]) -> "Provider":
        """Replace all models in the provider.

        Creates a new Provider with the new models list.

        Args:
            models: New models list

        Returns:
            New Provider with replaced models
        """
        return self.model_copy(update={"models": models})

    def with_base_url(self, base_url: str) -> "Provider":
        """Create a new provider with different base URL.

        Args:
            base_url: New base URL

        Returns:
            New Provider with updated base URL
        """
        return self.model_copy(update={"base_url": base_url})

    # =========================================================================
    # API Key Behavior
    # =========================================================================

    def get_api_key(self) -> str | None:
        """Get API key from environment.

        Returns:
            API key or None
        """
        if not self.api_key_env:
            return None
        return os.environ.get(self.api_key_env)

    def has_api_key(self) -> bool:
        """Check if API key is available.

        Returns:
            True if API key is set
        """
        if not self.requires_api_key:
            return True
        return self.get_api_key() is not None

    def validate_api_key(self) -> None:
        """Validate that API key is available.

        Raises:
            ValueError: If API key is required but not set
        """
        if self.requires_api_key and not self.has_api_key():
            raise ValueError(
                f"API key not found for provider {self.id}. "
                f"Set environment variable: {self.api_key_env}"
            )

    # =========================================================================
    # URL Behavior
    # =========================================================================

    def get_api_base_url(self) -> str | None:
        """Get API base URL (without /v1 suffix for some APIs)."""
        if not self.base_url:
            return None
        return self.base_url.replace("/v1", "")


# =============================================================================
# Default Providers (used when config file has no providers section)
# =============================================================================

DEFAULT_PROVIDERS_CONFIG: dict[str, dict] = {
    "ollama": {
        "name": "Ollama",
        "api_key_env": None,
        "base_url": "http://localhost:11434/v1",
        "auto_discover": True,
        "models": [],
    },
    "openai": {
        "name": "OpenAI",
        "api_key_env": "OPENAI_API_KEY",
        "base_url": "https://api.openai.com/v1",
        "models": [
            {
                "id": "gpt-4o",
                "name": "GPT-4o",
                "context_length": 128000,
                "max_output_tokens": 16384,
                "capabilities": {"vision": True, "function_calling": True},
                "cost": {"input": 2.5, "output": 10.0},
            },
            {
                "id": "gpt-4o-mini",
                "name": "GPT-4o Mini",
                "context_length": 128000,
                "max_output_tokens": 16384,
                "capabilities": {"vision": True, "function_calling": True},
                "cost": {"input": 0.15, "output": 0.6},
            },
            # o-series: reasoning models, support function calling
            {
                "id": "o3",
                "name": "o3",
                "context_length": 200000,
                "max_output_tokens": 100000,
                "capabilities": {"vision": True, "function_calling": True, "reasoning": True},
                "cost": {"input": 2.0, "output": 8.0},
            },
            {
                "id": "o4-mini",
                "name": "o4-mini",
                "context_length": 200000,
                "max_output_tokens": 100000,
                "capabilities": {"vision": True, "function_calling": True, "reasoning": True},
                "cost": {"input": 1.1, "output": 4.4},
            },
        ],
    },
    "anthropic": {
        "name": "Anthropic",
        "api_key_env": "ANTHROPIC_API_KEY",
        "base_url": "https://api.anthropic.com",
        "models": [
            {
                "id": "claude-sonnet-4-20250514",
                "name": "Claude Sonnet 4",
                "context_length": 200000,
                "max_output_tokens": 16384,
                "capabilities": {
                    "vision": True,
                    "function_calling": True,
                    "reasoning": True,  # extended thinking supported
                },
                "cost": {"input": 3.0, "output": 15.0},
            },
            {
                "id": "claude-opus-4-5",
                "name": "Claude Opus 4.5",
                "context_length": 200000,
                "max_output_tokens": 32000,
                "capabilities": {
                    "vision": True,
                    "function_calling": True,
                    "reasoning": True,
                },
                "cost": {"input": 15.0, "output": 75.0},
            },
            {
                "id": "claude-3-5-haiku-20241022",
                "name": "Claude 3.5 Haiku",
                "context_length": 200000,
                "max_output_tokens": 8192,
                "capabilities": {"vision": True, "function_calling": True},
                "cost": {"input": 0.8, "output": 4.0},
            },
        ],
    },
    "google": {
        "name": "Google AI",
        "api_key_env": "GOOGLE_API_KEY",
        "models": [
            {
                "id": "gemini-2.5-pro",
                "name": "Gemini 2.5 Pro",
                "context_length": 1000000,
                "max_output_tokens": 65536,
                "capabilities": {
                    "vision": True,
                    "function_calling": True,
                    "reasoning": True,  # thinking_config supported
                },
                "cost": {"input": 1.25, "output": 10.0},
            },
            {
                "id": "gemini-2.5-flash",
                "name": "Gemini 2.5 Flash",
                "context_length": 1000000,
                "max_output_tokens": 65536,
                "capabilities": {
                    "vision": True,
                    "function_calling": True,
                    "reasoning": True,
                },
                "cost": {"input": 0.15, "output": 0.6},
            },
        ],
    },
}


# =============================================================================
# Internal Functions (Provider Discovery & Loading)
# =============================================================================

def _get_litellm_model_info(provider_id: str, model_id: str) -> dict:
    """Query LiteLLM's built-in model database for capabilities and cost.

    LiteLLM maintains a comprehensive model_cost dict with fields like:
    - supports_function_calling, supports_vision, supports_reasoning
    - max_input_tokens, max_output_tokens
    - input_cost_per_token, output_cost_per_token

    Args:
        provider_id: Provider ID (e.g. "anthropic", "openai")
        model_id: Model ID (e.g. "claude-sonnet-4-20250514")

    Returns:
        LiteLLM model info dict, or empty dict if not found
    """
    import litellm

    cost_map = litellm.model_cost

    # Try various key formats LiteLLM uses
    candidates = [
        model_id,
        f"{provider_id}/{model_id}",
        f"{provider_id}.{model_id}",
    ]
    for key in candidates:
        info = cost_map.get(key)
        if info:
            return info

    return {}


def _parse_model_config(provider_id: str, model_config: dict) -> Model:
    """Parse a model configuration dict into a Model entity.

    Capabilities and cost are auto-populated from LiteLLM's model database.
    Values in model_config act as explicit overrides (highest priority).

    Priority for each field:
        config value  >  LiteLLM database  >  default

    Args:
        provider_id: Provider ID
        model_config: Model configuration dict

    Returns:
        Model entity
    """
    model_id = model_config["id"]
    litellm_info = _get_litellm_model_info(provider_id, model_id)

    capabilities_config = model_config.get("capabilities", {})
    cost_config = model_config.get("cost", {})

    # --- capabilities: config > litellm > default ---
    def cap(key: str, litellm_key: str, default: bool) -> bool:
        if key in capabilities_config:
            return bool(capabilities_config[key])
        return bool(litellm_info.get(litellm_key, default))

    # --- numeric fields: config > litellm > default ---
    def num(config_key: str, litellm_key: str, default: float) -> float:
        if config_key in model_config:
            return float(model_config[config_key])
        return float(litellm_info.get(litellm_key, default))

    def cost_field(config_key: str, litellm_key: str) -> float:
        if config_key in cost_config:
            return float(cost_config[config_key])
        raw = litellm_info.get(litellm_key, 0.0)
        # LiteLLM stores cost per token; convert to per 1M tokens
        return float(raw) * 1_000_000

    return Model(
        id=model_id,
        name=model_config.get("name", model_id),
        provider_id=provider_id,
        context_length=int(num("context_length", "max_input_tokens", 128000)),
        max_output_tokens=int(num("max_output_tokens", "max_output_tokens", 4096)),
        capabilities=ModelCapabilities(
            vision=cap("vision", "supports_vision", False),
            function_calling=cap("function_calling", "supports_function_calling", True),
            json_mode=cap("json_mode", "supports_response_schema", False),
            streaming=cap("streaming", "supports_streaming", True),
            reasoning=cap("reasoning", "supports_reasoning", False),
        ),
        cost=ModelCost(
            input=cost_field("input", "input_cost_per_token"),
            output=cost_field("output", "output_cost_per_token"),
            cache_read=cost_field("cache_read", "cache_read_input_token_cost"),
            cache_write=cost_field("cache_write", "cache_creation_input_token_cost"),
        ),
    )


def _parse_provider_config(provider_id: str, provider_config: dict) -> Provider:
    """Parse a provider configuration dict into a Provider entity.

    Args:
        provider_id: Provider ID
        provider_config: Provider configuration dict

    Returns:
        Provider entity
    """
    models = [
        _parse_model_config(provider_id, m)
        for m in provider_config.get("models", [])
    ]

    return Provider(
        id=provider_id,
        name=provider_config.get("name", provider_id),
        api_key_env=provider_config.get("api_key_env"),
        base_url=provider_config.get("base_url"),
        auto_discover=provider_config.get("auto_discover", False),
        models=models,
    )


async def _discover_openai_compatible_models(
    provider_id: str,
    base_url: str,
    api_key: str | None = None,
) -> list[Model]:
    """Discover models via OpenAI-compatible GET /v1/models endpoint.

    Works with any provider that implements the OpenAI models API:
    DeepSeek, OpenRouter, Together AI, local servers, etc.

    Capabilities are auto-filled from LiteLLM's model database using
    _parse_model_config, so known models get accurate capability info.

    Args:
        provider_id: Provider ID (used for model.provider_id and LiteLLM lookup)
        base_url: Provider base URL (should end with /v1)
        api_key: Optional API key for Authorization header

    Returns:
        List of discovered Model entities, empty list on any error
    """
    models: list[Model] = []
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{base_url}/models", headers=headers)
            if response.status_code != 200:
                logger.warning(
                    f"GET {base_url}/models returned {response.status_code} for provider '{provider_id}'"
                )
                return []

            data = response.json()
            for item in data.get("data", []):
                model_id = item.get("id", "")
                if not model_id:
                    continue
                # Reuse _parse_model_config so LiteLLM fills capabilities/cost
                model = _parse_model_config(provider_id, {"id": model_id})
                models.append(model)

            logger.info(f"Discovered {len(models)} models from {base_url}/models ({provider_id})")

    except Exception as e:
        logger.warning(f"Failed to discover models from {base_url}/models: {e}")

    return models


async def _discover_ollama_models(
    provider_id: str,
    base_url: str = "http://localhost:11434",
) -> list[Model]:
    """Discover available Ollama models via API.

    Args:
        provider_id: Provider ID (for model.provider_id)
        base_url: Ollama API base URL

    Returns:
        List of discovered Model
    """
    global _ollama_models_cache, _ollama_cache_time

    # Check cache
    current_time = time.time()
    if (
        _ollama_models_cache is not None
        and (current_time - _ollama_cache_time) < _ollama_cache_ttl
    ):
        logger.debug("Using cached Ollama models")
        return _ollama_models_cache

    models: list[Model] = []

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{base_url}/api/tags")
            response.raise_for_status()
            data = response.json()

            for model_data in data.get("models", []):
                model_name = model_data.get("name", "")
                if not model_name:
                    continue

                details = model_data.get("details", {})
                parameter_size = details.get("parameter_size", "")

                # Estimate context length based on model name
                context_length = 32768
                if "llama3" in model_name.lower():
                    context_length = 128000
                elif "qwen" in model_name.lower():
                    context_length = 32768
                elif "deepseek" in model_name.lower():
                    context_length = 64000

                display_name = model_name.replace(":", " ").title()
                if parameter_size:
                    display_name = f"{display_name} ({parameter_size})"

                models.append(Model(
                    id=model_name,
                    name=display_name,
                    provider_id=provider_id,
                    context_length=context_length,
                    max_output_tokens=8192,
                    capabilities=ModelCapabilities(function_calling=True),
                    cost=ModelCost(input=0.0, output=0.0),
                ))

            logger.info(f"Discovered {len(models)} Ollama models")
            _ollama_models_cache = models
            _ollama_cache_time = current_time

    except Exception as e:
        logger.warning(f"Failed to discover Ollama models: {e}")
        if _ollama_models_cache:
            return _ollama_models_cache

    return models


async def _load_providers() -> dict[str, Provider]:
    """Load all providers from configuration.

    Loading priority:
    1. Config file "providers" section (full control)
    2. Default providers (fallback when no config)

    For providers with auto_discover=True (like Ollama),
    models are discovered via API and merged with configured models.

    Returns:
        Dict of provider_id -> Provider
    """
    global _providers_cache

    if _providers_cache is not None:
        return _providers_cache

    providers: dict[str, Provider] = {}
    providers_config: dict[str, dict] = {}

    # Load from config file if available
    if _config_getter:
        config = await _config_getter()
        providers_config = config.get("providers", {})

    # Fall back to defaults if no providers configured
    if not providers_config:
        providers_config = DEFAULT_PROVIDERS_CONFIG

    # Parse each provider from config
    for provider_id, provider_config in providers_config.items():
        provider = _parse_provider_config(provider_id, provider_config)

        # Auto-discover models for providers that support it
        if provider_config.get("auto_discover", False):
            base_url = provider.base_url or "http://localhost:11434/v1"
            api_base_url = base_url.replace("/v1", "")
            api_key = provider.get_api_key()

            if provider_id == "ollama":
                # Ollama uses /api/tags which returns richer metadata
                discovered_models = await _discover_ollama_models(provider_id, api_base_url)
            else:
                # Generic OpenAI-compatible /v1/models endpoint
                discovered_models = await _discover_openai_compatible_models(
                    provider_id, base_url, api_key
                )

            if discovered_models:
                # Merge: discovered models + configured models (configured takes precedence)
                configured_ids = {m.id for m in provider.models}
                merged_models = list(provider.models)
                for model in discovered_models:
                    if model.id not in configured_ids:
                        merged_models.append(model)
                provider = provider.replace_models(merged_models)

        providers[provider_id] = provider

    _providers_cache = providers
    return providers


# =============================================================================
# Module-level Functions (replaces ProviderService methods)
# =============================================================================

async def list_providers() -> list[Provider]:
    """List all providers.

    Returns:
        List of Provider
    """
    providers = await _load_providers()
    return list(providers.values())


async def get_provider(provider_id: str) -> Provider | None:
    """Get a provider by ID.

    Args:
        provider_id: Provider ID

    Returns:
        Provider or None
    """
    providers = await _load_providers()
    return providers.get(provider_id)


async def get_model(
    provider_id: str,
    model_id: str,
) -> Model | None:
    """Get a model by provider and model ID.

    Args:
        provider_id: Provider ID
        model_id: Model ID

    Returns:
        Model or None
    """
    provider = await get_provider(provider_id)
    if not provider:
        return None

    for model in provider.models:
        if model.id == model_id:
            return model

    return None


async def get_default_model() -> dict[str, str]:
    """Get the default model.

    Returns:
        Dict with provider_id and model_id
    """
    default = {"provider_id": "ollama", "model_id": "deepseek-v3.1:671b-cloud"}

    if _config_getter:
        config = await _config_getter()
        default_model = config.get("default_model")
        if default_model:
            if "/" in default_model:
                provider_id, model_id = default_model.split("/", 1)
                default = {"provider_id": provider_id, "model_id": model_id}
            else:
                default["model_id"] = default_model

    return default


def parse_model(model_str: str) -> dict[str, str]:
    """Parse a model string.

    Args:
        model_str: Model string like "openai/gpt-4" or "gpt-4"

    Returns:
        Dict with provider_id and model_id
    """
    if "/" in model_str:
        provider_id, model_id = model_str.split("/", 1)
        return {"provider_id": provider_id, "model_id": model_id}

    # Try to find model in default providers
    for provider_id, provider_config in DEFAULT_PROVIDERS_CONFIG.items():
        for model in provider_config.get("models", []):
            if model["id"] == model_str:
                return {"provider_id": provider_id, "model_id": model_str}

    # Default to ollama
    return {"provider_id": "ollama", "model_id": model_str}


# =============================================================================
# LLM Completion Functions (unified via LiteLLM)
# =============================================================================

def _build_litellm_model_str(provider_id: str, model_id: str, base_url: str | None) -> str:
    """Build the model string LiteLLM expects.

    LiteLLM routing:
    - openai/gpt-4o          → OpenAI
    - anthropic/claude-*     → Anthropic
    - ollama/llama3          → Ollama (needs api_base)
    - ollama_chat/llama3     → Ollama chat endpoint
    - gemini/gemini-2.5-pro  → Google AI
    - azure/gpt-4            → Azure OpenAI
    """
    if provider_id == "ollama":
        return f"ollama_chat/{model_id}"
    return f"{provider_id}/{model_id}"


_VALID_REASONING_EFFORTS = {"low", "medium", "high"}
_OPENAI_REASONING_MODEL_PREFIXES = ("o1", "o3", "o4")


def _build_reasoning_params(
    provider_id: str,
    model_id: str,
    reasoning: bool = False,
    thinking_budget: int | None = None,
    reasoning_effort: str | None = None,
) -> dict[str, Any]:
    """Build provider-specific reasoning/thinking parameters.

    Two independent concepts:
    - reasoning (bool): Enable extended thinking / reasoning mode.
      Produces a separate reasoning chain alongside the response.
      Supported by Anthropic (thinking blocks) and Google (thinking_config).
    - reasoning_effort (str): "low" | "medium" | "high" — controls how much
      compute the model spends on reasoning. Used by OpenAI o-series models.

    Args:
        provider_id: Provider ID
        model_id: Model ID
        reasoning: Enable extended thinking (Anthropic / Google)
        thinking_budget: Max tokens for the thinking chain (default 8000)
        reasoning_effort: Effort level for OpenAI o-series ("low"/"medium"/"high")

    Returns:
        Extra kwargs to pass to litellm.acompletion

    Raises:
        ValueError: If reasoning_effort is not a valid value
    """
    if reasoning_effort is not None and reasoning_effort not in _VALID_REASONING_EFFORTS:
        raise ValueError(
            f"reasoning_effort must be one of {_VALID_REASONING_EFFORTS}, got '{reasoning_effort}'"
        )

    if not reasoning and reasoning_effort is None:
        return {}

    budget = thinking_budget or 8000

    if provider_id == "anthropic":
        # Claude extended thinking — reasoning_effort not applicable
        if not reasoning:
            return {}
        return {"thinking": {"type": "enabled", "budget_tokens": budget}}

    if provider_id == "openai":
        # o1/o3/o4 series support reasoning_effort
        is_reasoning_model = any(model_id.startswith(p) for p in _OPENAI_REASONING_MODEL_PREFIXES)
        if not is_reasoning_model:
            return {}
        effort = reasoning_effort or "medium"
        return {"reasoning_effort": effort}

    if provider_id == "google":
        # Gemini 2.5+ extended thinking via thinking_config
        if not reasoning:
            return {}
        return {"thinking_config": {"thinking_budget": budget}}

    # Ollama and others: no reasoning support
    return {}


def _normalize_chunk(chunk: Any) -> dict[str, Any]:
    """Normalize a LiteLLM streaming chunk to internal format.

    Internal format:
        {
            "content": str,           # text delta (may be empty)
            "reasoning": str | None,  # reasoning/thinking delta
            "tool_calls": list | None,
            "finish_reason": str | None,
        }
    """
    result: dict[str, Any] = {
        "content": "",
        "reasoning": None,
        "tool_calls": None,
        "finish_reason": None,
    }

    if not chunk.choices:
        return result

    choice = chunk.choices[0]
    delta = getattr(choice, "delta", None)

    if delta:
        result["content"] = delta.content or ""

        # Reasoning / thinking content (Anthropic extended thinking)
        thinking = getattr(delta, "thinking", None)
        if thinking:
            result["reasoning"] = thinking

        # Tool calls
        if getattr(delta, "tool_calls", None):
            result["tool_calls"] = [
                tc.model_dump() if hasattr(tc, "model_dump") else tc
                for tc in delta.tool_calls
            ]

    result["finish_reason"] = getattr(choice, "finish_reason", None)
    return result


def _normalize_response(response: Any) -> dict[str, Any]:
    """Normalize a LiteLLM non-streaming response to internal format."""
    choice = response.choices[0]
    message = choice.message

    content = message.content or ""
    tool_calls = None
    reasoning = None

    # Reasoning content (Anthropic thinking blocks come as separate content blocks)
    thinking = getattr(message, "thinking", None)
    if thinking:
        reasoning = thinking

    if getattr(message, "tool_calls", None):
        tool_calls = [
            tc.model_dump() if hasattr(tc, "model_dump") else tc
            for tc in message.tool_calls
        ]

    usage = getattr(response, "usage", None)
    return {
        "content": content,
        "reasoning": reasoning,
        "tool_calls": tool_calls,
        "finish_reason": choice.finish_reason,
        "model": getattr(response, "model", ""),
        "usage": {
            "input": getattr(usage, "prompt_tokens", 0) if usage else 0,
            "output": getattr(usage, "completion_tokens", 0) if usage else 0,
        },
    }


async def complete(
    model: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    stream: bool = False,
    reasoning: bool = False,
    thinking_budget: int | None = None,
    reasoning_effort: str | None = None,
    **kwargs: Any,
) -> dict[str, Any] | AsyncIterator[dict[str, Any]]:
    """Complete a chat request via LiteLLM.

    Supports all providers (OpenAI, Anthropic, Ollama, Google, Azure, etc.)
    through a unified interface.

    Args:
        model: Model string "provider/model" (e.g. "anthropic/claude-sonnet-4-20250514")
        messages: Chat messages in OpenAI format
        tools: Optional tool definitions in OpenAI format
        stream: Whether to stream response
        reasoning: Enable extended thinking mode (Anthropic / Google).
            Produces a separate reasoning chain in the response.
        thinking_budget: Max tokens for the thinking chain (default 8000).
            Used by Anthropic and Google when reasoning=True.
        reasoning_effort: Effort level for OpenAI o-series: "low"/"medium"/"high".
            Independent of reasoning flag — applies to o1/o3/o4 models.
        **kwargs: Additional litellm parameters

    Returns:
        Normalized response dict or async iterator of normalized chunks
    """
    import litellm

    model_info = parse_model(model)
    provider_id = model_info["provider_id"]
    model_id = model_info["model_id"]

    provider = await get_provider(provider_id)
    if not provider:
        raise ValueError(f"Provider not found: {provider_id}")

    # Resolve API key
    api_key = None
    if provider.api_key_env:
        api_key = os.environ.get(provider.api_key_env)
        if not api_key:
            raise ValueError(
                f"API key not found for provider '{provider_id}'. "
                f"Set environment variable: {provider.api_key_env}"
            )

    litellm_model = _build_litellm_model_str(provider_id, model_id, provider.base_url)

    # Determine if this model supports function calling.
    # Priority (highest → lowest):
    #   1. config function_calling=False  → always suppress (explicit opt-out)
    #   2. config function_calling=True   → always allow  (explicit opt-in)
    #   3. litellm.supports_function_calling → authoritative for known models
    #   4. default True                   → permissive for unknown/new models
    model_obj = provider.get_model(model_id)
    if model_obj is not None:
        # Config has an explicit opinion — trust it
        supports_tools = model_obj.capabilities.function_calling
    else:
        # No config entry: ask LiteLLM, fall back to True if it raises
        try:
            supports_tools = litellm.supports_function_calling(model=litellm_model)
        except Exception:
            supports_tools = True

    params: dict[str, Any] = {
        "model": litellm_model,
        "messages": messages,
        "stream": stream,
    }

    if tools and supports_tools:
        params["tools"] = tools
    elif tools and not supports_tools:
        logger.debug(
            f"Model '{model_id}' does not support function calling — tools suppressed"
        )

    if api_key:
        params["api_key"] = api_key

    if provider.base_url:
        # ollama_chat/ uses native Ollama API (/api/chat), not OpenAI-compatible /v1
        if provider_id == "ollama":
            params["api_base"] = provider.get_api_base_url()
        else:
            params["api_base"] = provider.base_url

    # Reasoning / thinking mode
    reasoning_params = _build_reasoning_params(
        provider_id, model_id, reasoning, thinking_budget, reasoning_effort
    )
    params.update(reasoning_params)

    params.update(kwargs)

    if stream:
        async def stream_response() -> AsyncIterator[dict[str, Any]]:
            response = await litellm.acompletion(**params)
            async for chunk in response:
                yield _normalize_chunk(chunk)

        return stream_response()
    else:
        response = await litellm.acompletion(**params)
        return _normalize_response(response)


# =============================================================================
# Backward-compatible ProviderService class
# =============================================================================

class ProviderService:
    """Application service for LLM provider operations.

    This class is provided for backward compatibility.
    New code should use the module-level functions directly.

    Manages:
    - Provider discovery and configuration
    - Model information
    - LLM completions (streaming and non-streaming)
    """

    def __init__(
        self,
        config_service: Any | None = None,
    ) -> None:
        """Initialize service.

        Args:
            config_service: Config service for loading provider settings
        """
        # Configure module-level state if config_service is provided
        if config_service is not None:
            configure(config_getter=config_service.get)

    def clear_cache(self) -> None:
        """Clear all caches."""
        clear_cache()

    async def list_providers(self) -> list[Provider]:
        """List all providers."""
        return await list_providers()

    async def get_provider(self, provider_id: str) -> Provider | None:
        """Get a provider by ID."""
        return await get_provider(provider_id)

    async def get_model(
        self,
        provider_id: str,
        model_id: str,
    ) -> Model | None:
        """Get a model by provider and model ID."""
        return await get_model(provider_id, model_id)

    async def get_default_model(self) -> dict[str, str]:
        """Get the default model."""
        return await get_default_model()

    def parse_model(self, model_str: str) -> dict[str, str]:
        """Parse a model string."""
        return parse_model(model_str)

    async def complete(
        self,
        model: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        stream: bool = False,
        reasoning: bool = False,
        thinking_budget: int | None = None,
        reasoning_effort: str | None = None,
        **kwargs: Any,
    ) -> dict[str, Any] | AsyncIterator[dict[str, Any]]:
        """Complete a chat request."""
        return await complete(
            model, messages, tools, stream,
            reasoning, thinking_budget, reasoning_effort,
            **kwargs,
        )



