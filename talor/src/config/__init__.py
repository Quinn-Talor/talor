"""Configuration System for Talor.

This module provides configuration management.

DDD Architecture:
- ConfigService: Application service (object instance)
- Config: Backward-compatible static facade

New code should use:
    ```python
    from src.core.container import get_container

    container = get_container()
    config = await container.config_service.get()
    await container.config_service.set("default_model", "openai/gpt-4")
    ```

Legacy code can still use:
    ```python
    from src.config import Config

    config = await Config.get()
    ```
"""

from src.config.config import Config
from src.config.service import ConfigService

__all__ = [
    # Static facade (backward compat)
    "Config",
    # Service
    "ConfigService",
]
