"""
LetsFG flight connectors — run server-side at letsfg.co.

Authenticate once via Twitter/X (free, 90-day token), then search instantly:
    letsfg auth
    letsfg search WAW BCN 2026-07-15
"""

from .auth import twitter_auth, get_bearer_token, save_token, BearerTokenError

__all__ = ["twitter_auth", "get_bearer_token", "save_token", "BearerTokenError"]
