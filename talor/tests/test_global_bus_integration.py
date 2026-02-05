"""Integration test for global bus usage across modules."""

import pytest

from src import get_global_bus, _reset_global_bus
from src.bus.events import (
    MessageCreated,
    MessageCreatedData,
    SessionCreated,
    SessionCreatedData,
    SessionInfo,
)


class TestGlobalBusIntegration:
    """Test global bus integration with real event types."""

    def setup_method(self):
        """Reset global bus before each test."""
        _reset_global_bus()

    def teardown_method(self):
        """Clean up after each test."""
        _reset_global_bus()

    @pytest.mark.asyncio
    async def test_multiple_sessions_event_isolation(self):
        """Test that events are properly isolated by session_id."""
        bus = get_global_bus()

        # Track events for each session
        session1_messages = []
        session2_messages = []
        all_messages = []

        def session1_handler(event):
            session1_messages.append(event.properties)

        def session2_handler(event):
            session2_messages.append(event.properties)

        def all_handler(event):
            all_messages.append(event.properties)

        # Subscribe with filters
        unsub1 = bus.subscribe(MessageCreated, session1_handler, session_id="session-1")
        unsub2 = bus.subscribe(MessageCreated, session2_handler, session_id="session-2")
        unsub_all = bus.subscribe(MessageCreated, all_handler)

        try:
            # Publish messages for different sessions
            await bus.publish(
                MessageCreated,
                MessageCreatedData(
                    session_id="session-1",
                    message_id="msg-1",
                    role="user",
                    content="Hello from session 1",
                ),
            )

            await bus.publish(
                MessageCreated,
                MessageCreatedData(
                    session_id="session-2",
                    message_id="msg-2",
                    role="user",
                    content="Hello from session 2",
                ),
            )

            await bus.publish(
                MessageCreated,
                MessageCreatedData(
                    session_id="session-1",
                    message_id="msg-3",
                    role="assistant",
                    content="Response from session 1",
                ),
            )

            # Verify isolation
            assert len(session1_messages) == 2
            assert all(m.session_id == "session-1" for m in session1_messages)

            assert len(session2_messages) == 1
            assert all(m.session_id == "session-2" for m in session2_messages)

            # Global handler should receive all
            assert len(all_messages) == 3

        finally:
            unsub1()
            unsub2()
            unsub_all()

    @pytest.mark.asyncio
    async def test_session_created_event_with_nested_session_id(self):
        """Test that SessionCreated events work with nested session_id in info."""
        bus = get_global_bus()

        received_events = []

        def handler(event):
            received_events.append(event.properties)

        # Subscribe with session filter
        unsub = bus.subscribe(
            SessionCreated, handler, session_id="test-session-123"
        )

        try:
            # Publish SessionCreated event (session_id is in nested info)
            await bus.publish(
                SessionCreated,
                SessionCreatedData(
                    session_id="test-session-123",
                    info=SessionInfo(
                        id="test-session-123",
                        title="Test Session",
                        directory="/tmp/test",
                        time={"created": 1234567890, "updated": 1234567890},
                    ),
                ),
            )

            # Should receive the event
            assert len(received_events) == 1
            assert received_events[0].session_id == "test-session-123"
            assert received_events[0].info.id == "test-session-123"

        finally:
            unsub()

    @pytest.mark.asyncio
    async def test_wildcard_subscription_with_session_filter(self):
        """Test wildcard subscription with session_id filter."""
        bus = get_global_bus()

        session1_events = []
        session2_events = []

        def session1_handler(event):
            session1_events.append(event)

        def session2_handler(event):
            session2_events.append(event)

        # Subscribe to all events for specific sessions
        unsub1 = bus.subscribe_all(session1_handler, session_id="session-1")
        unsub2 = bus.subscribe_all(session2_handler, session_id="session-2")

        try:
            # Publish different event types
            await bus.publish(
                MessageCreated,
                MessageCreatedData(
                    session_id="session-1",
                    message_id="msg-1",
                    role="user",
                    content="Message 1",
                ),
            )

            await bus.publish(
                SessionCreated,
                SessionCreatedData(
                    session_id="session-2",
                    info=SessionInfo(
                        id="session-2",
                        title="Session 2",
                        directory="/tmp",
                        time={"created": 123, "updated": 123},
                    ),
                ),
            )

            # Each handler should only receive events for its session
            assert len(session1_events) == 1
            assert session1_events[0].type == "message.created"

            assert len(session2_events) == 1
            assert session2_events[0].type == "session.created"

        finally:
            unsub1()
            unsub2()

    @pytest.mark.asyncio
    async def test_global_bus_singleton_behavior(self):
        """Test that get_global_bus() returns the same instance."""
        bus1 = get_global_bus()
        bus2 = get_global_bus()

        assert bus1 is bus2

        # Subscribe on one instance
        received = []

        def handler(event):
            received.append(event)

        unsub = bus1.subscribe(MessageCreated, handler)

        try:
            # Publish on the other instance
            await bus2.publish(
                MessageCreated,
                MessageCreatedData(
                    session_id="test",
                    message_id="msg",
                    role="user",
                    content="Test",
                ),
            )

            # Should receive the event
            assert len(received) == 1

        finally:
            unsub()
