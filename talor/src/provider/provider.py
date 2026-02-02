"""Provider Management for Talor.

This module provides LLM provider management for multiple AI services.

Features:
- Multiple provider support (OpenAI, Anthropic, etc.)
- Model definitions with capabilities
- Streaming and non-streaming completion
- Cost tracking
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any, AsyncIterator, TYPE_CHECKING

import httpx
from pydantic import BaseModel, Field

if TYPE_CHECKING:
    from src.config import Config


logger = logging.getLogger(__name__)


# =============================================================================
# Provider and Model Info
# =============================================================================

class ModelCapabilities(BaseModel):
    """Model capabilities."""
    vision: bool = False
    function_calling: bool = True
    json_mode: bool = False
    streaming: bool = True


class ModelCost(BaseModel):
    """Model cost per token."""
    input: float = 0.0  # Cost per 1M input tokens
    output: float = 0.0  # Cost per 1M output tokens
    cache_read: float = 0.0
    cache_write: float = 0.0


class ModelInfo(BaseModel):
    """Model information.

    Defines an LLM model's capabilities and costs.
    """
    id: str
    name: str
    provider_id: str
    context_length: int = 128000
    max_output_tokens: int = 4096
    capabilities: ModelCapabilities = Field(default_factory=ModelCapabilities)
    cost: ModelCost = Field(default_factory=ModelCost)


class ProviderInfo(BaseModel):
    """Provider information.

    Defines an LLM provider's configuration and available models.
    """
    id: str
    name: str
    api_key_env: str | None = None
    base_url: str | None = None
    models: list[ModelInfo] = Field(default_factory=list)


# =============================================================================
# Built-in Providers
# =============================================================================

BUILTIN_PROVIDERS: dict[str, ProviderInfo] = {
    "ollama": ProviderInfo(
        id="ollama",
        name="Ollama",
        api_key_env=None,  # Ollama doesn't require API key
        base_url="http://localhost:11434/v1",
        models=[
            ModelInfo(
                id="deepseek-v3.1:671b-cloud",
                name="DeepSeek V3.1 671B Cloud",
                provider_id="ollama",
                context_length=64000,
                max_output_tokens=8192,
                capabilities=ModelCapabilities(function_calling=True),
                cost=ModelCost(input=0.0, output=0.0),
            ),
            ModelInfo(
                id="qwen2.5:14b",
                name="Qwen 2.5 14B",
                provider_id="ollama",
                context_length=32768,
                max_output_tokens=8192,
                capabilities=ModelCapabilities(function_calling=True),
                cost=ModelCost(input=0.0, output=0.0),
            ),
            ModelInfo(
                id="llama3.2:latest",
                name="Llama 3.2",
                provider_id="ollama",
                context_length=128000,
                max_output_tokens=8192,
                capabilities=ModelCapabilities(function_calling=True),
                cost=ModelCost(input=0.0, output=0.0),
            ),
        ],
    ),
    "openai": ProviderInfo(
        id="openai",
        name="OpenAI",
        api_key_env="OPENAI_API_KEY",
        base_url="https://api.openai.com/v1",
        models=[
            ModelInfo(
                id="gpt-4o",
                name="GPT-4o",
                provider_id="openai",
                context_length=128000,
                max_output_tokens=16384,
                capabilities=ModelCapabilities(vision=True, function_calling=True),
                cost=ModelCost(input=2.5, output=10.0),
            ),
            ModelInfo(
                id="gpt-4o-mini",
                name="GPT-4o Mini",
                provider_id="openai",
                context_length=128000,
                max_output_tokens=16384,
                capabilities=ModelCapabilities(vision=True, function_calling=True),
                cost=ModelCost(input=0.15, output=0.6),
            ),
            ModelInfo(
                id="gpt-4-turbo",
                name="GPT-4 Turbo",
                provider_id="openai",
                context_length=128000,
                max_output_tokens=4096,
                capabilities=ModelCapabilities(vision=True, function_calling=True),
                cost=ModelCost(input=10.0, output=30.0),
            ),
            ModelInfo(
                id="gpt-3.5-turbo",
                name="GPT-3.5 Turbo",
                provider_id="openai",
                context_length=16385,
                max_output_tokens=4096,
                capabilities=ModelCapabilities(function_calling=True),
                cost=ModelCost(input=0.5, output=1.5),
            ),
        ],
    ),
    "anthropic": ProviderInfo(
        id="anthropic",
        name="Anthropic",
        api_key_env="ANTHROPIC_API_KEY",
        base_url="https://api.anthropic.com",
        models=[
            ModelInfo(
                id="claude-3-5-sonnet-20241022",
                name="Claude 3.5 Sonnet",
                provider_id="anthropic",
                context_length=200000,
                max_output_tokens=8192,
                capabilities=ModelCapabilities(vision=True, function_calling=True),
                cost=ModelCost(input=3.0, output=15.0),
            ),
            ModelInfo(
                id="claude-3-5-haiku-20241022",
                name="Claude 3.5 Haiku",
                provider_id="anthropic",
                context_length=200000,
                max_output_tokens=8192,
                capabilities=ModelCapabilities(vision=True, function_calling=True),
                cost=ModelCost(input=0.8, output=4.0),
            ),
            ModelInfo(
                id="claude-3-opus-20240229",
                name="Claude 3 Opus",
                provider_id="anthropic",
                context_length=200000,
                max_output_tokens=4096,
                capabilities=ModelCapabilities(vision=True, function_calling=True),
                cost=ModelCost(input=15.0, output=75.0),
            ),
        ],
    ),
    "google": ProviderInfo(
        id="google",
        name="Google AI",
        api_key_env="GOOGLE_API_KEY",
        models=[
            ModelInfo(
                id="gemini-1.5-pro",
                name="Gemini 1.5 Pro",
                provider_id="google",
                context_length=2000000,
                max_output_tokens=8192,
                capabilities=ModelCapabilities(vision=True, function_calling=True),
                cost=ModelCost(input=1.25, output=5.0),
            ),
            ModelInfo(
                id="gemini-1.5-flash",
                name="Gemini 1.5 Flash",
                provider_id="google",
                context_length=1000000,
                max_output_tokens=8192,
                capabilities=ModelCapabilities(vision=True, function_calling=True),
                cost=ModelCost(input=0.075, output=0.3),
            ),
        ],
    ),
}


# =============================================================================
# Provider Namespace
# =============================================================================

class Provider:
    """Provider management namespace.

    Provides methods for managing LLM providers and making completions.
    """

    # Class-level state
    _config: Any | None = None
    _providers_cache: dict[str, ProviderInfo] | None = None
    _clients: dict[str, Any] = {}
    _ollama_models_cache: list[ModelInfo] | None = None
    _ollama_cache_time: float = 0
    _ollama_cache_ttl: float = 300  # 5 minutes

    @classmethod
    def configure(cls, config: Any = None) -> None:
        """Configure the provider system.

        Args:
            config: Config instance
        """
        cls._config = config
        cls._providers_cache = None
        cls._ollama_models_cache = None
        cls._ollama_cache_time = 0

    @classmethod
    async def _discover_ollama_models(cls, base_url: str = "http://localhost:11434") -> list[ModelInfo]:
        """Discover available Ollama models.

        Args:
            base_url: Ollama API base URL

        Returns:
            List of discovered ModelInfo
        """
        # Check cache
        current_time = time.time()
        if cls._ollama_models_cache is not None and (current_time - cls._ollama_cache_time) < cls._ollama_cache_ttl:
            logger.debug("Using cached Ollama models")
            return cls._ollama_models_cache

        models = []

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{base_url}/api/tags")
                response.raise_for_status()
                data = response.json()

                for model_data in data.get("models", []):
                    model_name = model_data.get("name", "")
                    if not model_name:
                        continue

                    # Extract model details
                    details = model_data.get("details", {})
                    parameter_size = details.get("parameter_size", "")

                    # Estimate context length based on model family
                    context_length = 32768  # Default
                    if "llama3" in model_name.lower():
                        context_length = 128000
                    elif "qwen" in model_name.lower():
                        context_length = 32768
                    elif "deepseek" in model_name.lower():
                        context_length = 64000

                    # Create display name
                    display_name = model_name.replace(":", " ").title()
                    if parameter_size:
                        display_name = f"{display_name} ({parameter_size})"

                    models.append(ModelInfo(
                        id=model_name,
                        name=display_name,
                        provider_id="ollama",
                        context_length=context_length,
                        max_output_tokens=8192,
                        capabilities=ModelCapabilities(function_calling=True),
                        cost=ModelCost(input=0.0, output=0.0),
                    ))

                logger.info(f"Discovered {len(models)} Ollama models")

                # Update cache
                cls._ollama_models_cache = models
                cls._ollama_cache_time = current_time

        except Exception as e:
            logger.warning(f"Failed to discover Ollama models: {e}")
            # Return fallback models if discovery fails
            if cls._ollama_models_cache:
                logger.debug("Using stale cached Ollama models")
                return cls._ollama_models_cache

            # Return default fallback models
            models = [
                ModelInfo(
                    id="deepseek-v3.1:671b-cloud",
                    name="DeepSeek V3.1 671B Cloud",
                    provider_id="ollama",
                    context_length=64000,
                    max_output_tokens=8192,
                    capabilities=ModelCapabilities(function_calling=True),
                    cost=ModelCost(input=0.0, output=0.0),
                ),
            ]
            logger.debug("Using fallback Ollama models")

        return models

    @classmethod
    async def _load_providers(cls) -> dict[str, ProviderInfo]:
        """Load all providers."""
        if cls._providers_cache is not None:
            return cls._providers_cache

        # Start with built-in providers
        providers = {k: v.model_copy() for k, v in BUILTIN_PROVIDERS.items()}

        # Discover Ollama models if Ollama provider exists
        if "ollama" in providers:
            ollama_base_url = providers["ollama"].base_url or "http://localhost:11434"
            # Extract base URL without /v1 suffix for API calls
            api_base_url = ollama_base_url.replace("/v1", "")
            discovered_models = await cls._discover_ollama_models(api_base_url)
            if discovered_models:
                providers["ollama"].models = discovered_models

        # Load custom providers from config
        if cls._config:
            config = await cls._config.get()
            for provider_id, provider_config in config.get("provider", {}).items():
                if provider_id in providers:
                    # Update existing provider
                    if "base_url" in provider_config:
                        providers[provider_id].base_url = provider_config["base_url"]
                else:
                    # Add custom provider
                    providers[provider_id] = ProviderInfo(
                        id=provider_id,
                        name=provider_config.get("name", provider_id),
                        api_key_env=provider_config.get("api_key_env"),
                        base_url=provider_config.get("base_url"),
                    )

        cls._providers_cache = providers
        return providers

    @classmethod
    async def list(cls) -> list[ProviderInfo]:
        """List all providers.

        Returns:
            List of ProviderInfo
        """
        providers = await cls._load_providers()
        return list(providers.values())

    @classmethod
    async def get(cls, provider_id: str) -> ProviderInfo | None:
        """Get a provider by ID.

        Args:
            provider_id: Provider ID

        Returns:
            ProviderInfo or None
        """
        providers = await cls._load_providers()
        return providers.get(provider_id)

    @classmethod
    async def get_model(cls, provider_id: str, model_id: str) -> ModelInfo | None:
        """Get a model by provider and model ID.

        Args:
            provider_id: Provider ID
            model_id: Model ID

        Returns:
            ModelInfo or None
        """
        provider = await cls.get(provider_id)
        if not provider:
            return None

        for model in provider.models:
            if model.id == model_id:
                return model

        return None

    @classmethod
    async def default_model(cls) -> dict[str, str]:
        """Get the default model.

        Returns:
            Dict with provider_id and model_id
        """
        # Default to Ollama for local development
        default = {"provider_id": "ollama", "model_id": "deepseek-v3.1:671b-cloud"}

        if cls._config:
            config = await cls._config.get()
            default_model = config.get("default_model")
            if default_model:
                # Parse "provider/model" format
                if "/" in default_model:
                    provider_id, model_id = default_model.split("/", 1)
                    default = {"provider_id": provider_id, "model_id": model_id}
                else:
                    default["model_id"] = default_model

        return default

    @classmethod
    def parse_model(cls, model_str: str) -> dict[str, str]:
        """Parse a model string.

        Args:
            model_str: Model string like "openai/gpt-4" or "gpt-4"

        Returns:
            Dict with provider_id and model_id
        """
        if "/" in model_str:
            provider_id, model_id = model_str.split("/", 1)
            return {"provider_id": provider_id, "model_id": model_id}

        # Try to find the model in known providers
        for provider_id, provider in BUILTIN_PROVIDERS.items():
            for model in provider.models:
                if model.id == model_str:
                    return {"provider_id": provider_id, "model_id": model_str}

        # Default to Ollama for local models
        return {"provider_id": "ollama", "model_id": model_str}

    @classmethod
    async def complete(
        cls,
        model: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        stream: bool = False,
        **kwargs,
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
        # Parse model
        model_info = cls.parse_model(model)
        provider_id = model_info["provider_id"]
        model_id = model_info["model_id"]

        # Get provider
        provider = await cls.get(provider_id)
        if not provider:
            raise ValueError(f"Provider not found: {provider_id}")

        # Get API key (optional for some providers like Ollama)
        api_key = None
        if provider.api_key_env:
            api_key = os.environ.get(provider.api_key_env)

        # Only require API key for providers that need it
        if provider.api_key_env and not api_key:
            raise ValueError(f"API key not found for provider: {provider_id}")

        # For Ollama and other local providers, use a dummy key
        if not api_key:
            api_key = "ollama"  # Ollama doesn't validate API key

        # Call appropriate provider
        if provider_id == "openai":
            return await cls._complete_openai(
                api_key=api_key,
                base_url=provider.base_url,
                model=model_id,
                messages=messages,
                tools=tools,
                stream=stream,
                **kwargs,
            )
        elif provider_id == "anthropic":
            return await cls._complete_anthropic(
                api_key=api_key,
                model=model_id,
                messages=messages,
                tools=tools,
                stream=stream,
                **kwargs,
            )
        else:
            # Default to OpenAI-compatible API
            return await cls._complete_openai(
                api_key=api_key,
                base_url=provider.base_url,
                model=model_id,
                messages=messages,
                tools=tools,
                stream=stream,
                **kwargs,
            )

    @classmethod
    async def _complete_openai(
        cls,
        api_key: str,
        base_url: str | None,
        model: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        stream: bool = False,
        **kwargs,
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
            async def stream_response():
                response = await client.chat.completions.create(**params, stream=True)
                async for chunk in response:
                    delta = chunk.choices[0].delta if chunk.choices else None
                    if delta:
                        yield {
                            "content": delta.content or "",
                            "tool_calls": [tc.model_dump() for tc in delta.tool_calls] if delta.tool_calls else None,
                            "finish_reason": chunk.choices[0].finish_reason if chunk.choices else None,
                            "model": chunk.model,
                        }
            return stream_response()
        else:
            response = await client.chat.completions.create(**params)
            choice = response.choices[0]
            return {
                "content": choice.message.content or "",
                "tool_calls": [tc.model_dump() for tc in choice.message.tool_calls] if choice.message.tool_calls else None,
                "finish_reason": choice.finish_reason,
                "model": response.model,
                "usage": {
                    "input": response.usage.prompt_tokens if response.usage else 0,
                    "output": response.usage.completion_tokens if response.usage else 0,
                },
            }

    @classmethod
    async def _complete_anthropic(
        cls,
        api_key: str,
        model: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        stream: bool = False,
        **kwargs,
    ) -> dict[str, Any] | AsyncIterator[dict[str, Any]]:
        """Complete using Anthropic API."""
        try:
            from anthropic import AsyncAnthropic
        except ImportError:
            raise ImportError("anthropic package required: pip install anthropic")

        client = AsyncAnthropic(api_key=api_key)

        # Convert messages to Anthropic format
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
            # Convert OpenAI tool format to Anthropic
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
            async def stream_response():
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

    @classmethod
    def clear_cache(cls) -> None:
        """Clear provider cache (for testing)."""
        cls._providers_cache = None
        cls._ollama_models_cache = None
        cls._ollama_cache_time = 0
        cls._clients.clear()
