"""
LetsFG flight connectors — run server-side at letsfg.co.

Authenticate once via Twitter/X to get a free 90-day Bearer token,
then run unlimited searches via the cloud API.

Quick start:
    letsfg auth        # one-time Twitter/X auth (~30 seconds)
    letsfg search WAW BCN 2026-07-15

Or programmatically:
    from letsfg.connectors.auth import twitter_auth, get_bearer_token
    twitter_auth()     # interactive: prints a tweet to post, waits for confirmation
"""

from .auth import twitter_auth, get_bearer_token, BearerTokenError

__all__ = ["twitter_auth", "get_bearer_token", "BearerTokenError"]
