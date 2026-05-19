import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from typer.testing import CliRunner

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
if str(SDK_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_PYTHON_ROOT))

from letsfg.cli import app
from letsfg.connectors.source_regions import (
    REGIONS,
    connector_matches_market,
    normalize_country_codes,
    passes_country_filter,
    resolve_country_filter,
    route_touches_country,
)


class SourceCountryFilterHelpersTest(unittest.TestCase):
    def test_normalize_country_codes_accepts_repeated_and_comma_values(self):
        self.assertEqual(
            normalize_country_codes(["br, ar", "mx"]),
            frozenset({"BR", "AR", "MX"}),
        )

    def test_normalize_country_codes_rejects_non_iso_alpha2_values(self):
        with self.assertRaisesRegex(ValueError, "Invalid country code"):
            normalize_country_codes(["BRA"])

    def test_resolve_country_filter_combines_country_and_region(self):
        result = resolve_country_filter(["BR"], "north-america")
        self.assertIn("BR", result)
        self.assertIn("US", result)
        self.assertIn("CA", result)

    def test_resolve_country_filter_unknown_region_lists_valid_regions(self):
        with self.assertRaisesRegex(ValueError, "Valid regions"):
            resolve_country_filter(None, "antarctica")

    def test_route_touches_country_matches_origin_or_destination_only(self):
        countries = frozenset({"BR"})
        self.assertTrue(route_touches_country("BSB", "SDU", countries))
        self.assertFalse(route_touches_country("SCL", "PUQ", countries))

    def test_route_touches_country_fails_open_for_unknown_endpoint(self):
        self.assertTrue(route_touches_country("ZZZ", "PUQ", frozenset({"BR"})))

    def test_connector_market_matches_country_footprint(self):
        self.assertTrue(connector_matches_market("gol_direct", frozenset({"BR"}), False))
        self.assertFalse(connector_matches_market("gol_direct", frozenset({"GB"}), False))

    def test_global_aggregators_are_opt_in(self):
        countries = frozenset({"BR"})
        self.assertFalse(connector_matches_market("kiwi_connector", countries, False))
        self.assertTrue(connector_matches_market("kiwi_connector", countries, True))

    def test_passes_country_filter_requires_market_and_route(self):
        countries = frozenset({"BR"})
        self.assertTrue(passes_country_filter("latam_direct", "GRU", "LIM", countries, False))
        self.assertFalse(passes_country_filter("latam_direct", "SCL", "PUQ", countries, False))

    def test_regions_contract_contains_expected_predefined_region(self):
        self.assertIn("latin-america", REGIONS)
        self.assertIn("BR", REGIONS["latin-america"])


class SourceCountryFilterCliTest(unittest.TestCase):
    def test_cli_resolves_country_filter_before_search_local(self):
        runner = CliRunner()

        async def fake_search_local(**kwargs):
            self.assertEqual(kwargs["country_filter"], frozenset({"BR", "AR"}))
            self.assertTrue(kwargs["include_global"])
            return {"total_results": 0, "offers": []}

        with patch("letsfg.local.search_local", fake_search_local):
            result = runner.invoke(
                app,
                [
                    "search",
                    "BSB",
                    "SDU",
                    "2026-05-24",
                    "--country",
                    "br,ar",
                    "--include-global",
                    "--json",
                ],
            )

        self.assertEqual(result.exit_code, 0, result.output)


if __name__ == "__main__":
    unittest.main()
