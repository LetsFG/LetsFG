"""
PLAY Airlines stub connector — airline ceased operations.

PLAY (IATA: OG) was an Icelandic low-cost carrier operating transatlantic
and European routes from Keflavik (KEF). The airline shut down and
flyplay.com went offline. This stub ensures engine.py imports succeed
and returns empty results.
"""

from __future__ import annotations

import logging
from typing import Any

from ..models.flights import (
    FlightSearchRequest,
    FlightSearchResponse,
)

logger = logging.getLogger(__name__)


class PlayConnectorClient:
    """Stub connector for defunct PLAY Airlines (OG)."""

    def __init__(self, timeout: float = 25.0, **kwargs):
        pass

    async def search_flights(self, req: FlightSearchRequest) -> FlightSearchResponse:
        ob_result = await self._search_ow(req)
        if req.return_from and ob_result.total_results > 0:
            ib_req = req.model_copy(update={"origin": req.destination, "destination": req.origin, "date_from": req.return_from, "return_from": None})
            ib_result = await self._search_ow(ib_req)
            if ib_result.total_results > 0:
                ob_result.offers = self._combine_rt(ob_result.offers, ib_result.offers, req)
                ob_result.total_results = len(ob_result.offers)
        return ob_result


    async def _search_ow(self, req: FlightSearchRequest, **kw: Any) -> FlightSearchResponse:
        return FlightSearchResponse(
            search_id="play_defunct",
            origin=req.origin,
            destination=req.destination,
            offers=[],
            total_results=0,
        )

    async def close(self):
        pass


    @staticmethod
    def _combine_rt(
        ob: list[FlightOffer], ib: list[FlightOffer], req,
    ) -> list[FlightOffer]:
        combos: list[FlightOffer] = []
        for o in ob[:15]:
            for i in ib[:10]:
                price = round(o.price + i.price, 2)
                cid = hashlib.md5(f"{o.id}_{i.id}".encode()).hexdigest()[:12]
                combos.append(FlightOffer(
                    id=f"rt_play_{cid}", price=price, currency=o.currency,
                    outbound=o.outbound, inbound=i.outbound,
                    airlines=list(dict.fromkeys(o.airlines + i.airlines)),
                    owner_airline=o.owner_airline,
                    booking_url=o.booking_url, is_locked=False,
                    source=o.source, source_tier=o.source_tier,
                ))
        combos.sort(key=lambda c: c.price)
        return combos[:20]
