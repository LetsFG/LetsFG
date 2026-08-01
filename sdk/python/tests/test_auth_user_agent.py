"""
Regression test for GitHub issues #163 / #177.

`connectors/auth.py::_post_json()` built its urllib Request with only a
Content-Type header -- no User-Agent -- so it fell back to the interpreter
default, e.g. "Python-urllib/3.13". Cloudflare blocks that default UA with
error 1010 ("blocked User-Agent"), so every PFS auth call (`letsfg auth`,
and anything calling request_enrolment()/verify_payment_method() directly)
failed with HTTP 403 even though the exact same request with a normal UA
(curl, or the other clients in this package) reaches the app fine.

cli.py and client.py already set an explicit User-Agent on every request;
this was the one call site in the package that didn't.
"""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
if str(SDK_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_PYTHON_ROOT))

from letsfg.connectors import auth as auth_module


class _DummyResponse:
    def __init__(self, status: int, payload: dict):
        self.status = status
        self._payload = payload

    def read(self):
        import json
        return json.dumps(self._payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class TestPostJsonUserAgent(unittest.TestCase):
    def test_post_json_sets_an_explicit_user_agent(self):
        """The request must not fall back to urllib's default UA -- that's
        exactly what Cloudflare's 1010 rule blocks (issue #163 / #177)."""
        captured = {}

        def fake_urlopen(req, timeout=None):
            captured["headers"] = dict(req.header_items())
            return _DummyResponse(402, {"setup_url": "https://letsfg.co/x"})

        with patch.object(auth_module, "urlopen", fake_urlopen):
            auth_module._post_json("/api/agent-access/request", {})

        headers = {k.lower(): v for k, v in captured["headers"].items()}
        self.assertIn("user-agent", headers)
        self.assertNotIn("python-urllib", headers["user-agent"].lower())

    def test_post_json_user_agent_matches_the_rest_of_the_sdk(self):
        captured = {}

        def fake_urlopen(req, timeout=None):
            captured["headers"] = dict(req.header_items())
            return _DummyResponse(200, {"ok": True})

        with patch.object(auth_module, "urlopen", fake_urlopen):
            auth_module._post_json("/api/agent-access/verify", {"setup_session_id": "cs_x"})

        headers = {k.lower(): v for k, v in captured["headers"].items()}
        self.assertEqual(headers.get("user-agent"), "LetsFG-Python-SDK/1.0.3")


if __name__ == "__main__":
    unittest.main()
