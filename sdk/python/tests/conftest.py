import pytest


@pytest.fixture(autouse=True)
def _pending_auth_in_tmp(tmp_path, monkeypatch):
    """connect_auth() keeps the sign-in in flight on disk; never let a test write the real ~/.letsfg."""
    from letsfg.connectors import auth

    monkeypatch.setattr(auth, "_pending_path", lambda: tmp_path / "pending_auth.json")


@pytest.fixture(autouse=True)
def _no_userinfo_network(monkeypatch):
    """_exchange_code reads /oauth/userinfo after connecting; never from a test (test_auth_connected_account.py
    tests the real one)."""
    from letsfg.connectors import auth

    monkeypatch.setattr(auth, "_fetch_userinfo", lambda token: None)
