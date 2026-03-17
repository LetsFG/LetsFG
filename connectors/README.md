# Airline Connectors

Direct airline integrations for LetsFG. Each connector lets agents natively interact with an airline's website or API to search flights in real time.

These run on the user's machine as part of the LetsFG CLI/SDK — no server needed.

## How It Works

Each connector implements `search_flights(request)` and returns standardized `FlightSearchResponse` objects. The engine (`engine.py`) dispatches searches to relevant connectors in parallel based on route coverage.

**Three integration approaches:**

| Approach | Speed | Example |
|----------|-------|---------|
| Direct API | ~0.5-1s | Ryanair, FlyDubai, Air Arabia |
| Hybrid (API + browser fallback) | ~1-3s | Vueling, Frontier, Flybondi |
| Browser automation | ~5-15s | Most LCCs (EasyJet, Spirit, etc.) |

## Supported Airlines

| Connector | Airline | Regions |
|-----------|---------|---------|
| `airarabia.py` | Air Arabia | ME, Africa, Asia |
| `airasia.py` | AirAsia | Southeast Asia |
| `airindiaexpress.py` | Air India Express | India, ME, SE Asia |
| `airpeace.py` | Air Peace | West Africa |
| `akasa.py` | Akasa Air | India |
| `allegiant.py` | Allegiant Air | US domestic |
| `ana.py` | ANA (All Nippon Airways) | Japan, Asia, US, Europe |
| `azul.py` | Azul | Brazil, South America |
| `batikair.py` | Batik Air | Indonesia, SE Asia |
| `cebupacific.py` | Cebu Pacific | Philippines, Asia |
| `condor.py` | Condor | Europe, Americas |
| `cathay.py` | Cathay Pacific | Hong Kong, Asia, Europe, US |
| `easyjet.py` | easyJet | Europe |
| `eurowings.py` | Eurowings | Europe |
| `flair.py` | Flair Airlines | Canada |
| `flybondi.py` | Flybondi | Argentina, South America |
| `flydubai.py` | FlyDubai | ME, Asia, Europe |
| `flynas.py` | Flynas | Saudi Arabia, ME |
| `flysafair.py` | FlySafair | South Africa |
| `frontier.py` | Frontier Airlines | US, Americas |
| `gol.py` | GOL | Brazil, South America |
| `indigo.py` | IndiGo | India, ME, SE Asia |
| `jejuair.py` | Jeju Air | South Korea, Asia |
| `jet2.py` | Jet2 | UK, Europe |
| `jetsmart.py` | JetSMART | Chile, Argentina, South America |
| `jetstar.py` | Jetstar | Australia, NZ, Asia |
| `kiwi.py` | Kiwi.com | Worldwide (aggregator) |
| `korean.py` | Korean Air | South Korea, Asia, US, Europe |
| `lionair.py` | Lion Air | Indonesia, SE Asia |
| `nokair.py` | Nok Air | Thailand, SE Asia |
| `norwegian.py` | Norwegian | Scandinavia, Europe |
| `peach.py` | Peach Aviation | Japan, Asia |
| `pegasus.py` | Pegasus Airlines | Turkey, Europe |
| `play.py` | PLAY | Iceland, Europe |
| `porter.py` | Porter Airlines | Canada |
| `ryanair.py` | Ryanair | Europe |
| `scoot.py` | Scoot | Singapore, Asia |
| `singapore.py` | Singapore Airlines | Singapore, Asia, Global |
| `smartwings.py` | Smartwings | Czech Republic, Europe |
| `southwest.py` | Southwest Airlines | US domestic |
| `spicejet.py` | SpiceJet | India, ME |
| `spirit.py` | Spirit Airlines | US, Caribbean |
| `spring.py` | Spring Airlines | China, Asia |
| `sunexpress.py` | SunExpress | Turkey, Europe |
| `thai.py` | Thai Airways | Thailand, Asia, Europe |
| `transavia.py` | Transavia | Netherlands, France, Europe |
| `twayair.py` | T'way Air | South Korea, Asia |
| `vietjet.py` | VietJet Air | Vietnam, SE Asia |
| `vivaaerobus.py` | VivaAerobus | Mexico |
| `volaris.py` | Volaris | Mexico, Central America |
| `volotea.py` | Volotea | Spain, Italy, Europe |
| `vueling.py` | Vueling | Spain, Europe |
| `wizzair.py` | Wizz Air | Europe, ME |
| `zipair.py` | ZIPAIR | Japan, Asia |

## Route Filtering

The engine uses this to only query connectors relevant to a given route — no point asking Ryanair about flights in Brazil.

## Adding a Connector

See `_connector_template.py` for the standard pattern. Each connector needs:

1. A `search_flights(request) -> FlightSearchResponse` method
2. An entry in `airline_routes.py` with country coverage
3. Registration in `engine.py`'s `_DIRECT_AIRLINE_CONNECTORS` list
