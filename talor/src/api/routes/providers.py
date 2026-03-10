"""Provider Routes.

Uses module-level functions from src.provider for provider management.
"""

from typing import Any

from fastapi import APIRouter, HTTPException

from src.api.models import ModelCapabilitiesResponse, ModelCostResponse, ModelResponse, ProviderResponse
from src.provider import (
    list_providers as provider_list,
    get_provider as provider_get,
    clear_cache as provider_clear_cache,
)
from src.provider.provider import Model


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
