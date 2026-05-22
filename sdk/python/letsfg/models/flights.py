"""Flight search request/response models — multi-provider."""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


def _raw_duration_seconds(departure: datetime, arrival: datetime) -> int:
    try:
        return max(int((arrival - departure).total_seconds()), 0)
    except Exception:
        return 0


def _airport_duration_seconds(
    departure: datetime,
    arrival: datetime,
    origin: str,
    destination: str,
) -> int:
    if departure.year <= 2000 or arrival.year <= 2000 or not origin or not destination:
        return 0

    try:
        from letsfg.connectors.airport_tz import duration_seconds_from_local_times

        return duration_seconds_from_local_times(departure, arrival, origin, destination)
    except Exception:
        return 0


def _airport_local_naive(value: datetime, airport: str) -> datetime:
    if value.tzinfo is None or not airport:
        return value

    try:
        from letsfg.connectors.airport_tz import get_airport_tz

        airport_tz = get_airport_tz(airport)
    except Exception:
        airport_tz = None

    try:
        if airport_tz is not None:
            return value.astimezone(airport_tz).replace(tzinfo=None)
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    except Exception:
        return value.replace(tzinfo=None)


# ── Request ──────────────────────────────────────────────────────────────────

class FlightSearchRequest(BaseModel):
    """Parameters for a flight search — FREE for agents."""

    origin: str = Field(
        ...,
        description="IATA code of departure airport/city (e.g. 'PRG', 'LON')",
        min_length=2,
        max_length=4,
    )
    destination: str = Field(
        ...,
        description="IATA code of arrival airport/city (e.g. 'BCN', 'NYC')",
        min_length=2,
        max_length=4,
    )
    date_from: date = Field(..., description="Departure date")
    date_to: Optional[date] = Field(None, description="Latest departure date")
    return_from: Optional[date] = Field(None, description="Return date (omit for one-way)")
    return_to: Optional[date] = Field(None, description="Latest return date")
    adults: int = Field(1, ge=1, le=9)
    children: int = Field(0, ge=0, le=9)
    infants: int = Field(0, ge=0, le=9)
    cabin_class: Optional[str] = Field(
        None,
        description="M (economy), W (premium economy), C (business), F (first)",
        pattern=r"^[MWCF]$",
    )
    max_stopovers: int = Field(2, ge=0, le=4, description="Max connections per direction")
    currency: str = Field("EUR", min_length=3, max_length=3)
    locale: str = Field("en", description="Language for city/airport names")
    limit: int = Field(50, ge=1, le=200, description="Max results to return")
    sort: str = Field("price", description="Sort by: price, duration, departure_time")
    departure_time_from: Optional[str] = Field(
        None,
        description="Earliest departure time HH:MM (e.g. '06:00' for morning flights)",
        pattern=r"^([01]?[0-9]|2[0-3]):[0-5][0-9]$",
    )
    departure_time_to: Optional[str] = Field(
        None,
        description="Latest departure time HH:MM (e.g. '14:00' for flights before 2pm)",
        pattern=r"^([01]?[0-9]|2[0-3]):[0-5][0-9]$",
    )
    provider_filters: dict[str, Any] = Field(
        default_factory=dict,
        description="Provider-specific filter payloads keyed by provider name, e.g. {'google_flights': {...}}",
    )
    country_filter: Optional[frozenset[str]] = Field(
        default=None,
        description="ISO alpha-2 countries used to filter source markets and route endpoints",
    )
    include_global: bool = Field(
        False,
        description="Include global aggregators when country_filter is active",
    )

    @field_validator("country_filter", mode="before")
    @classmethod
    def validate_country_filter(cls, v: Any) -> Optional[frozenset[str]]:
        if v is None:
            return None
        return frozenset(str(code).strip().upper() for code in v if str(code).strip())

    @field_validator("origin", "destination")
    @classmethod
    def validate_iata_code(cls, v: str) -> str:
        v = v.strip().upper()
        if not re.fullmatch(r"[A-Z]{2,4}", v):
            raise ValueError(f"Invalid IATA code '{v}': must be 2-4 letters (e.g. 'LON', 'PRG')")
        return v

    @field_validator("date_from")
    @classmethod
    def validate_date_not_past(cls, v: date) -> date:
        if v < date.today():
            raise ValueError(f"date_from ({v}) cannot be in the past")
        return v


