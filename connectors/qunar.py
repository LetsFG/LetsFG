"""
Qunar.com (去哪儿) connector — Playwright browser + getFlightAsyncInfo API interception.

Qunar is one of China's largest OTAs (owned by Baidu/Trip.com parent group).
It has the best coverage and prices for domestic Chinese routes and many
international routes from/to China, including budget carriers not in GDS.

Strategy:
1.  Launch Playwright browser (non-headless for anti-bot).
2.  Navigate to touch.qunar.com/lowFlight/flightList?dep=CN_NAME&arr=CN_NAME.
3.  Let qlogj.js generate the Bella anti-bot token (~3-5s).
4.  Wait for getFlightCalendar to succeed (loads calendar with prices by date).
5.  Navigate the date calendar to select the target departure date.
6.  Intercept getFlightAsyncInfo JSON response (60-180 flights with full details).
7.  Parse flightList → binfo → FlightSegment → FlightOffer.

API reference:
  POST https://touch.qunar.com/lowFlightInterface/api/getFlightAsyncInfo
  POST https://touch.qunar.com/lowFlightInterface/api/getFlightCalendar

Date uses Chinese city names (e.g. 北京 = Beijing, 广州 = Guangzhou).
Prices are in CNY. IATA codes are present in binfo.depAirportCode / arrAirportCode.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from datetime import datetime, date as date_type
from typing import Any, Optional

from ..models.flights import (
    FlightOffer,
    FlightRoute,
    FlightSearchRequest,
    FlightSearchResponse,
    FlightSegment,
)

logger = logging.getLogger(__name__)

# ── CNY exchange rates (approximate, updated periodically) ───────────────────
_CNY_RATES = {
    "EUR": 0.127, "USD": 0.138, "GBP": 0.109,
    "INR": 11.58, "AUD": 0.214, "CAD": 0.192,
    "JPY": 20.4,  "KRW": 189.0, "SGD": 0.184,
    "THB": 4.66,  "MYR": 0.606, "CNY": 1.0,
    "HKD": 1.073, "TWD": 4.48,  "MOP": 1.11,
    "IDR": 2180,  "PHP": 7.9,   "VND": 3500,
    "BRL": 0.72,  "MXN": 2.39,  "AED": 0.507,
    "SAR": 0.518, "QAR": 0.503, "TRY": 4.47,
    "RUB": 12.8,  "ZAR": 2.57,
}

# ── IATA airport code → Chinese city name used by Qunar ─────────────────────
_IATA_TO_CN: dict[str, str] = {
    # Beijing (both Capital PEK and Daxing PKX → same city 北京)
    "PEK": "北京", "PKX": "北京", "BJS": "北京",
    # Shanghai (Pudong PVG and Hongqiao SHA → same city 上海)
    "PVG": "上海", "SHA": "上海",
    # Guangzhou
    "CAN": "广州",
    # Chengdu (Shuangliu CTU and Tianfu TFU)
    "CTU": "成都", "TFU": "成都",
    # Shenzhen
    "SZX": "深圳",
    # Hangzhou
    "HGH": "杭州",
    # Nanjing
    "NKG": "南京",
    # Wuhan
    "WUH": "武汉",
    # Xi'an
    "XIY": "西安", "SIA": "西安",
    # Changsha
    "CSX": "长沙",
    # Kunming
    "KMG": "昆明",
    # Chongqing
    "CKG": "重庆",
    # Haikou
    "HAK": "海口",
    # Sanya
    "SYX": "三亚",
    # Qingdao
    "TAO": "青岛",
    # Harbin
    "HRB": "哈尔滨",
    # Zhengzhou
    "CGO": "郑州",
    # Dalian
    "DLC": "大连",
    # Jinan
    "TNA": "济南",
    # Nanning
    "NNG": "南宁",
    # Guiyang
    "KWE": "贵阳",
    # Guilin
    "KWL": "桂林",
    # Urumqi
    "URC": "乌鲁木齐",
    # Tianjin
    "TSN": "天津",
    # Xiamen
    "XMN": "厦门",
    # Fuzhou
    "FOC": "福州",
    # Zhuhai
    "ZUH": "珠海",
    # Wenzhou
    "WNZ": "温州",
    # Ningbo
    "NGB": "宁波",
    # Yantai
    "YNT": "烟台",
    # Taiyuan
    "TYN": "太原",
    # Yinchuan
    "INC": "银川",
    # Xining
    "XNN": "西宁",
    # Hefei
    "HFE": "合肥",
    # Wuxi
    "WUX": "无锡",
    # Hohhot
    "HET": "呼和浩特",
    # Lanzhou
    "LHW": "兰州",
    # Shenyang
    "SHE": "沈阳",
    # Changchun
    "CGQ": "长春",
    # Nanchang
    "KHN": "南昌",
    # Xishuangbanna / Jinghong
    "JHG": "西双版纳",
    # Lijiang
    "LJG": "丽江",
    # Kashgar
    "KHG": "喀什",
    # Lhasa
    "LXA": "拉萨",
    # Linzhi (Nyingchi)
    "LZY": "林芝",
    # Zhangjiajie
    "DYG": "张家界",
    # Yichang
    "YIH": "宜昌",
    # Nantong
    "NTG": "南通",
    # Ganzhou
    "KOW": "赣州",
    # Huangshan
    "TXN": "黄山",
    # Zunyi
    "ZYI": "遵义",
    # Mianyang
    "MYG": "绵阳",
    # Mudanjiang
    "MDG": "牡丹江",
    # Beihai
    "BHY": "北海",
    # Changde
    "CGD": "常德",
    # Wanzhou
    "WXN": "万州",
    # Yibin
    "YBP": "宜宾",
    # Luoyang
    "LYA": "洛阳",
    # Dali
    "DLU": "大理",
    # Karamay
    "KRY": "克拉玛依",
    # Aksu
    "AKU": "阿克苏",
    # Hotan
    "HTN": "和田",
    # Turpan
    "TLQ": "吐鲁番",
    # Yanbian
    "YNJ": "延边",
    # Jilin
    "JIL": "吉林",
    # Weifang
    "WEF": "潍坊",
    # Dongying
    "DOY": "东营",
    # Jining
    "JNG": "济宁",
    # Wuzhishan
    "WSX": "五指山",
    # Zhanjiang
    "ZHA": "湛江",

    # ── International (popular routes from/to China) ─────────────────────────
    "HKG": "香港",
    "MFM": "澳门",
    "TPE": "台北", "KHH": "高雄", "RMQ": "台中",
    # Japan
    "NRT": "东京", "HND": "东京", "TYO": "东京",
    "KIX": "大阪", "ITM": "大阪", "OSA": "大阪",
    "CTS": "札幌", "NGO": "名古屋", "FUK": "福冈",
    "OKA": "冲绳", "SDJ": "仙台", "HIJ": "广岛",
    # Korea
    "ICN": "首尔", "GMP": "首尔", "SEL": "首尔",
    "PUS": "釜山", "CJU": "济州岛",
    # Southeast Asia
    "BKK": "曼谷", "DMK": "曼谷",
    "HKT": "普吉岛", "CNX": "清迈", "USM": "苏梅岛",
    "SIN": "新加坡",
    "KUL": "吉隆坡", "JHB": "新山", "PEN": "槟城",
    "CGK": "雅加达", "DPS": "巴厘岛", "SUB": "泗水",
    "MNL": "马尼拉", "CEB": "宿务",
    "HAN": "河内", "SGN": "胡志明市", "DAD": "岘港",
    "RGN": "仰光", "DAC": "达卡", "CMB": "科伦坡",
    "KTM": "加德满都", "MLE": "马代",
    # Europe
    "LHR": "伦敦", "LGW": "伦敦", "STN": "伦敦",
    "CDG": "巴黎", "ORY": "巴黎",
    "FRA": "法兰克福",
    "AMS": "阿姆斯特丹",
    "FCO": "罗马", "ROM": "罗马",
    "MAD": "马德里", "BCN": "巴塞罗那",
    "VIE": "维也纳", "ZRH": "苏黎世", "GVA": "日内瓦",
    "MUC": "慕尼黑", "BER": "柏林",
    "ATH": "雅典", "PRG": "布拉格",
    "BUD": "布达佩斯", "WAW": "华沙",
    "CPH": "哥本哈根", "ARN": "斯德哥尔摩",
    "HEL": "赫尔辛基", "OSL": "奥斯陆",
    "IST": "伊斯坦布尔",
    "DUB": "都柏林", "BRU": "布鲁塞尔",
    "LIS": "里斯本", "MXP": "米兰", "MIL": "米兰",
    # North America
    "LAX": "洛杉矶",
    "JFK": "纽约", "EWR": "纽约", "LGA": "纽约",
    "SFO": "旧金山", "SEA": "西雅图",
    "ORD": "芝加哥", "BOS": "波士顿",
    "IAD": "华盛顿", "DCA": "华盛顿",
    "YVR": "温哥华", "YYZ": "多伦多",
    "DFW": "达拉斯", "MIA": "迈阿密",
    "ATL": "亚特兰大", "DEN": "丹佛",
    # Australia / NZ
    "SYD": "悉尼", "MEL": "墨尔本",
    "BNE": "布里斯班", "PER": "珀斯",
    "AKL": "奥克兰",
    # Middle East
    "DXB": "迪拜", "AUH": "阿布扎比",
    "DOH": "多哈", "RUH": "利雅得",
    "KWI": "科威特", "AMM": "安曼",
    # Central Asia
    "ALA": "阿拉木图", "TAS": "塔什干",
    # South America
    "GRU": "圣保罗", "EZE": "布宜诺斯艾利斯",
    # Africa
    "CAI": "开罗", "JNB": "约翰内斯堡",
}

# Reverse map: Chinese name → canonical IATA (first code listed)
_CN_TO_IATA: dict[str, str] = {}
for _iata, _cn in _IATA_TO_CN.items():
    if _cn not in _CN_TO_IATA:
        _CN_TO_IATA[_cn] = _iata


def _cny_to(amount: float, currency: str) -> float:
    rate = _CNY_RATES.get(currency.upper())
    if rate:
        return round(amount * rate, 2)
    return round(amount * _CNY_RATES["EUR"], 2)


def _parse_flight_time(time_str: str) -> int:
    """Parse Chinese flight time like '3小时10分钟' to seconds."""
    if not time_str:
        return 0
    import re
    hours = re.search(r'(\d+)小时', time_str)
    mins = re.search(r'(\d+)分', time_str)
    h = int(hours.group(1)) if hours else 0
    m = int(mins.group(1)) if mins else 0
    return (h * 60 + m) * 60


def _parse_dt(date_str: str, time_str: str) -> datetime:
    if not date_str or not time_str:
        return datetime(2000, 1, 1)
    try:
        return datetime.fromisoformat(f"{date_str}T{time_str}:00")
    except Exception:
        return datetime(2000, 1, 1)


def _parse_binfo(info: dict, origin: str, destination: str) -> Optional[FlightSegment]:
    """Parse a Qunar binfo/binfo1 dict into a FlightSegment."""
    if not info:
        return None
    try:
        airline = info.get("carrier", "") or info.get("shortCarrier", "")
        airline_name = info.get("fullName", "") or info.get("shortName", "")
        # Prefer English airline name from IATA code if Chinese
        if airline_name and ord(airline_name[0]) > 127:
            airline_name = airline
        flight_no = info.get("flightNo", "")
        dep_code = info.get("depAirportCode", "") or origin
        arr_code = info.get("arrAirportCode", "") or destination
        dep_dt = _parse_dt(info.get("depDate", ""), info.get("depTime", ""))
        arr_dt = _parse_dt(info.get("arrDate", ""), info.get("arrTime", ""))
        return FlightSegment(
            airline=airline,
            airline_name=airline_name,
            flight_no=flight_no,
            origin=dep_code,
            destination=arr_code,
            departure=dep_dt,
            arrival=arr_dt,
        )
    except Exception as e:
        logger.debug("qunar: binfo parse error: %s", e)
        return None


def _parse_qunar_flight_list(
    flights: list[dict],
    req: FlightSearchRequest,
    target_date: str,
) -> list[FlightOffer]:
    """Parse Qunar getFlightAsyncInfo flightList into FlightOffer list.

    Non-stop flights: binfo = main segment, binfo1 == binfo (duplicate).
    Connecting flights: binfo is empty, binfo1 = leg 1, binfo2 = leg 2.
    """
    target_cur = req.currency or "EUR"
    offers: list[FlightOffer] = []

    for item in flights:
        try:
            binfo_raw = item.get("binfo") or {}
            binfo1 = item.get("binfo1") or {}
            binfo2 = item.get("binfo2") or {}
            trans_city = item.get("transCity", "")

            # Determine if this is non-stop or connecting
            is_connecting = bool(trans_city) or bool(binfo2)

            if is_connecting:
                # Connecting: binfo may be empty; legs are binfo1 and binfo2
                leg1 = binfo1
                leg2 = binfo2
                dep_date = leg1.get("depDate", "")
                price_cny_str = leg1.get("minSellPrice", "") or item.get("minPrice", "0")
            else:
                # Non-stop: binfo has the data
                leg1 = binfo_raw if binfo_raw.get("depAirportCode") else binfo1
                leg2 = {}
                dep_date = leg1.get("depDate", "")
                price_cny_str = leg1.get("minSellPrice", "") or item.get("minPrice", "0")

            # Skip if not matching target date
            if target_date and dep_date and dep_date != target_date:
                continue

            try:
                price_cny = float(price_cny_str)
            except (ValueError, TypeError):
                continue
            if price_cny <= 0:
                continue

            price = _cny_to(price_cny, target_cur)

            stops = 1 if is_connecting else int(leg1.get("stops", 0))

            # Build flight segments
            seg1 = _parse_binfo(leg1, req.origin, req.destination)
            if not seg1:
                continue

            segments: list[FlightSegment] = [seg1]
            if is_connecting and leg2:
                seg2 = _parse_binfo(leg2, seg1.destination, req.destination)
                if seg2:
                    segments.append(seg2)

            # Total flight time
            dur_str = item.get("totalFlightTime", "") or leg1.get("flightTime", "")
            total_dur = _parse_flight_time(dur_str)

            outbound = FlightRoute(
                segments=segments,
                total_duration_seconds=total_dur,
                stopovers=stops,
            )

            # Build booking URL from the prefix field
            prefix = item.get("prefix", "")
            if prefix:
                booking_url = prefix
            else:
                import urllib.parse
                dep_cn = _IATA_TO_CN.get(req.origin, req.origin)
                arr_cn = _IATA_TO_CN.get(req.destination, req.destination)
                booking_url = (
                    "https://touch.qunar.com/lowFlight/flightList"
                    f"?dep={urllib.parse.quote(dep_cn)}"
                    f"&arr={urllib.parse.quote(arr_cn)}"
                )

            all_airlines = list(dict.fromkeys(s.airline for s in segments if s.airline))
            owner = segments[0].airline if segments else ""

            flight_key = item.get("flightKey", "") or seg1.flight_no
            h = hashlib.md5(
                f"qunar_{flight_key}_{dep_date}_{price_cny}".encode()
            ).hexdigest()[:10]

            offers.append(FlightOffer(
                id=f"qn_{h}",
                price=price,
                currency=target_cur,
                price_formatted=f"CNY {price_cny:.0f} ({target_cur} {price:.2f})",
                outbound=outbound,
                inbound=None,
                airlines=all_airlines,
                owner_airline=owner,
                source="qunar_ota",
                source_tier="free",
                is_locked=False,
                booking_url=booking_url,
            ))

        except Exception as e:
            logger.debug("qunar: parse flight error: %s", e)

    return offers


class QunarConnectorClient:
    """Qunar.com (去哪儿) — Playwright + getFlightAsyncInfo API interception.

    Covers Chinese domestic routes and international routes from/to China.
    Requires QUNAR_PROXY env var for production use (IP-based rate limits).
    """

    def __init__(self, timeout: float = 60.0):
        self.timeout = timeout

    async def close(self):
        pass

    async def search_flights(
        self, req: FlightSearchRequest
    ) -> FlightSearchResponse:
        ob_result = await self._search_ow(req)
        if req.return_from and ob_result.total_results > 0:
            ib_req = req.model_copy(update={
                "origin": req.destination,
                "destination": req.origin,
                "date_from": req.return_from,
                "return_from": None,
            })
            ib_result = await self._search_ow(ib_req)
            if ib_result.total_results > 0:
                ob_result.offers = self._combine_rt(ob_result.offers, ib_result.offers, req)
                ob_result.total_results = len(ob_result.offers)
        return ob_result

    async def _search_ow(self, req: FlightSearchRequest) -> FlightSearchResponse:
        t0 = time.monotonic()
        try:
            offers = await self._do_search(req)
            if offers:
                offers.sort(key=lambda o: o.price if o.price > 0 else float("inf"))
                elapsed = time.monotonic() - t0
                logger.info(
                    "QUNAR %s→%s: %d offers in %.1fs",
                    req.origin, req.destination, len(offers), elapsed,
                )
                h = hashlib.md5(
                    f"qunar{req.origin}{req.destination}{req.date_from}".encode()
                ).hexdigest()[:12]
                return FlightSearchResponse(
                    search_id=f"fs_qn_{h}",
                    origin=req.origin,
                    destination=req.destination,
                    currency=req.currency,
                    offers=offers,
                    total_results=len(offers),
                )
        except Exception as e:
            logger.warning("QUNAR search failed: %s", e)
        return self._empty(req)

    async def _do_search(self, req: FlightSearchRequest) -> list[FlightOffer] | None:
        from playwright.async_api import async_playwright
        from .browser import (
            get_proxy, inject_stealth_js,
            stealth_position_arg, bandwidth_saving_args,
            disable_background_networking_args,
        )
        import urllib.parse

        dep_cn = _IATA_TO_CN.get(req.origin.upper())
        arr_cn = _IATA_TO_CN.get(req.destination.upper())
        if not dep_cn or not arr_cn:
            logger.info(
                "QUNAR: no Chinese city mapping for %s or %s — skipping",
                req.origin, req.destination,
            )
            return None

        target_date = req.date_from.isoformat() if req.date_from else ""

        async_info_data: dict = {}

        # ── Qunar-specific URL substrings to abort ──────────────────────────
        # Using substring matching (same technique as _aggressive_block_handler)
        # because Playwright's single-* glob does not match URL path separators,
        # so patterns like "*go-mpulse.net*" fail for "https://s.go-mpulse.net/".
        # Substring matching is simple, reliable, and zero overhead.
        #
        # These endpoints are safe to block — none of them affect the Bella
        # token generation or flight search results.
        _QUNAR_ABORT_SUBS: tuple[str, ...] = (
            "gw/f/flight/recommend/city",   # 3.7 MB all-cities list (×2 per load)
            "touch/flight/recommend/city",  # 18 KB popular-city shortcuts (×2)
            "flightconfig/calendar",        # Holiday data (not used)
            "jweixin",                       # WeChat SDK (12 KB)
            "ccweixin.qunar.com",           # WeChat JS config
            "commonlog",                     # Per-request logging calls
            "fmgw.qunar.com",               # Metrics
            "rmcsdf.qunar.com",             # Device-tracking fingerprint
            "/fe/tad",                       # Fingerprint beacon
            "generator/faver",              # Analytics pixel
            "/bc/clk",                       # Click tracker
            "/bc/w?",                        # Tracking pixel
            "go-mpulse.net",                # Akamai mPulse (210 KB)
        )

        # Resource types to block — scripts are kept because qlogy.js and
        # common@...js generate the Bella token and run the React app.
        _QUNAR_BLOCKED_RES = frozenset({
            "image", "media", "font", "websocket", "manifest", "stylesheet",
        })

        async def _qunar_blocker(route, request):
            """Combined block handler: resource-type + Qunar-specific substrings."""
            if request.resource_type in _QUNAR_BLOCKED_RES:
                await route.abort()
                return
            url_l = request.url.lower()
            for sub in _QUNAR_ABORT_SUBS:
                if sub in url_l:
                    await route.abort()
                    return
            await route.continue_()

        async def on_async_info_route(route, request):
            """Capture getFlightAsyncInfo via route intercept (most reliable)."""
            response = await route.fetch()
            body_bytes = await response.body()
            try:
                body = body_bytes.decode("utf-8")
            except Exception:
                body = body_bytes.decode("gbk", errors="replace")
            if len(body) > 500:
                async_info_data["body"] = body
            await route.fulfill(
                status=response.status,
                headers=dict(response.headers),
                body=body_bytes,
            )

        async def on_calendar_route(route, request):
            """Intercept getFlightCalendar: rewrite tag to exactly the target
            date so getFlightAsyncInfo auto-fires for that date, not today+2."""
            if request.method == "POST" and request.post_data and target_date:
                try:
                    body = json.loads(request.post_data)
                    b = body.get("b", {})
                    b["tag"] = f"{target_date}|{target_date}"
                    b["days"] = 1
                    b["startDate"] = target_date
                    b["endDate"] = target_date
                    body["b"] = b
                    response = await route.fetch(post_data=json.dumps(body))
                except Exception:
                    response = await route.fetch()
            else:
                response = await route.fetch()

            body_bytes = await response.body()
            try:
                body_txt = body_bytes.decode("utf-8")
            except Exception:
                body_txt = body_bytes.decode("gbk", errors="replace")
            if len(body_txt) > 100:
                try:
                    obj = json.loads(body_txt)
                    code = obj.get("bstatus", {}).get("code", -1)
                    logger.debug("QUNAR calendar code=%s size=%s", code, len(body_txt))
                except Exception:
                    pass
            await route.fulfill(
                status=response.status,
                headers=dict(response.headers),
                body=body_bytes,
            )

        proxy = get_proxy("QUNAR_PROXY")
        launch_kw: dict = {
            "headless": False,
            "args": [
                *stealth_position_arg(),
                "--window-size=414,896",
                "--disable-blink-features=AutomationControlled",
                # Block images + fonts at the Blink engine level (undetectable
                # by anti-bot; saves ~20-30% bandwidth per page load)
                *bandwidth_saving_args(),
                # Suppress Chrome's own background networking (Google update
                # checks, SafeBrowsing, optimizationguide, etc.)
                *disable_background_networking_args(),
            ],
        }
        if proxy:
            launch_kw["proxy"] = proxy

        pw = await async_playwright().start()
        try:
            browser = await pw.chromium.launch(**launch_kw)
            ctx = await browser.new_context(
                viewport={"width": 414, "height": 896},
                user_agent=(
                    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
                    "Mobile/21A329 MicroMessenger/8.0.49(0x18003131) "
                    "NetType/WIFI Language/zh_CN"
                ),
            )
            page = await ctx.new_page()
            await inject_stealth_js(page)

            # ── Route registration order matters: Playwright uses LIFO —
            #    last-registered route has HIGHEST priority.
            #
            # 1. Combined block handler (lowest priority) — single **/* handler
            #    blocks by resource type AND Qunar-specific URL substrings.
            #    Uses substring matching so path-separator glob issues don't
            #    affect patterns like "go-mpulse.net" or "ccweixin.qunar.com".
            await page.route("**/*", _qunar_blocker)

            # 2. getFlightAsyncInfo capture (high priority) — registered after
            #    blocker so it wins for that URL; fulfills with captured body.
            await page.route(
                "**/lowFlightInterface/api/getFlightAsyncInfo",
                on_async_info_route,
            )

            # 3. getFlightCalendar date rewrite (highest priority — registered
            #    last, overrides both routes above for that URL).
            await page.route(
                "**/lowFlightInterface/api/getFlightCalendar",
                on_calendar_route,
            )

            url = (
                "https://touch.qunar.com/lowFlight/flightList"
                f"?dep={urllib.parse.quote(dep_cn)}"
                f"&arr={urllib.parse.quote(arr_cn)}"
                "&flightType=1"
            )
            await page.goto(url, wait_until="domcontentloaded", timeout=25000)

            # Poll at 1 s intervals; max 35 s total
            # (bella init ~3-5s, calendar ~1s, async info ~1s after calendar)
            for _ in range(35):
                await page.wait_for_timeout(1000)
                if "body" in async_info_data:
                    break

            await page.close()
            await ctx.close()
            await browser.close()

        except Exception as e:
            logger.error("QUNAR browser error: %s", e)
            return None
        finally:
            try:
                await pw.stop()
            except Exception:
                pass

        if "body" not in async_info_data:
            logger.warning("QUNAR: no getFlightAsyncInfo response captured")
            return None

        try:
            obj = json.loads(async_info_data["body"])
            code = obj.get("bstatus", {}).get("code", -1)
            if code != 0:
                logger.warning("QUNAR: getFlightAsyncInfo code=%s", code)
                return None
            flights = obj.get("data", {}).get("flightList", [])
            if not flights:
                logger.info("QUNAR: empty flightList")
                return None
            return _parse_qunar_flight_list(flights, req, target_date)
        except Exception as e:
            logger.error("QUNAR: parse response error: %s", e)
            return None

    def _empty(self, req: FlightSearchRequest) -> FlightSearchResponse:
        return FlightSearchResponse(
            search_id="",
            origin=req.origin,
            destination=req.destination,
            currency=req.currency,
            offers=[],
            total_results=0,
        )

    @staticmethod
    def _combine_rt(
        ob: list[FlightOffer],
        ib: list[FlightOffer],
        req: FlightSearchRequest,
    ) -> list[FlightOffer]:
        combos: list[FlightOffer] = []
        for o in ob[:15]:
            for i in ib[:10]:
                price = round(o.price + i.price, 2)
                cid = hashlib.md5(f"{o.id}_{i.id}".encode()).hexdigest()[:12]
                combos.append(FlightOffer(
                    id=f"rt_qn_{cid}",
                    price=price,
                    currency=o.currency,
                    outbound=o.outbound,
                    inbound=i.outbound,
                    airlines=list(dict.fromkeys(o.airlines + i.airlines)),
                    owner_airline=o.owner_airline,
                    booking_url=o.booking_url,
                    is_locked=False,
                    source=o.source,
                    source_tier=o.source_tier,
                ))
        combos.sort(key=lambda c: c.price)
        return combos[:20]
