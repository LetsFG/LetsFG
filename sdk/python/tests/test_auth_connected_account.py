"""
After connecting, `letsfg auth` says WHICH account it connected (masked e-mail).

Why (2026-11-10): with the letsfg.co hand-off, the code goes to whichever
process polls for it. If someone else approves your authorize link first, your
CLI connects to THEIR account. Showing the account straight away is how you
notice. The CLI asks for `openid email` (both in the server's
scopes_supported) so /oauth/userinfo can answer; a guest account has no e-mail
and says so. A failure to read it never fails the sign-in.
"""
import io
import json
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch
from urllib.error import URLError

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
if str(SDK_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_PYTHON_ROOT))

from letsfg.connectors import auth as A

REAL_FETCH_USERINFO = A._fetch_userinfo    # conftest stubs it for every other test


class MaskTest(unittest.TestCase):
    def test_masks_the_local_part(self):
        self.assertEqual(A._mask_email("tomek@gmail.com"), "t***@gmail.com")
        self.assertEqual(A._mask_email("a@x.io"), "a***@x.io")

    def test_anything_else_is_not_shown(self):
        for bad in ("", "no-at-sign", "@x.io", "a@", None, 7):
            self.assertEqual(A._mask_email(bad), "", bad)


class AccountLineTest(unittest.TestCase):
    def test_names_the_masked_email(self):
        line = A._account_line({"sub": "agent_1", "email": "tomek@gmail.com"})
        self.assertIn("t***@gmail.com", line)
        self.assertNotIn("tomek@", line)
        self.assertIn("letsfg auth", line, "says what to do if it is not you")

    def test_a_guest_account_says_it_has_no_email(self):
        self.assertIn("guest", A._account_line({"sub": "agent_1"}))

    def test_nothing_when_userinfo_was_not_readable(self):
        self.assertIsNone(A._account_line(None))


class FetchUserinfoTest(unittest.TestCase):
    def test_reads_claims_with_the_bearer_token(self):
        seen = {}

        class _Resp:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return json.dumps({"sub": "agent_1", "email": "x@y.co"}).encode()

        def fake_urlopen(req, timeout=10):
            seen["url"], seen["auth"] = req.full_url, req.headers.get("Authorization")
            return _Resp()

        with patch.object(A, "urlopen", fake_urlopen):
            claims = REAL_FETCH_USERINFO("at-123")
        self.assertEqual(claims["email"], "x@y.co")
        self.assertTrue(seen["url"].endswith("/developers/api/oauth/userinfo"))
        self.assertEqual(seen["auth"], "Bearer at-123")

    def test_any_failure_is_none(self):
        def boom(*a, **k):
            raise URLError("offline")
        with patch.object(A, "urlopen", boom):
            self.assertIsNone(REAL_FETCH_USERINFO("at"))


class ScopeTest(unittest.TestCase):
    def test_asks_for_openid_and_email(self):
        self.assertIn("openid", A._SCOPE.split())
        self.assertIn("email", A._SCOPE.split())


class ExchangePrintsTheAccountTest(unittest.TestCase):
    def test_the_account_is_printed_after_connecting(self):
        out = io.StringIO()
        with patch.object(A, "_post_form", lambda *a, **k: (200, {"access_token": "at"})), \
             patch.object(A, "save_token", lambda *a, **k: None), \
             patch.object(A, "_fetch_userinfo", lambda token: {"sub": "s", "email": "tomek@gmail.com"}), \
             redirect_stdout(out):
            A._exchange_code("https://x/token", code="c", client_id="cid", redirect_uri="r", verifier="v")
        self.assertIn("t***@gmail.com", out.getvalue())


if __name__ == "__main__":
    unittest.main()