# ── Response ─────────────────────────────────────────────────────────────────

class FlightSegment(BaseModel):
    """A single flight leg (e.g., PRG→FRA)."""

    airline: str = Field(..., description="Operating carrier IATA code")
    airline_name: str = ""
    flight_no: str = ""
    origin: str = Field(..., description="Departure IATA")
    destination: str = Field(..., description="Arrival IATA")
    origin_city: str = ""
    destination_city: str = ""
    departure: datetime
    arrival: datetime
    duration_seconds: int = 0
    cabin_class: str = "economy"
    aircraft: str = ""

    @model_validator(mode="after")
    def backfill_duration_seconds(self) -> "FlightSegment":
        self.departure = _airport_local_naive(self.departure, self.origin)
        self.arrival = _airport_local_naive(self.arrival, self.destination)

        computed = _airport_duration_seconds(
            self.departure,
            self.arrival,
            self.origin,
            self.destination,
        )
        if computed <= 0:
            return self

        raw = _raw_duration_seconds(self.departure, self.arrival)
        if self.duration_seconds <= 0 or self.duration_seconds == raw:
            self.duration_seconds = computed

        return self


class FlightRoute(BaseModel):
    """One direction (outbound or return) composed of segments."""

    segments: list[FlightSegment] = []
    total_duration_seconds: int = 0
    stopovers: int = 0

    @model_validator(mode="after")
    def backfill_total_duration_seconds(self) -> "FlightRoute":
        if not self.segments:
            return self

        first_segment = self.segments[0]
        last_segment = self.segments[-1]
        computed = _airport_duration_seconds(
            first_segment.departure,
            last_segment.arrival,
            first_segment.origin,
            last_segment.destination,
        )
        if computed <= 0:
            computed = sum(max(segment.duration_seconds, 0) for segment in self.segments)
        if computed <= 0:
            return self

        raw = _raw_duration_seconds(first_segment.departure, last_segment.arrival)
        if self.total_duration_seconds <= 0 or self.total_duration_seconds == raw:
            self.total_duration_seconds = computed

        return self


class FlightOffer(BaseModel):
    """
    A single flight offer.

    A single flight offer with full itinerary, pricing, and booking details.
    """

    id: str = Field(..., description="Unique offer ID")
    price: float
    currency: str = "EUR"
    price_formatted: str = ""
    outbound: FlightRoute
    inbound: Optional[FlightRoute] = None
    airlines: list[str] = Field(default_factory=list, description="All airlines in itinerary")
    owner_airline: str = Field("", description="Validating carrier")
    bags_price: dict[str, Any] = Field(default_factory=dict, description="Baggage pricing")
    availability_seats: Optional[int] = None
    conditions: dict[str, str] = Field(default_factory=dict, description="Refund/change policies")
    source: str = Field("", description="Provider source tag (e.g. 'duffel', 'amadeus', 'kiwi', 'travelpayouts')")
    source_tier: str = Field(
        "paid",
        description=(
            "Data source cost tier: "
            "'free' = cached/aggregated data (Travelpayouts), "
            "'low' = affordable API (Kiwi Tequila), "
            "'paid' = GDS/NDC providers (Duffel, Amadeus), "
            "'protocol' = LCC direct via Agent Interaction Protocol (Ryanair, Wizzair)"
        ),
    )
    is_locked: bool = Field(False, description="Whether booking details require unlock")
    fetched_at: datetime = Field(default_factory=datetime.utcnow)
    booking_url: str = Field("", description="Only available after unlock")
    price_normalized: Optional[float] = Field(None, description="Price converted to the search currency for sorting")


