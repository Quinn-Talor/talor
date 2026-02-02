"""Pytest configuration and shared fixtures for Talor tests."""

import asyncio
from pathlib import Path
from typing import AsyncIterator

import pytest


@pytest.fixture(scope="session")
def event_loop_policy():
    """Set the event loop policy for the test session."""
    return asyncio.get_event_loop_policy()


@pytest.fixture
async def workspace(tmp_path: Path) -> Path:
    """Create a temporary workspace directory for testing.
    
    Args:
        tmp_path: Pytest's temporary directory fixture
        
    Returns:
        Path to the temporary workspace directory
    """
    workspace_dir = tmp_path / "workspace"
    workspace_dir.mkdir()
    return workspace_dir


@pytest.fixture
async def config_dir(tmp_path: Path) -> Path:
    """Create a temporary config directory for testing.
    
    Args:
        tmp_path: Pytest's temporary directory fixture
        
    Returns:
        Path to the temporary config directory
    """
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    return config_dir
