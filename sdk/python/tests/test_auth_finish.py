"""
`letsfg auth --finish <url>`: finish a sign-in whose local listener is gone.

Measured 10 Nov 2026 (LetsFG-private audit, oauth-never-connected): about one
letsfg-python consent in three never reached /oauth/token. The person pressed
Authorize, letsfg.co sent the browser to http://127.0.0.1:<port>/callback, and
nothing was listening any more -- the agent's tool call had been killed, or the
CLI ran in a sandbox or on another machine. The browser then shows "can't
connect" with the code sitting in its address bar.

So `letsfg auth` keeps what it needs to finish -- client_id, redirect_uri, PKCE
verifier, state -- in ~/.letsfg/pending_auth.json (0600) for ten minutes, the
server's code lifetime, and `letsfg auth --finish '<that address>'` exchanges
the code. What must hold:
  * the file is private (0600) from the moment it exists;
  * a URL whose `state` is not ours is refused (CSRF), never exchanged;
  * after ten minutes the record is refused (the code is dead anyway);
  * the token request carries the verifier and the ORIGINAL redirect_uri;
  * the record is gone once the server has answered (codes are single-use).
"""
import io
import json
import os
import stat
import sys
import tempfile
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
from letsfg.connectors import pending_auth as P


def _pending(created_at: float = 1_000.0) -> P.PendingAuth:
    return P.PendingAuth(
        client_id="cid",
        redirect_uri="http://127.0.0.1:43210/callback",
        verifier="v" * 43,
        state="st-ours",
        token_endpoint="https://letsfg.co/developers/api/oauth/token",
        created_at=created_at,
    )


class _TmpDir(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.path = Path(self._tmp.name) / ".letsfg" / "pending_auth.json"

    def tearDown(self):
        self._tmp.cleanup()


class PendingStoreTest(_TmpDir):
    def test_round_trips_within_ten_minutes(self):
        P.save(self.path, _pending(created_at=1_000.0))
        self.assertEqual(P.load(self.path, now=1_000.0 + 599), _pending(created_at=1_000.0))

    @unittest.skipIf(os.name == "nt", "POSIX permissions")
    def test_file_is_private_to_the_user(self):
        P.save(self.path, _pending())
        mode = stat.S_IMODE(self.path.stat().st_mode)
        self.assertEqual(mode, 0o600)

    @unittest.skipIf(os.name == "nt", "POSIX permissions")
    def test_overwriting_an_existing_world_readable_file_leaves_it_private(self):
        self.path.parent.mkdir(parents=True)
        self.path.write_text("{}")
        self.path.chmod(0o644)
        P.save(self.path, _pending())
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o600)

    def test_refused_after_ten_minutes(self):
        P.save(self.path, _pending(created_at=1_000.0))
        with self.assertRaises(P.PendingAuthError) as ctx:
            P.load(self.path, now=1_000.0 + P.PENDING_TTL_S + 1)
        self.assertIn("letsfg auth", str(ctx.exception))

    def test_missing_file_says_to_start_again(self):
        with self.assertRaises(P.PendingAuthError) as ctx:
            P.load(self.path, now=0)
        self.assertIn("letsfg auth", str(ctx.exception))

    def test_corrupt_file_is_refused_not_crashed_on(self):
        self.path.parent.mkdir(parents=True)
        self.path.write_text("{not json")
        with self.assertRaises(P.PendingAuthError):
            P.load(self.path, now=0)

    def test_clear_is_quiet_when_nothing_is_there(self):
        P.clear(self.path)
        P.save(self.path, _pending())
        P.clear(self.path)
        self.assertFalse(self.path.exists())


