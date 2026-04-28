import sys
import unittest
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
if str(SDK_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_PYTHON_ROOT))

from letsfg.connectors.wizzair import _search_timetable_sync


class _DummyResponse:
    status_code = 200
    text = "ok"

    def json(self):
        return {"outboundFlights": [], "returnFlights": []}


class _DummySession:
    def __init__(self):
        self.calls = []

    def post(self, url, json, headers, timeout):
        self.calls.append(
            {
                "url": url,
                "json": json,
                "headers": headers,
                "timeout": timeout,
            }
        )
        return _DummyResponse()


class WizzairConnectorTest(unittest.TestCase):
    def test_timetable_uses_public_pricing(self) -> None:
        session = _DummySession()

        with patch("curl_cffi.requests.Session", return_value=session):
            _search_timetable_sync(
                version="28.8.0",
                origin="LTN",
                destination="BCN",
                date_from="2026-05-03",
                date_to="2026-05-08",
                adults=1,
                children=0,
                infants=0,
            )

        self.assertEqual(len(session.calls), 1)
        self.assertIs(session.calls[0]["json"]["wdc"], False)
        self.assertEqual(session.calls[0]["json"]["priceType"], "regular")


if __name__ == "__main__":
    unittest.main()