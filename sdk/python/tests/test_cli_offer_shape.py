"""
The CLI renders the offer shape /api/results actually returns, sends the body
keys /api/search actually reads, and says what /api/agent-book actually answered.

Driven live on 2026-09-11 (LetsFG/LetsFG#212 follow-up): every table cell but
the price was "-", `--direct` came back with every connection, and a
`missing_details` answer printed "Could not complete a confirmed booking ...
Booking link: (none)". The fixtures below are trimmed copies of real responses
from that run (search ws_0643b31599384f05, WAW-BCN round trip).
"""
import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
if str(SDK_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_PYTHON_ROOT))

from typer.testing import CliRunner

from letsfg import cli
from letsfg import local as L

# One real round-trip offer, as /api/results returns it: the outbound leg IS the
# offer, and the return leg is `inbound` with the same fields.
RT_OFFER = {
    "id": "wo_f041c49a12cc", "price": 91.14, "currency": "EUR", "source": "kayak_meta",
    "airline": "Wizz Air", "airline_code": "W6", "origin": "WAW", "destination": "BCN",
    "departure_time": "2026-10-20T18:00:00", "arrival_time": "2026-10-20T22:55:00",
    "duration_minutes": 295, "stops": 1, "flight_number": "W61433",
    "segments": [
        {"airline": "Wizz Air", "airline_code": "W6", "flight_number": "W61433", "origin": "WAW",
         "destination": "BGY", "departure_time": "2026-10-20T18:00:00", "arrival_time": "2026-10-20T20:05:00",
         "duration_minutes": 125, "cabin": "M"},
        {"airline": "Ryanair", "airline_code": "FR", "flight_number": "FR3319", "origin": "BGY",
         "destination": "BCN", "departure_time": "2026-10-20T21:15:00", "arrival_time": "2026-10-20T22:55:00",
         "duration_minutes": 100, "cabin": "M"},
    ],
    "inbound": {
        "origin": "BCN", "destination": "WAW", "departure_time": "2026-10-27T19:00:00",
        "arrival_time": "2026-10-27T22:10:00", "duration_minutes": 190, "stops": 0,
        "airline": "Wizz Air", "airline_code": "W6", "flight_number": "W61478",
        "segments": [{"airline": "Wizz Air", "airline_code": "W6", "flight_number": "W61478", "origin": "BCN",
                      "destination": "WAW", "departure_time": "2026-10-27T19:00:00",
                      "arrival_time": "2026-10-27T22:10:00", "duration_minutes": 190, "cabin": "M"}],
    },
}
# A one-way offer that lands after midnight.
OW_OFFER = {
    "id": "wo_ab3fbcde6d41", "price": 17.44, "currency": "EUR", "airline": "Ryanair", "airline_code": "FR",
    "origin": "LTN", "destination": "BCN", "departure_time": "2026-10-20T23:45:00",
    "arrival_time": "2026-10-21T02:55:00", "duration_minutes": 130, "stops": 0,
    "segments": [{"airline": "Ryanair", "airline_code": "FR", "origin": "LTN", "destination": "BCN",
                  "departure_time": "2026-10-20T23:45:00", "arrival_time": "2026-10-21T02:55:00",
                  "duration_minutes": 130}],
}

runner = CliRunner()


def _search_returning(offers):
    async def fake(*a, **k):
        return {"offers": list(offers), "total_results": len(offers), "search_id": "ws_test"}
    return fake