class CodeFromCallbackTest(unittest.TestCase):
    def test_reads_the_code_from_the_loopback_address(self):
        url = "http://127.0.0.1:43210/callback?code=abc&state=st-ours"
        self.assertEqual(P.code_from_callback(url, _pending()), "abc")

    def test_tolerates_quotes_and_whitespace_from_a_paste(self):
        url = "  'http://127.0.0.1:43210/callback?code=abc&state=st-ours'\n"
        self.assertEqual(P.code_from_callback(url, _pending()), "abc")

    def test_accepts_the_hosted_hand_off_address_too(self):
        url = "https://letsfg.co/connect/done?h=HANDLE&code=abc&state=st-ours"
        self.assertEqual(P.code_from_callback(url, _pending()), "abc")

    def test_refuses_another_attempts_state(self):
        url = "http://127.0.0.1:43210/callback?code=abc&state=someone-else"
        with self.assertRaises(P.PendingAuthError) as ctx:
            P.code_from_callback(url, _pending())
        self.assertIn("state", str(ctx.exception))

    def test_refuses_a_url_without_state(self):
        with self.assertRaises(P.PendingAuthError):
            P.code_from_callback("http://127.0.0.1:43210/callback?code=abc", _pending())

    def test_surfaces_a_refusal(self):
        url = "http://127.0.0.1:43210/callback?error=access_denied&state=st-ours"
        with self.assertRaises(P.PendingAuthError) as ctx:
            P.code_from_callback(url, _pending())
        self.assertIn("access_denied", str(ctx.exception))

    def test_refuses_a_url_with_no_code(self):
        with self.assertRaises(P.PendingAuthError):
            P.code_from_callback("http://127.0.0.1:43210/callback?state=st-ours", _pending())


class FinishAuthTest(_TmpDir):
    def _finish(self, url, post_form, now=1_000.0 + 30):
        saved = {}
        out = io.StringIO()
        with patch.object(A, "_pending_path", lambda: self.path), \
             patch.object(A, "_post_form", post_form), \
             patch.object(A, "save_token", lambda *a, **k: saved.update(k, token=a[0])), \
             patch.object(A.time, "time", lambda: now), \
             redirect_stdout(out):
            token = A.finish_auth(url)
        return token, saved, out.getvalue()

    def test_exchanges_the_code_with_the_stored_verifier_and_redirect(self):
        P.save(self.path, _pending())
        sent = {}

        def post_form(url, fields, timeout=30):
            sent.update(fields, url=url)
            return 200, {"access_token": "at", "refresh_token": "rt", "expires_in": 3600,
                         "scope": "flights:search flights:book profile:read"}

        token, saved, _ = self._finish("http://127.0.0.1:43210/callback?code=abc&state=st-ours", post_form)
        self.assertEqual(token, "at")
        self.assertEqual(sent["url"], "https://letsfg.co/developers/api/oauth/token")
        self.assertEqual(sent["grant_type"], "authorization_code")
        self.assertEqual(sent["code"], "abc")
        self.assertEqual(sent["code_verifier"], "v" * 43)
        self.assertEqual(sent["redirect_uri"], "http://127.0.0.1:43210/callback")
        self.assertEqual(sent["client_id"], "cid")
        self.assertEqual(saved["refresh_token"], "rt")
        self.assertEqual(saved["client_id"], "cid")
        self.assertFalse(self.path.exists(), "the record goes once the code is spent")

    def test_a_foreign_state_is_never_sent_to_the_server(self):
        P.save(self.path, _pending())

        def post_form(*a, **k):
            raise AssertionError("must not exchange a code from another attempt")

        with self.assertRaises(A.BearerTokenError):
            self._finish("http://127.0.0.1:43210/callback?code=abc&state=evil", post_form)
        self.assertTrue(self.path.exists(), "a wrong paste does not burn the real attempt")

    def test_expired_record_is_refused_and_removed(self):
        P.save(self.path, _pending(created_at=1_000.0))

        def post_form(*a, **k):
            raise AssertionError("must not call the server for an expired attempt")

        with self.assertRaises(A.BearerTokenError) as ctx:
            self._finish("http://127.0.0.1:43210/callback?code=abc&state=st-ours", post_form,
                         now=1_000.0 + P.PENDING_TTL_S + 5)
        self.assertIn("letsfg auth", str(ctx.exception))
        self.assertFalse(self.path.exists())

    def test_a_server_refusal_is_reported_and_the_spent_record_removed(self):
        P.save(self.path, _pending())
        with self.assertRaises(A.BearerTokenError) as ctx:
            self._finish("http://127.0.0.1:43210/callback?code=abc&state=st-ours",
                         lambda *a, **k: (400, {"error": "invalid_grant"}))
        self.assertIn("invalid_grant", str(ctx.exception))
        self.assertFalse(self.path.exists())

    def test_a_network_failure_keeps_the_record_for_a_retry(self):
        P.save(self.path, _pending())

        def post_form(*a, **k):
            raise URLError("offline")

        with self.assertRaises(A.BearerTokenError):
            self._finish("http://127.0.0.1:43210/callback?code=abc&state=st-ours", post_form)
        self.assertTrue(self.path.exists())


