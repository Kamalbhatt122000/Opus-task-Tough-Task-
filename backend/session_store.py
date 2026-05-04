"""
In-memory session store.

Keyed by session_id (UUID string).  Stores processed mesh,
cavity data, and stone meshes so /api/regenerate and /api/export/glb
can re-use them without re-uploading.
"""

import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

_store: Dict[str, Dict[str, Any]] = {}


def save(session_id: str, data: Dict[str, Any]) -> None:
    """Persist session data."""
    _store[session_id] = data
    logger.info("Session %s saved (%d keys)", session_id, len(data))


def get(session_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve session data or *None*."""
    return _store.get(session_id)


def update(session_id: str, key: str, value: Any) -> None:
    """Update a single key inside an existing session."""
    if session_id in _store:
        _store[session_id][key] = value


def delete(session_id: str) -> None:
    """Remove a session."""
    _store.pop(session_id, None)
    logger.info("Session %s deleted", session_id)
