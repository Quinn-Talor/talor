"""Provider Routes.

Uses module-level functions from src.provider for provider management.
"""

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.api.models import ModelCapabilitiesResponse, ModelCostResponse, ModelResponse, ProviderResponse
from src.config import Config, reload as config_reload
from src.provider import (
    list_providers as provider_list,
    get_provider as provider_get,
    clear_cache as provider_clear_cache,
)
from src.provider.provider import Model


class ModelCapabilitiesRequest(BaseModel):
    """Request model for overriding model capabilities."""
    vision: bool | None = None
    function_calling: bool | None = None
    json_mode: bool | None = None
    streaming: bool | None = None
    reasoning: bool | None = None
    parallel_tool_calls: bool | None = None
    structured_output: bool | None = None


router = APIRouter()


def _model_to_response(model: Model) -> ModelResponse:
    return ModelResponse(
        id=model.id,
        name=model.name,
        provider_id=model.provider_id,
        context_length=model.context_length,
        max_output_tokens=model.max_output_tokens,
        capabilities=ModelCapabilitiesResponse(
            vision=model.capabilities.vision,
            function_calling=model.capabilities.function_calling,
            json_mode=model.capabilities.json_mode,
            streaming=model.capabilities.streaming,
            reasoning=model.capabilities.reasoning,
            parallel_tool_calls=model.capabilities.parallel_tool_calls,
            structured_output=model.capabilities.structured_output,
        ),
        cost=ModelCostResponse(
            input=model.cost.input,
            output=model.cost.output,
            cache_read=model.cost.cache_read,
            cache_write=model.cost.cache_write,
        ),
    )


@router.get("", response_model=list[ProviderResponse])
async def list_providers() -> list[ProviderResponse]:
    """List available providers with their models and capabilities."""
    providers = await provider_list()
    return [
        ProviderResponse(
            id=p.id,
            name=p.name,
            models=[_model_to_response(m) for m in p.models],
        )
        for p in providers
    ]


@router.get("/models", response_model=list[ModelResponse])
async def list_all_models() -> list[ModelResponse]:
    """List all models across all providers with full capability info."""
    providers = await provider_list()
    return [
        _model_to_response(model)
        for provider in providers
        for model in provider.models
    ]


@router.get("/{provider_id}/models", response_model=list[ModelResponse])
async def list_provider_models(provider_id: str) -> list[ModelResponse]:
    """List all models for a specific provider with full capability info."""
    provider = await provider_get(provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail=f"Provider '{provider_id}' not found")
    return [_model_to_response(m) for m in provider.models]


@router.post("/refresh")
async def refresh_providers() -> dict[str, Any]:
    """Refresh provider cache and rediscover models."""
    provider_clear_cache()
    providers = await provider_list()
    return {
        "success": True,
        "providers": len(providers),
        "models": sum(len(p.models) for p in providers),
    }


@router.post("/{provider_id}/refresh")
async def refresh_provider_models(provider_id: str) -> dict[str, Any]:
    """Refresh model discovery for a specific provider."""
    provider_clear_cache()
    provider = await provider_get(provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail=f"Provider '{provider_id}' not found")
    return {
        "success": True,
        "provider_id": provider_id,
        "models": len(provider.models),
    }


@router.put("/{provider_id}/models/{model_id}/capabilities")
async def override_model_capabilities(
    provider_id: str,
    model_id: str,
    request: ModelCapabilitiesRequest,
) -> ModelResponse:
    """Persist capability overrides for a specific model to config.

    Only non-None fields in the request are updated; existing values are kept.
    Changes are written to .talor/config.json and take effect after cache reload.
    """
    provider = await provider_get(provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail=f"Provider '{provider_id}' not found")

    config = await Config.get()
    providers_cfg: dict[str, Any] = dict(config.get("providers", {}))

    # Get or create this provider's config entry
    provider_cfg: dict[str, Any] = dict(providers_cfg.get(provider_id, {}))
    models_list: list[dict[str, Any]] = list(provider_cfg.get("models", []))

    # Find existing model entry or create new one
    model_entry: dict[str, Any] | None = None
    for entry in models_list:
        if entry.get("id") == model_id:
            model_entry = entry
            break

    if model_entry is None:
        model_entry = {"id": model_id}
        models_list.append(model_entry)

    # Merge capability overrides (only non-None values)
    caps: dict[str, Any] = dict(model_entry.get("capabilities", {}))
    override_fields = request.model_dump(exclude_none=True)
    caps.update(override_fields)
    model_entry["capabilities"] = caps

    provider_cfg["models"] = models_list
    providers_cfg[provider_id] = provider_cfg
    await Config.set("providers", providers_cfg)
    await config_reload()

    # Reload and return the updated model
    provider_clear_cache()
    updated_provider = await provider_get(provider_id)
    if updated_provider:
        for m in updated_provider.models:
            if m.id == model_id:
                return _model_to_response(m)

    raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found after update")