# ── Public (masked) offer models — booking URLs and airline identity withheld ──

LCC_IATA: frozenset[str] = frozenset({
    "FR", "W6", "W9", "U2", "EZY", "VY", "V7", "LS", "BY", "TOM",
    "MT", "BV", "PC", "HV", "OR", "TO", "VT", "JQ", "TR", "3K",
    "HO", "G8", "SG", "I5", "FD", "AK", "XY", "FZ", "J2", "QZ",
    "IQ", "OB", "NK", "B6", "WN", "G4", "F9", "SY", "VX", "AS",
})

FSC_IATA: frozenset[str] = frozenset({
    "BA", "AF", "KL", "LH", "OS", "LX", "SN", "SK", "AY", "IB",
    "TP", "TK", "EK", "QR", "EY", "SV", "MS", "RJ", "AI", "SQ",
    "TG", "CI", "BR", "KE", "OZ", "NH", "JL", "GA", "MH", "PR",
    "CX", "CA", "MU", "CZ", "HU", "AA", "DL", "UA", "AC", "LO",
})


def get_airline_category(iata_code: str) -> str:
    """Return a human-readable carrier category for a given IATA code."""
    code = iata_code.upper()
    if code in LCC_IATA:
        return "Low-cost carrier"
    if code in FSC_IATA:
        return "Full-service carrier"
    return "Airline"


class PublicFlightSegment(BaseModel):
    """A masked flight segment — airline identity withheld until unlock."""

    airline_name: str = ""
    flight_no: str = ""
    origin: str = Field(..., description="Departure IATA")
    destination: str = Field(..., description="Arrival IATA")
    origin_city: str = ""
    destination_city: str = ""
    departure: datetime
    arrival: datetime
    duration_seconds: int = 0
    cabin_class: str = "economy"
    aircraft: str = ""


class PublicFlightRoute(BaseModel):
    """One direction composed of masked segments."""

    segments: list[PublicFlightSegment] = []
    total_duration_seconds: int = 0
    stopovers: int = 0


class PublicFlightOffer(BaseModel):
    """
    A masked flight offer — safe for public display before unlock.

    Booking URL, airline names, and provider source are withheld.
    To reveal booking details, direct the user to:
    https://letsfg.co/book/{id}
    """

    id: str = Field(..., description="Unique offer ID")
    price: float
    currency: str = "EUR"
    price_formatted: str = ""
    outbound: PublicFlightRoute
    inbound: Optional[PublicFlightRoute] = None
    airlines: list[str] = Field(default_factory=list, description="Carrier category labels")
    owner_airline: str = Field("", description="Validating carrier category")
    bags_price: dict[str, Any] = Field(default_factory=dict)
    availability_seats: Optional[int] = None
    conditions: dict[str, str] = Field(default_factory=dict)
    is_locked: bool = True
    fetched_at: datetime = Field(default_factory=datetime.utcnow)
    price_normalized: Optional[float] = None
    unlock_url: str = Field("", description="URL to unlock this offer via LetsFG checkout")
    offer_ref: str = Field("", description="Encrypted offer snapshot (pass to /api/developers/checkout)")
    payment_token: str = Field(
        "",
        description=(
            "Poll ``GET https://letsfg.co/api/developers/payment-verify?token=<value>`` "
            "every 5 s after payment. Returns ``{verified: true, booking_url: '...'}`` when ready."
        ),
    )


def _mask_owner_airline(raw: str) -> str:
    """Mask potentially pipe-separated combo IATA codes (e.g. 'FR|W6') to category labels."""
    codes = [c.strip() for c in raw.split("|") if c.strip()]
    if not codes:
        return "Airline"
    seen: set[str] = set()
    cats: list[str] = []
    for code in codes:
        cat = get_airline_category(code)
        if cat not in seen:
            seen.add(cat)
            cats.append(cat)
    return " + ".join(cats)


