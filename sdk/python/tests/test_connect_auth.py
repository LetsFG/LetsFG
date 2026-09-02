"""
`letsfg auth` connects a card at letsfg.co/connect (OAuth 2.1 + PKCE).

Before 2026-09-02 this ran the Stripe enrolment: it read `setup_url` out of the
402 and posted a `setup_session_id` to /api/agent-access/verify. Both lanes are
retired, so that CLI could not get a token at all -- `pip install letsfg` gave
you a `letsfg auth` that always failed. These tests pin the replacement.

What actually matters here, and is easy to regress:
  * the loopback listener must bind BEFORE registration, because redirect_uri
    has to match byte for byte;
  * a mismatched `state` must be refused (CSRF), not exchanged;
  * the refresh token ROTATES -- storing the old one replays a spent token;
  * verify_payment_method() must raise rather than post to a dead lane.
"""
import base64
import hashlib
import sys
import time
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
if str(SDK_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_PYTHON_ROOT))

from letsfg.connectors import auth as A


class PkceTest(unittest.TestCase):
    def test_challenge_is_the_s256_of_the_verifier(self):
        verifier, challenge = A._pkce()
        expected = base64.urlsafe_b64encode(
            hashlib.sha256(verifier.encode()).digest()
        ).rstrip(b"=").decode()
        self.assertEqual(challenge, expected)

    def test_verifier_is_unpadded_and_url_safe(self):
        verifier, challenge = A._pkce()
        for value in (verifier, challenge):
            self.assertNotIn("=", value)
            self.assertNotIn("+", value)
            self.assertNotIn("/", value)
            # RFC 7636 requires 43-128 characters.
            self.assertGreaterEqual(len(value), 43)


class CallbackServerTest(unittest.TestCase):
    def _hit(self, port, query):
        urllib.request.urlopen(f"http://127.0.0.1:{port}/callback?{query}", timeout=5).read()

    def test_captures_the_code_on_a_matching_state(self):
        s = A._CallbackServer("st123")
        try:
            self._hit(s.port, "code=abc123&state=st123")
            self.assertEqual(s.wait_for_code(timeout=5), "abc123")
        finally:
            s.close()

    def test_refuses_a_mismatched_state(self):
        s = A._CallbackServer("st123")
        try:
            self._hit(s.port, "code=abc123&state=WRONG")
            with self.assertRaises(A.BearerTokenError) as ctx:
                s.wait_for_code(timeout=5)
            self.assertIn("state mismatch", str(ctx.exception))
        finally:
            s.close()

    def test_surfaces_a_provider_error(self):
        s = A._CallbackServer("st9")
        try:
            self._hit(s.port, "error=access_denied&state=st9")
            with self.assertRaises(A.BearerTokenError) as ctx:
                s.wait_for_code(timeout=5)
            self.assertIn("access_denied", str(ctx.exception))
        finally:
            s.close()


class RetiredLaneTest(unittest.TestCase):
    def test_verify_payment_method_raises_instead_of_calling_a_dead_lane(self):
        with patch.object(A, "urlopen") as never:
            with self.assertRaises(A.BearerTokenError) as ctx:
                A.verify_payment_method(setup_session_id="cs_x")
            never.assert_not_called()
        self.assertIn("letsfg auth", str(ctx.exception))


class RefreshRotationTest(unittest.TestCase):
    def test_stores_the_rotated_refresh_token(self):
        stored = {"pfs_auth": {"refresh_token": "old_rt", "client_id": "cid"}}
        saved = {}

        def fake_post_form(url, fields, timeout=30):
            self.assertEqual(fields["grant_type"], "refresh_token")
            self.assertEqual(fields["refresh_token"], "old_rt")
            return 200, {
                "access_token": "new_at",
                "refresh_token": "new_rt",
                "expires_in": 3600,
            }

        with patch.object(A, "_load_config", lambda: stored), \
             patch.object(A, "_save_config", lambda cfg: saved.update(cfg)), \
             patch.object(A, "_post_form", fake_post_form), \
             patch.object(A, "_discover", lambda: {"token_endpoint": "https://x/token"}):
            self.assertEqual(A.refresh_access_token(), "new_at")

        self.assertEqual(saved["pfs_auth"]["refresh_token"], "new_rt")
        self.assertEqual(saved["pfs_auth"]["token"], "new_at")

    def test_keeps_the_old_refresh_token_when_the_server_does_not_rotate(self):
        stored = {"pfs_auth": {"refresh_token": "old_rt", "client_id": "cid"}}
        saved = {}
        with patch.object(A, "_load_config", lambda: stored), \
             patch.object(A, "_save_config", lambda cfg: saved.update(cfg)), \
             patch.object(A, "_post_form", lambda *a, **k: (200, {"access_token": "at"})), \
             patch.object(A, "_discover", lambda: {"token_endpoint": "https://x/token"}):
            A.refresh_access_token()
        self.assertEqual(saved["pfs_auth"]["refresh_token"], "old_rt")


class TokenLifetimeTest(unittest.TestCase):
    def test_expired_token_with_a_refresh_token_points_at_the_refresher(self):
        stored = {"pfs_auth": {
            "token": "stale", "expires_at": time.time() - 10, "refresh_token": "rt",
        }}
        with patch.dict("os.environ", {}, clear=False), \
             patch.object(A, "_load_config", lambda: stored):
            A.os.environ.pop("LETSFG_BEARER_TOKEN", None)
            with self.assertRaises(A.BearerTokenError) as ctx:
                A.get_bearer_token()
        self.assertIn("ensure_bearer_token", str(ctx.exception))

    def test_env_var_always_wins(self):
        with patch.dict("os.environ", {"LETSFG_BEARER_TOKEN": "from_env"}):
            self.assertEqual(A.get_bearer_token(), "from_env")
            self.assertEqual(A.ensure_bearer_token(), "from_env")


class DiscoveryTest(unittest.TestCase):
    def test_falls_back_to_the_advertised_endpoints(self):
        def boom(*a, **k):
            raise OSError("network down")

        with patch.object(A, "urlopen", boom):
            meta = A._discover()
        self.assertTrue(meta["authorization_endpoint"].endswith("/connect"))
        self.assertTrue(meta["token_endpoint"].endswith("/oauth/token"))
        self.assertTrue(meta["registration_endpoint"].endswith("/oauth/register"))


if __name__ == "__main__":
    unittest.main()
