"""Tests for GlobalBus implementation.

This module tests the GlobalBus class with session_id filtering capabilities.
"""

import pytest
from pydantic import BaseModel

from src.bus import GlobalBus, BusEvent


# Test event definitions
class TestMessageData(BaseModel):
    """Test message data with session_id."""
    session_id: str
    content: str


class TestSessionInfo(BaseModel):
    """Test session info."""
    id: str
    title: str


class TestSessionCreatedData(BaseModel):
    """Test session created data (session_id in nested info)."""
    info: TestSessionInfo


TestMessage = BusEvent.define("test.message", TestMessageData)
TestSessionCreated = BusEvent.define("test.session.created", TestSessionCreatedData)


@pytest.mark.asyncio
async def test_global_bus_basic_publish_subscribe():
    """Test basic publish/subscribe without session filtering."""
    bus = GlobalBus()
    received_events = []

    async def handler(event):
        received_events.append(event.properties)

    # Subscribe without session filter
    unsub = bus.subscribe(TestMessage, handler)

    # Publish event
    await bus.publish(
        TestMessage,
        TestMessageData(session_id="session-1", content="Hello")
    )

    # Verify event received
    assert len(received_events) == 1
    assert received_events[0].session_id == "session-1"
    assert received_events[0].content == "Hello"

    # Cleanup
    unsub()


@pytest.mark.asyncio
async def test_global_bus_session_filtering():
    """Test session_id filtering for subscriptions."""
    bus = GlobalBus()
    session1_events = []
    session2_events = []

    async def handler1(event):
        session1_events.append(event.properties)

    async def handler2(event):
        session2_events.append(event.properties)

    # Subscribe with session filters
    unsub1 = bus.subscribe(TestMessage, handler1, session_id="session-1")
    unsub2 = bus.subscribe(TestMessage, handler2, session_id="session-2")

    # Publish events for different sessions
    await bus.publish(
        TestMessage,
        TestMessageData(session_id="session-1", content="Message 1")
    )
    await bus.publish(
        TestMessage,
        TestMessageData(session_id="session-2", content="Message 2")
    )
    await bus.publish(
        TestMessage,
        TestMessageData(session_id="session-1", content="Message 3")
    )

    # Verify filtering
    assert len(session1_events) == 2
    assert session1_events[0].content == "Message 1"
    assert session1_events[1].content == "Message 3"

    assert len(session2_events) == 1
    assert session2_events[0].content == "Message 2"

    # Cleanup
    unsub1()
    unsub2()


@pytest.mark.asyncio
async def test_global_bus_mixed_subscriptions():
    """Test mix of global and session-filtered subscriptions."""
    bus = GlobalBus()
    global_events = []
    session_events = []

    async def global_handler(event):
        global_events.append(event.properties)

    async def session_handler(event):
        session_events.append(event.properties)

    # Subscribe globally (no filter)
    unsub_global = bus.subscribe(TestMessage, global_handler)

    # Subscribe with session filter
    unsub_session = bus.subscribe(TestMessage, session_handler, session_id="session-1")

    # Publish events
    await bus.publish(
        TestMessage,
        TestMessageData(session_id="session-1", content="Message 1")
    )
    await bus.publish(
        TestMessage,
        TestMessageData(session_id="session-2", content="Message 2")
    )

    # Global handler should receive all events
    assert len(global_events) == 2

    # Session handler should only receive session-1 events
    assert len(session_events) == 1
    assert session_events[0].session_id == "session-1"

    # Cleanup
    unsub_global()
    unsub_session()


@pytest.mark.asyncio
async def test_global_bus_wildcard_subscription():
    """Test wildcard subscription with session filtering."""
    bus = GlobalBus()
    all_events = []
    session_events = []

    async def all_handler(event):
        all_events.append(event.type)

    async def session_handler(event):
        session_events.append(event.type)

    # Subscribe to all events globally
    unsub_all = bus.subscribe_all(all_handler)

    # Subscribe to all events for specific session
    unsub_session = bus.subscribe_all(session_handler, session_id="session-1")

    # Publish different event types
    await bus.publish(
        TestMessage,
        TestMessageData(session_id="session-1", content="Message 1")
    )
    await bus.publish(
        TestSessionCreated,
        TestSessionCreatedData(info=TestSessionInfo(id="session-1", title="Test"))
    )
    await bus.publish(
        TestMessage,
        TestMessageData(session_id="session-2", content="Message 2")
    )

    # All handler should receive all events
    assert len(all_events) == 3

    # Session handler should only receive session-1 events
    assert len(session_events) == 2
    assert "test.message" in session_events
    assert "test.session.created" in session_events

    # Cleanup
    unsub_all()
    unsub_session()


@pytest.mark.asyncio
async def test_global_bus_unsubscribe():
    """Test unsubscribe functionality."""
    bus = GlobalBus()
    events = []

    async def handler(event):
        events.append(event.properties)

    # Subscribe and then unsubscribe
    unsub = bus.subscribe(TestMessage, handler, session_id="session-1")

    await bus.publish(
        TestMessage,
        TestMessageData(session_id="session-1", content="Message 1")
    )

    assert len(events) == 1

    # Unsubscribe
    unsub()

    # Publish again - should not receive
    await bus.publish(
        TestMessage,
        TestMessageData(session_id="session-1", content="Message 2")
    )

    assert len(events) == 1  # Still 1, not 2


