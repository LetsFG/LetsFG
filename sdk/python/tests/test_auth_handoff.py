"""
`letsfg auth` over the hosted code hand-off (letsfg.co/connect/done).

A loopback listener only works when the browser and this process share a
machine and the process is still alive. When letsfg.co offers a hand-off
(POST /developers/api/oauth/handoff), the CLI registers
https://letsfg.co/connect/done?h=<handle> instead, and polls
/oauth/handoff/fetch for the approved code -- from a sandbox, a remote box or
an agent, wherever. PKCE still guards the redeem.

What must hold:
  * the hand-off is used when the server offers it, and the loopback is NOT bound;
  * a server without it (404, HTML, network error) falls back to the loopback,
    so this SDK can ship before the server does;
  * a redirect the server names that is not our /connect/done page is refused
    (fall back), never registered;
  * the fetched state must be ours (CSRF), or the code is not exchanged;
  * "pending" keeps polling; 404 stops with what to do; a network blip retries.
"""
import io
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

HANDLE = "H" * 43
HOSTED = f"{A._BASE_URL}/connect/done?h={HANDLE}"


class StartHandoffTest(unittest.TestCase):
    def test_uses_the_hand_off_the_server_offers(self):
        with patch.object(A, "_post_json_abs", lambda url, payload, timeout=30: (
                201, {"handle": HANDLE, "redirect_uri": HOSTED, "poll_interval": 3})):
            h = A._start_handoff()
        self.assertEqual((h.handle, h.redirect_uri, h.poll_interval), (HANDLE, HOSTED, 3))

    def test_no_hand_off_on_an_older_server(self):
        for answer in [(404, {"error": "<html>not found"}), (405, {}), (500, {"detail": "x"}), (201, {})]:
            with patch.object(A, "_post_json_abs", lambda url, payload, timeout=30, a=answer: a):
                self.assertIsNone(A._start_handoff(), answer)

    def test_no_hand_off_when_the_network_fails(self):
        def boom(*a, **k):
            raise URLError("offline")
        with patch.object(A, "_post_json_abs", boom):
            self.assertIsNone(A._start_handoff())

    def test_a_redirect_that_is_not_our_page_is_refused(self):
        for bad in ["https://evil.example/connect/done?h=" + HANDLE,
                    f"{A._BASE_URL}/connect/done?h=OTHER",
                    f"{A._BASE_URL}/connect/done?h={HANDLE}&x=1",
                    f"{A._BASE_URL}.evil.com/connect/done?h={HANDLE}"]:
            with patch.object(A, "_post_json_abs", lambda url, payload, timeout=30, b=bad: (
                    201, {"handle": HANDLE, "redirect_uri": b})):
                self.assertIsNone(A._start_handoff(), bad)


class WaitForHandoffTest(unittest.TestCase):
    def _wait(self, answers, state="st", timeout=60):
        calls, slept = [], []
        clock = {"t": 0.0}

        def post(url, payload, timeout=30):
            calls.append(payload)
            a = answers.pop(0)
            if isinstance(a, Exception):
                raise a
            return a

        def sleep(s):
            slept.append(s)
            clock["t"] += s

        with patch.object(A, "_post_json_abs", post):
            code = A._wait_for_handoff(
                A._Handoff(HANDLE, HOSTED, 3), expected_state=state, timeout=timeout,
                sleep=sleep, now=lambda: clock["t"],
            )
        return code, calls, slept

    def test_polls_until_ready_and_returns_the_code(self):
        code, calls, slept = self._wait([
            (200, {"status": "pending"}), (200, {"status": "pending"}),
            (200, {"status": "ready", "code": "the-code", "state": "st"}),
        ])
        self.assertEqual(code, "the-code")
        self.assertEqual(calls, [{"handle": HANDLE}] * 3, "the handle goes in the body, never a URL")
        self.assertEqual(slept, [3, 3])

    def test_a_network_blip_is_retried(self):
        code, _, _ = self._wait([URLError("reset"), (502, {"error": "gateway"}),
                                 (200, {"status": "ready", "code": "c", "state": "st"})])
        self.assertEqual(code, "c")

    def test_a_foreign_state_is_refused(self):
        with self.assertRaises(A.BearerTokenError) as ctx:
            self._wait([(200, {"status": "ready", "code": "c", "state": "evil"})])
        self.assertIn("state", str(ctx.exception))

    def test_a_declined_consent_stops_at_once(self):
        with self.assertRaises(A.BearerTokenError) as ctx:
            self._wait([(200, {"status": "denied", "error": "access_denied", "state": "st"})])
        self.assertIn("not approved", str(ctx.exception))

    def test_a_404_stops_and_says_what_to_do(self):
        with self.assertRaises(A.BearerTokenError) as ctx:
            self._wait([(404, {"detail": "No such hand-off"})])
        self.assertIn("letsfg auth", str(ctx.exception))

    def test_gives_up_at_the_deadline_with_the_finish_hint(self):
        with self.assertRaises(A.BearerTokenError) as ctx:
            self._wait([(200, {"status": "pending"})] * 50, timeout=10)
        self.assertIn("--finish", str(ctx.exception))


class ConnectAuthOverHandoffTest(unittest.TestCase):
    def _connect(self, handoff):
        registered, exchanged, opened = {}, {}, []

        class _NoListener:
            def __init__(self, state):
                raise AssertionError("the loopback must not be bound when the hand-off is used")

        def post_json(url, payload, timeout=30):
            registered.update(payload)
            return 201, {"client_id": "cid"}

        def post_form(url, fields, timeout=30):
            exchanged.update(fields)
            return 200, {"access_token": "at"}

        out = io.StringIO()
        with patch.object(A, "_discover", lambda: {
                 "authorization_endpoint": "https://letsfg.co/connect",
                 "token_endpoint": "https://letsfg.co/developers/api/oauth/token",
                 "registration_endpoint": "https://letsfg.co/developers/api/oauth/register"}), \
             patch.object(A, "_start_handoff", lambda: handoff), \
             patch.object(A, "_CallbackServer", _NoListener), \
             patch.object(A, "_post_json_abs", post_json), \
             patch.object(A, "_post_form", post_form), \
             patch.object(A, "_wait_for_handoff", lambda h, expected_state, **k: "hosted-code"), \
             patch.object(A, "save_token", lambda *a, **k: None), \
             patch.object(A.webbrowser, "open", lambda url: opened.append(url) or True), \
             redirect_stdout(out):
            token = A.connect_auth(open_browser=True)
        return token, registered, exchanged, opened

    def test_registers_and_redeems_with_the_hosted_redirect(self):
        token, registered, exchanged, opened = self._connect(A._Handoff(HANDLE, HOSTED, 3))
        self.assertEqual(token, "at")
        self.assertEqual(registered["redirect_uris"], [HOSTED])
        self.assertEqual(exchanged["redirect_uri"], HOSTED)
        self.assertEqual(exchanged["code"], "hosted-code")
        self.assertIn("redirect_uri=" + __import__("urllib.parse").parse.quote(HOSTED, safe=""), opened[0])

    def test_falls_back_to_the_loopback_without_a_hand_off(self):
        # The scope test (test_connect_auth_scope.py) drives the loopback path end to end; here, only
        # that a None hand-off reaches _CallbackServer at all.
        with self.assertRaises(AssertionError) as ctx:
            self._connect(None)
        self.assertIn("loopback must not be bound", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
