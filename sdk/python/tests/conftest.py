import pytest


@pytest.fixture(autouse=True)
def _pending_auth_in_tmp(tmp_path, monkeypatch):
    """connect_auth() keeps the sign-in in flight on disk; never let a test write the real ~/.letsfg."""
    from letsfg.connectors import auth

    monkeypatch.setattr(auth, "_pending_path", lambda: tmp_path / "pending_auth.json")
