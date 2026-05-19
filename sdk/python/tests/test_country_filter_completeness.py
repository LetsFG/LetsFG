import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SDK_PYTHON_ROOT = PROJECT_ROOT / "sdk" / "python"
if str(SDK_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_PYTHON_ROOT))

from letsfg.connectors.engine import _DIRECT_AIRLINE_connectorS
from letsfg.connectors.source_regions import (
    CONNECTOR_COUNTRIES,
    EXEMPT_SOURCES,
    GLOBAL_AGGREGATORS,
)


class CountryFilterCompletenessTest(unittest.TestCase):
    def test_all_registered_sources_are_classified_global_or_exempt(self):
        covered = set(CONNECTOR_COUNTRIES) | set(GLOBAL_AGGREGATORS) | set(EXEMPT_SOURCES)
        missing = sorted(source_id for source_id, _, _ in _DIRECT_AIRLINE_connectorS if source_id not in covered)
        self.assertEqual(missing, [])


if __name__ == "__main__":
    unittest.main()
