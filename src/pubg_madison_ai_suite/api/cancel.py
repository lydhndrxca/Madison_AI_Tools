"""Shared cancel-event management for concurrent API requests."""

from threading import Event, Lock

_active_events: set[Event] = set()
_lock = Lock()


def reset_cancel_event() -> Event:
    """Create a new cancel token for a request and register it."""
    ev = Event()
    with _lock:
        _active_events.add(ev)
    return ev


def release_cancel_event(ev: Event) -> None:
    """Unregister a token when its request completes."""
    with _lock:
        _active_events.discard(ev)


def cancel_all() -> int:
    """Set all active cancel events. Returns count of cancelled requests."""
    with _lock:
        count = len(_active_events)
        for ev in _active_events:
            ev.set()
        _active_events.clear()
    return count
