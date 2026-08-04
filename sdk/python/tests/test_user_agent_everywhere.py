"""
Regression test for GitHub issue #163 — the second time.

#177/#178 fixed the missing User-Agent in `connectors/auth.py::_post_json()`,
so `letsfg auth` stopped returning 403. But the fix patched one call site, and
`local.py` — the PFS *search* and *book* path — still built its requests by
hand with only Content-Type and Authorization. So auth succeeded, a token was
issued, and then the very first search 403'd with Cloudflare error 1010.

That is exactly what s-stefanov reported on 2026-08-04: "keep getting 403 when
searching for a flights".

Verified against production while writing this:

    no User-Agent   -> HTTP 403  error code: 1010
    explicit UA     -> HTTP 401  {"error": "Unauthorized"}   (reaches the app)

This test does NOT test one function. It walks every urllib Request built
anywhere in the package and asserts each one carries a non-default User-Agent,
so the next endpoint added to any module cannot reintroduce this a third time.
"""
import ast
import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
PACKAGE_ROOT = SDK_PYTHON_ROOT / "letsfg"
if str(SDK_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_PYTHON_ROOT))


def _iter_request_calls():
    """Every `Request(...)` construction in the package, with its source file."""
    for path in sorted(PACKAGE_ROOT.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = (
                func.id if isinstance(func, ast.Name)
                else func.attr if isinstance(func, ast.Attribute)
                else None
            )
            if name == "Request":
                yield path, node


def _headers_arg(call: ast.Call):
    for kw in call.keywords:
        if kw.arg == "headers":
            return kw.value
    return None


class TestEveryRequestSendsAUserAgent(unittest.TestCase):
    def test_package_builds_at_least_one_request(self):
        """Guard the guard: if the walk finds nothing, the test is vacuous."""
        self.assertTrue(list(_iter_request_calls()), "no Request() calls found — walker is broken")

    def test_every_request_carries_an_explicit_user_agent(self):
        offenders = []
        for path, call in _iter_request_calls():
            headers = _headers_arg(call)
            rel = path.relative_to(PROJECT_ROOT)
            line = call.lineno

            if headers is None:
                offenders.append(f"{rel}:{line} — no headers= at all")
                continue

            # Built inline: the literal must contain a User-Agent key.
            if isinstance(headers, ast.Dict):
                keys = {
                    k.value.lower()
                    for k in headers.keys
                    if isinstance(k, ast.Constant) and isinstance(k.value, str)
                }
                if "user-agent" not in keys:
                    offenders.append(f"{rel}:{line} — inline headers without User-Agent")
                continue

            # Built by a helper (e.g. _headers()/self._headers()). Those are the
            # shape we WANT; the helpers are asserted separately below.
            if isinstance(headers, ast.Call):
                continue

            offenders.append(f"{rel}:{line} — headers= is neither a literal nor a helper call")

        self.assertEqual(
            offenders, [],
            "Requests without an explicit User-Agent will be 403'd by Cloudflare "
            "(error 1010) before reaching the app:\n  " + "\n  ".join(offenders),
        )

    def test_local_search_helper_sets_the_shared_user_agent(self):
        """local.py is the PFS search/book path — the one that regressed."""
        from letsfg import local

        for json_body in (True, False):
            headers = {k.lower(): v for k, v in local._headers("tok", json_body=json_body).items()}
            self.assertIn("user-agent", headers)
            self.assertNotIn("python-urllib", headers["user-agent"].lower())
            self.assertEqual(headers["user-agent"], local._USER_AGENT)
            self.assertEqual(headers["authorization"], "Bearer tok")

    def test_client_helper_sets_the_shared_user_agent(self):
        from letsfg.client import LetsFG

        headers = {k.lower(): v for k, v in LetsFG(api_key="x")._headers().items()}
        self.assertIn("user-agent", headers)
        self.assertNotIn("python-urllib", headers["user-agent"].lower())


if __name__ == "__main__":
    unittest.main()
