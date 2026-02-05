"""Provider Module for Talor.

This module provides LLM provider management with rich domain models and
module-level functions for provider operations.

Provides:
- Provider and Model entities with behavior
- Module-level functions for provider discovery and LLM completion
- Cost calculation, capability checking encapsulated in entities
"""

from __future__ import annotations

import json
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
                "capabilities": {"vision": True, "function_calling": True},
                "cost": {"input": 3.0, "output": 15.0},
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
                "capabilities": {"vision": True, "function_calling": True},
                "cost": {"input": 1.25, "output": 10.0},
            },
        ],
    },
}


# =============================================================================
# Internal Functions (Provider Discovery & Loading)
# =============================================================================

def _parse_model_config(provider_id: str, model_config: dict) -> Model:
    """Parse a model configuration dict into a Model entity.

    Args:
        provider_id: Provider ID
        model_config: Model configuration dict

    Returns:
        Model entity
    """
    capabilities_config = model_config.get("capabilities", {})
    cost_config = model_config.get("cost", {})

    return Model(
        id=model_config["id"],
        name=model_config.get("name", model_config["id"]),
        provider_id=provider_id,
        context_length=model_config.get("context_length", 128000),
        max_output_tokens=model_config.get("max_output_tokens", 4096),
        capabilities=ModelCapabilities(
            vision=capabilities_config.get("vision", False),
            function_calling=capabilities_config.get("function_calling", True),
            json_mode=capabilities_config.get("json_mode", False),
            streaming=capabilities_config.get("streaming", True),
        ),
        cost=ModelCost(
            input=cost_config.get("input", 0.0),
            output=cost_config.get("output", 0.0),
            cache_read=cost_config.get("cache_read", 0.0),
            cache_write=cost_config.get("cache_write", 0.0),
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

        # Auto-discover models for providers that support it (e.g., Ollama)
        if provider_config.get("auto_discover", False):
            base_url = provider.base_url or "http://localhost:11434/v1"
            api_base_url = base_url.replace("/v1", "")
            discovered_models = await _discover_ollama_models(provider_id, api_base_url)

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
# LLM Completion Functions
# =============================================================================

async def complete(
    model: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    stream: bool = False,
    **kwargs: Any,
) -> dict[str, Any] | AsyncIterator[dict[str, Any]]:
    """Complete a chat request.

    Args:
        model: Model ID or "provider/model"
        messages: Chat messages
        tools: Optional tool definitions
        stream: Whether to stream response
        **kwargs: Additional parameters

    Returns:
        Response dict or async iterator of chunks
    """
    model_info = parse_model(model)
    provider_id = model_info["provider_id"]
    model_id = model_info["model_id"]

    provider = await get_provider(provider_id)
    if not provider:
        raise ValueError(f"Provider not found: {provider_id}")

    api_key = None
    if provider.api_key_env:
        api_key = os.environ.get(provider.api_key_env)

    if provider.api_key_env and not api_key:
        raise ValueError(f"API key not found for provider: {provider_id}")

    if not api_key:
        api_key = "ollama"

    if provider_id == "openai":
        return await _complete_openai(
            api_key=api_key,
            base_url=provider.base_url,
            model=model_id,
            messages=messages,
            tools=tools,
            stream=stream,
            **kwargs,
        )
    elif provider_id == "anthropic":
        return await _complete_anthropic(
            api_key=api_key,
            model=model_id,
            messages=messages,
            tools=tools,
            stream=stream,
            **kwargs,
        )
    else:
        return await _complete_openai(
            api_key=api_key,
            base_url=provider.base_url,
            model=model_id,
            messages=messages,
            tools=tools,
            stream=stream,
            **kwargs,
        )


async def _complete_openai(
    api_key: str,
    base_url: str | None,
    model: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    stream: bool = False,
    **kwargs: Any,
) -> dict[str, Any] | AsyncIterator[dict[str, Any]]:
    """Complete using OpenAI API."""
    try:
        from openai import AsyncOpenAI
    except ImportError:
        raise ImportError("openai package required: pip install openai")

    client = AsyncOpenAI(api_key=api_key, base_url=base_url)

    params: dict[str, Any] = {
        "model": model,
        "messages": messages,
    }

    if tools:
        params["tools"] = tools

    params.update(kwargs)

    if stream:
        async def stream_response() -> AsyncIterator[dict[str, Any]]:
            response = await client.chat.completions.create(**params, stream=True)
            async for chunk in response:
                delta = chunk.choices[0].delta if chunk.choices else None
                if delta:
                    yield {
                        "content": delta.content or "",
                        "tool_calls": (
                            [tc.model_dump() for tc in delta.tool_calls]
                            if delta.tool_calls
                            else None
                        ),
                        "finish_reason": (
                            chunk.choices[0].finish_reason if chunk.choices else None
                        ),
                        "model": chunk.model,
                    }
        return stream_response()
    else:
        response = await client.chat.completions.create(**params)
        choice = response.choices[0]
        return {
            "content": choice.message.content or "",
            "tool_calls": (
                [tc.model_dump() for tc in choice.message.tool_calls]
                if choice.message.tool_calls
                else None
            ),
            "finish_reason": choice.finish_reason,
            "model": response.model,
            "usage": {
                "input": response.usage.prompt_tokens if response.usage else 0,
                "output": response.usage.completion_tokens if response.usage else 0,
            },
        }


async def _complete_anthropic(
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    stream: bool = False,
    **kwargs: Any,
) -> dict[str, Any] | AsyncIterator[dict[str, Any]]:
    """Complete using Anthropic API."""
    try:
        from anthropic import AsyncAnthropic
    except ImportError:
        raise ImportError("anthropic package required: pip install anthropic")

    client = AsyncAnthropic(api_key=api_key)

    system_message = None
    anthropic_messages = []

    for msg in messages:
        if msg["role"] == "system":
            system_message = msg["content"]
        else:
            anthropic_messages.append({
                "role": msg["role"],
                "content": msg["content"],
            })

    params: dict[str, Any] = {
        "model": model,
        "messages": anthropic_messages,
        "max_tokens": kwargs.get("max_tokens", 4096),
    }

    if system_message:
        params["system"] = system_message

    if tools:
        anthropic_tools = []
        for tool in tools:
            if tool["type"] == "function":
                anthropic_tools.append({
                    "name": tool["function"]["name"],
                    "description": tool["function"]["description"],
                    "input_schema": tool["function"]["parameters"],
                })
        params["tools"] = anthropic_tools

    if stream:
        async def stream_response() -> AsyncIterator[dict[str, Any]]:
            async with client.messages.stream(**params) as response:
                async for event in response:
                    if hasattr(event, "delta") and hasattr(event.delta, "text"):
                        yield {
                            "content": event.delta.text,
                            "finish_reason": None,
                        }
                    elif hasattr(event, "message"):
                        yield {
                            "content": "",
                            "finish_reason": event.message.stop_reason,
                        }
        return stream_response()
    else:
        response = await client.messages.create(**params)

        content = ""
        tool_calls = []

        for block in response.content:
            if block.type == "text":
                content += block.text
            elif block.type == "tool_use":
                tool_calls.append({
                    "id": block.id,
                    "type": "function",
                    "function": {
                        "name": block.name,
                        "arguments": json.dumps(block.input),
                    },
                })

        return {
            "content": content,
            "tool_calls": tool_calls if tool_calls else None,
            "finish_reason": response.stop_reason,
            "model": response.model,
            "usage": {
                "input": response.usage.input_tokens,
                "output": response.usage.output_tokens,
            },
        }


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
        **kwargs: Any,
    ) -> dict[str, Any] | AsyncIterator[dict[str, Any]]:
        """Complete a chat request."""
        return await complete(model, messages, tools, stream, **kwargs)



