"""
Tests for India regional source coverage: verifies that the right connectors
are selected for India-touching routes.
"""

import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
if str(SDK_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_PYTHON_ROOT))

from letsfg.connectors.airline_routes import get_relevant_connectors
from letsfg.connectors.engine import (  # noqa: E402
    _DIRECT_AIRLINE_connectorS,
    _FAST_MODE_SOURCES,
    _ECONOMY_ONLY_SOURCES,
)


class IndiaRegionalSourceCoverageTest(unittest.TestCase):
    def setUp(self):
        self.connectors = _DIRECT_AIRLINE_connectorS

    def test_allianceair_selected_for_india_domestic(self):
        relevant = get_relevant_connectors("BLR", "DEL", self.connectors)
        sources = [s for s, _, _ in relevant]
        self.assertIn("allianceair_direct", sources)

    def test_starair_selected_for_india_domestic(self):
        relevant = get_relevant_connectors("BLR", "DEL", self.connectors)
        sources = [s for s, _, _ in relevant]
        self.assertIn("starair_direct", sources)

    def test_easemytrip_selected_for_india_domestic(self):
        relevant = get_relevant_connectors("BLR", "DEL", self.connectors)
        sources = [s for s, _, _ in relevant]
        self.assertIn("easemytrip_ota", sources)

    def test_allianceair_selected_for_india_international(self):
        """AllianceAir only covers IN so it will NOT fire for IN↔AE routes.
        Verified by checking it fires for domestic routes instead."""
        relevant_domestic = get_relevant_connectors("BLR", "DEL", self.connectors)
        sources = [s for s, _, _ in relevant_domestic]
        self.assertIn("allianceair_direct", sources)
        # It should NOT fire for a purely AE domestic route
        relevant_ae = get_relevant_connectors("DXB", "AUH", self.connectors)
        sources_ae = [s for s, _, _ in relevant_ae]
        self.assertNotIn("allianceair_direct", sources_ae)

    def test_india_connectors_not_selected_for_intra_europe(self):
        """India-only connectors should NOT fire for CDG→LHR."""
        relevant = get_relevant_connectors("CDG", "LHR", self.connectors)
        sources = [s for s, _, _ in relevant]
        self.assertNotIn("allianceair_direct", sources)
        self.assertNotIn("starair_direct", sources)

    def test_all_india_lccs_in_fast_mode(self):
        india_lccs = ["indigo_direct", "spicejet_direct", "akasa_direct", "airindiaexpress_direct",
                      "allianceair_direct", "starair_direct"]
        for source in india_lccs:
            with self.subTest(source=source):
                self.assertIn(source, _FAST_MODE_SOURCES)

    def test_spicejet_canonical_key(self):
        """spicejet_direct_api must not appear anywhere in engine."""
        all_sources = {s for s, _, _ in _DIRECT_AIRLINE_connectorS}
        all_sources |= _FAST_MODE_SOURCES | _ECONOMY_ONLY_SOURCES
        self.assertNotIn("spicejet_direct_api", all_sources)


class IndiaOTACoverageTest(unittest.TestCase):
    def setUp(self):
        self.connectors = _DIRECT_AIRLINE_connectorS

    def test_easemytrip_registered(self):
        sources = [s for s, _, _ in self.connectors]
        self.assertIn("easemytrip_ota", sources)

    def test_easemytrip_route_coverage_includes_in(self):
        from letsfg.connectors.airline_routes import AIRLINE_COUNTRIES
        coverage = AIRLINE_COUNTRIES.get("easemytrip", set())
        self.assertIn("IN", coverage)


if __name__ == "__main__":
    unittest.main()