@pytest.mark.asyncio
async def test_global_bus_session_id_in_nested_info():
    """Test extracting session_id from nested info object."""
    bus = GlobalBus()
    events = []

    async def handler(event):
        events.append(event.properties)

    # Subscribe with session filter
    unsub = bus.subscribe(TestSessionCreated, handler, session_id="session-1")

    # Publish event with session_id in nested info
    await bus.publish(
        TestSessionCreated,
        TestSessionCreatedData(info=TestSessionInfo(id="session-1", title="Test 1"))
    )
    await bus.publish(
        TestSessionCreated,
        TestSessionCreatedData(info=TestSessionInfo(id="session-2", title="Test 2"))
    )

    # Should only receive session-1 event
    assert len(events) == 1
    assert events[0].info.id == "session-1"

    # Cleanup
    unsub()


@pytest.mark.asyncio
async def test_global_bus_event_without_session_id():
    """Test publishing event without session_id field."""
    bus = GlobalBus()
    global_events = []
    session_events = []

    class NoSessionData(BaseModel):
        content: str

    NoSessionEvent = BusEvent.define("test.no.session", NoSessionData)

    async def global_handler(event):
        global_events.append(event.properties)

    async def session_handler(event):
        session_events.append(event.properties)

    # Subscribe globally and with session filter
    unsub_global = bus.subscribe(NoSessionEvent, global_handler)
    unsub_session = bus.subscribe(NoSessionEvent, session_handler, session_id="session-1")

    # Publish event without session_id
    await bus.publish(NoSessionEvent, NoSessionData(content="No session"))

    # Global handler should receive it
    assert len(global_events) == 1

    # Session handler should NOT receive it (no session_id to match)
    assert len(session_events) == 0

    # Cleanup
    unsub_global()
    unsub_session()


@pytest.mark.asyncio
async def test_global_bus_subscription_counts():
    """Test subscription count properties."""
    bus = GlobalBus()

    async def handler(event):
        pass

    # Initially empty
    assert bus.subscription_count == 0
    assert bus.session_subscription_count == 0
    assert bus.total_subscription_count == 0

    # Add global subscription
    unsub1 = bus.subscribe(TestMessage, handler)
    assert bus.subscription_count == 1
    assert bus.session_subscription_count == 0
    assert bus.total_subscription_count == 1

    # Add session subscription
    unsub2 = bus.subscribe(TestMessage, handler, session_id="session-1")
    assert bus.subscription_count == 1
    assert bus.session_subscription_count == 1
    assert bus.total_subscription_count == 2

    # Add another session subscription
    unsub3 = bus.subscribe(TestMessage, handler, session_id="session-2")
    assert bus.subscription_count == 1
    assert bus.session_subscription_count == 2
    assert bus.total_subscription_count == 3

    # Cleanup
    unsub1()
    unsub2()
    unsub3()

    assert bus.total_subscription_count == 0


@pytest.mark.asyncio
async def test_global_bus_get_session_ids():
    """Test getting list of active session IDs."""
    bus = GlobalBus()

    async def handler(event):
        pass

    # Initially empty
    assert bus.get_session_ids() == []

    # Add subscriptions for different sessions
    unsub1 = bus.subscribe(TestMessage, handler, session_id="session-1")
    unsub2 = bus.subscribe(TestMessage, handler, session_id="session-2")
    unsub3 = bus.subscribe(TestMessage, handler, session_id="session-1")  # Duplicate

    session_ids = bus.get_session_ids()
    assert len(session_ids) == 2
    assert "session-1" in session_ids
    assert "session-2" in session_ids

    # Cleanup
    unsub1()
    unsub2()
    unsub3()


@pytest.mark.asyncio
async def test_global_bus_clear():
    """Test clearing all subscriptions."""
    bus = GlobalBus()

    async def handler(event):
        pass

    # Add various subscriptions
    bus.subscribe(TestMessage, handler)
    bus.subscribe(TestMessage, handler, session_id="session-1")
    bus.subscribe_all(handler)
    bus.subscribe_all(handler, session_id="session-2")

    assert bus.total_subscription_count > 0

    # Clear all
    bus.clear()

    assert bus.subscription_count == 0
    assert bus.session_subscription_count == 0
    assert bus.total_subscription_count == 0
    assert bus.get_session_ids() == []


@pytest.mark.asyncio
async def test_global_bus_error_isolation():
    """Test that errors in one handler don't affect others."""
    bus = GlobalBus()
    successful_calls = []

    async def failing_handler(event):
        raise ValueError("Handler error")

    async def successful_handler(event):
        successful_calls.append(event.properties)

    # Subscribe both handlers
    unsub1 = bus.subscribe(TestMessage, failing_handler, session_id="session-1")
    unsub2 = bus.subscribe(TestMessage, successful_handler, session_id="session-1")

    # Publish event
    await bus.publish(
        TestMessage,
        TestMessageData(session_id="session-1", content="Test")
    )

    # Successful handler should still be called despite failing handler
    assert len(successful_calls) == 1

    # Cleanup
    unsub1()
    unsub2()


@pytest.mark.asyncio
async def test_global_bus_backward_compatibility():
    """Test that GlobalBus is backward compatible with Bus API."""
    bus = GlobalBus()
    events = []

    async def handler(event):
        events.append(event.properties)

    # Use base Bus API (no session_id parameter)
    unsub = bus.subscribe(TestMessage, handler)

    await bus.publish(
        TestMessage,
        TestMessageData(session_id="session-1", content="Test")
    )

    # Should work like regular Bus
    assert len(events) == 1

    # Cleanup
    unsub()
