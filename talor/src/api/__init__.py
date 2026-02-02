"""API Module for Talor.

This module provides the FastAPI application and routes following opencode's pattern.
"""

from talor.api.app import create_app, app

__all__ = ["create_app", "app"]
