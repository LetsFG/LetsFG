"""
LetsFG — Agent-native flight search & booking SDK.

Search 400+ airlines via the LetsFG cloud API. Authenticate once with Twitter/X
for a free 90-day Bearer token, then search instantly.

Quick start (CLI):
    letsfg auth               # one-time Twitter/X auth
    letsfg search WAW BCN 2026-07-15

Programmatic search (free, requires Bearer token):
    from letsfg.local import search_local
    import asyncio
    result = asyncio.run(search_local("SHA", "CTU", "2026-03-20"))

Full API (search + unlock + book, requires API key):
    from letsfg import LetsFG
    bt = LetsFG(api_key="trav_...")
    flights = bt.search("GDN", "BER", "2026-03-03")
    bt.unlock(flights.offers[0].id)
    bt.book(flights.offers[0].id, passenger={...})
"""

from letsfg.client import (
    LetsFG,
    LetsFGError,
    BoostedTravel,
    BoostedTravelError,
    AuthenticationError,
    PaymentRequiredError,
    OfferExpiredError,
    ValidationError,
    ErrorCode,
    ErrorCategory,
)
from letsfg.config import StarRequiredError
from letsfg.models import (
    FlightOffer,
    FlightSearchResult,
    FlightSegment,
    FlightRoute,
    UnlockResult,
    BookingResult,
    Passenger,
    AgentProfile,
)
from letsfg.models.flights import PublicFlightOffer, to_public_offer

__version__ = "2026.5.78"
__all__ = [
    "LetsFG",
    "LetsFGError",
    "BoostedTravel",      # deprecated alias
    "BoostedTravelError", # deprecated alias,
    "AuthenticationError",
    "PaymentRequiredError",
    "OfferExpiredError",
    "ValidationError",
    "StarRequiredError",
    "ErrorCode",
    "ErrorCategory",
    "FlightOffer",
    "FlightSearchResult",
    "FlightSegment",
    "FlightRoute",
    "UnlockResult",
    "BookingResult",
    "Passenger",
    "AgentProfile",
    "get_system_profile",
    "PublicFlightOffer",
    "to_public_offer",
]

def get_system_profile():
    """Detect system resources (RAM, CPU) and return optimal concurrency settings."""
    from letsfg.system_info import get_system_profile as _get
    return _get()
