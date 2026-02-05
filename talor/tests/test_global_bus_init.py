"""Tests for global bus initialization in src/__init__.py."""

import pytest

from src import get_global_bus, _reset_global_bus
from src.bus import GlobalBus
from src.bus.events import MessageCreated, MessageCreatedData


class TestGlobalBusInit:
    """Test global bus initialization and access."""

    def setup_method(self):
        """Reset global bus before each test."""
        _reset_global_bus()

    def teardown_method(self):
        """Clean up after each test."""
        _reset_global_bus()

    def test_get_global_bus_returns_instance(self):
        """Test that get_global_bus() returns a GlobalBus instance."""
        bus = get_global_bus()
        assert isinstance(bus, GlobalBus)

    def test_get_global_bus_returns_same_instance(self):
        """Test that get_global_bus() returns the same instance on multiple calls."""
        bus1 = get_global_bus()
        bus2 = get_global_bus()
        assert bus1 is bus2

    @pytest.mark.asyncio
    async def test_global_bus_can_publish_events(self):
        """Test that the global bus can publish events."""
        bus = get_global_bus()

        # Track received events
        received_events = []

        def handler(event):
            received_events.append(event)

        # Subscribe to events
        unsub = bus.subscribe(MessageCreated, handler)

        try:
            # Publish event
            await bus.publish(
                MessageCreated,
                MessageCreatedData(
                    session_id="test-session",
                    message_id="test-msg",
                    role="user",
                    content="Hello"
                )
            )

            # Verify event was received
            assert len(received_events) == 1
            assert received_events[0].properties.session_id == "test-session"
            assert received_events[0].properties.message_id == "test-msg"
            assert received_events[0].properties.content == "Hello"
        finally:
            unsub()

    @pytest.mark.asyncio
    async def test_global_bus_session_filtering(self):
        """Test that the global bus supports session_id filtering."""
        bus = get_global_bus()

        # Track received events
        session1_events = []
        session2_events = []

        def handler1(event):
            session1_events.append(event)

        def handler2(event):
            session2_events.append(event)

        # Subscribe with session filters
        unsub1 = bus.subscribe(MessageCreated, handler1, session_id="session-1")
        unsub2 = bus.subscribe(MessageCreated, handler2, session_id="session-2")

        try:
            # Publish events for different sessions
            await bus.publish(
                MessageCreated,
                MessageCreatedData(
                    session_id="session-1",
                    message_id="msg-1",
                    role="user",
                    content="Hello from session 1"
                )
            )

            await bus.publish(
                MessageCreated,
                MessageCreatedData(
                    session_id="session-2",
                    message_id="msg-2",
                    role="user",
                    content="Hello from session 2"
                )
            )

            # Verify filtering
            assert len(session1_events) == 1
            assert session1_events[0].properties.session_id == "session-1"

            assert len(session2_events) == 1
            assert session2_events[0].properties.session_id == "session-2"
        finally:
            unsub1()
            unsub2()

    def test_reset_global_bus_clears_instance(self):
        """Test that _reset_global_bus() clears the instance."""
        bus1 = get_global_bus()
        _reset_global_bus()
        bus2 = get_global_bus()

        # Should be different instances after reset
        assert bus1 is not bus2
