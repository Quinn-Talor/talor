"""Provider System for Talor.

This module provides LLM provider management.

DDD Architecture:
- Provider/Model: Rich domain entities with behavior
- ProviderService: Application service (object instance)

Usage:
    ```python
    from src.core.container import get_container

    container = get_container()
    providers = await container.provider_service.list_providers()
    response = await container.provider_service.complete(model="openai/gpt-4", messages=[...])
    ```
"""

from src.provider.provider import (
    Provider,
    Model,
    ModelCapabilities,
    ModelCost,
    BUILTIN_PROVIDERS,
)
from src.provider.service import ProviderService

__all__ = [
    # Domain entities
    "Provider",
    "Model",
    "ModelCapabilities",
    "ModelCost",
    "BUILTIN_PROVIDERS",
    # Service
    "ProviderService",
]
