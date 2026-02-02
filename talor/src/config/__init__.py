"""Configuration System for Talor.

This module provides configuration management:
- Layered configuration (remote → global → project → inline)
- JSONC format support
- Configuration merging
- Event publishing for changes

Example:
    ```python
    from src.config import Config

    # Get merged configuration
    config = await Config.get()

    # Get specific value
    default_agent = config.get("default_agent", "build")

    # Get config directories
    dirs = await Config.directories()
    ```
"""

from src.config.config import Config

__all__ = ["Config"]
