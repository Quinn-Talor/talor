"""Provider System for Talor.

This module provides LLM provider management following opencode's pattern:
- Provider abstraction for multiple LLM services
- Model definitions with capabilities and costs
- Provider selection and configuration

Example:
    ```python
    from talor.provider import Provider
    
    # Get default model
    model = await Provider.default_model()
    
    # List available providers
    providers = await Provider.list()
    
    # Get specific model
    model = await Provider.get_model("openai", "gpt-4")
    
    # Complete with model
    response = await Provider.complete(
        model="gpt-4",
        messages=[{"role": "user", "content": "Hello"}],
    )
    ```
"""

from talor.provider.provider import Provider, ProviderInfo, ModelInfo

__all__ = ["Provider", "ProviderInfo", "ModelInfo"]
