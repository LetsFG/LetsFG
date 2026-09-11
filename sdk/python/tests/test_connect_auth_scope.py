"""
`letsfg auth` must request scopes the server advertises (LetsFG/LetsFG#212).

The server's /oauth/authorize/init keeps only the requested scopes it knows
(`scopes_supported` in RFC 8414 discovery) and drops the rest WITHOUT an error.
The CLI used to send the bare word "flights", which is not one of them, so the
consent succeeded and the grant carried no scope at all: every hosted-connector
tool then answered "The connected OAuth grant does not include 'flights:search'".
"""
import io
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
if str(SDK_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_PYTHON_ROOT))

from letsfg.connectors import auth as A

# What https://letsfg.co/developers/api/.well-known/oauth-authorization-server
# publishes (api/services/oauth_store.py::ALL_SCOPES). Pinned here so a typo in
# _SCOPE fails a test instead of a customer's consent.
ADVERTISED = {"flights:search", "flights:book", "hotels:search", "hotels:book", "profile:read"}


class _FakeCallbackServer:
    def __init__(self, expected_state):
        self.port = 43210

    def wait_for_code(self, timeout=600):
        return "code-1"

    def close(self):
        pass


def _run_connect(token_response: dict) -> tuple[str, str]:
    """Drive connect_auth() with every network edge stubbed; return (auth_url, stdout)."""
    opened = []
    saved = {}
    out = io.StringIO()
    with patch.object(A, "_discover", lambda: {
                "authorization_endpoint": "https://letsfg.co/connect",
                "token_endpoint": "https://letsfg.co/developers/api/oauth/token",
                "registration_endpoint": "https://letsfg.co/developers/api/oauth/register",
            }), \
         patch.object(A, "_CallbackServer", _FakeCallbackServer), \
         patch.object(A, "_post_json_abs", lambda url, payload, timeout=30: (201, {"client_id": "cid"})), \
         patch.object(A, "_post_form", lambda url, fields, timeout=30: (200, token_response)), \
         patch.object(A, "save_token", lambda *a, **k: saved.update(k)), \
         patch.object(A.webbrowser, "open", lambda url: opened.append(url) or True), \
         redirect_stdout(out):
        A.connect_auth(open_browser=True)
    assert opened, "connect_auth must open the authorize URL"
    return opened[0], out.getvalue()


class ScopeTest(unittest.TestCase):
    def test_every_requested_scope_is_one_the_server_advertises(self):
        requested = A._SCOPE.split()
        self.assertTrue(requested, "must request at least one scope")
        self.assertEqual(set(requested) - ADVERTISED, set(),
                         "an unknown scope is dropped silently by the server")

    def test_flights_search_is_requested(self):
        # Without it, search_flights on the hosted connector refuses the grant.
        self.assertIn("flights:search", A._SCOPE.split())
        self.assertIn("flights:book", A._SCOPE.split())

    def test_authorize_url_carries_the_scopes(self):
        url, _ = _run_connect({"access_token": "at", "refresh_token": "rt", "expires_in": 3600,
                               "scope": A._SCOPE})
        q = parse_qs(urlparse(url).query)
        self.assertEqual(q["scope"], [A._SCOPE])
        self.assertEqual(q["response_type"], ["code"])
        self.assertEqual(q["code_challenge_method"], ["S256"])

    def test_a_scopeless_grant_is_reported_not_swallowed(self):
        # RFC 6749 s3.3: the server reports the scope it actually granted.
        _, out = _run_connect({"access_token": "at", "refresh_token": "rt", "expires_in": 3600,
                               "scope": ""})
        self.assertIn("flights:search", out)
        self.assertIn("Warning", out)

    def test_a_full_grant_prints_no_warning(self):
        _, out = _run_connect({"access_token": "at", "refresh_token": "rt", "expires_in": 3600,
                               "scope": A._SCOPE})
        self.assertNotIn("Warning", out)

    def test_a_server_that_omits_scope_is_not_accused(self):
        _, out = _run_connect({"access_token": "at", "refresh_token": "rt", "expires_in": 3600})
        self.assertNotIn("Warning", out)


if __name__ == "__main__":
    unittest.main()
