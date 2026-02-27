"""
Integration tests for authentication flow.

Tests the complete authentication flow including:
- User registration
- User login
- Token refresh
- Session ownership
"""

import os

import pytest

from src.auth.service import AuthConfig, AuthService, AuthError
from src.core.storage import StorageSystem
from src.session.session import create_session, list_sessions, get_session


@pytest.fixture
async def storage():
    """Create an in-memory storage system for testing."""
    storage = StorageSystem(":memory:")
    await storage.init()
    yield storage
    await storage.close()


@pytest.fixture
async def auth_service(storage):
    """Create an auth service for testing."""
    os.environ["JWT_SECRET"] = "test-secret-key-for-integration-tests"
    os.environ["JWT_EXPIRY"] = "3600"
    os.environ["JWT_REFRESH_EXPIRY"] = "604800"
    config = AuthConfig()
    return AuthService(storage, config)


class TestAuthFlow:
    """Test authentication flow."""

    @pytest.mark.asyncio
    async def test_register_user(self, auth_service: AuthService):
        """Test user registration."""
        user = await auth_service.register("testuser", "testpass123")
        assert user.username == "testuser"
        assert user.id is not None

    @pytest.mark.asyncio
    async def test_register_duplicate_user(self, auth_service: AuthService):
        """Test registering duplicate user fails."""
        await auth_service.register("testuser", "testpass123")
        from src.auth.service import UserExistsError
        with pytest.raises(UserExistsError):
            await auth_service.register("testuser", "different")

    @pytest.mark.asyncio
    async def test_login_user(self, auth_service: AuthService):
        """Test user login."""
        await auth_service.register("testuser", "testpass123")
        tokens = await auth_service.login("testuser", "testpass123")
        assert tokens.access_token is not None
        assert tokens.refresh_token is not None
        assert tokens.expires_in > 0

    @pytest.mark.asyncio
    async def test_login_invalid_credentials(self, auth_service: AuthService):
        """Test login with invalid credentials fails."""
        await auth_service.register("testuser", "testpass123")
        with pytest.raises(AuthError):
            await auth_service.login("testuser", "wrongpass")

    @pytest.mark.asyncio
    async def test_refresh_token(self, auth_service: AuthService):
        """Test token refresh."""
        await auth_service.register("testuser", "testpass123")
        tokens = await auth_service.login("testuser", "testpass123")
        new_tokens = await auth_service.refresh(tokens.refresh_token)
        assert new_tokens.access_token is not None
        assert new_tokens.refresh_token is not None

    @pytest.mark.asyncio
    async def test_verify_token(self, auth_service: AuthService):
        """Test token verification."""
        user = await auth_service.register("testuser", "testpass123")
        tokens = await auth_service.login("testuser", "testpass123")
        user_id = await auth_service.verify_token(tokens.access_token)
        assert user_id == user.id


class TestSessionWithAuth:
    """Test session operations with authentication."""

    @pytest.mark.asyncio
    async def test_create_session_with_user(
        self, storage: StorageSystem, auth_service: AuthService
    ):
        """Test creating session with user ownership."""
        user = await auth_service.register("testuser", "testpass123")
        session = await create_session(storage, user_id=user.id)
        assert session.user_id == user.id

    @pytest.mark.asyncio
    async def test_list_sessions_by_user(
        self, storage: StorageSystem, auth_service: AuthService
    ):
        """Test listing sessions filtered by user."""
        user1 = await auth_service.register("user1", "pass123")
        user2 = await auth_service.register("user2", "pass123")

        await create_session(storage, user_id=user1.id)
        await create_session(storage, user_id=user1.id)
        await create_session(storage, user_id=user2.id)

        sessions1 = await list_sessions(storage, user_id=user1.id)
        assert len(sessions1) == 2

        sessions2 = await list_sessions(storage, user_id=user2.id)
        assert len(sessions2) == 1

    @pytest.mark.asyncio
    async def test_session_isolation(
        self, storage: StorageSystem, auth_service: AuthService
    ):
        """Test that users can only access their own sessions."""
        user1 = await auth_service.register("user1", "pass123")
        user2 = await auth_service.register("user2", "pass123")

        session = await create_session(storage, user_id=user1.id)

        retrieved = await get_session(storage, session.id)
        assert retrieved is not None
        assert retrieved.user_id == user1.id

        sessions2 = await list_sessions(storage, user_id=user2.id)
        session_ids = [s.id for s in sessions2]
        assert session.id not in session_ids