class RenderTest(unittest.TestCase):
    def _run(self, offers, *args):
        with patch.object(L, "search_local", _search_returning(offers)), \
             patch.object(cli, "HAS_RICH", False):
            r = runner.invoke(cli.app, ["search", "WAW", "BCN", "2026-10-20", *args])
        self.assertEqual(r.exit_code, 0, r.output)
        return r.output

    def test_round_trip_row_shows_airlines_route_times_and_return(self):
        out = self._run([RT_OFFER], "--return", "2026-10-27")
        self.assertIn("EUR 91.14", out)
        self.assertIn("W6-Wizz Air + FR-Ryanair", out, "both carriers of a two-segment leg")
        self.assertIn("WAW→BGY→BCN", out)
        self.assertIn("18:00→22:55", out)
        self.assertIn("ret: BCN→WAW", out)
        self.assertNotIn(" -  ", out.split("Offer IDs")[0] if "Offer IDs" in out else out)

    def test_leg_helpers_read_the_flat_shape(self):
        self.assertEqual(cli._leg_route(RT_OFFER), "WAW→BGY→BCN")
        self.assertEqual(cli._leg_duration(RT_OFFER), "4h 55m")
        self.assertEqual(cli._leg_stops(RT_OFFER), "1")
        self.assertEqual(cli._leg_stops(RT_OFFER["inbound"]), "0")
        self.assertEqual(cli._leg_airlines(RT_OFFER["inbound"]), "W6-Wizz Air")
        self.assertEqual(cli._format_leg_time(RT_OFFER, "dep"), "18:00")
        self.assertEqual(cli._format_leg_time(RT_OFFER["inbound"], "arr", include_day_offset=True), "22:10")

    def test_arrival_after_midnight_carries_a_day_offset(self):
        self.assertEqual(cli._format_leg_time(OW_OFFER, "arr", include_day_offset=True), "02:55+1")

    def test_duration_sort_uses_both_legs(self):
        self.assertEqual(cli._offer_duration_seconds(RT_OFFER), (295 + 190) * 60)
        self.assertEqual(cli._offer_duration_seconds(OW_OFFER), 130 * 60)

    def test_rich_table_renders_the_same_fields(self):
        if not cli.HAS_RICH:
            self.skipTest("rich not installed")
        with patch.object(L, "search_local", _search_returning([RT_OFFER])):
            # CliRunner's stdout is not a tty, like a pipe: the table must not fold to 80 columns.
            r = runner.invoke(cli.app, ["search", "WAW", "BCN", "2026-10-20", "--return", "2026-10-27"])
        self.assertEqual(r.exit_code, 0, r.output)
        for needle in ("Wizz Air", "WAW→BGY→BCN", "18:00", "22:55", "4h 55m", "BCN→WAW", "3h 10m"):
            self.assertIn(needle, r.output)


class SearchBodyTest(unittest.TestCase):
    def test_sends_the_keys_the_website_route_reads(self):
        import asyncio
        seen = {}

        class _Resp:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return json.dumps({"offers": [], "total_results": 0}).encode()

        def fake_urlopen(req, timeout=30):
            seen["body"] = json.loads(req.data.decode())
            return _Resp()

        with patch.object(L, "ensure_bearer_token", lambda: "t"), patch.object(L, "urlopen", fake_urlopen):
            asyncio.run(L.search_local("WAW", "BCN", "2026-10-20", return_date="2026-10-27",
                                       cabin_class="C", max_stopovers=0, sort="duration", limit=20))
        b = seen["body"]
        self.assertEqual(b["max_stops"], 0, "--direct must reach the server as max_stops")
        self.assertEqual(b["cabin"], "C")
        self.assertEqual(b["sort_by"], "duration")
        self.assertEqual(b["return_date"], "2026-10-27")
        for stale in ("max_stopovers", "cabin_class", "sort", "limit"):
            self.assertNotIn(stale, b, f"{stale} is not a key the route reads")


