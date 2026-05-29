"""
Tests for enriched SDK telemetry payload in letsfg/local.py.

Covers:
- _build_telemetry_payload returns all required fields
- Payload includes source, search_count, result_count, duration_ms, sdk_version
- LETSFG_NO_TELEMETRY env var short-circuits _fire_telemetry
- _fire_telemetry passes enriched payload (mock HTTP check)
"""
import json
import os
import sys
import unittest
from unittest.mock import MagicMock, patch


class TestTelemetryPayload(unittest.TestCase):

    def test_build_telemetry_payload_returns_required_fields(self):
        from letsfg.local import _build_telemetry_payload
        payload = _build_telemetry_payload(
            source="python-sdk",
            search_count=1,
            result_count=42,
            duration_ms=18_400,
        )
        self.assertEqual(payload["source"], "python-sdk")
        self.assertEqual(payload["search_count"], 1)
        self.assertEqual(payload["result_count"], 42)
        self.assertEqual(payload["duration_ms"], 18_400)
        self.assertIn("sdk_version", payload)
        self.assertIsInstance(payload["sdk_version"], str)

    def test_build_telemetry_payload_source_defaults_stripped(self):
        from letsfg.local import _build_telemetry_payload
        payload = _build_telemetry_payload(
            source="  ",
            search_count=1,
            result_count=0,
            duration_ms=0,
        )
        self.assertEqual(payload["source"], "python-sdk")

    def test_fire_telemetry_skipped_when_no_telemetry_set(self):
        with patch.dict(os.environ, {"LETSFG_NO_TELEMETRY": "1"}):
            with patch("letsfg.local.urlopen") as mock_urlopen:
                from letsfg.local import _fire_telemetry
                _fire_telemetry(source="python-sdk", search_count=1, result_count=5, duration_ms=1000)
                mock_urlopen.assert_not_called()

    def test_fire_telemetry_sends_enriched_payload_when_enabled(self):
        with patch.dict(os.environ, {}, clear=False):
            # Ensure NO_TELEMETRY is not set
            os.environ.pop("LETSFG_NO_TELEMETRY", None)
            with patch("letsfg.local.urlopen") as mock_urlopen:
                mock_urlopen.return_value.__enter__ = lambda s: s
                mock_urlopen.return_value.__exit__ = MagicMock(return_value=False)

                from letsfg.local import _fire_telemetry
                _fire_telemetry(source="python-sdk", search_count=1, result_count=10, duration_ms=5_000)

                mock_urlopen.assert_called_once()
                call_args = mock_urlopen.call_args[0][0]  # first positional arg = Request object
                body = json.loads(call_args.data.decode())

                self.assertEqual(body["source"], "python-sdk")
                self.assertIn("search_count", body)
                self.assertIn("result_count", body)
                self.assertIn("duration_ms", body)
                self.assertIn("sdk_version", body)
                self.assertEqual(body["search_count"], 1)
                self.assertEqual(body["result_count"], 10)
                self.assertEqual(body["duration_ms"], 5_000)

    def test_fire_telemetry_never_raises(self):
        """Even with a broken urlopen, _fire_telemetry must not raise."""
        os.environ.pop("LETSFG_NO_TELEMETRY", None)
        with patch("letsfg.local.urlopen", side_effect=Exception("network error")):
            from letsfg.local import _fire_telemetry
            # Must not raise
            _fire_telemetry(source="python-sdk", search_count=0, result_count=0, duration_ms=0)


if __name__ == "__main__":
    unittest.main()
