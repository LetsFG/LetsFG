"""
LetsFG flight connectors — run server-side at letsfg.co.

Get a free 90-day Bearer token at https://letsfg.co/for-agents, then:
    letsfg auth --token <token>
    letsfg search WAW BCN 2026-07-15
"""

from .auth import get_bearer_token, save_token, BearerTokenError

__all__ = ["get_bearer_token", "save_token", "BearerTokenError"]