class BookOutputTest(unittest.TestCase):
    def _book(self, answer):
        async def fake(**k):
            return answer
        with patch.object(L, "book_offer", fake), patch.object(cli, "HAS_RICH", False), \
             patch.dict("os.environ", {"LETSFG_API_KEY": ""}), \
             patch("letsfg.client._saved_api_key", lambda: None):
            r = runner.invoke(cli.app, ["book", "wo_1", "--search-id", "ws_1", "--email", "t@example.com",
                                        "--passenger", '{"given_name":"T"}'])
        return r

    def test_missing_details_lists_the_fields(self):
        r = self._book({"error": "missing_details", "missing_fields": ["address_city", "phone_country"], "charged": 0})
        self.assertEqual(r.exit_code, 0, r.output)
        self.assertIn("address_city, phone_country", r.output)
        self.assertIn("Nothing was charged", r.output)
        self.assertNotIn("Booking link", r.output)

    def test_payment_method_required_shows_the_add_card_link(self):
        r = self._book({"error": "payment_method_required", "message": "No card.", "add_card_url": "https://letsfg.co/connect?card=abc"})
        self.assertEqual(r.exit_code, 0, r.output)
        self.assertIn("https://letsfg.co/connect?card=abc", r.output)
        self.assertIn("Nothing was charged", r.output)

    def test_a_started_booking_hands_over_the_ref_and_the_poll_command(self):
        r = self._book({"booking_ref": "bk_123"})
        self.assertEqual(r.exit_code, 0, r.output)
        self.assertIn("bk_123", r.output)
        self.assertIn("letsfg booking bk_123", r.output)


class BookingStatusTest(unittest.TestCase):
    def _status(self, answer, *args):
        async def fake(ref):
            return answer
        with patch.object(L, "booking_status", fake), patch.object(cli, "HAS_RICH", False):
            return runner.invoke(cli.app, ["booking", "bk_123", *args])

    def test_completed_shows_pnr_and_captured_amount(self):
        r = self._status({"state": "completed", "pnr": "ABC123", "charged_amount": 91.14, "currency": "EUR"})
        self.assertEqual(r.exit_code, 0, r.output)
        self.assertIn("ABC123", r.output)
        self.assertIn("91.14 EUR", r.output)

    def test_failed_says_the_hold_was_released(self):
        r = self._status({"state": "failed", "failure_reason": "seller checkout dead", "decline_reason": ""})
        self.assertIn("released", r.output)
        self.assertIn("seller checkout dead", r.output)

    def test_no_record_yet_is_not_an_error(self):
        r = self._status({"state": "", "message": "No booking record yet for this ref."})
        self.assertEqual(r.exit_code, 0, r.output)
        self.assertIn("No booking record yet", r.output)

    def test_status_posts_the_ref_with_the_bearer(self):
        import asyncio
        seen = {}

        class _Resp:
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return b'{"state":"booking_in_progress"}'

        def fake_urlopen(req, timeout=30):
            seen["url"] = req.full_url
            seen["body"] = json.loads(req.data.decode())
            seen["auth"] = req.get_header("Authorization")
            return _Resp()

        with patch.object(L, "ensure_bearer_token", lambda: "tok"), patch.object(L, "urlopen", fake_urlopen):
            out = asyncio.run(L.booking_status("bk_9"))
        self.assertEqual(out["state"], "booking_in_progress")
        self.assertTrue(seen["url"].endswith("/api/agent-book/status"))
        self.assertEqual(seen["body"], {"booking_ref": "bk_9"})
        self.assertEqual(seen["auth"], "Bearer tok")


class LocationsTest(unittest.TestCase):
    def test_without_a_developer_key_it_says_so_instead_of_no_locations(self):
        with patch.dict("os.environ", {"LETSFG_API_KEY": ""}), patch("letsfg.client._saved_api_key", lambda: None), \
             patch.object(cli, "HAS_RICH", False):
            r = runner.invoke(cli.app, ["locations", "London"])
        self.assertEqual(r.exit_code, 1)
        self.assertIn("API key", r.output)
        self.assertNotIn("No locations found", r.output)


class Utf8StreamsTest(unittest.TestCase):
    def test_redirected_streams_are_switched_to_utf8(self):
        class Pipe(io.TextIOWrapper):
            pass
        buf = io.BytesIO()
        pipe = Pipe(buf, encoding="cp1252")
        with patch.object(sys, "stdout", pipe), patch.object(sys, "stderr", pipe):
            cli._utf8_streams()
            print("WAW→BCN")
        self.assertEqual(pipe.encoding, "utf-8")
        pipe.flush()
        self.assertIn("WAW→BCN".encode("utf-8"), buf.getvalue())


if __name__ == "__main__":
    unittest.main()
