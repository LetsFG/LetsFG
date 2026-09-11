"""
A 401 from letsfg.co carries the server's own code (LetsFG/LetsFG#212).

letsfg.co answers `401 {"error":"Unauthorized","code":"NO_SESSION"}` for an
expired token and for a token it refused for any other reason. The old message
called every 401 "Bearer token expired or revoked", which sent a person through
the consent flow three times for a bug on our side. The code must reach the
message so a report can quote it.
"""
import asyncio
import io
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
if str(SDK_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_PYTHON_ROOT))

from letsfg import local as L
from letsfg.connectors.auth import BearerTokenError


def _http_error(status: int, body: bytes) -> HTTPError:
    return HTTPError("https://letsfg.co/api/search", status, "Unauthorized", {}, io.BytesIO(body))


class TokenRefreshTest(unittest.TestCase):
    def test_search_refreshes_an_expired_token_instead_of_asking_for_letsfg_auth(self):
        # An hour after `letsfg auth` the access token is stale but the refresh
        # token is stored next to it; search_local must go through the refresher.
        import time
        from letsfg.connectors import auth as A
        stored = {"pfs_auth": {"token": "stale", "expires_at": time.time() - 10,
                               "refresh_token": "rt", "client_id": "cid"}}
        refreshed = []
        def refused(req, timeout=30):
            raise _http_error(401, b'{"code":"NO_SESSION"}')

        with (patch.object(A, "_load_config", lambda: stored),
              patch.object(A, "refresh_access_token", lambda: refreshed.append(1) or "fresh"),
              patch.object(L, "urlopen", refused)):
            with self.assertRaises(BearerTokenError):
                asyncio.run(L.search_local("LUX", "LCY", "2026-10-01"))
        self.assertEqual(refreshed, [1], "the stale token must be refreshed, not reported as expired")


class UnauthorizedMessageTest(unittest.TestCase):
    def _search(self, err: HTTPError) -> str:
        def raise_it(req, timeout=30):
            raise err
        with patch.object(L, "ensure_bearer_token", lambda: "lfg_at_x"), \
             patch.object(L, "urlopen", raise_it):
            with self.assertRaises(BearerTokenError) as cm:
                asyncio.run(L.search_local("LUX", "LCY", "2026-10-01"))
        return str(cm.exception)

    def test_search_carries_the_servers_code(self):
        msg = self._search(_http_error(401, b'{"error":"Unauthorized","code":"NO_SESSION"}'))
        self.assertIn("401", msg)
        self.assertIn("NO_SESSION", msg)
        self.assertIn("letsfg auth", msg)
        self.assertNotIn("expired or revoked", msg, "a refused token is not necessarily expired")

    def test_a_401_without_a_body_still_points_at_letsfg_auth(self):
        msg = self._search(_http_error(401, b"nope"))
        self.assertIn("401", msg)
        self.assertIn("letsfg auth", msg)

    def test_book_uses_the_same_message(self):
        def raise_it(req, timeout=60):
            raise _http_error(401, b'{"error":"Unauthorized","code":"NO_SESSION"}')
        with patch.object(L, "ensure_bearer_token", lambda: "lfg_at_x"), \
             patch.object(L, "urlopen", raise_it):
            with self.assertRaises(BearerTokenError) as cm:
                asyncio.run(L.book_offer("s1", "o1", {"given_name": "A"}, "a@example.com"))
        self.assertIn("NO_SESSION", str(cm.exception))

    def test_other_errors_are_not_rewritten(self):
        def raise_it(req, timeout=30):
            raise _http_error(500, b"boom")
        with patch.object(L, "ensure_bearer_token", lambda: "lfg_at_x"), \
             patch.object(L, "urlopen", raise_it):
            with self.assertRaises(HTTPError):
                asyncio.run(L.search_local("LUX", "LCY", "2026-10-01"))


if __name__ == "__main__":
    unittest.main()
