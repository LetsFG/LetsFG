"""
LetsFG — Agent-native flight search & booking SDK.

Search hundreds of airlines via the LetsFG cloud engine. Connect a card once at
letsfg.co/connect -- nothing is charged -- then search instantly.

Quick start (CLI):
    letsfg auth               # one-time card connect, opens a browser
    letsfg search WAW BCN 2026-07-15

Programmatic search (free, requires Bearer token):
    from letsfg.local import search_local
    import asyncio
    result = asyncio.run(search_local("SHA", "CTU", "2026-03-20"))

Full API (search + unlock + book, requires API key):
    from letsfg import LetsFG
    bt = LetsFG(api_key="letsfg_...")
    flights = bt.search("GDN", "BER", "2026-03-03")
    bt.unlock(flights.offers[0].id)
    bt.book(flights.offers[0].id, passenger={...})
"""

from letsfg.client import (
    LetsFG,
    LetsFGError,
    AuthenticationError,
    PaymentRequiredError,
    OfferExpiredError,
    ValidationError,
    ErrorCode,
    ErrorCategory,
)
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

__version__ = "2026.5.95"
__all__ = [
    "LetsFG",
    "LetsFGError",
    "AuthenticationError",
    "PaymentRequiredError",
    "OfferExpiredError",
    "ValidationError",
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
    "PublicFlightOffer",
    "to_public_offer",
]
