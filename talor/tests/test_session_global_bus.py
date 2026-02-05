"""Test session module event publishing to global bus."""

import asyncio
import pytest
from pathlib import Path

from src import get_global_bus, _reset_global_bus
from src.session import session
from src.bus.events import (
    SessionCreated,
    SessionUpdated,
    SessionDeleted,
    MessageCreated,
)


@pytest.fixture
async def setup_session_module():
    """Setup session module with in-memory storage."""
    # Reset global bus
    _reset_global_bus()

    # Configure session module (no storage for simplicity)
    session.configure(workspace=Path("."), storage=None)
    session.clear_cache()

    yield

    # Cleanup
    session.clear_cache()
    _reset_global_bus()


@pytest.mark.asyncio
async def test_session_created_event_published_to_global_bus(setup_session_module):
    """Test that session created events are published to global bus."""
    bus = get_global_bus()
    received_events = []

    # Subscribe to SessionCreated events
    def handler(event):
        received_events.append(event)

    unsub = bus.subscribe(SessionCreated, handler)

    try:
        # Create a session
        new_session = await session.create_session(title="Test Session")

        # Wait for event processing
        await asyncio.sleep(0.1)

        # Verify event was received
        assert len(received_events) == 1
        event = received_events[0]
        assert event.properties.session_id == new_session.id
        assert event.properties.info.title == "Test Session"
    finally:
        unsub()


@pytest.mark.asyncio
async def test_session_updated_event_published_to_global_bus(setup_session_module):
    """Test that session updated events are published to global bus."""
    bus = get_global_bus()
    received_events = []

    # Create a session first
    new_session = await session.create_session(title="Original Title")

    # Subscribe to SessionUpdated events
    def handler(event):
        received_events.append(event)

    unsub = bus.subscribe(SessionUpdated, handler)

    try:
        # Update the session title
        await session.update_session_title(new_session.id, "Updated Title")

        # Wait for event processing
        await asyncio.sleep(0.1)

        # Verify event was received
        assert len(received_events) == 1
        event = received_events[0]
        assert event.properties.session_id == new_session.id
        assert event.properties.info.title == "Updated Title"
    finally:
        unsub()


@pytest.mark.asyncio
async def test_message_created_event_published_to_global_bus(setup_session_module):
    """Test that message created events are published to global bus."""
    bus = get_global_bus()
    received_events = []

    # Create a session first
    new_session = await session.create_session(title="Test Session")

    # Subscribe to MessageCreated events for this session
    def handler(event):
        received_events.append(event)

    unsub = bus.subscribe(MessageCreated, handler, session_id=new_session.id)

    try:
        # Add a user message
        msg = await session.add_user_message(new_session.id, "Hello, world!")

        # Wait for event processing
        await asyncio.sleep(0.1)

        # Verify event was received
        assert len(received_events) == 1
        event = received_events[0]
        assert event.properties.session_id == new_session.id
        assert event.properties.message_id == msg.info.id
        assert event.properties.role == "user"
        assert event.properties.content == "Hello, world!"
    finally:
        unsub()


@pytest.mark.asyncio
async def test_session_events_filtered_by_session_id(setup_session_module):
    """Test that session events are properly filtered by session_id."""
    bus = get_global_bus()
    session1_events = []
    session2_events = []

    # Create two sessions
    session1 = await session.create_session(title="Session 1")
    session2 = await session.create_session(title="Session 2")

    # Subscribe to MessageCreated events for each session
    unsub1 = bus.subscribe(
        MessageCreated,
        lambda e: session1_events.append(e),
        session_id=session1.id
    )
    unsub2 = bus.subscribe(
        MessageCreated,
        lambda e: session2_events.append(e),
        session_id=session2.id
    )

    try:
        # Add messages to both sessions
        await session.add_user_message(session1.id, "Message to session 1")
        await session.add_user_message(session2.id, "Message to session 2")
        await session.add_user_message(session1.id, "Another message to session 1")

        # Wait for event processing
        await asyncio.sleep(0.1)

        # Verify each subscriber only received events for their session
        assert len(session1_events) == 2
        assert all(e.properties.session_id == session1.id for e in session1_events)

        assert len(session2_events) == 1
        assert all(e.properties.session_id == session2.id for e in session2_events)
    finally:
        unsub1()
        unsub2()


@pytest.mark.asyncio
async def test_session_deleted_event_published_to_global_bus(setup_session_module):
    """Test that session deleted events are published to global bus."""
    bus = get_global_bus()
    received_events = []

    # Create a session first
    new_session = await session.create_session(title="To Be Deleted")

    # Subscribe to SessionDeleted events
    def handler(event):
        received_events.append(event)

    unsub = bus.subscribe(SessionDeleted, handler)

    try:
        # Delete the session
        await session.delete_session(new_session.id)

        # Wait for event processing
        await asyncio.sleep(0.1)

        # Verify event was received
        assert len(received_events) == 1
        event = received_events[0]
        assert event.properties.session_id == new_session.id
        assert event.properties.info.title == "To Be Deleted"
    finally:
        unsub()
