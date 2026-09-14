"""
The hotel methods send what POST /hotels/book reads, and stop polling at every final status.

Since 2026-09-11 a hotel booking holds the full price on the connected Revolut method and captures
it once the supplier confirms. The SDK still sent the retired deposit contract (`expected_balance`,
no `expected_cost`), so every book_hotel() call was refused with a 422 - and book_hotel_and_wait()
polled an `attention` job, which is final, until it timed out.
"""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
if str(SDK_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_PYTHON_ROOT))

from letsfg.client import LetsFG

OFFER = {"session_id": "sess_offer", "combination_id_v2": "c2hash", "price": 183.4, "currency": "USD",
         "fx_rate": 0.2741, "expected_cost": 627.03}


def _book_kwargs(**over):
    kw = dict(expected_price=OFFER["price"], expected_cost=OFFER["expected_cost"],
              currency=OFFER["currency"], fx_rate=OFFER["fx_rate"],
              city_id=141297, city_name="Warsaw, Poland", check_in="2026-11-10", check_out="2026-11-12",
              guests=[{"title": "Mr", "first_name": "Jan", "last_name": "Kowalski"}],
              email="jan@letsfg.test", phone="512345678")
    kw.update(over)
    return kw


class BookHotelPayloadTest(unittest.TestCase):
    def setUp(self):
        self.client = LetsFG(api_key="letsfg_test_key")
        self.sent = []
        self.client._post = lambda path, body, timeout=None: self.sent.append((path, body)) or {
            "booking_job_id": "hb_1", "status": "in_progress"}

    def test_it_sends_the_offer_contract_the_api_reads(self):
        self.client.book_hotel(OFFER["session_id"], 1234, OFFER["combination_id_v2"],
                               idempotency_key="k1", **_book_kwargs())
        path, body = self.sent[0]
        self.assertEqual(path, "/api/v1/hotels/book")
        self.assertEqual(body["expected_price"], 183.4)
        self.assertEqual(body["expected_cost"], 627.03)
        self.assertEqual(body["currency"], "USD")
        self.assertEqual(body["fx_rate"], 0.2741)
        self.assertEqual(body["idempotency_key"], "k1")
        self.assertNotIn("expected_balance", body)

    def test_a_pln_offer_sends_no_fx_rate(self):
        self.client.book_hotel("s", 1, "c", **_book_kwargs(currency="PLN", fx_rate=None))
        body = self.sent[0][1]
        self.assertEqual(body["currency"], "PLN")
        self.assertNotIn("fx_rate", body)
        self.assertNotIn("idempotency_key", body)

    def test_the_retired_expected_balance_is_refused_at_the_call(self):
        with self.assertRaises(TypeError):
            self.client.book_hotel("s", 1, "c", expected_balance=600.0,
                                   **{k: v for k, v in _book_kwargs().items() if k != "expected_cost"})
        self.assertEqual(self.sent, [], "nothing may reach the API")

    def test_the_offer_numbers_cannot_be_passed_by_position(self):
        with self.assertRaises(TypeError):
            self.client.book_hotel("s", 1, "c", 183.4, 627.03)  # noqa - the point is that it fails

    def test_search_asks_for_the_currency_it_documents(self):
        self.client.search_hotels(141297, "Warsaw, Poland", "2026-11-10", "2026-11-12")
        self.assertEqual(self.sent[0][1]["currency"], "USD")
        self.client.search_hotels(141297, "Warsaw, Poland", "2026-11-10", "2026-11-12", currency="EUR")
        self.assertEqual(self.sent[1][1]["currency"], "EUR")


class BookHotelAndWaitTest(unittest.TestCase):
    def _run(self, statuses):
        client = LetsFG(api_key="letsfg_test_key")
        client._post = lambda path, body, timeout=None: {"booking_job_id": "hb_1", "status": "in_progress"}
        polls = []

        def _get(path, timeout=None):
            polls.append(path)
            return dict(statuses[len(polls) - 1])
        client._get = _get
        with patch("letsfg.client.time.sleep", lambda s: None):
            result = client.book_hotel_and_wait(poll_interval=1, max_wait=100, session_id="s", hotel_code=1,
                                                combination_id_v2="c", **_book_kwargs())
        return result, polls

    def test_attention_is_final_and_never_polled_again(self):
        result, polls = self._run([{"status": "in_progress"},
                                   {"status": "attention", "error": "We are confirming", "confirmation": "ABC123"},
                                   {"status": "succeeded"}])
        self.assertEqual(result["status"], "attention")
        self.assertEqual(result["confirmation"], "ABC123")
        self.assertEqual(len(polls), 2)

    def test_failed_and_succeeded_are_final(self):
        for final in ("failed", "succeeded"):
            result, polls = self._run([{"status": final}, {"status": "in_progress"}])
            self.assertEqual((result["status"], len(polls)), (final, 1))

    def test_every_final_status_is_named_once(self):
        self.assertEqual(LetsFG.HOTEL_BOOKING_FINAL_STATUSES, ("succeeded", "failed", "attention"))

    def test_giving_up_keeps_the_job_id(self):
        result, polls = self._run([{"status": "in_progress"}] * 200)
        self.assertEqual(result["status"], "in_progress")
        self.assertEqual(result["booking_job_id"], "hb_1")
        self.assertEqual(len(polls), 100)


if __name__ == "__main__":
    unittest.main()
