"""
The API-key lane sends the return date as `return_from` (LetsFG/LetsFG#220, #221).

The Developer API's search reads `return_from`; `return_date` is the website
route's name and the API drops it without a word, so a round trip asked for
through an API key ran as a one-way. The Bearer lane (letsfg/local.py) keeps
`return_date`, which is what /api/search reads.
"""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
if str(SDK_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_PYTHON_ROOT))

from letsfg import client as C
from letsfg.connectors import auth as A


class ApiKeyLaneFieldNamesTest(unittest.TestCase):
    def test_round_trip_sends_return_from(self):
        posted = {}

        def fake_post(self, path, body, timeout=None):
            posted["path"], posted["body"] = path, body
            return {"offers": []}

        def no_token():
            raise A.BearerTokenError("no token")

        with patch.object(A, "get_bearer_token", no_token), patch.object(C.LetsFG, "_post", fake_post):
            C.LetsFG(api_key="letsfg_test").search(
                "BUD", "LIS", "2027-02-17", return_date="2027-02-24", cabin_class="C")

        self.assertEqual(posted["path"], "/api/v1/flights/search")
        self.assertEqual(posted["body"].get("return_from"), "2027-02-24")
        self.assertNotIn("return_date", posted["body"], "the Developer API drops return_date")
        self.assertEqual(posted["body"].get("cabin_class"), "C")


if __name__ == "__main__":
    unittest.main()
