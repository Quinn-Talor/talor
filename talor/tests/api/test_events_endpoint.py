"""Integration tests for SSE events endpoint with GlobalBus."""

import asyncio
import json
import pytest
from unittest.mock import AsyncMock, MagicMock

from src import get_global_bus, _reset_global_bus
from src.bus.events import MessageCreated, MessageCreatedData


class TestEventsEndpoint:
    """Test the /api/events SSE endpoint with GlobalBus integration."""

    def setup_method(self):
        """Reset global bus before each test."""
        _reset_global_bus()

    def teardown_method(self):
        """Clean up after each test."""
        _reset_global_bus()

    @pytest.mark.asyncio
    async def test_event_handler_receives_global_bus_events(self):
        """Test that the SSE endpoint can receive events from GlobalBus.

        This test verifies that:
        1. The endpoint subscribes to GlobalBus with session_id filter
        2. Events published to GlobalBus are received by the handler
        3. Only events matching the session_id filter are received

        Validates: Requirements 1.3, 1.5
        """
        from src.api.routes.events import event_stream
        from fastapi import Request

        # Get global bus
        bus = get_global_bus()

        # Mock session to exist
        mock_session = MagicMock()
        mock_session.id = "test-session-123"

        # Mock get_session to return our mock
        import src.session as session_module
        original_get_session = session_module.get_session

        async def mock_get_session(session_id):
            if session_id == "test-session-123":
                return mock_session
            return None

        session_module.get_session = mock_get_session

        # Mock register_client
        import src.api.sse as sse_module
        original_register_client = sse_module.register_client

        def mock_register_client(session_id, queue):
            return lambda: None  # Return no-op unregister function

        sse_module.register_client = mock_register_client

        try:
            # Create a mock request
            mock_request = MagicMock(spec=Request)

            # Start the event stream in the background
            response = await event_stream(mock_request, session_id="test-session-123")

            # Get the generator
            generator = response.body_iterator

            # Publish events to global bus
            await bus.publish(
                MessageCreated,
                MessageCreatedData(
                    session_id="test-session-123",
                    message_id="msg-1",
                    role="user",
                    content="Test message for session 123",
                ),
            )

            # Publish event for different session (should not be received)
            await bus.publish(
                MessageCreated,
                MessageCreatedData(
                    session_id="other-session",
                    message_id="msg-2",
                    role="user",
                    content="Test message for other session",
                ),
            )

            # Give time for events to propagate
            await asyncio.sleep(0.1)

            # Try to get one event from the stream
            try:
                event_data = await asyncio.wait_for(
                    generator.__anext__(),
                    timeout=1.0
                )

                # Parse the SSE format
                if isinstance(event_data, str):
                    # Extract the data part
                    lines = event_data.strip().split('\n')
                    for line in lines:
                        if line.startswith('data: '):
                            data_json = line[6:]  # Remove 'data: ' prefix
                            event = json.loads(data_json)

                            # Verify it's the correct event
                            assert event['type'] == 'message.created'
                            assert event['properties']['session_id'] == 'test-session-123'
                            assert event['properties']['message_id'] == 'msg-1'
                            break

            except asyncio.TimeoutError:
                pytest.fail("Timeout waiting for event from SSE stream")

        finally:
            # Restore original functions
            session_module.get_session = original_get_session
            sse_module.register_client = original_register_client

    @pytest.mark.asyncio
    async def test_global_bus_subscription_with_session_filter(self):
        """Test that GlobalBus subscription correctly filters by session_id.

        This is a unit test for the GlobalBus filtering mechanism that
        the SSE endpoint relies on.

        Validates: Requirements 1.5
        """
        bus = get_global_bus()

        session1_events = []
        session2_events = []

        async def session1_handler(event):
            session1_events.append(event.properties)

        async def session2_handler(event):
            session2_events.append(event.properties)

        # Subscribe with session filters
        unsub1 = bus.subscribe_all(session1_handler, session_id="session-1")
        unsub2 = bus.subscribe_all(session2_handler, session_id="session-2")

        try:
            # Publish events for different sessions
            await bus.publish(
                MessageCreated,
                MessageCreatedData(
                    session_id="session-1",
                    message_id="msg-1",
                    role="user",
                    content="Message for session 1",
                ),
            )

            await bus.publish(
                MessageCreated,
                MessageCreatedData(
                    session_id="session-2",
                    message_id="msg-2",
                    role="user",
                    content="Message for session 2",
                ),
            )

            await bus.publish(
                MessageCreated,
                MessageCreatedData(
                    session_id="session-1",
                    message_id="msg-3",
                    role="assistant",
                    content="Response for session 1",
                ),
            )

            # Give time for async handlers to complete
            await asyncio.sleep(0.1)

            # Verify filtering
            assert len(session1_events) == 2
            assert all(e.session_id == "session-1" for e in session1_events)

            assert len(session2_events) == 1
            assert all(e.session_id == "session-2" for e in session2_events)

        finally:
            unsub1()
            unsub2()
