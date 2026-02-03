"""Provider Routes."""

from typing import Any

from fastapi import APIRouter, Depends

from src.api.models import ProviderResponse
from src.core.container import get_container
from src.provider.service import ProviderService


router = APIRouter()


def get_provider_service() -> ProviderService:
    """Get provider service from container."""
    return get_container().provider_service


@router.get("", response_model=list[ProviderResponse])
async def list_providers(
    service: ProviderService = Depends(get_provider_service),
) -> list[ProviderResponse]:
    """List available providers."""
    providers = await service.list_providers()
    return [
        ProviderResponse(
            id=p.id,
            name=p.name,
            models=[m.model_dump() for m in p.models],
        )
        for p in providers
    ]


@router.get("/models")
async def list_models(
    service: ProviderService = Depends(get_provider_service),
) -> list[dict]:
    """List all available models."""
    providers = await service.list_providers()
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
async def refresh_providers(
    service: ProviderService = Depends(get_provider_service),
) -> dict[str, Any]:
    """Refresh provider cache and rediscover models."""
    service.clear_cache()
    providers = await service.list_providers()

    return {
        "success": True,
        "providers": len(providers),
        "models": sum(len(p.models) for p in providers),
    }
