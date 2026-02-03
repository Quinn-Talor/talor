"""Provider Module for Talor.

This module provides LLM provider management with rich domain models and
module-level functions for provider operations.

Usage (recommended - module-level functions):
    ```python
    from src.provider import configure, list_providers, get_provider, complete

    # Configure module (typically done at app startup)
    configure(config_getter=config.get)

    # Use module-level functions
    providers = await list_providers()
    provider = await get_provider("openai")
    response = await complete(model="openai/gpt-4", messages=[...])
    ```

Usage (backward compatible - ProviderService class):
    ```python
    from src.provider import ProviderService

    service = ProviderService(config_service=config_service)
    providers = await service.list_providers()
    ```
"""

from src.provider.provider import (
    # Domain entities
    Provider,
    Model,
    ModelCapabilities,
    ModelCost,
    # Built-in providers
    BUILTIN_PROVIDERS,
    # Module-level functions
    configure,
    clear_cache,
    list_providers,
    get_provider,
    get_model,
    get_default_model,
    parse_model,
    complete,
    # Backward-compatible service class
    ProviderService,
)

__all__ = [
    # Domain entities
    "Provider",
    "Model",
    "ModelCapabilities",
    "ModelCost",
    # Built-in providers
    "BUILTIN_PROVIDERS",
    # Module-level functions
    "configure",
    "clear_cache",
    "list_providers",
    "get_provider",
    "get_model",
    "get_default_model",
    "parse_model",
    "complete",
    # Backward-compatible service class
    "ProviderService",
]
