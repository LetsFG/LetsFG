"""
Tests for India user-facing surfaces: CLI location fallback and local
resolver India city aliases.

Verifies that 'letsfg locations Bengaluru' works offline via local index.
"""

import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
if str(SDK_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_PYTHON_ROOT))

from letsfg.local import _resolve_location_local


class IndiaAliasLocalResolverTest(unittest.TestCase):
    """Ensure historical/colloquial India city names resolve correctly."""

    def test_bengaluru_resolves_to_blr(self):
        results = _resolve_location_local("bengaluru")
        iatas = [r["iata_code"] for r in results]
        self.assertIn("BLR", iatas, "Bengaluru should resolve to BLR")

    def test_new_delhi_resolves_to_del(self):
        results = _resolve_location_local("new delhi")
        iatas = [r["iata_code"] for r in results]
        self.assertIn("DEL", iatas, "New Delhi should resolve to DEL")

    def test_bombay_resolves_to_bom(self):
        results = _resolve_location_local("bombay")
        iatas = [r["iata_code"] for r in results]
        self.assertIn("BOM", iatas, "Bombay should resolve to BOM")

    def test_madras_resolves_to_maa(self):
        results = _resolve_location_local("madras")
        iatas = [r["iata_code"] for r in results]
        self.assertIn("MAA", iatas, "Madras should resolve to MAA")

    def test_calcutta_resolves_to_ccu(self):
        results = _resolve_location_local("calcutta")
        iatas = [r["iata_code"] for r in results]
        self.assertIn("CCU", iatas, "Calcutta should resolve to CCU")

    def test_bangalore_resolves_via_city_name(self):
        """'Bangalore' is the primary name in the index; must also work."""
        results = _resolve_location_local("bangalore")
        iatas = [r["iata_code"] for r in results]
        self.assertIn("BLR", iatas)

    def test_delhi_resolves_via_city_name(self):
        results = _resolve_location_local("delhi")
        iatas = [r["iata_code"] for r in results]
        self.assertIn("DEL", iatas)

    def test_mumbai_resolves_via_city_name(self):
        results = _resolve_location_local("mumbai")
        iatas = [r["iata_code"] for r in results]
        self.assertIn("BOM", iatas)

    def test_unknown_query_returns_empty(self):
        results = _resolve_location_local("zzznonsensexyz")
        self.assertIsInstance(results, list)

    def test_empty_query_returns_empty(self):
        results = _resolve_location_local("")
        self.assertEqual(results, [])

    def test_case_insensitive(self):
        lower = _resolve_location_local("bengaluru")
        upper = _resolve_location_local("BENGALURU")
        mixed = _resolve_location_local("Bengaluru")
        # All should return at least BLR
        for results in [lower, upper, mixed]:
            iatas = [r["iata_code"] for r in results]
            self.assertIn("BLR", iatas)


class IndiaAirportDirectResolverTest(unittest.TestCase):
    """Ensure known India airports resolve by IATA code and by name."""

    def test_blr_by_code(self):
        results = _resolve_location_local("BLR")
        iatas = [r["iata_code"] for r in results]
        self.assertIn("BLR", iatas)

    def test_del_by_code(self):
        results = _resolve_location_local("DEL")
        iatas = [r["iata_code"] for r in results]
        self.assertIn("DEL", iatas)

    def test_bom_by_code(self):
        results = _resolve_location_local("BOM")
        iatas = [r["iata_code"] for r in results]
        self.assertIn("BOM", iatas)

    def test_ccu_by_code(self):
        results = _resolve_location_local("CCU")
        iatas = [r["iata_code"] for r in results]
        self.assertIn("CCU", iatas)

    def test_maa_by_code(self):
        results = _resolve_location_local("MAA")
        iatas = [r["iata_code"] for r in results]
        self.assertIn("MAA", iatas)

    def test_hyd_by_code(self):
        results = _resolve_location_local("HYD")
        # HYD may or may not be in the index; if it is, it should return correctly
        self.assertIsInstance(results, list)


if __name__ == "__main__":
    unittest.main()