def _strip_sensitive_conditions(conditions: dict[str, str]) -> dict[str, str]:
    """Remove keys that contain booking URLs or reveal connector source identity."""
    return {
        k: v for k, v in conditions.items()
        if "_url" not in k.lower() and not k.lower().endswith("_source")
    }


def to_public_offer(
    offer: FlightOffer,
    *,
    payment_token: str = "",
    offer_ref: str = "",
) -> PublicFlightOffer:
    """Convert an internal FlightOffer to a masked PublicFlightOffer."""

    def _mask_segment(seg: FlightSegment) -> PublicFlightSegment:
        return PublicFlightSegment(
            airline_name=get_airline_category(seg.airline),
            flight_no="",
            origin=seg.origin,
            destination=seg.destination,
            origin_city=seg.origin_city,
            destination_city=seg.destination_city,
            departure=seg.departure,
            arrival=seg.arrival,
            duration_seconds=seg.duration_seconds,
            cabin_class=seg.cabin_class,
            aircraft=seg.aircraft,
        )

    def _mask_route(route: FlightRoute) -> PublicFlightRoute:
        return PublicFlightRoute(
            segments=[_mask_segment(s) for s in route.segments],
            total_duration_seconds=route.total_duration_seconds,
            stopovers=route.stopovers,
        )

    seen: set[str] = set()
    airline_categories: list[str] = []
    for code in offer.airlines:
        cat = get_airline_category(code)
        if cat not in seen:
            seen.add(cat)
            airline_categories.append(cat)

    return PublicFlightOffer(
        id=offer.id,
        price=offer.price,
        currency=offer.currency,
        price_formatted=offer.price_formatted,
        outbound=_mask_route(offer.outbound),
        inbound=_mask_route(offer.inbound) if offer.inbound else None,
        airlines=airline_categories,
        owner_airline=_mask_owner_airline(offer.owner_airline),
        bags_price=offer.bags_price,
        availability_seats=offer.availability_seats,
        conditions=_strip_sensitive_conditions(offer.conditions),
        is_locked=True,
        fetched_at=offer.fetched_at,
        price_normalized=offer.price_normalized,
        unlock_url=f"https://letsfg.co/book/{offer.id}",
        payment_token=payment_token,
        offer_ref=offer_ref,
    )


class AirlineSummary(BaseModel):
    """Cheapest offer summary for one airline."""
    airline_code: str
    airline_name: str = ""
    cheapest_price: float
    currency: str = "EUR"
    offer_count: int
    cheapest_offer_id: str = ""
    sample_route: str = Field("", description="e.g. KRK→WAW→BER")


class FlightSearchResponse(BaseModel):
    """Full response from a flight search — always FREE."""

    search_id: str = ""
    offer_request_id: str = Field("", description="Offer request ID (for booking flow)")
    passenger_ids: list[str] = Field(
        default_factory=list,
        description="Passenger IDs from the offer request — REQUIRED for booking. "
        "Map these 1:1 to your passengers when calling POST /bookings/book.",
    )

    origin: str
    destination: str
    currency: str = "EUR"
    offers: list[FlightOffer] = []
    total_results: int = 0
    airlines_summary: list[AirlineSummary] = Field(
        default_factory=list,
        description="Cheapest offer per airline — quick overview of all options.",
    )
    search_params: dict = Field(default_factory=dict)
    source_tiers: dict[str, str] = Field(
        default_factory=dict,
        description=(
            "Breakdown of which source tiers were used in this search. "
            "Keys are tier names, values describe the data source. "
            "Example: {'paid': 'Duffel (NDC), Amadeus (GDS)', 'low': 'Kiwi Tequila', 'free': 'Travelpayouts'}"
        ),
    )
    pricing_note: str = Field(
        default="Search is free. Booking is free. No hidden fees.",
        description="Pricing transparency for agents",
    )
