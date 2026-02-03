"""Provider Domain Model for Talor.

This module provides LLM provider management with rich domain models.

Following DDD principles:
- Model and Provider are rich entities with behavior
- Cost calculation, capability checking are encapsulated
- Token estimation and budget management in entities
"""

from __future__ import annotations

import logging
import os
from typing import TYPE_CHECKING

from pydantic import BaseModel, Field

if TYPE_CHECKING:
    from src.config import Config


logger = logging.getLogger(__name__)


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
# Built-in Providers
# =============================================================================

BUILTIN_PROVIDERS: dict[str, Provider] = {
    "ollama": Provider(
        id="ollama",
        name="Ollama",
        api_key_env=None,
        base_url="http://localhost:11434/v1",
        models=[
            Model(
                id="deepseek-v3.1:671b-cloud",
                name="DeepSeek V3.1 671B Cloud",
                provider_id="ollama",
                context_length=64000,
                max_output_tokens=8192,
                capabilities=ModelCapabilities(function_calling=True),
                cost=ModelCost(input=0.0, output=0.0),
            ),
            Model(
                id="qwen2.5:14b",
                name="Qwen 2.5 14B",
                provider_id="ollama",
                context_length=32768,
                max_output_tokens=8192,
                capabilities=ModelCapabilities(function_calling=True),
                cost=ModelCost(input=0.0, output=0.0),
            ),
        ],
    ),
    "openai": Provider(
        id="openai",
        name="OpenAI",
        api_key_env="OPENAI_API_KEY",
        base_url="https://api.openai.com/v1",
        models=[
            Model(
                id="gpt-4o",
                name="GPT-4o",
                provider_id="openai",
                context_length=128000,
                max_output_tokens=16384,
                capabilities=ModelCapabilities(vision=True, function_calling=True),
                cost=ModelCost(input=2.5, output=10.0),
            ),
            Model(
                id="gpt-4o-mini",
                name="GPT-4o Mini",
                provider_id="openai",
                context_length=128000,
                max_output_tokens=16384,
                capabilities=ModelCapabilities(vision=True, function_calling=True),
                cost=ModelCost(input=0.15, output=0.6),
            ),
        ],
    ),
    "anthropic": Provider(
        id="anthropic",
        name="Anthropic",
        api_key_env="ANTHROPIC_API_KEY",
        base_url="https://api.anthropic.com",
        models=[
            Model(
                id="claude-3-5-sonnet-20241022",
                name="Claude 3.5 Sonnet",
                provider_id="anthropic",
                context_length=200000,
                max_output_tokens=8192,
                capabilities=ModelCapabilities(vision=True, function_calling=True),
                cost=ModelCost(input=3.0, output=15.0),
            ),
            Model(
                id="claude-3-5-haiku-20241022",
                name="Claude 3.5 Haiku",
                provider_id="anthropic",
                context_length=200000,
                max_output_tokens=8192,
                capabilities=ModelCapabilities(vision=True, function_calling=True),
                cost=ModelCost(input=0.8, output=4.0),
            ),
        ],
    ),
    "google": Provider(
        id="google",
        name="Google AI",
        api_key_env="GOOGLE_API_KEY",
        models=[
            Model(
                id="gemini-1.5-pro",
                name="Gemini 1.5 Pro",
                provider_id="google",
                context_length=2000000,
                max_output_tokens=8192,
                capabilities=ModelCapabilities(vision=True, function_calling=True),
                cost=ModelCost(input=1.25, output=5.0),
            ),
        ],
    ),
}



