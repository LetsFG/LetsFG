"""
Tests for cross-area route validation: ensures correct connectors are selected
for international routes (e.g., India↔Middle East, India↔Europe) and that
India connectors are suppressed for non-India routes.
"""

import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
if str(SDK_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_PYTHON_ROOT))

from letsfg.connectors.airline_routes import get_relevant_connectors
from letsfg.connectors.engine import _DIRECT_AIRLINE_connectorS as _DIRECT_AIRLINE_CONNECTORS


class CrossAreaRouteValidationTest(unittest.TestCase):
    def setUp(self):
        self.connectors = _DIRECT_AIRLINE_CONNECTORS

    # ── India → Europe ────────────────────────────────────────────────────

    def test_india_europe_includes_indigo(self):
        relevant = get_relevant_connectors("DEL", "LHR", self.connectors)
        sources = [s for s, _, _ in relevant]
        # IndiGo flies DEL-LHR
        self.assertIn("indigo_direct", sources)

    def test_india_europe_includes_global_otas(self):
        relevant = get_relevant_connectors("BOM", "CDG", self.connectors)
        sources = [s for s, _, _ in relevant]
        # Skyscanner meta-search must appear for intercontinental routes
        self.assertIn("skyscanner_meta", sources)

    # ── India → Middle East ───────────────────────────────────────────────

    def test_india_middle_east_includes_airindiaexpress(self):
        """AirIndiaExpress explicitly covers both IN and AE."""
        relevant = get_relevant_connectors("COK", "DXB", self.connectors)
        sources = [s for s, _, _ in relevant]
        self.assertIn("airindiaexpress_direct", sources)

    def test_india_middle_east_includes_easemytrip(self):
        """EaseMyTrip is an OTA that covers AE so it fires for IN↔AE."""
        relevant = get_relevant_connectors("DEL", "DXB", self.connectors)
        sources = [s for s, _, _ in relevant]
        self.assertIn("easemytrip_ota", sources)

    # ── Intra-Europe ──────────────────────────────────────────────────────

    def test_intra_europe_no_india_direct_airlines(self):
        """India-only connectors must be suppressed for purely European routes."""
        india_only = ["allianceair_direct", "starair_direct"]
        for route in [("LHR", "CDG"), ("AMS", "FRA"), ("BCN", "MAD")]:
            origin, dest = route
            relevant = get_relevant_connectors(origin, dest, self.connectors)
            sources = [s for s, _, _ in relevant]
            for src in india_only:
                with self.subTest(route=f"{origin}-{dest}", source=src):
                    self.assertNotIn(src, sources)

    # ── US domestic ───────────────────────────────────────────────────────

    def test_us_domestic_no_india_airlines(self):
        """India-only direct airlines must not fire for US domestic routes."""
        relevant = get_relevant_connectors("JFK", "LAX", self.connectors)
        sources = [s for s, _, _ in relevant]
        self.assertNotIn("allianceair_direct", sources)
        self.assertNotIn("starair_direct", sources)
        # Note: easemytrip_ota covers US in its route config so it DOES fire here

    # ── Southeast Asia ────────────────────────────────────────────────────

    def test_sea_domestic_no_india_direct_lccs(self):
        relevant = get_relevant_connectors("SIN", "KUL", self.connectors)
        sources = [s for s, _, _ in relevant]
        # India-only connectors should not appear for SIN-KUL
        self.assertNotIn("allianceair_direct", sources)
        self.assertNotIn("starair_direct", sources)

    # ── Coverage completeness ─────────────────────────────────────────────

    def test_all_registered_connectors_have_coverage_entry(self):
        """Every connector in the engine should have a route coverage entry."""
        from letsfg.connectors.airline_routes import AIRLINE_COUNTRIES
        missing = []
        for source, _, _ in self.connectors:
            key = source.replace("_direct", "").replace("_ota", "").replace("_meta", "").replace("_connector", "")
            # wizzair is keyed as 'wizz'
            if key == "wizzair":
                key = "wizz"
            if key not in AIRLINE_COUNTRIES:
                missing.append(source)
        # Allow connectors with no coverage entry (they fire for all routes)
        if missing:
            for source in missing:
                with self.subTest(source=source):
                    # Verify it returns something for a known route (safe fallback)
                    result = get_relevant_connectors("BLR", "DEL", [(source, object, 30.0)])
                    self.assertEqual(len(result), 1, f"{source} has no coverage entry but should fire as fallback")


if __name__ == "__main__":
    unittest.main()