class ConnectAuthKeepsTheAttemptTest(_TmpDir):
    """connect_auth() writes the record BEFORE it waits, and says how to finish."""

    def _run(self, wait):
        class _Server:
            port = 43210

            def __init__(self, state):
                self.state = state

            def wait_for_code(self, timeout=600):
                return wait(self)

            def close(self):
                pass

        out = io.StringIO()
        with patch.object(A, "_pending_path", lambda: self.path), \
             patch.object(A, "_discover", lambda: {
                 "authorization_endpoint": "https://letsfg.co/connect",
                 "token_endpoint": "https://letsfg.co/developers/api/oauth/token",
                 "registration_endpoint": "https://letsfg.co/developers/api/oauth/register",
             }), \
             patch.object(A, "_CallbackServer", _Server), \
             patch.object(A, "_post_json_abs", lambda url, payload, timeout=30: (201, {"client_id": "cid"})), \
             patch.object(A, "_post_form", lambda url, fields, timeout=30: (200, {"access_token": "at"})), \
             patch.object(A, "save_token", lambda *a, **k: None), \
             redirect_stdout(out):
            try:
                A.connect_auth(open_browser=False)
            except A.BearerTokenError:
                pass
        return out.getvalue()

    def test_record_exists_while_waiting_and_matches_the_attempt(self):
        seen = {}

        def wait(server):
            seen["record"] = json.loads(self.path.read_text())
            seen["state"] = server.state
            return "code-1"

        out = self._run(wait)
        rec = seen["record"]
        self.assertEqual(rec["client_id"], "cid")
        self.assertEqual(rec["redirect_uri"], "http://127.0.0.1:43210/callback")
        self.assertEqual(rec["state"], seen["state"])
        self.assertGreaterEqual(len(rec["verifier"]), 43)
        self.assertIn("letsfg auth --finish", out)
        self.assertFalse(self.path.exists(), "cleared after a normal success")

    def test_record_survives_a_listener_that_never_hears_back(self):
        def wait(server):
            raise A.BearerTokenError("Timed out waiting for the browser to come back.")

        out = self._run(wait)
        self.assertTrue(self.path.exists())
        self.assertIn("letsfg auth --finish", out)


class CliFinishFlagTest(unittest.TestCase):
    def test_finish_flag_calls_finish_auth_and_never_starts_a_new_sign_in(self):
        from typer.testing import CliRunner
        from letsfg import cli

        calls = []
        with patch.object(A, "finish_auth", lambda url: calls.append(url) or "at"), \
             patch.object(A, "connect_auth", lambda **k: self.fail("must not start a new sign-in")):
            result = CliRunner().invoke(cli.app, ["auth", "--finish", "http://127.0.0.1:1/callback?code=c&state=s"])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertEqual(calls, ["http://127.0.0.1:1/callback?code=c&state=s"])

    def test_finish_flag_reports_a_refusal_as_an_error(self):
        from typer.testing import CliRunner
        from letsfg import cli

        def refuse(url):
            raise A.BearerTokenError("its state does not match")

        with patch.object(A, "finish_auth", refuse):
            result = CliRunner().invoke(cli.app, ["auth", "--finish", "http://x/?code=c&state=s"])
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("state does not match", result.output)


if __name__ == "__main__":
    unittest.main()
