"""Test bootstrap — isolate the suite from any real database.

WHY THIS FILE EXISTS: the suite is destructive by design (several tests call
`delete_many({})` on collections to guarantee a clean slate). Pointed at the
development database, running `pytest` silently destroyed the `seed.py` demo
data — which is exactly what happened once, and it is a nasty trap: the demo
works, you run the tests, and the demo is gone with no error.

So the suite gets its OWN database, chosen here before any application module
is imported (`app.core.config` reads MONGO_DB from the environment, and
`os.environ` wins over backend/.env). `setdefault` still lets a developer
override it deliberately.

Collections, JSON-schema validators and indexes are created once per session so
the tests exercise the same constraints the application does — a unique index on
`users.phone` is part of what the API relies on.
"""
import os

os.environ.setdefault("MONGO_DB", "vehicle_sharing_test")

import os

os.environ.setdefault("MONGO_DB", "vehicle_sharing_test")

import asyncio  # noqa: E402


def _prepare_test_database() -> None:
    """Create collections + validators + indexes in the TEST database.

    Runs at import time on its own throwaway event loop rather than as a
    session-scoped async fixture: pytest-asyncio 0.21 (strict mode) only
    provides a function-scoped `event_loop`, so a session-scoped async fixture
    raises ScopeMismatch. `reset_client()` afterwards drops the Motor client
    that loop pinned, which `app.core.database` handles on its own but is
    cheaper to do explicitly here.
    """
    from app.core.database import ping_db, reset_client

    loop = asyncio.new_event_loop()
    try:
        asyncio.set_event_loop(loop)
        if not loop.run_until_complete(ping_db()):
            return  # every DB-backed test skips cleanly on its own
        import init_db

        loop.run_until_complete(init_db.main())
    finally:
        try:
            reset_client()
        finally:
            loop.close()
            # Leave a fresh loop installed. pytest-asyncio builds its own per
            # test, but code that calls asyncio.get_event_loop() at import time
            # would otherwise hit "There is no current event loop in thread".
            asyncio.set_event_loop(asyncio.new_event_loop())


_prepare_test_database()
