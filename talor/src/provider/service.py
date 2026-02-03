"""Provider Service for Talor.

This module provides the application service for LLM provider operations.
The service is an object instance, not a class with static methods.

Example:
    ```python
    service = ProviderService(config_service=config)

    providers = await service.list_providers()
    model = await service.get_model("openai", "gpt-4")
    response = await service.complete(model="openai/gpt-4", messages=[...])
    ```
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, AsyncIterator, TYPE_CHECKING

import httpx

from src.provider.provider import (
    Provider,
    Model,
    ModelCapabilities,
    ModelCost,
    BUILTIN_PROVIDERS,
)

if TYPE_CHECKING:
    from src.config.service import ConfigService


logger = logging.getLogger(__name__)


class ProviderService:
    """Application service for LLM provider operations.

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
        self._config_service = config_service
        self._providers_cache: dict[str, Provider] | None = None
        self._ollama_models_cache: list[Model] | None = None
        self._ollama_cache_time: float = 0
        self._ollama_cache_ttl: float = 300  # 5 minutes

    def clear_cache(self) -> None:
        """Clear all caches."""
        self._providers_cache = None
        self._ollama_models_cache = None
        self._ollama_cache_time = 0

    # =========================================================================
    # Provider Discovery
    # =========================================================================

    async def _discover_ollama_models(
        self,
        base_url: str = "http://localhost:11434",
    ) -> list[Model]:
        """Discover available Ollama models.

        Args:
            base_url: Ollama API base URL

        Returns:
            List of discovered Model
        """
        # Check cache
        current_time = time.time()
        if (
            self._ollama_models_cache is not None
            and (current_time - self._ollama_cache_time) < self._ollama_cache_ttl
        ):
            logger.debug("Using cached Ollama models")
            return self._ollama_models_cache

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

                    details = model_data.get("details", {})
                    parameter_size = details.get("parameter_size", "")

                    # Estimate context length
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
                        provider_id="ollama",
                        context_length=context_length,
                        max_output_tokens=8192,
                        capabilities=ModelCapabilities(function_calling=True),
                        cost=ModelCost(input=0.0, output=0.0),
                    ))

                logger.info(f"Discovered {len(models)} Ollama models")
                self._ollama_models_cache = models
                self._ollama_cache_time = current_time

        except Exception as e:
            logger.warning(f"Failed to discover Ollama models: {e}")
            if self._ollama_models_cache:
                return self._ollama_models_cache

            # Fallback
            models = [
                Model(
                    id="deepseek-v3.1:671b-cloud",
                    name="DeepSeek V3.1 671B Cloud",
                    provider_id="ollama",
                    context_length=64000,
                    max_output_tokens=8192,
                    capabilities=ModelCapabilities(function_calling=True),
                    cost=ModelCost(input=0.0, output=0.0),
                ),
            ]

        return models

    async def _load_providers(self) -> dict[str, Provider]:
        """Load all providers."""
        if self._providers_cache is not None:
            return self._providers_cache

        # Start with built-in providers
        providers = {k: v.model_copy() for k, v in BUILTIN_PROVIDERS.items()}

        # Discover Ollama models
        if "ollama" in providers:
            ollama_base_url = providers["ollama"].base_url or "http://localhost:11434"
            api_base_url = ollama_base_url.replace("/v1", "")
            discovered_models = await self._discover_ollama_models(api_base_url)
            if discovered_models:
                # Use entity's replace_models method (DDD pattern)
                providers["ollama"] = providers["ollama"].replace_models(discovered_models)

        # Load custom providers from config
        if self._config_service:
            config = await self._config_service.get()
            for provider_id, provider_config in config.get("provider", {}).items():
                if provider_id in providers:
                    if "base_url" in provider_config:
                        # Use entity's with_base_url method (DDD pattern)
                        providers[provider_id] = providers[provider_id].with_base_url(
                            provider_config["base_url"]
                        )
                else:
                    providers[provider_id] = Provider(
                        id=provider_id,
                        name=provider_config.get("name", provider_id),
                        api_key_env=provider_config.get("api_key_env"),
                        base_url=provider_config.get("base_url"),
                    )

        self._providers_cache = providers
        return providers

    # =========================================================================
    # Provider Operations
    # =========================================================================

    async def list_providers(self) -> list[Provider]:
        """List all providers.

        Returns:
            List of Provider
        """
        providers = await self._load_providers()
        return list(providers.values())

    async def get_provider(self, provider_id: str) -> Provider | None:
        """Get a provider by ID.

        Args:
            provider_id: Provider ID

        Returns:
            Provider or None
        """
        providers = await self._load_providers()
        return providers.get(provider_id)

    async def get_model(
        self,
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
        provider = await self.get_provider(provider_id)
        if not provider:
            return None

        for model in provider.models:
            if model.id == model_id:
                return model

        return None

    async def get_default_model(self) -> dict[str, str]:
        """Get the default model.

        Returns:
            Dict with provider_id and model_id
        """
        default = {"provider_id": "ollama", "model_id": "deepseek-v3.1:671b-cloud"}

        if self._config_service:
            config = await self._config_service.get()
            default_model = config.get("default_model")
            if default_model:
                if "/" in default_model:
                    provider_id, model_id = default_model.split("/", 1)
                    default = {"provider_id": provider_id, "model_id": model_id}
                else:
                    default["model_id"] = default_model

        return default

    def parse_model(self, model_str: str) -> dict[str, str]:
        """Parse a model string.

        Args:
            model_str: Model string like "openai/gpt-4" or "gpt-4"

        Returns:
            Dict with provider_id and model_id
        """
        if "/" in model_str:
            provider_id, model_id = model_str.split("/", 1)
            return {"provider_id": provider_id, "model_id": model_id}

        for provider_id, provider in BUILTIN_PROVIDERS.items():
            for model in provider.models:
                if model.id == model_str:
                    return {"provider_id": provider_id, "model_id": model_str}

        return {"provider_id": "ollama", "model_id": model_str}

    # =========================================================================
    # Completion
    # =========================================================================

    async def complete(
        self,
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
        model_info = self.parse_model(model)
        provider_id = model_info["provider_id"]
        model_id = model_info["model_id"]

        provider = await self.get_provider(provider_id)
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
            return await self._complete_openai(
                api_key=api_key,
                base_url=provider.base_url,
                model=model_id,
                messages=messages,
                tools=tools,
                stream=stream,
                **kwargs,
            )
        elif provider_id == "anthropic":
            return await self._complete_anthropic(
                api_key=api_key,
                model=model_id,
                messages=messages,
                tools=tools,
                stream=stream,
                **kwargs,
            )
        else:
            return await self._complete_openai(
                api_key=api_key,
                base_url=provider.base_url,
                model=model_id,
                messages=messages,
                tools=tools,
                stream=stream,
                **kwargs,
            )

    async def _complete_openai(
        self,
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

    async def _complete_anthropic(
        self,
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
