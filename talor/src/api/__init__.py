"""Talor API Module.

Provides REST API and WebSocket endpoints for the AI agent framework.
"""

from src.api.app import create_app, app

__all__ = ["create_app", "app"]
