"""Provider Routes.

Uses module-level functions from src.provider for provider management.
"""

from typing import Any

from fastapi import APIRouter

from src.api.models import ProviderResponse
from src.provider import (
    list_providers as provider_list,
    clear_cache as provider_clear_cache,
)


router = APIRouter()


@router.get("", response_model=list[ProviderResponse])
async def list_providers() -> list[ProviderResponse]:
    """List available providers."""
    providers = await provider_list()
    return [
        ProviderResponse(
            id=p.id,
            name=p.name,
            models=[m.model_dump() for m in p.models],
        )
        for p in providers
    ]


@router.get("/models")
async def list_models() -> list[dict]:
    """List all available models."""
    providers = await provider_list()
    models = []

    for provider in providers:
        for model in provider.models:
            models.append({
                "id": f"{provider.id}/{model.id}",
                "name": model.name,
                "provider": provider.id,
                "context_length": model.context_length,
                "max_output_tokens": model.max_output_tokens,
            })

    return models


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
