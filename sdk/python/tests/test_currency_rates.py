import sys
import unittest
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
if str(SDK_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_PYTHON_ROOT))

from letsfg.connectors import currency as currency_module


class _DummyResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _DummyAsyncClient:
    def __init__(self, response):
        self.response = response
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, url):
        self.calls.append(url)
        return self.response


class CurrencyRatesTest(unittest.IsolatedAsyncioTestCase):
    async def test_fetch_rates_parses_frankfurter_v2_rows(self) -> None:
        client = _DummyAsyncClient(
            _DummyResponse(
                [
                    {"base": "USD", "quote": "INR", "rate": 83.5},
                    {"base": "USD", "quote": "EUR", "rate": 0.92},
                    {"base": "EUR", "quote": "GBP", "rate": 0.87},
                ]
            )
        )

        currency_module._cache = {}
        currency_module._cache_ts = 0.0

        with patch("letsfg.connectors.currency.httpx.AsyncClient", return_value=client):
            rates = await currency_module.fetch_rates("usd")

        self.assertEqual(rates, {"INR": 83.5, "EUR": 0.92})
        self.assertEqual(len(client.calls), 1)
        self.assertIn("/rates?base=USD&quotes=", client.calls[0])


if __name__ == "__main__":
    unittest.main()