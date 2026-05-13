// Shared NL query parser — used by /api/search and the SSR /results?q= page
// Handles: EN, DE, ES, FR, IT, NL, PL, PT, SQ (Albanian), HR (Croatian), SV (Swedish)
// Also handles: filler words, typos via accent-stripping, ordinals, DD/MM/YYYY, relative dates

import { findBestLocationMatch, findExactLocationMatch } from '../airports'

// ── City → IATA lookup ────────────────────────────────────────────────────────
// Keys are lowercase, accent-free. resolveCity() normalises input before lookup.

export const CITY_TO_IATA: Record<string, { code: string; name: string }> = {
  // ── UK & Ireland ────────────────────────────────────────────────────────────
  'london': { code: 'LON', name: 'London' },
  'londra': { code: 'LON', name: 'London' },
  'londyn': { code: 'LON', name: 'London' },
  'londynu': { code: 'LON', name: 'London' },          // PL genitive
  'londen': { code: 'LON', name: 'London' },
  'londres': { code: 'LON', name: 'London' },           // FR/ES/PT
  'londër': { code: 'LON', name: 'London' },            // SQ
  'heathrow': { code: 'LHR', name: 'London Heathrow' },
  'gatwick': { code: 'LGW', name: 'London Gatwick' },
  'stansted': { code: 'STN', name: 'London Stansted' },
  'luton': { code: 'LTN', name: 'London Luton' },
  'city airport': { code: 'LCY', name: 'London City' },
  'lcy': { code: 'LCY', name: 'London City' },
  'manchester': { code: 'MAN', name: 'Manchester' },
  'birmingham': { code: 'BHX', name: 'Birmingham' },
  'edinburgh': { code: 'EDI', name: 'Edinburgh' },
  'glasgow': { code: 'GLA', name: 'Glasgow' },
  'bristol': { code: 'BRS', name: 'Bristol' },
  'leeds': { code: 'LBA', name: 'Leeds Bradford' },
  'newcastle': { code: 'NCL', name: 'Newcastle' },
  'belfast': { code: 'BFS', name: 'Belfast' },
  'liverpool': { code: 'LPL', name: 'Liverpool' },
  'southampton': { code: 'SOU', name: 'Southampton' },
  'exeter': { code: 'EXT', name: 'Exeter' },
  'aberdeen': { code: 'ABZ', name: 'Aberdeen' },
  'inverness': { code: 'INV', name: 'Inverness' },
  'inv': { code: 'INV', name: 'Inverness' },
  'highlands': { code: 'INV', name: 'Scottish Highlands (via Inverness)' },
  'isle of skye': { code: 'INV', name: 'Isle of Skye (via Inverness)' },
  'skye': { code: 'INV', name: 'Isle of Skye (via Inverness)' },
  'cardiff': { code: 'CWL', name: 'Cardiff' },
  'cwl': { code: 'CWL', name: 'Cardiff' },
  'norwich': { code: 'NWI', name: 'Norwich' },
  'nwi': { code: 'NWI', name: 'Norwich' },
  // ── UK regional & tourist airports ──────────────────────────────────────────
  'newquay': { code: 'NQY', name: 'Newquay (Cornwall)' },
  'nqy': { code: 'NQY', name: 'Newquay' },
  'cornwall': { code: 'NQY', name: 'Cornwall (Newquay)' },
  'st ives': { code: 'NQY', name: 'St Ives (via Newquay)' },
  'penzance': { code: 'NQY', name: 'Penzance (via Newquay)' },
  'jersey': { code: 'JER', name: 'Jersey (Channel Islands)' },
  'jer': { code: 'JER', name: 'Jersey' },
  'guernsey': { code: 'GCI', name: 'Guernsey (Channel Islands)' },
  'gci': { code: 'GCI', name: 'Guernsey' },
  'isle of man': { code: 'IOM', name: 'Isle of Man' },
  'iom': { code: 'IOM', name: 'Isle of Man' },
  'orkney': { code: 'KOI', name: 'Orkney (Kirkwall)' },
  'shetland': { code: 'LSI', name: 'Shetland (Sumburgh)' },
  'isle of wight': { code: 'SOU', name: 'Isle of Wight (via Southampton)' },
  'derry': { code: 'LDY', name: 'Derry / Londonderry' },
  'londonderry': { code: 'LDY', name: 'Derry / Londonderry' },
  'ldy': { code: 'LDY', name: 'Derry' },
  'dundee': { code: 'DND', name: 'Dundee' },
  'dnd': { code: 'DND', name: 'Dundee' },
  'cotswolds': { code: 'BHX', name: 'Cotswolds (via Birmingham)' },
  'stratford upon avon': { code: 'BHX', name: 'Stratford-upon-Avon (via Birmingham)' },
  'oxford': { code: 'LHR', name: 'Oxford (via London Heathrow)' },
  'bath': { code: 'BRS', name: 'Bath (via Bristol)' },
  'stonehenge': { code: 'BRS', name: 'Stonehenge (via Bristol)' },
  'lake district': { code: 'MAN', name: 'Lake District (via Manchester)' },
  'windermere': { code: 'MAN', name: 'Lake District (via Manchester)' },
  'yorkshire': { code: 'LBA', name: 'Yorkshire (via Leeds Bradford)' },
  'york': { code: 'LBA', name: 'York (via Leeds Bradford)' },
  // ── Ireland regional ────────────────────────────────────────────────────────
  'galway': { code: 'NOC', name: 'Galway (via Knock)' },
  'knock': { code: 'NOC', name: 'Knock (Ireland West)' },
  'noc': { code: 'NOC', name: 'Knock / Ireland West' },
  'killarney': { code: 'KIR', name: 'Killarney (Kerry)' },
  'kerry': { code: 'KIR', name: 'County Kerry' },
  'kir': { code: 'KIR', name: 'Kerry' },
  'shannon': { code: 'SNN', name: 'Shannon' },
  'snn': { code: 'SNN', name: 'Shannon' },
  'limerick': { code: 'SNN', name: 'Limerick (via Shannon)' },
  'donegal': { code: 'CFN', name: 'Donegal' },
  'waterford': { code: 'WAT', name: 'Waterford' },
  'dublin': { code: 'DUB', name: 'Dublin' },
  'dub': { code: 'DUB', name: 'Dublin' },
  'cork': { code: 'ORK', name: 'Cork' },
  'ork': { code: 'ORK', name: 'Cork' },
  // ── Western Europe ──────────────────────────────────────────────────────────
  'barcelona': { code: 'BCN', name: 'Barcelona' },
  'barcelony': { code: 'BCN', name: 'Barcelona' },    // PL genitive
  'barcelonie': { code: 'BCN', name: 'Barcelona' },   // PL locative
  'barcelone': { code: 'BCN', name: 'Barcelona' },    // FR
  'barcellona': { code: 'BCN', name: 'Barcelona' },   // IT
  'barcelonës': { code: 'BCN', name: 'Barcelona' },   // SQ genitive
  'barcelones': { code: 'BCN', name: 'Barcelona' },   // SQ genitive (no diacritics)
  'madrid': { code: 'MAD', name: 'Madrid' },
  'madryt': { code: 'MAD', name: 'Madrid' },           // PL
  'madrytu': { code: 'MAD', name: 'Madrid' },          // PL genitive
  'malaga': { code: 'AGP', name: 'Malaga' },
  'malága': { code: 'AGP', name: 'Malaga' },
  'seville': { code: 'SVQ', name: 'Seville' },
  'sevilla': { code: 'SVQ', name: 'Seville' },
  'valencia': { code: 'VLC', name: 'Valencia' },
  'alicante': { code: 'ALC', name: 'Alicante' },
  'bilbao': { code: 'BIO', name: 'Bilbao' },
  'palma': { code: 'PMI', name: 'Palma de Mallorca' },
  'mallorca': { code: 'PMI', name: 'Palma de Mallorca' },
  'majorca': { code: 'PMI', name: 'Palma de Mallorca' },
  'ibiza': { code: 'IBZ', name: 'Ibiza' },
  'menorca': { code: 'MAH', name: 'Menorca' },
  'minorca': { code: 'MAH', name: 'Menorca' },
  'tenerife': { code: 'TFS', name: 'Tenerife' },
  'gran canaria': { code: 'LPA', name: 'Gran Canaria' },
  'lanzarote': { code: 'ACE', name: 'Lanzarote' },
  'fuerteventura': { code: 'FUE', name: 'Fuerteventura' },
  'la palma': { code: 'SPC', name: 'La Palma (Canary Islands)' },
  'san sebastian': { code: 'EAS', name: 'San Sebastián' },
  'donostia': { code: 'EAS', name: 'San Sebastián' },
  'cordoba': { code: 'ODB', name: 'Córdoba' },
  'córdoba': { code: 'ODB', name: 'Córdoba' },
  'granada': { code: 'GRX', name: 'Granada' },
  'murcia': { code: 'MJV', name: 'Murcia' },
  'santander': { code: 'SDR', name: 'Santander' },
  'asturias': { code: 'OVD', name: 'Asturias' },
  'gijon': { code: 'OVD', name: 'Asturias' },
  'oviedo': { code: 'OVD', name: 'Asturias' },
  'zaragoza': { code: 'ZAZ', name: 'Zaragoza' },
  'valladolid': { code: 'VLL', name: 'Valladolid' },
  // ── Spanish tourist coast / inland ────────────────────────────────────────
  'marbella': { code: 'AGP', name: 'Marbella (via Malaga)' },
  'costa del sol': { code: 'AGP', name: 'Costa del Sol (via Malaga)' },
  'nerja': { code: 'AGP', name: 'Nerja (via Malaga)' },
  'torremolinos': { code: 'AGP', name: 'Torremolinos (via Malaga)' },
  'benalmadena': { code: 'AGP', name: 'Benalmádena (via Malaga)' },
  'ronda': { code: 'AGP', name: 'Ronda (via Malaga)' },
  'benidorm': { code: 'ALC', name: 'Benidorm (via Alicante)' },
  'costa blanca': { code: 'ALC', name: 'Costa Blanca (via Alicante)' },
  'denia': { code: 'ALC', name: 'Dénia (via Alicante)' },
  'javea': { code: 'ALC', name: 'Jávea (via Alicante)' },
  'costa brava': { code: 'GRO', name: 'Costa Brava (via Girona)' },
  'girona': { code: 'GRO', name: 'Girona (Costa Brava)' },
  'gro': { code: 'GRO', name: 'Girona' },
  'lloret de mar': { code: 'GRO', name: 'Lloret de Mar (via Girona)' },
  'sitges': { code: 'BCN', name: 'Sitges (via Barcelona)' },
  'tarragona': { code: 'REU', name: 'Tarragona (via Reus)' },
  'reus': { code: 'REU', name: 'Reus' },
  'santiago de compostela': { code: 'SCQ', name: 'Santiago de Compostela' },
  'scq': { code: 'SCQ', name: 'Santiago de Compostela' },
  'vigo': { code: 'VGO', name: 'Vigo' },
  'vgo': { code: 'VGO', name: 'Vigo' },
  'a coruna': { code: 'LCG', name: 'A Coruña' },
  'la coruna': { code: 'LCG', name: 'A Coruña' },
  'lcg': { code: 'LCG', name: 'A Coruña' },
  'pamplona': { code: 'PNA', name: 'Pamplona' },
  'pna': { code: 'PNA', name: 'Pamplona' },
  'almeria': { code: 'LEI', name: 'Almería' },
  'almería': { code: 'LEI', name: 'Almería' },
  'lei': { code: 'LEI', name: 'Almería' },
  'jerez': { code: 'XRY', name: 'Jerez de la Frontera' },
  'xry': { code: 'XRY', name: 'Jerez' },
  // ── Portugal tourist spots ────────────────────────────────────────────────
  'sintra': { code: 'LIS', name: 'Sintra (via Lisbon)' },
  'cascais': { code: 'LIS', name: 'Cascais (via Lisbon)' },
  'estoril': { code: 'LIS', name: 'Estoril (via Lisbon)' },
  'algarve': { code: 'FAO', name: 'Algarve (Faro)' },
  'lagos portugal': { code: 'FAO', name: 'Lagos (Algarve, via Faro)' },
  'albufeira': { code: 'FAO', name: 'Albufeira (via Faro)' },
  'vilamoura': { code: 'FAO', name: 'Vilamoura (via Faro)' },
  'coimbra': { code: 'OPO', name: 'Coimbra (via Porto)' },
  'braga': { code: 'OPO', name: 'Braga (via Porto)' },
  'evora': { code: 'LIS', name: 'Évora (via Lisbon)' },
  'évora': { code: 'LIS', name: 'Évora (via Lisbon)' },
  'obidos': { code: 'LIS', name: 'Óbidos (via Lisbon)' },
  'parigi': { code: 'CDG', name: 'Paris' },
  'parijs': { code: 'CDG', name: 'Paris' },
  'paryz': { code: 'CDG', name: 'Paris' },
  'paryż': { code: 'CDG', name: 'Paris' },
  'paryza': { code: 'CDG', name: 'Paris' },            // PL genitive (accent-stripped)
  'paryżu': { code: 'CDG', name: 'Paris' },            // PL locative
  'nice': { code: 'NCE', name: 'Nice' },
  // ── French Riviera (all served by Nice NCE) ───────────────────────────────
  'saint tropez': { code: 'NCE', name: 'Saint-Tropez (via Nice)' },
  'saint-tropez': { code: 'NCE', name: 'Saint-Tropez (via Nice)' },
  'st tropez': { code: 'NCE', name: 'Saint-Tropez (via Nice)' },
  'st-tropez': { code: 'NCE', name: 'Saint-Tropez (via Nice)' },
  'cannes': { code: 'NCE', name: 'Cannes (via Nice)' },
  'antibes': { code: 'NCE', name: 'Antibes (via Nice)' },
  'monaco': { code: 'NCE', name: 'Monaco (via Nice)' },
  'monte carlo': { code: 'NCE', name: 'Monte Carlo (via Nice)' },
  'monte-carlo': { code: 'NCE', name: 'Monte Carlo (via Nice)' },
  'menton': { code: 'NCE', name: 'Menton (via Nice)' },
  'grasse': { code: 'NCE', name: 'Grasse (via Nice)' },
  'french riviera': { code: 'NCE', name: 'French Riviera (Nice)' },
  'cote d azur': { code: 'NCE', name: 'Côte d\'Azur (Nice)' },
  'côte d azur': { code: 'NCE', name: 'Côte d\'Azur (Nice)' },
  // ── More French cities ────────────────────────────────────────────────────
  'marseille': { code: 'MRS', name: 'Marseille' },
  'toulon': { code: 'TLN', name: 'Toulon' },
  'lyon': { code: 'LYS', name: 'Lyon' },
  'bordeaux': { code: 'BOD', name: 'Bordeaux' },
  'bod': { code: 'BOD', name: 'Bordeaux' },
  'toulouse': { code: 'TLS', name: 'Toulouse' },
  'tls': { code: 'TLS', name: 'Toulouse' },
  'montpellier': { code: 'MPL', name: 'Montpellier' },
  'mpl': { code: 'MPL', name: 'Montpellier' },
  'nantes': { code: 'NTE', name: 'Nantes' },
  'nte': { code: 'NTE', name: 'Nantes' },
  'rennes': { code: 'RNS', name: 'Rennes' },
  'rns': { code: 'RNS', name: 'Rennes' },
  'brest': { code: 'BES', name: 'Brest (France)' },
  'bes': { code: 'BES', name: 'Brest' },
  'perpignan': { code: 'PGF', name: 'Perpignan' },
  'pgf': { code: 'PGF', name: 'Perpignan' },
  'grenoble': { code: 'GNB', name: 'Grenoble' },
  'gnb': { code: 'GNB', name: 'Grenoble' },
  'dijon': { code: 'DIJ', name: 'Dijon' },
  'dij': { code: 'DIJ', name: 'Dijon' },
  'clermont ferrand': { code: 'CFE', name: 'Clermont-Ferrand' },
  'clermont-ferrand': { code: 'CFE', name: 'Clermont-Ferrand' },
  'pau': { code: 'PUF', name: 'Pau' },
  'puf': { code: 'PUF', name: 'Pau' },
  'biarritz': { code: 'BIQ', name: 'Biarritz' },
  'biq': { code: 'BIQ', name: 'Biarritz' },
  'saint jean de luz': { code: 'BIQ', name: 'Saint-Jean-de-Luz (via Biarritz)' },
  'bayonne': { code: 'BIQ', name: 'Bayonne (via Biarritz)' },
  'limoges': { code: 'LIG', name: 'Limoges' },
  'lig': { code: 'LIG', name: 'Limoges' },
  'avignon': { code: 'MRS', name: 'Avignon (via Marseille)' },
  'arles': { code: 'MRS', name: 'Arles (via Marseille)' },
  'aix en provence': { code: 'MRS', name: 'Aix-en-Provence (via Marseille)' },
  'strasbourg': { code: 'SXB', name: 'Strasbourg' },
  'sxb': { code: 'SXB', name: 'Strasbourg' },
  'colmar': { code: 'SXB', name: 'Colmar (Alsace, via Strasbourg)' },
  'alsace': { code: 'SXB', name: 'Alsace (via Strasbourg)' },
  'metz': { code: 'ETZ', name: 'Metz' },
  'lourdes': { code: 'LDE', name: 'Lourdes (Tarbes-Lourdes)' },
  'lde': { code: 'LDE', name: 'Lourdes' },
  'tarbes': { code: 'LDE', name: 'Tarbes (via Lourdes)' },
  'dordogne': { code: 'BOD', name: 'Dordogne (via Bordeaux)' },
  'perigord': { code: 'BOD', name: 'Périgord (via Bordeaux)' },
  'loire valley': { code: 'NTE', name: 'Loire Valley (via Nantes)' },
  'loire': { code: 'NTE', name: 'Loire Valley (via Nantes)' },
  'normandy': { code: 'ORY', name: 'Normandy (via Paris)' },
  'normandie': { code: 'ORY', name: 'Normandy (via Paris)' },
  'mont saint michel': { code: 'RNS', name: 'Mont Saint-Michel (via Rennes)' },
  'mont-saint-michel': { code: 'RNS', name: 'Mont Saint-Michel (via Rennes)' },
  'brittany': { code: 'BES', name: 'Brittany (via Brest)' },
  'bretagne': { code: 'BES', name: 'Brittany (via Brest)' },
  // ── Corsica ───────────────────────────────────────────────────────────────
  'corsica': { code: 'AJA', name: 'Corsica (Ajaccio)' },
  'ajaccio': { code: 'AJA', name: 'Ajaccio' },
  'aja': { code: 'AJA', name: 'Ajaccio' },
  'bastia': { code: 'BIA', name: 'Bastia' },
  'bia': { code: 'BIA', name: 'Bastia' },
  'calvi': { code: 'CLY', name: 'Calvi (Corsica)' },
  'cly': { code: 'CLY', name: 'Calvi' },
  // ── French Alps / ski resorts (served by Chambéry CMF or Geneva GVA) ─────
  'chamonix': { code: 'GVA', name: 'Chamonix (via Geneva)' },
  'courchevel': { code: 'CMF', name: 'Courchevel (via Chambéry)' },
  'chambery': { code: 'CMF', name: 'Chambéry' },
  'chambéry': { code: 'CMF', name: 'Chambéry' },
  'val d isere': { code: 'CMF', name: 'Val d\'Isère (via Chambéry)' },
  "val d'isere": { code: 'CMF', name: 'Val d\'Isère (via Chambéry)' },
  'val disere': { code: 'CMF', name: 'Val d\'Isère (via Chambéry)' },
  'meribel': { code: 'CMF', name: 'Méribel (via Chambéry)' },
  'méribel': { code: 'CMF', name: 'Méribel (via Chambéry)' },
  'tignes': { code: 'CMF', name: 'Tignes (via Chambéry)' },
  'les arcs': { code: 'CMF', name: 'Les Arcs (via Chambéry)' },
  'megeve': { code: 'GVA', name: 'Megève (via Geneva)' },
  'mégève': { code: 'GVA', name: 'Megève (via Geneva)' },
  'alpe d huez': { code: 'GNB', name: 'Alpe d\'Huez (via Grenoble)' },
  "alpe d'huez": { code: 'GNB', name: 'Alpe d\'Huez (via Grenoble)' },
  'les deux alpes': { code: 'GNB', name: 'Les Deux Alpes (via Grenoble)' },
  'amsterdam': { code: 'AMS', name: 'Amsterdam' },
  'amsterdamu': { code: 'AMS', name: 'Amsterdam' },    // PL genitive
  'rotterdam': { code: 'RTM', name: 'Rotterdam' },
  'eindhoven': { code: 'EIN', name: 'Eindhoven' },
  'brussels': { code: 'BRU', name: 'Brussels' },
  'brussel': { code: 'BRU', name: 'Brussels' },
  'bruxelles': { code: 'BRU', name: 'Brussels' },
  'brüssel': { code: 'BRU', name: 'Brussels' },
  'bruselas': { code: 'BRU', name: 'Brussels' },
  'bruxelas': { code: 'BRU', name: 'Brussels' },        // PT
  'bryssel': { code: 'BRU', name: 'Brussels' },         // SV
  'brisel': { code: 'BRU', name: 'Brussels' },          // HR (informal)
  'bruksel': { code: 'BRU', name: 'Brussels' },         // SQ
  'lisbon': { code: 'LIS', name: 'Lisbon' },
  'lisbonne': { code: 'LIS', name: 'Lisbon' },
  'lissabon': { code: 'LIS', name: 'Lisbon' },
  'lisbona': { code: 'LIS', name: 'Lisbon' },
  'lisboa': { code: 'LIS', name: 'Lisbon' },            // PT
  'lisabon': { code: 'LIS', name: 'Lisbon' },           // HR
  'porto': { code: 'OPO', name: 'Porto' },
  'faro': { code: 'FAO', name: 'Faro' },
  'funchal': { code: 'FNC', name: 'Funchal (Madeira)' },
  'madeira': { code: 'FNC', name: 'Funchal (Madeira)' },
  'ponta delgada': { code: 'PDL', name: 'Ponta Delgada (Azores)' },
  'azores': { code: 'PDL', name: 'Ponta Delgada (Azores)' },
  // ── Central Europe ──────────────────────────────────────────────────────────
  'berlin': { code: 'BER', name: 'Berlin' },
  'berlino': { code: 'BER', name: 'Berlin' },           // IT
  'berlim': { code: 'BER', name: 'Berlin' },            // PT
  'munich': { code: 'MUC', name: 'Munich' },
  'munchen': { code: 'MUC', name: 'Munich' },
  'münchen': { code: 'MUC', name: 'Munich' },
  'monachium': { code: 'MUC', name: 'Munich' },         // PL
  'munique': { code: 'MUC', name: 'Munich' },           // PT
  'monaco di baviera': { code: 'MUC', name: 'Munich' }, // IT
  'frankfurt': { code: 'FRA', name: 'Frankfurt' },
  'francoforte': { code: 'FRA', name: 'Frankfurt' },    // IT
  'hamburgo': { code: 'HAM', name: 'Hamburg' },         // ES/PT
  'amburgo': { code: 'HAM', name: 'Hamburg' },          // IT
  'hamburg': { code: 'HAM', name: 'Hamburg' },
  'dusseldorf': { code: 'DUS', name: 'Düsseldorf' },
  'düsseldorf': { code: 'DUS', name: 'Düsseldorf' },
  'cologne': { code: 'CGN', name: 'Cologne' },
  'koln': { code: 'CGN', name: 'Cologne' },
  'köln': { code: 'CGN', name: 'Cologne' },
  'stuttgart': { code: 'STR', name: 'Stuttgart' },
  'nuremberg': { code: 'NUE', name: 'Nuremberg' },
  'nürnberg': { code: 'NUE', name: 'Nuremberg' },
  'vienna': { code: 'VIE', name: 'Vienna' },
  'wien': { code: 'VIE', name: 'Vienna' },
  'vienne': { code: 'VIE', name: 'Vienna' },
  'viena': { code: 'VIE', name: 'Vienna' },             // ES/PT
  'wenen': { code: 'VIE', name: 'Vienna' },             // NL
  'bec': { code: 'VIE', name: 'Vienna' },               // HR (Beč stripped)
  'vjene': { code: 'VIE', name: 'Vienna' },             // SQ (Vjenë stripped)
  'innsbruck': { code: 'INN', name: 'Innsbruck' },
  'inn': { code: 'INN', name: 'Innsbruck' },
  // ── Austrian ski resorts (all via Innsbruck or Salzburg) ─────────────────────
  'kitzbühel': { code: 'INN', name: 'Kitzbühel (via Innsbruck)' },
  'kitzbuhel': { code: 'INN', name: 'Kitzbühel (via Innsbruck)' },
  'st anton': { code: 'INN', name: 'St Anton am Arlberg (via Innsbruck)' },
  'st. anton': { code: 'INN', name: 'St Anton (via Innsbruck)' },
  'saint anton': { code: 'INN', name: 'St Anton (via Innsbruck)' },
  'lech': { code: 'INN', name: 'Lech am Arlberg (via Innsbruck)' },
  'lech am arlberg': { code: 'INN', name: 'Lech (via Innsbruck)' },
  'zürs': { code: 'INN', name: 'Zürs (via Innsbruck)' },
  'zurs': { code: 'INN', name: 'Zürs (via Innsbruck)' },
  'ischgl': { code: 'INN', name: 'Ischgl (via Innsbruck)' },
  'sölden': { code: 'INN', name: 'Sölden (via Innsbruck)' },
  'solden': { code: 'INN', name: 'Sölden (via Innsbruck)' },
  'mayrhofen': { code: 'INN', name: 'Mayrhofen (via Innsbruck)' },
  'stubai': { code: 'INN', name: 'Stubaital (via Innsbruck)' },
  'seefeld': { code: 'INN', name: 'Seefeld (via Innsbruck)' },
  'bad gastein': { code: 'SZG', name: 'Bad Gastein (via Salzburg)' },
  'gastein': { code: 'SZG', name: 'Bad Gastein (via Salzburg)' },
  'zell am see': { code: 'SZG', name: 'Zell am See (via Salzburg)' },
  'kaprun': { code: 'SZG', name: 'Kaprun (via Salzburg)' },
  'saalbach': { code: 'SZG', name: 'Saalbach (via Salzburg)' },
  'schladming': { code: 'GRZ', name: 'Schladming (via Graz)' },
  'obertauern': { code: 'SZG', name: 'Obertauern (via Salzburg)' },
  'salzburg': { code: 'SZG', name: 'Salzburg' },
  'szg': { code: 'SZG', name: 'Salzburg' },
  'graz': { code: 'GRZ', name: 'Graz' },
  'grz': { code: 'GRZ', name: 'Graz' },
  'klagenfurt': { code: 'KLU', name: 'Klagenfurt' },
  'klu': { code: 'KLU', name: 'Klagenfurt' },
  'linz': { code: 'LNZ', name: 'Linz' },
  'lnz': { code: 'LNZ', name: 'Linz' },
  'zurich': { code: 'ZRH', name: 'Zurich' },
  'zürich': { code: 'ZRH', name: 'Zurich' },
  'zermatt': { code: 'GVA', name: 'Zermatt (via Geneva)' },
  'verbier': { code: 'GVA', name: 'Verbier (via Geneva)' },
  'st moritz': { code: 'ZRH', name: 'St Moritz (via Zurich)' },
  'saint moritz': { code: 'ZRH', name: 'St Moritz (via Zurich)' },
  'davos': { code: 'ZRH', name: 'Davos (via Zurich)' },
  'interlaken': { code: 'BRN', name: 'Interlaken (via Berne)' },
  'lugano': { code: 'LUG', name: 'Lugano' },
  'bern': { code: 'BRN', name: 'Bern' },
  'berne': { code: 'BRN', name: 'Bern' },
  'lausanne': { code: 'GVA', name: 'Lausanne (via Geneva)' },
  'geneva': { code: 'GVA', name: 'Geneva' },
  'geneve': { code: 'GVA', name: 'Geneva' },
  'genf': { code: 'GVA', name: 'Geneva' },
  'basel': { code: 'BSL', name: 'Basel' },
  'prague': { code: 'PRG', name: 'Prague' },
  'praha': { code: 'PRG', name: 'Prague' },
  'prag': { code: 'PRG', name: 'Prague' },
  'praga': { code: 'PRG', name: 'Prague' },
  'pragi': { code: 'PRG', name: 'Prague' },            // PL genitive
  'praag': { code: 'PRG', name: 'Prague' },             // NL
  'praze': { code: 'PRG', name: 'Prague' },             // CZ locative
  'prahu': { code: 'PRG', name: 'Prague' },             // CZ accusative
  'rzym': { code: 'FCO', name: 'Rome' },               // PL
  'rzymu': { code: 'FCO', name: 'Rome' },              // PL genitive
  'wiedeń': { code: 'VIE', name: 'Vienna' },           // PL
  'wiednia': { code: 'VIE', name: 'Vienna' },          // PL genitive
  'stambuł': { code: 'IST', name: 'Istanbul' },        // PL
  'stambulu': { code: 'IST', name: 'Istanbul' },       // PL genitive
  'ateny': { code: 'ATH', name: 'Athens' },            // PL
  'aten': { code: 'ATH', name: 'Athens' },             // PL genitive
  'lizbona': { code: 'LIS', name: 'Lisbon' },          // PL
  'lizbony': { code: 'LIS', name: 'Lisbon' },          // PL genitive
  'bruksela': { code: 'BRU', name: 'Brussels' },       // PL
  'brukseli': { code: 'BRU', name: 'Brussels' },       // PL genitive
  'kopenhaga': { code: 'CPH', name: 'Copenhagen' },    // PL
  'kopenhagi': { code: 'CPH', name: 'Copenhagen' },    // PL genitive
  'sztokholm': { code: 'ARN', name: 'Stockholm' },     // PL
  'sztokholmu': { code: 'ARN', name: 'Stockholm' },    // PL genitive
  'dubaj': { code: 'DXB', name: 'Dubai' },             // PL
  'dubaju': { code: 'DXB', name: 'Dubai' },            // PL genitive
  'nowy jork': { code: 'JFK', name: 'New York' },      // PL
  'nowego jorku': { code: 'JFK', name: 'New York' },   // PL genitive
  'nueva york': { code: 'JFK', name: 'New York' },      // ES
  'nova york': { code: 'JFK', name: 'New York' },       // PT
  'nova iorque': { code: 'JFK', name: 'New York' },     // PT alternate
  'budapest': { code: 'BUD', name: 'Budapest' },
  'budimpesta': { code: 'BUD', name: 'Budapest' },      // HR (Budimpešta stripped)
  'budapeszt': { code: 'BUD', name: 'Budapest' },       // PL
  'budapeste': { code: 'BUD', name: 'Budapest' },       // PT
  'bratislava': { code: 'BTS', name: 'Bratislava' },
  'bratislawa': { code: 'BTS', name: 'Bratislava' },
  'pressburg': { code: 'BTS', name: 'Bratislava' },
  'warsaw': { code: 'WAW', name: 'Warsaw' },
  'warsawa': { code: 'WAW', name: 'Warsaw' },
  'warszawa': { code: 'WAW', name: 'Warsaw' },
  'warschau': { code: 'WAW', name: 'Warsaw' },
  'varsovie': { code: 'WAW', name: 'Warsaw' },
  'varsovia': { code: 'WAW', name: 'Warsaw' },
  'varsavia': { code: 'WAW', name: 'Warsaw' },
  'krakow': { code: 'KRK', name: 'Kraków' },
  'krakau': { code: 'KRK', name: 'Kraków' },
  'cracow': { code: 'KRK', name: 'Kraków' },
  'cracovie': { code: 'KRK', name: 'Kraków' },
  'gdansk': { code: 'GDN', name: 'Gdańsk' },
  'gdańsk': { code: 'GDN', name: 'Gdańsk' },
  'danzig': { code: 'GDN', name: 'Gdańsk' },
  'gdn': { code: 'GDN', name: 'Gdańsk' },
  'sopot': { code: 'GDN', name: 'Sopot (via Gdańsk)' },
  'gdynia': { code: 'GDN', name: 'Gdynia (via Gdańsk)' },
  'tri-city': { code: 'GDN', name: 'Tri-City (Gdańsk/Gdynia/Sopot)' },
  'tricity': { code: 'GDN', name: 'Tri-City Poland' },
  'wroclaw': { code: 'WRO', name: 'Wrocław' },
  'wrocław': { code: 'WRO', name: 'Wrocław' },
  'breslau': { code: 'WRO', name: 'Wrocław' },
  'wro': { code: 'WRO', name: 'Wrocław' },
  'poznan': { code: 'POZ', name: 'Poznań' },
  'poznań': { code: 'POZ', name: 'Poznań' },
  'posen': { code: 'POZ', name: 'Poznań' },
  'poz': { code: 'POZ', name: 'Poznań' },
  'szczecin': { code: 'SZZ', name: 'Szczecin' },
  'stettin': { code: 'SZZ', name: 'Szczecin' },
  'szz': { code: 'SZZ', name: 'Szczecin' },
  'lodz': { code: 'LCJ', name: 'Łódź' },
  'łódź': { code: 'LCJ', name: 'Łódź' },
  'lcj': { code: 'LCJ', name: 'Łódź' },
  'katowice': { code: 'KTW', name: 'Katowice' },
  'ktw': { code: 'KTW', name: 'Katowice' },
  'bielsko biala': { code: 'KTW', name: 'Bielsko-Biała (via Katowice)' },
  'rzeszow': { code: 'RZE', name: 'Rzeszów' },
  'rzeszów': { code: 'RZE', name: 'Rzeszów' },
  'rze': { code: 'RZE', name: 'Rzeszów' },
  'lublin': { code: 'LUZ', name: 'Lublin' },
  'luz': { code: 'LUZ', name: 'Lublin' },
  'bialystok': { code: 'BQS', name: 'Białystok' },
  'białystok': { code: 'BQS', name: 'Białystok' },
  'torun': { code: 'BZG', name: 'Toruń (via Bydgoszcz)' },
  'toruń': { code: 'BZG', name: 'Toruń (via Bydgoszcz)' },
  'bydgoszcz': { code: 'BZG', name: 'Bydgoszcz' },
  'bzg': { code: 'BZG', name: 'Bydgoszcz' },
  'zakopane': { code: 'KRK', name: 'Zakopane (via Kraków)' },
  'tatry': { code: 'KRK', name: 'Tatra Mountains (via Kraków)' },
  'tatra mountains': { code: 'KRK', name: 'Tatra Mountains (via Kraków)' },
  'wieliczka': { code: 'KRK', name: 'Wieliczka Salt Mine (via Kraków)' },
  'auschwitz': { code: 'KRK', name: 'Auschwitz / Oświęcim (via Kraków)' },
  'oswiecim': { code: 'KRK', name: 'Oświęcim (via Kraków)' },
  'mazury': { code: 'SZY', name: 'Mazury Lakes (Szymany)' },
  'masuria': { code: 'SZY', name: 'Masuria (Szymany)' },
  'szy': { code: 'SZY', name: 'Szymany (Mazury)' },
  // ── Scandinavia & Baltics ────────────────────────────────────────────────────
  'stockholm': { code: 'ARN', name: 'Stockholm' },
  'estocolmo': { code: 'ARN', name: 'Stockholm' },      // ES/PT
  'stoccolma': { code: 'ARN', name: 'Stockholm' },      // IT
  'arlanda': { code: 'ARN', name: 'Stockholm-Arlanda Airport' },
  'arl': { code: 'ARN', name: 'Stockholm-Arlanda Airport' },
  'goteborg': { code: 'GOT', name: 'Gothenburg' },
  'göteborg': { code: 'GOT', name: 'Gothenburg' },
  'gothenburg': { code: 'GOT', name: 'Gothenburg' },
  'malmo': { code: 'MMX', name: 'Malmö' },
  'malmö': { code: 'MMX', name: 'Malmö' },
  'oslo': { code: 'OSL', name: 'Oslo' },
  'bergen': { code: 'BGO', name: 'Bergen' },
  'bgo': { code: 'BGO', name: 'Bergen' },
  'trondheim': { code: 'TRD', name: 'Trondheim' },
  'trd': { code: 'TRD', name: 'Trondheim' },
  'stavanger': { code: 'SVG', name: 'Stavanger' },
  'svg': { code: 'SVG', name: 'Stavanger' },
  'tromso': { code: 'TOS', name: 'Tromsø' },
  'tromsø': { code: 'TOS', name: 'Tromsø' },
  'tos': { code: 'TOS', name: 'Tromsø' },
  'bodo': { code: 'BOO', name: 'Bodø' },
  'bodø': { code: 'BOO', name: 'Bodø' },
  'boo': { code: 'BOO', name: 'Bodø' },
  // ── Norwegian fjord destinations ───────────────────────────────────────────
  'lofoten': { code: 'SVJ', name: 'Lofoten (Svolvær)' },
  'svolvær': { code: 'SVJ', name: 'Svolvær (Lofoten)' },
  'svj': { code: 'SVJ', name: 'Lofoten' },
  'ålesund': { code: 'AES', name: 'Ålesund (Geiranger gateway)' },
  'alesund': { code: 'AES', name: 'Ålesund' },
  'aes': { code: 'AES', name: 'Ålesund' },
  'geiranger': { code: 'AES', name: 'Geiranger (via Ålesund)' },
  'flam': { code: 'BGO', name: 'Flåm (via Bergen)' },
  'flåm': { code: 'BGO', name: 'Flåm (via Bergen)' },
  'hardangerfjord': { code: 'BGO', name: 'Hardangerfjord (via Bergen)' },
  'sognefjord': { code: 'BGO', name: 'Sognefjord (via Bergen)' },
  'preikestolen': { code: 'SVG', name: 'Preikestolen (via Stavanger)' },
  'pulpit rock': { code: 'SVG', name: 'Pulpit Rock (via Stavanger)' },
  'longyearbyen': { code: 'LYR', name: 'Longyearbyen (Svalbard)' },
  'svalbard': { code: 'LYR', name: 'Svalbard' },
  'lyr': { code: 'LYR', name: 'Svalbard' },
  'copenhagen': { code: 'CPH', name: 'Copenhagen' },
  'kobenhavn': { code: 'CPH', name: 'Copenhagen' },
  'københavn': { code: 'CPH', name: 'Copenhagen' },
  'kopenhagen': { code: 'CPH', name: 'Copenhagen' },
  'copenhague': { code: 'CPH', name: 'Copenhagen' },    // FR/ES/PT
  'copenaghen': { code: 'CPH', name: 'Copenhagen' },   // IT
  'kopenhamn': { code: 'CPH', name: 'Copenhagen' },    // SV (Köpenhamn stripped)
  'aarhus': { code: 'AAR', name: 'Aarhus' },
  'aalborg': { code: 'AAL', name: 'Aalborg' },
  'odense': { code: 'ODE', name: 'Odense' },
  'helsinki': { code: 'HEL', name: 'Helsinki' },
  'tampere': { code: 'TMP', name: 'Tampere' },
  'turku': { code: 'TKU', name: 'Turku' },
  'oulu': { code: 'OUL', name: 'Oulu' },
  'riga': { code: 'RIX', name: 'Riga' },
  'tallinn': { code: 'TLL', name: 'Tallinn' },
  'vilnius': { code: 'VNO', name: 'Vilnius' },
  // ── Russia ──────────────────────────────────────────────────────────────────
  'moscow': { code: 'SVO', name: 'Moscow' },
  'moskau': { code: 'SVO', name: 'Moscow' },
  'moscou': { code: 'SVO', name: 'Moscow' },
  'mosca': { code: 'SVO', name: 'Moscow' },
  'moscu': { code: 'SVO', name: 'Moscow' },
  'moscú': { code: 'SVO', name: 'Moscow' },
  'moskwa': { code: 'SVO', name: 'Moscow' },            // PL
  'moskva': { code: 'SVO', name: 'Moscow' },            // SV/HR/RU romanized
  'moszkva': { code: 'SVO', name: 'Moscow' },           // HU
  'saint petersburg': { code: 'LED', name: 'Saint Petersburg' },
  'st petersburg': { code: 'LED', name: 'Saint Petersburg' },
  'st. petersburg': { code: 'LED', name: 'Saint Petersburg' },
  // ── Southern Europe ──────────────────────────────────────────────────────────
  'rome': { code: 'FCO', name: 'Rome' },
  'roma': { code: 'FCO', name: 'Rome' },
  'rom': { code: 'FCO', name: 'Rome' },
  'rim': { code: 'FCO', name: 'Rome' },                 // HR
  'milan': { code: 'MXP', name: 'Milan' },
  'milano': { code: 'MXP', name: 'Milan' },
  'mailand': { code: 'MXP', name: 'Milan' },
  'mediolan': { code: 'MXP', name: 'Milan' },
  'milaan': { code: 'MXP', name: 'Milan' },             // NL
  'milao': { code: 'MXP', name: 'Milan' },              // PT
  'mediolanu': { code: 'MXP', name: 'Milan' },          // PL genitive
  'naples': { code: 'NAP', name: 'Naples' },
  'napoli': { code: 'NAP', name: 'Naples' },
  'neapel': { code: 'NAP', name: 'Naples' },
  'napels': { code: 'NAP', name: 'Naples' },            // NL
  'neapol': { code: 'NAP', name: 'Naples' },            // PL
  'neapolu': { code: 'NAP', name: 'Naples' },           // PL genitive
  'napulj': { code: 'NAP', name: 'Naples' },            // HR
  'napoles': { code: 'NAP', name: 'Naples' },           // ES/PT
  'amalfi': { code: 'NAP', name: 'Amalfi (via Naples)' },
  'positano': { code: 'NAP', name: 'Positano (via Naples)' },
  'sorrento': { code: 'NAP', name: 'Sorrento (via Naples)' },
  'pompei': { code: 'NAP', name: 'Pompeii (via Naples)' },
  'pompeii': { code: 'NAP', name: 'Pompeii (via Naples)' },
  'venice': { code: 'VCE', name: 'Venice' },
  'venezia': { code: 'VCE', name: 'Venice' },
  'venedig': { code: 'VCE', name: 'Venice' },
  'venise': { code: 'VCE', name: 'Venice' },
  'venecia': { code: 'VCE', name: 'Venice' },           // ES/SQ
  'venetie': { code: 'VCE', name: 'Venice' },           // NL
  'veneza': { code: 'VCE', name: 'Venice' },            // PT
  'wenecja': { code: 'VCE', name: 'Venice' },           // PL
  'wenecji': { code: 'VCE', name: 'Venice' },           // PL gen/loc
  'venecija': { code: 'VCE', name: 'Venice' },          // HR
  'florence': { code: 'FLR', name: 'Florence' },
  'firenze': { code: 'FLR', name: 'Florence' },
  'florenz': { code: 'FLR', name: 'Florence' },
  'florencia': { code: 'FLR', name: 'Florence' },       // ES
  'florenca': { code: 'FLR', name: 'Florence' },        // PT
  'florencja': { code: 'FLR', name: 'Florence' },       // PL
  'florencji': { code: 'FLR', name: 'Florence' },       // PL gen/loc
  'firenca': { code: 'FLR', name: 'Florence' },         // HR
  'pisa': { code: 'PSA', name: 'Pisa' },
  'cinque terre': { code: 'PSA', name: 'Cinque Terre (via Pisa)' },
  'bologna': { code: 'BLQ', name: 'Bologna' },
  'rimini': { code: 'RMI', name: 'Rimini' },
  'verona': { code: 'VRN', name: 'Verona' },
  'vrn': { code: 'VRN', name: 'Verona' },
  // ── Italian Lakes & north-Italy tourist spots ─────────────────────────────
  'lake como': { code: 'BGY', name: 'Lake Como (via Bergamo/Milan)' },
  'como': { code: 'BGY', name: 'Como (Lake Como, via Bergamo)' },
  'bellagio': { code: 'BGY', name: 'Bellagio (Lake Como, via Bergamo)' },
  'lake maggiore': { code: 'MXP', name: 'Lake Maggiore (via Milan)' },
  'stresa': { code: 'MXP', name: 'Stresa (Lake Maggiore, via Milan)' },
  'lake garda': { code: 'VRN', name: 'Lake Garda (via Verona)' },
  'sirmione': { code: 'VRN', name: 'Sirmione (Lake Garda, via Verona)' },
  'gardone': { code: 'VRN', name: 'Gardone Riviera (via Verona)' },
  'riva del garda': { code: 'VRN', name: 'Riva del Garda (via Verona)' },
  'dolomites': { code: 'VCE', name: 'Dolomites (via Venice)' },
  'cortina': { code: 'VCE', name: "Cortina d'Ampezzo (via Venice)" },
  // ── Italian Tuscany / Umbria spots ────────────────────────────────────────
  'siena': { code: 'FLR', name: 'Siena (via Florence)' },
  'san gimignano': { code: 'FLR', name: 'San Gimignano (via Florence)' },
  'tuscany': { code: 'FLR', name: 'Tuscany (Florence)' },
  'toscana': { code: 'FLR', name: 'Tuscany (Florence)' },
  'chianti': { code: 'FLR', name: 'Chianti (via Florence)' },
  'umbria': { code: 'FCO', name: 'Umbria (via Rome)' },
  'assisi': { code: 'FCO', name: 'Assisi (via Rome/Perugia)' },
  'perugia': { code: 'PEG', name: 'Perugia' },
  'peg': { code: 'PEG', name: 'Perugia' },
  'spoleto': { code: 'FCO', name: 'Spoleto (via Rome)' },
  'orvieto': { code: 'FCO', name: 'Orvieto (via Rome)' },
  'lucca': { code: 'PSA', name: 'Lucca (via Pisa)' },
  'elba': { code: 'PSA', name: 'Elba Island (via Pisa)' },
  'isle of elba': { code: 'PSA', name: 'Elba Island (via Pisa)' },
  // ── Italian south / heritage ─────────────────────────────────────────────
  'capri': { code: 'NAP', name: 'Capri (via Naples)' },
  'ravello': { code: 'NAP', name: 'Ravello (via Naples)' },
  'matera': { code: 'BRI', name: 'Matera (via Bari)' },
  'alberobello': { code: 'BRI', name: 'Alberobello / Trulli (via Bari)' },
  'lecce': { code: 'BDS', name: 'Lecce (via Brindisi)' },
  'otranto': { code: 'BDS', name: 'Otranto (via Brindisi)' },
  'bergamo': { code: 'BGY', name: 'Bergamo (Milan Orio al Serio)' },
  'bgy': { code: 'BGY', name: 'Bergamo' },
  'orio al serio': { code: 'BGY', name: 'Bergamo' },
  'turin': { code: 'TRN', name: 'Turin' },
  'torino': { code: 'TRN', name: 'Turin' },
  'genoa': { code: 'GOA', name: 'Genoa' },
  'genova': { code: 'GOA', name: 'Genoa' },
  'genua': { code: 'GOA', name: 'Genoa' },
  'portofino': { code: 'GOA', name: 'Portofino (via Genoa)' },
  'trieste': { code: 'TRS', name: 'Trieste' },
  'ancona': { code: 'AOI', name: 'Ancona' },
  'pescara': { code: 'PSR', name: 'Pescara' },
  'bari': { code: 'BRI', name: 'Bari' },
  'brindisi': { code: 'BDS', name: 'Brindisi' },
  'lamezia': { code: 'SUF', name: 'Lamezia Terme' },
  'lamezia terme': { code: 'SUF', name: 'Lamezia Terme' },
  'catania': { code: 'CTA', name: 'Catania' },
  'palermo': { code: 'PMO', name: 'Palermo' },
  'sicily': { code: 'CTA', name: 'Sicily (Catania)' },
  'sicilia': { code: 'CTA', name: 'Sicily (Catania)' },
  'sardinia': { code: 'CAG', name: 'Sardinia (Cagliari)' },
  'sardegna': { code: 'CAG', name: 'Sardinia' },
  'cagliari': { code: 'CAG', name: 'Cagliari' },
  'olbia': { code: 'OLB', name: 'Olbia (Sardinia)' },
  'alghero': { code: 'AHO', name: 'Alghero (Sardinia)' },
  'athens': { code: 'ATH', name: 'Athens' },
  'athen': { code: 'ATH', name: 'Athens' },
  'athenes': { code: 'ATH', name: 'Athens' },
  'atenas': { code: 'ATH', name: 'Athens' },            // ES/PT
  'atene': { code: 'ATH', name: 'Athens' },             // IT
  'athene': { code: 'ATH', name: 'Athens' },            // NL
  'atena': { code: 'ATH', name: 'Athens' },             // HR
  'athine': { code: 'ATH', name: 'Athens' },            // SQ (Athinë stripped)
  'thessaloniki': { code: 'SKG', name: 'Thessaloniki' },
  'heraklion': { code: 'HER', name: 'Heraklion (Crete)' },
  'crete': { code: 'HER', name: 'Heraklion (Crete)' },
  'santorini': { code: 'JTR', name: 'Santorini' },
  'mykonos': { code: 'JMK', name: 'Mykonos' },
  'rhodes': { code: 'RHO', name: 'Rhodes' },
  'corfu': { code: 'CFU', name: 'Corfu' },
  'zakynthos': { code: 'ZTH', name: 'Zakynthos (Zante)' },
  'zante': { code: 'ZTH', name: 'Zakynthos (Zante)' },
  'kos': { code: 'KGS', name: 'Kos' },
  'kefalonia': { code: 'EFL', name: 'Kefalonia' },
  'cephalonia': { code: 'EFL', name: 'Kefalonia' },
  'kefallinia': { code: 'EFL', name: 'Kefalonia' },
  'lesbos': { code: 'MJT', name: 'Lesbos (Mytilene)' },
  'mytilene': { code: 'MJT', name: 'Lesbos (Mytilene)' },
  'lesvos': { code: 'MJT', name: 'Lesbos (Mytilene)' },
  'skiathos': { code: 'JSI', name: 'Skiathos' },
  'samos': { code: 'SMI', name: 'Samos' },
  'chios': { code: 'JKH', name: 'Chios' },
  'kalamata': { code: 'KLX', name: 'Kalamata' },
  'kavala': { code: 'KVA', name: 'Kavala' },
  'lefkada': { code: 'PVK', name: 'Lefkada (via Preveza)' },
  'preveza': { code: 'PVK', name: 'Preveza / Lefkada' },
  'volos': { code: 'VOL', name: 'Volos' },
  'alexandroupolis': { code: 'AXD', name: 'Alexandroupolis' },
  'istanbul': { code: 'IST', name: 'Istanbul' },
  'estambul': { code: 'IST', name: 'Istanbul' },        // ES
  'istambul': { code: 'IST', name: 'Istanbul' },        // PT
  'stamboll': { code: 'IST', name: 'Istanbul' },        // SQ
  'ankara': { code: 'ESB', name: 'Ankara' },
  'antalya': { code: 'AYT', name: 'Antalya' },
  'izmir': { code: 'ADB', name: 'İzmir' },
  'bodrum': { code: 'BJV', name: 'Bodrum' },
  'dalaman': { code: 'DLM', name: 'Dalaman' },
  'marmaris': { code: 'DLM', name: 'Marmaris (via Dalaman)' },
  'fethiye': { code: 'DLM', name: 'Fethiye (via Dalaman)' },
  'oludeniz': { code: 'DLM', name: 'Ölüdeniz (via Dalaman)' },
  'alanya': { code: 'GZP', name: 'Alanya' },
  'gazipasa': { code: 'GZP', name: 'Alanya-Gazipaşa' },
  'cappadocia': { code: 'NAV', name: 'Cappadocia (Nevşehir)' },
  'kapadokya': { code: 'NAV', name: 'Cappadocia (Nevşehir)' },
  'goreme': { code: 'NAV', name: 'Göreme (Cappadocia)' },
  'nevsehir': { code: 'NAV', name: 'Nevşehir (Cappadocia)' },
  'nevşehir': { code: 'NAV', name: 'Nevşehir (Cappadocia)' },
  'kayseri': { code: 'ASR', name: 'Kayseri' },
  'trabzon': { code: 'TZX', name: 'Trabzon' },
  'denizli': { code: 'DNZ', name: 'Denizli' },
  'pamukkale': { code: 'DNZ', name: 'Pamukkale (via Denizli)' },
  'gaziantep': { code: 'GZT', name: 'Gaziantep' },
  'konya': { code: 'KYA', name: 'Konya' },
  'erzurum': { code: 'ERZ', name: 'Erzurum' },
  'samsun': { code: 'SZF', name: 'Samsun' },
  'belgrade': { code: 'BEG', name: 'Belgrade' },
  'beograd': { code: 'BEG', name: 'Belgrade' },
  'zagreb': { code: 'ZAG', name: 'Zagreb' },
  'agram': { code: 'ZAG', name: 'Zagreb' },
  'ljubljana': { code: 'LJU', name: 'Ljubljana' },
  'laibach': { code: 'LJU', name: 'Ljubljana' },
  'split': { code: 'SPU', name: 'Split' },
  'dubrovnik': { code: 'DBV', name: 'Dubrovnik' },
  'sarajevo': { code: 'SJJ', name: 'Sarajevo' },
  'podgorica': { code: 'TGD', name: 'Podgorica' },
  'tirana': { code: 'TIA', name: 'Tirana' },
  'tirane': { code: 'TIA', name: 'Tirana' },
  'skopje': { code: 'SKP', name: 'Skopje' },
  'sofia': { code: 'SOF', name: 'Sofia' },
  'varna': { code: 'VAR', name: 'Varna (Bulgaria)' },
  'burgas': { code: 'BOJ', name: 'Burgas (Bulgaria)' },
  'plovdiv': { code: 'PDV', name: 'Plovdiv' },
  'bucharest': { code: 'OTP', name: 'Bucharest' },
  'bukarest': { code: 'OTP', name: 'Bucharest' },
  'bucaresti': { code: 'OTP', name: 'Bucharest' },
  'timisoara': { code: 'TSR', name: 'Timișoara' },
  'cluj': { code: 'CLJ', name: 'Cluj-Napoca' },
  'pristina': { code: 'PRN', name: 'Pristina (Kosovo)' },
  'tivat': { code: 'TIV', name: 'Tivat (Montenegro)' },
  'kotor': { code: 'TIV', name: 'Kotor (via Tivat)' },
  'ohrid': { code: 'OHD', name: 'Ohrid (North Macedonia)' },
  'chisinau': { code: 'KIV', name: 'Chișinău' },
  'kyiv': { code: 'KBP', name: 'Kyiv' },
  'kiev': { code: 'KBP', name: 'Kyiv' },
  'lviv': { code: 'LWO', name: 'Lviv' },
  'lemberg': { code: 'LWO', name: 'Lviv' },
  'lwow': { code: 'LWO', name: 'Lviv' },
  'lwów': { code: 'LWO', name: 'Lviv' },
  'minsk': { code: 'MSQ', name: 'Minsk' },
  'valletta': { code: 'MLA', name: 'Malta' },
  'malta': { code: 'MLA', name: 'Malta' },
  'reykjavik': { code: 'KEF', name: 'Reykjavik' },
  'reykjavík': { code: 'KEF', name: 'Reykjavik' },
  'larnaca': { code: 'LCA', name: 'Larnaca (Cyprus)' },
  'nicosia': { code: 'LCA', name: 'Larnaca (Cyprus)' },
  // ── Middle East ──────────────────────────────────────────────────────────────
  'dubai': { code: 'DXB', name: 'Dubai' },
  'abu dhabi': { code: 'AUH', name: 'Abu Dhabi' },
  'sharjah': { code: 'SHJ', name: 'Sharjah' },
  'doha': { code: 'DOH', name: 'Doha' },
  'kuwait': { code: 'KWI', name: 'Kuwait City' },
  'kuwait city': { code: 'KWI', name: 'Kuwait City' },
  'muscat': { code: 'MCT', name: 'Muscat' },
  'bahrain': { code: 'BAH', name: 'Bahrain' },
  'riyadh': { code: 'RUH', name: 'Riyadh' },
  'ruh': { code: 'RUH', name: 'Riyadh' },
  'jeddah': { code: 'JED', name: 'Jeddah' },
  'jed': { code: 'JED', name: 'Jeddah' },
  'mecca': { code: 'JED', name: 'Jeddah (nearest to Mecca)' },
  'medina': { code: 'MED', name: 'Medina (Saudi Arabia)' },
  'med': { code: 'MED', name: 'Medina' },
  'dammam': { code: 'DMM', name: 'Dammam' },
  'dmm': { code: 'DMM', name: 'Dammam' },
  'amman': { code: 'AMM', name: 'Amman' },
  'amm': { code: 'AMM', name: 'Amman' },
  'aqaba': { code: 'AQJ', name: 'Aqaba (Jordan)' },
  'aqj': { code: 'AQJ', name: 'Aqaba' },
  'petra': { code: 'AQJ', name: 'Aqaba (nearest to Petra)' },
  'beirut': { code: 'BEY', name: 'Beirut' },
  'bey': { code: 'BEY', name: 'Beirut' },
  'tel aviv': { code: 'TLV', name: 'Tel Aviv' },
  'tlv': { code: 'TLV', name: 'Tel Aviv' },
  'jerusalem': { code: 'TLV', name: 'Tel Aviv' },
  'baghdad': { code: 'BGW', name: 'Baghdad' },
  'bgw': { code: 'BGW', name: 'Baghdad' },
  'erbil': { code: 'EBL', name: 'Erbil (Iraq)' },
  'ebl': { code: 'EBL', name: 'Erbil' },
  'tehran': { code: 'IKA', name: 'Tehran' },
  'ika': { code: 'IKA', name: 'Tehran' },
  'isfahan': { code: 'IFN', name: 'Isfahan' },
  'isfahan iran': { code: 'IFN', name: 'Isfahan' },
  'ifn': { code: 'IFN', name: 'Isfahan' },
  'shiraz': { code: 'SYZ', name: 'Shiraz' },
  'syz': { code: 'SYZ', name: 'Shiraz' },
  'mashhad': { code: 'MHD', name: 'Mashhad' },
  'mhd': { code: 'MHD', name: 'Mashhad' },
  'sana\'a': { code: 'SAH', name: "Sana'a (Yemen)" },
  'sanaa': { code: 'SAH', name: "Sana'a (Yemen)" },
  // ── Africa ───────────────────────────────────────────────────────────────────
  'cairo': { code: 'CAI', name: 'Cairo' },
  'kairo': { code: 'CAI', name: 'Cairo' },
  'kair': { code: 'CAI', name: 'Cairo' },               // PL
  'le caire': { code: 'CAI', name: 'Cairo' },           // FR
  'el cairo': { code: 'CAI', name: 'Cairo' },           // ES
  'il cairo': { code: 'CAI', name: 'Cairo' },           // IT
  'hurghada': { code: 'HRG', name: 'Hurghada' },
  'red sea': { code: 'HRG', name: 'Hurghada (Red Sea)' },
  'red sea coast': { code: 'HRG', name: 'Hurghada (Red Sea)' },
  'red sea riviera': { code: 'HRG', name: 'Hurghada (Red Sea)' },
  'marsa alam': { code: 'RMF', name: 'Marsa Alam' },
  'sharm el sheikh': { code: 'SSH', name: 'Sharm el-Sheikh' },
  'sharm el-sheikh': { code: 'SSH', name: 'Sharm el-Sheikh' },
  'sharm': { code: 'SSH', name: 'Sharm el-Sheikh' },
  'luxor': { code: 'LXR', name: 'Luxor' },
  'aswan': { code: 'ASW', name: 'Aswan' },
  'casablanca': { code: 'CMN', name: 'Casablanca' },
  'marrakech': { code: 'RAK', name: 'Marrakech' },
  'marrakesh': { code: 'RAK', name: 'Marrakech' },
  'agadir': { code: 'AGA', name: 'Agadir' },
  'fez': { code: 'FEZ', name: 'Fez' },
  'fes': { code: 'FEZ', name: 'Fez' },
  'tangier': { code: 'TNG', name: 'Tangier' },
  'tanger': { code: 'TNG', name: 'Tangier' },
  'rabat': { code: 'RBA', name: 'Rabat' },
  'essaouira': { code: 'ESU', name: 'Essaouira' },
  'tunis': { code: 'TUN', name: 'Tunis' },
  'djerba': { code: 'DJE', name: 'Djerba' },
  'jerba': { code: 'DJE', name: 'Djerba' },
  'monastir': { code: 'MIR', name: 'Monastir' },
  'sfax': { code: 'SFA', name: 'Sfax' },
  'algiers': { code: 'ALG', name: 'Algiers' },
  'tripoli': { code: 'TIP', name: 'Tripoli' },
  'nairobi': { code: 'NBO', name: 'Nairobi' },
  'nbo': { code: 'NBO', name: 'Nairobi' },
  'mombasa': { code: 'MBA', name: 'Mombasa' },
  'mba': { code: 'MBA', name: 'Mombasa' },
  'addis ababa': { code: 'ADD', name: 'Addis Ababa' },
  'add': { code: 'ADD', name: 'Addis Ababa' },
  'lagos': { code: 'LOS', name: 'Lagos' },
  'los nigeria': { code: 'LOS', name: 'Lagos' },
  'accra': { code: 'ACC', name: 'Accra' },
  'acc': { code: 'ACC', name: 'Accra' },
  'abuja': { code: 'ABV', name: 'Abuja' },
  'abv': { code: 'ABV', name: 'Abuja' },
  'dakar': { code: 'DSS', name: 'Dakar' },
  'dss': { code: 'DSS', name: 'Dakar' },
  'johannesburg': { code: 'JNB', name: 'Johannesburg' },
  'jo\'burg': { code: 'JNB', name: 'Johannesburg' },
  'joburg': { code: 'JNB', name: 'Johannesburg' },
  'jnb': { code: 'JNB', name: 'Johannesburg' },
  'cape town': { code: 'CPT', name: 'Cape Town' },
  'cpt': { code: 'CPT', name: 'Cape Town' },
  'durban': { code: 'DUR', name: 'Durban' },
  'dur': { code: 'DUR', name: 'Durban' },
  'dar es salaam': { code: 'DAR', name: 'Dar es Salaam' },
  'dar': { code: 'DAR', name: 'Dar es Salaam' },
  'zanzibar': { code: 'ZNZ', name: 'Zanzibar' },
  'znz': { code: 'ZNZ', name: 'Zanzibar' },
  'kampala': { code: 'EBB', name: 'Kampala' },
  'entebbe': { code: 'EBB', name: 'Kampala (Entebbe)' },
  'ebb': { code: 'EBB', name: 'Entebbe' },
  'kigali': { code: 'KGL', name: 'Kigali (Rwanda)' },
  'kgl': { code: 'KGL', name: 'Kigali' },
  'rwanda': { code: 'KGL', name: 'Kigali (Rwanda)' },
  'bujumbura': { code: 'BJM', name: 'Bujumbura' },
  'bjm': { code: 'BJM', name: 'Bujumbura' },
  'lusaka': { code: 'LUN', name: 'Lusaka (Zambia)' },
  'lun': { code: 'LUN', name: 'Lusaka' },
  'harare': { code: 'HRE', name: 'Harare (Zimbabwe)' },
  'hre': { code: 'HRE', name: 'Harare' },
  'gaborone': { code: 'GBE', name: 'Gaborone (Botswana)' },
  'gbe': { code: 'GBE', name: 'Gaborone' },
  'windhoek': { code: 'WDH', name: 'Windhoek (Namibia)' },
  'wdh': { code: 'WDH', name: 'Windhoek' },
  'luanda': { code: 'LAD', name: 'Luanda' },
  'lad': { code: 'LAD', name: 'Luanda' },
  'maputo': { code: 'MPM', name: 'Maputo' },
  'mpm': { code: 'MPM', name: 'Maputo' },
  'antananarivo': { code: 'TNR', name: 'Antananarivo (Madagascar)' },
  'madagascar': { code: 'TNR', name: 'Antananarivo (Madagascar)' },
  'tnr': { code: 'TNR', name: 'Antananarivo' },
  'abidjan': { code: 'ABJ', name: 'Abidjan (Ivory Coast)' },
  'abj': { code: 'ABJ', name: 'Abidjan' },
  'ivory coast': { code: 'ABJ', name: 'Abidjan (Ivory Coast)' },
  'bamako': { code: 'BKO', name: 'Bamako (Mali)' },
  'bko': { code: 'BKO', name: 'Bamako' },
  'douala': { code: 'DLA', name: 'Douala (Cameroon)' },
  'dla': { code: 'DLA', name: 'Douala' },
  'yaounde': { code: 'YAO', name: 'Yaoundé (Cameroon)' },
  'yaoundé': { code: 'YAO', name: 'Yaoundé' },
  'libreville': { code: 'LBV', name: 'Libreville (Gabon)' },
  'lbv': { code: 'LBV', name: 'Libreville' },
  'kinshasa': { code: 'FIH', name: 'Kinshasa (DRC)' },
  'fih': { code: 'FIH', name: 'Kinshasa' },
  'drc': { code: 'FIH', name: 'Kinshasa (DRC)' },
  'conakry': { code: 'CKY', name: 'Conakry (Guinea)' },
  'freetown': { code: 'FNA', name: 'Freetown (Sierra Leone)' },
  'monrovia': { code: 'ROB', name: 'Monrovia (Liberia)' },
  'khartoum': { code: 'KRT', name: 'Khartoum (Sudan)' },
  'krt': { code: 'KRT', name: 'Khartoum' },
  'mogadishu': { code: 'MGQ', name: 'Mogadishu (Somalia)' },
  'reunion': { code: 'RUN', name: 'Réunion' },
  'réunion': { code: 'RUN', name: 'Réunion' },
  'run': { code: 'RUN', name: 'Réunion' },
  'mauritius': { code: 'MRU', name: 'Mauritius' },
  'mru': { code: 'MRU', name: 'Mauritius' },
  'port louis': { code: 'MRU', name: 'Port Louis (Mauritius)' },
  'maldives': { code: 'MLE', name: 'Maldives (Malé)' },
  'male': { code: 'MLE', name: 'Malé (Maldives)' },
  'malé': { code: 'MLE', name: 'Malé (Maldives)' },
  'mle': { code: 'MLE', name: 'Malé' },
  'seychelles': { code: 'SEZ', name: 'Seychelles (Mahé)' },
  'mahe': { code: 'SEZ', name: 'Mahé (Seychelles)' },
  'mahé': { code: 'SEZ', name: 'Mahé (Seychelles)' },
  'sez': { code: 'SEZ', name: 'Mahé (Seychelles)' },
  // ── Asia ─────────────────────────────────────────────────────────────────────
  'tokyo': { code: 'TYO', name: 'Tokyo' },
  'tokio': { code: 'TYO', name: 'Tokyo' },              // DE/ES/IT/NL/PL/PT/HR/SQ
  'osaka': { code: 'KIX', name: 'Osaka' },
  'nagoya': { code: 'NGO', name: 'Nagoya' },
  'sapporo': { code: 'CTS', name: 'Sapporo' },
  'fukuoka': { code: 'FUK', name: 'Fukuoka' },
  'seoul': { code: 'ICN', name: 'Seoul' },
  'seul': { code: 'ICN', name: 'Seoul' },         // PL/HR/IT/ES/PT/SQ/TR
  'seulu': { code: 'ICN', name: 'Seoul' },        // PL genitive
  'soul': { code: 'ICN', name: 'Seoul' },         // CZ/SK/PL alt
  'soulu': { code: 'ICN', name: 'Seoul' },        // PL/CZ genitive
  'séoul': { code: 'ICN', name: 'Seoul' },        // FR
  'seúl': { code: 'ICN', name: 'Seoul' },         // ES
  'busan': { code: 'PUS', name: 'Busan' },
  'beijing': { code: 'PEK', name: 'Beijing' },
  'peking': { code: 'PEK', name: 'Beijing' },
  'shanghai': { code: 'PVG', name: 'Shanghai' },
  'guangzhou': { code: 'CAN', name: 'Guangzhou' },
  'shenzhen': { code: 'SZX', name: 'Shenzhen' },
  'chengdu': { code: 'CTU', name: 'Chengdu' },
  // ── More China cities ────────────────────────────────────────────────────────
  'xian': { code: 'XIY', name: 'Xi\'an' },
  "xi'an": { code: 'XIY', name: 'Xi\'an' },
  'xiy': { code: 'XIY', name: 'Xi\'an' },
  'chongqing': { code: 'CKG', name: 'Chongqing' },
  'ckg': { code: 'CKG', name: 'Chongqing' },
  'hangzhou': { code: 'HGH', name: 'Hangzhou' },
  'hgh': { code: 'HGH', name: 'Hangzhou' },
  'nanjing': { code: 'NKG', name: 'Nanjing' },
  'nkg': { code: 'NKG', name: 'Nanjing' },
  'wuhan': { code: 'WUH', name: 'Wuhan' },
  'wuh': { code: 'WUH', name: 'Wuhan' },
  'tianjin': { code: 'TSN', name: 'Tianjin' },
  'tsn': { code: 'TSN', name: 'Tianjin' },
  'kunming': { code: 'KMG', name: 'Kunming' },
  'kmg': { code: 'KMG', name: 'Kunming' },
  'xiamen': { code: 'XMN', name: 'Xiamen' },
  'xmn': { code: 'XMN', name: 'Xiamen' },
  'qingdao': { code: 'TAO', name: 'Qingdao' },
  'tao': { code: 'TAO', name: 'Qingdao' },
  'harbin': { code: 'HRB', name: 'Harbin' },
  'hrb': { code: 'HRB', name: 'Harbin' },
  'sanya': { code: 'SYX', name: 'Sanya (Hainan)' },
  'sanya phoenix': { code: 'SYX', name: 'Sanya (Hainan)' },
  'sanya fenghuang': { code: 'SYX', name: 'Sanya (Hainan)' },
  'hainan': { code: 'SYX', name: 'Hainan (Sanya)' },
  'syx': { code: 'SYX', name: 'Sanya' },
  'haikou': { code: 'HAK', name: 'Haikou' },
  'hak': { code: 'HAK', name: 'Haikou' },
  'guilin': { code: 'KWL', name: 'Guilin' },
  'kwl': { code: 'KWL', name: 'Guilin' },
  'zhengzhou': { code: 'CGO', name: 'Zhengzhou' },
  'cgo': { code: 'CGO', name: 'Zhengzhou' },
  'urumqi': { code: 'URC', name: 'Ürümqi' },
  'ürümqi': { code: 'URC', name: 'Ürümqi' },
  'urc': { code: 'URC', name: 'Ürümqi' },
  'lhasa': { code: 'LXA', name: 'Lhasa (Tibet)' },
  'tibet': { code: 'LXA', name: 'Lhasa (Tibet)' },
  'lxa': { code: 'LXA', name: 'Lhasa' },
  // ── Japan additions ──────────────────────────────────────────────────────────
  'kyoto': { code: 'KIX', name: 'Kyoto (via Osaka)' },
  'hiroshima': { code: 'HIJ', name: 'Hiroshima' },
  'hij': { code: 'HIJ', name: 'Hiroshima' },
  'okinawa': { code: 'OKA', name: 'Okinawa (Naha)' },
  'naha': { code: 'OKA', name: 'Okinawa (Naha)' },
  'oka': { code: 'OKA', name: 'Okinawa' },
  'nagasaki': { code: 'NGS', name: 'Nagasaki' },
  'ngs': { code: 'NGS', name: 'Nagasaki' },
  'kumamoto': { code: 'KMJ', name: 'Kumamoto' },
  'kagoshima': { code: 'KOJ', name: 'Kagoshima' },
  'matsuyama': { code: 'MYJ', name: 'Matsuyama' },
  'sendai': { code: 'SDJ', name: 'Sendai' },
  'sdj': { code: 'SDJ', name: 'Sendai' },
  'nrt': { code: 'NRT', name: 'Tokyo Narita' },
  'narita': { code: 'NRT', name: 'Tokyo Narita' },
  'haneda': { code: 'HND', name: 'Tokyo Haneda' },
  'hnd': { code: 'HND', name: 'Tokyo Haneda' },
  'itm': { code: 'ITM', name: 'Osaka Itami' },
  'kix': { code: 'KIX', name: 'Osaka Kansai' },
  // ── Korea additions ──────────────────────────────────────────────────────────
  'incheon': { code: 'ICN', name: 'Seoul Incheon' },
  'icn': { code: 'ICN', name: 'Seoul Incheon' },
  'gimpo': { code: 'GMP', name: 'Seoul Gimpo' },
  'gmp': { code: 'GMP', name: 'Seoul Gimpo' },
  'jeju': { code: 'CJU', name: 'Jeju' },
  'cju': { code: 'CJU', name: 'Jeju' },
  // ── SE Asia additions ────────────────────────────────────────────────────────
  'boracay': { code: 'MPH', name: 'Boracay (Caticlan)' },
  'mph': { code: 'MPH', name: 'Boracay' },
  'palawan': { code: 'PPS', name: 'Puerto Princesa (Palawan)' },
  'puerto princesa': { code: 'PPS', name: 'Puerto Princesa (Palawan)' },
  'pps': { code: 'PPS', name: 'Puerto Princesa' },
  'davao': { code: 'DVO', name: 'Davao (Philippines)' },
  'dvo': { code: 'DVO', name: 'Davao' },
  'suvarnabhumi': { code: 'BKK', name: 'Bangkok Suvarnabhumi' },
  'don mueang': { code: 'DMK', name: 'Bangkok Don Mueang' },
  'dmk': { code: 'DMK', name: 'Bangkok Don Mueang' },
  'hat yai': { code: 'HDY', name: 'Hat Yai' },
  'hdy': { code: 'HDY', name: 'Hat Yai' },
  'johor bahru': { code: 'JHB', name: 'Johor Bahru' },
  'jhb': { code: 'JHB', name: 'Johor Bahru' },
  'kota bharu': { code: 'KBR', name: 'Kota Bharu' },
  'kuching': { code: 'KCH', name: 'Kuching (Sarawak)' },
  'kch': { code: 'KCH', name: 'Kuching' },
  'makassar': { code: 'UPG', name: 'Makassar' },
  'upg': { code: 'UPG', name: 'Makassar' },
  'medan': { code: 'KNO', name: 'Medan' },
  'kno': { code: 'KNO', name: 'Medan' },
  'yangon': { code: 'RGN', name: 'Yangon' },
  'rangoon': { code: 'RGN', name: 'Yangon' },
  'rgn': { code: 'RGN', name: 'Yangon' },
  'naypyidaw': { code: 'NYT', name: 'Naypyidaw' },
  'luang prabang': { code: 'LPQ', name: 'Luang Prabang (Laos)' },
  'lpq': { code: 'LPQ', name: 'Luang Prabang' },
  // ── India additions ──────────────────────────────────────────────────────────
  'jaipur': { code: 'JAI', name: 'Jaipur' },
  'jai': { code: 'JAI', name: 'Jaipur' },
  'varanasi': { code: 'VNS', name: 'Varanasi' },
  'vns': { code: 'VNS', name: 'Varanasi' },
  'amritsar': { code: 'ATQ', name: 'Amritsar' },
  'atq': { code: 'ATQ', name: 'Amritsar' },
  'agra': { code: 'AGR', name: 'Agra (Taj Mahal)' },
  'taj mahal': { code: 'AGR', name: 'Agra (Taj Mahal)' },
  'agr': { code: 'AGR', name: 'Agra' },
  'udaipur': { code: 'UDR', name: 'Udaipur' },
  'udr': { code: 'UDR', name: 'Udaipur' },
  'cochin': { code: 'COK', name: 'Kochi' },
  'trivandrum': { code: 'TRV', name: 'Thiruvananthapuram' },
  'thiruvananthapuram': { code: 'TRV', name: 'Thiruvananthapuram' },
  'trv': { code: 'TRV', name: 'Thiruvananthapuram' },
  'calicut': { code: 'CCJ', name: 'Calicut (Kozhikode)' },
  'kozhikode': { code: 'CCJ', name: 'Calicut (Kozhikode)' },
  'ccj': { code: 'CCJ', name: 'Calicut' },
  'pune': { code: 'PNQ', name: 'Pune' },
  'pnq': { code: 'PNQ', name: 'Pune' },
  'surat': { code: 'STV', name: 'Surat' },
  'nagpur': { code: 'NAG', name: 'Nagpur' },
  'nag': { code: 'NAG', name: 'Nagpur' },
  'indore': { code: 'IDR', name: 'Indore' },
  'idr': { code: 'IDR', name: 'Indore' },
  'bhopal': { code: 'BHO', name: 'Bhopal' },
  'visakhapatnam': { code: 'VTZ', name: 'Visakhapatnam' },
  'vizag': { code: 'VTZ', name: 'Visakhapatnam' },
  'vtz': { code: 'VTZ', name: 'Visakhapatnam' },
  'macau': { code: 'MFM', name: 'Macau' },
  'taipei': { code: 'TPE', name: 'Taipei' },
  'hong kong': { code: 'HKG', name: 'Hong Kong' },
  'hongkong': { code: 'HKG', name: 'Hong Kong' },
  'hong-kong': { code: 'HKG', name: 'Hong Kong' },
  'singapore': { code: 'SIN', name: 'Singapore' },
  'singapur': { code: 'SIN', name: 'Singapore' },       // DE/ES/PL/HR/SQ
  'singapour': { code: 'SIN', name: 'Singapore' },      // FR
  'singapura': { code: 'SIN', name: 'Singapore' },      // PT
  'bangkok': { code: 'BKK', name: 'Bangkok' },
  'phuket': { code: 'HKT', name: 'Phuket' },
  'chiang mai': { code: 'CNX', name: 'Chiang Mai' },
  'bali': { code: 'DPS', name: 'Bali' },
  'denpasar': { code: 'DPS', name: 'Bali' },
  'lombok': { code: 'LOP', name: 'Lombok' },
  'jakarta': { code: 'CGK', name: 'Jakarta' },
  'surabaya': { code: 'SUB', name: 'Surabaya' },
  'yogyakarta': { code: 'YIA', name: 'Yogyakarta' },
  'jogjakarta': { code: 'YIA', name: 'Yogyakarta' },
  'kuala lumpur': { code: 'KUL', name: 'Kuala Lumpur' },
  'penang': { code: 'PEN', name: 'Penang' },
  'langkawi': { code: 'LGK', name: 'Langkawi' },
  'kota kinabalu': { code: 'BKI', name: 'Kota Kinabalu' },
  'manila': { code: 'MNL', name: 'Manila' },
  'cebu': { code: 'CEB', name: 'Cebu' },
  'ho chi minh': { code: 'SGN', name: 'Ho Chi Minh City' },
  'saigon': { code: 'SGN', name: 'Ho Chi Minh City' },
  'hanoi': { code: 'HAN', name: 'Hanoi' },
  'danang': { code: 'DAD', name: 'Da Nang' },
  'da nang': { code: 'DAD', name: 'Da Nang' },
  'phu quoc': { code: 'PQC', name: 'Phu Quoc' },
  'koh samui': { code: 'USM', name: 'Koh Samui' },
  'samui': { code: 'USM', name: 'Koh Samui' },
  'krabi': { code: 'KBV', name: 'Krabi' },
  'phnom penh': { code: 'PNH', name: 'Phnom Penh' },
  'siem reap': { code: 'REP', name: 'Siem Reap (Angkor Wat)' },
  'vientiane': { code: 'VTE', name: 'Vientiane' },
  'mumbai': { code: 'BOM', name: 'Mumbai' },
  'bombay': { code: 'BOM', name: 'Mumbai' },
  'delhi': { code: 'DEL', name: 'Delhi' },
  'new delhi': { code: 'DEL', name: 'Delhi' },
  'bangalore': { code: 'BLR', name: 'Bangalore' },
  'bengaluru': { code: 'BLR', name: 'Bangalore' },
  'hyderabad': { code: 'HYD', name: 'Hyderabad' },
  'chennai': { code: 'MAA', name: 'Chennai' },
  'madras': { code: 'MAA', name: 'Chennai' },
  'kolkata': { code: 'CCU', name: 'Kolkata' },
  'calcutta': { code: 'CCU', name: 'Kolkata' },
  'ahmedabad': { code: 'AMD', name: 'Ahmedabad' },
  'goa': { code: 'GOI', name: 'Goa' },
  'kochi': { code: 'COK', name: 'Kochi' },
  'colombo': { code: 'CMB', name: 'Colombo' },
  'kathmandu': { code: 'KTM', name: 'Kathmandu' },
  'dhaka': { code: 'DAC', name: 'Dhaka' },
  'karachi': { code: 'KHI', name: 'Karachi' },
  'lahore': { code: 'LHE', name: 'Lahore' },
  'islamabad': { code: 'ISB', name: 'Islamabad' },
  'tashkent': { code: 'TAS', name: 'Tashkent' },
  'almaty': { code: 'ALA', name: 'Almaty' },
  'astana': { code: 'NQZ', name: 'Astana' },
  'tbilisi': { code: 'TBS', name: 'Tbilisi' },
  'yerevan': { code: 'EVN', name: 'Yerevan' },
  'baku': { code: 'GYD', name: 'Baku' },
  // ── Americas ─────────────────────────────────────────────────────────────────
  'new york': { code: 'NYC', name: 'New York' },
  'nyc': { code: 'NYC', name: 'New York' },
  'jfk': { code: 'JFK', name: 'New York JFK' },
  'newark': { code: 'EWR', name: 'Newark' },
  'ewr': { code: 'EWR', name: 'Newark' },
  'new jersey': { code: 'EWR', name: 'Newark (New Jersey)' },
  'nj': { code: 'EWR', name: 'Newark (New Jersey)' },
  'laguardia': { code: 'LGA', name: 'New York LaGuardia' },
  'los angeles': { code: 'LAX', name: 'Los Angeles' },
  'la': { code: 'LAX', name: 'Los Angeles' },
  'san francisco': { code: 'SFO', name: 'San Francisco' },
  'sf': { code: 'SFO', name: 'San Francisco' },
  'chicago': { code: 'ORD', name: 'Chicago' },
  'miami': { code: 'MIA', name: 'Miami' },
  'fort lauderdale': { code: 'FLL', name: 'Fort Lauderdale' },
  'dallas': { code: 'DFW', name: 'Dallas' },
  'houston': { code: 'IAH', name: 'Houston' },
  'boston': { code: 'BOS', name: 'Boston' },
  'seattle': { code: 'SEA', name: 'Seattle' },
  'washington': { code: 'WAS', name: 'Washington DC' },
  'dc': { code: 'WAS', name: 'Washington DC' },
  'baltimore': { code: 'BWI', name: 'Baltimore' },
  'atlanta': { code: 'ATL', name: 'Atlanta' },
  'las vegas': { code: 'LAS', name: 'Las Vegas' },
  'orlando': { code: 'MCO', name: 'Orlando' },
  'tampa': { code: 'TPA', name: 'Tampa' },
  'denver': { code: 'DEN', name: 'Denver' },
  'phoenix': { code: 'PHX', name: 'Phoenix' },
  'minneapolis': { code: 'MSP', name: 'Minneapolis' },
  'detroit': { code: 'DTW', name: 'Detroit' },
  'san diego': { code: 'SAN', name: 'San Diego' },
  'portland': { code: 'PDX', name: 'Portland' },
  'new orleans': { code: 'MSY', name: 'New Orleans' },
  'nashville': { code: 'BNA', name: 'Nashville' },
  'charlotte': { code: 'CLT', name: 'Charlotte' },
  'raleigh': { code: 'RDU', name: 'Raleigh' },
  'salt lake city': { code: 'SLC', name: 'Salt Lake City' },
  'kansas city': { code: 'MCI', name: 'Kansas City' },
  'san antonio': { code: 'SAT', name: 'San Antonio' },
  'pittsburgh': { code: 'PIT', name: 'Pittsburgh' },
  'cleveland': { code: 'CLE', name: 'Cleveland' },
  'indianapolis': { code: 'IND', name: 'Indianapolis' },
  'memphis': { code: 'MEM', name: 'Memphis' },
  'st louis': { code: 'STL', name: 'St. Louis' },
  'saint louis': { code: 'STL', name: 'St. Louis' },
  'cincinnati': { code: 'CVG', name: 'Cincinnati' },
  'buffalo': { code: 'BUF', name: 'Buffalo' },
  'sacramento': { code: 'SMF', name: 'Sacramento' },
  'oklahoma city': { code: 'OKC', name: 'Oklahoma City' },
  'omaha': { code: 'OMA', name: 'Omaha' },
  'albuquerque': { code: 'ABQ', name: 'Albuquerque' },
  'tucson': { code: 'TUS', name: 'Tucson' },
  'reno': { code: 'RNO', name: 'Reno' },
  // ── More US cities ───────────────────────────────────────────────────────────
  'philadelphia': { code: 'PHL', name: 'Philadelphia' },
  'philly': { code: 'PHL', name: 'Philadelphia' },
  'phl': { code: 'PHL', name: 'Philadelphia' },
  'austin': { code: 'AUS', name: 'Austin' },
  'aus': { code: 'AUS', name: 'Austin' },
  'dulles': { code: 'IAD', name: 'Washington Dulles' },
  'washington dulles': { code: 'IAD', name: 'Washington Dulles' },
  'iad': { code: 'IAD', name: 'Washington Dulles' },
  'reagan': { code: 'DCA', name: 'Washington Reagan' },
  'washington national': { code: 'DCA', name: 'Washington National' },
  'dca': { code: 'DCA', name: 'Washington Reagan' },
  "o'hare": { code: 'ORD', name: 'Chicago O\'Hare' },
  'ohare': { code: 'ORD', name: 'Chicago O\'Hare' },
  'chicago ohare': { code: 'ORD', name: 'Chicago O\'Hare' },
  "chicago o'hare": { code: 'ORD', name: 'Chicago O\'Hare' },
  'ord': { code: 'ORD', name: 'Chicago O\'Hare' },
  'midway': { code: 'MDW', name: 'Chicago Midway' },
  'chicago midway': { code: 'MDW', name: 'Chicago Midway' },
  'mdw': { code: 'MDW', name: 'Chicago Midway' },
  'san jose california': { code: 'SJC', name: 'San Jose (California)' },
  'san jose ca': { code: 'SJC', name: 'San Jose (California)' },
  'san jose silicon valley': { code: 'SJC', name: 'San Jose (California)' },
  'sjc': { code: 'SJC', name: 'San Jose (California)' },
  'orange county': { code: 'SNA', name: 'Orange County (John Wayne)' },
  'santa ana': { code: 'SNA', name: 'Orange County (John Wayne)' },
  'sna': { code: 'SNA', name: 'Orange County' },
  'burbank': { code: 'BUR', name: 'Burbank (Hollywood Burbank)' },
  'bur': { code: 'BUR', name: 'Burbank' },
  'long beach': { code: 'LGB', name: 'Long Beach' },
  'lgb': { code: 'LGB', name: 'Long Beach' },
  'santa barbara': { code: 'SBA', name: 'Santa Barbara' },
  'sba': { code: 'SBA', name: 'Santa Barbara' },
  'san luis obispo': { code: 'SBP', name: 'San Luis Obispo' },
  'fresno': { code: 'FAT', name: 'Fresno' },
  'monterey': { code: 'MRY', name: 'Monterey (California)' },
  'monterey california': { code: 'MRY', name: 'Monterey (California)' },
  'palm springs': { code: 'PSP', name: 'Palm Springs' },
  'psp': { code: 'PSP', name: 'Palm Springs' },
  'san fernando valley': { code: 'BUR', name: 'Burbank (Hollywood Burbank)' },
  'bwi': { code: 'BWI', name: 'Baltimore/Washington' },
  'slc': { code: 'SLC', name: 'Salt Lake City' },
  'rdu': { code: 'RDU', name: 'Raleigh-Durham' },
  'clt': { code: 'CLT', name: 'Charlotte' },
  'tpa': { code: 'TPA', name: 'Tampa' },
  'msy': { code: 'MSY', name: 'New Orleans' },
  'msp': { code: 'MSP', name: 'Minneapolis' },
  'dtw': { code: 'DTW', name: 'Detroit' },
  'pdx': { code: 'PDX', name: 'Portland' },
  'bna': { code: 'BNA', name: 'Nashville' },
  'pit': { code: 'PIT', name: 'Pittsburgh' },
  'cvg': { code: 'CVG', name: 'Cincinnati' },
  'cmh': { code: 'CMH', name: 'Columbus' },
  'columbus': { code: 'CMH', name: 'Columbus' },
  'columbus ohio': { code: 'CMH', name: 'Columbus' },
  'mco': { code: 'MCO', name: 'Orlando' },
  'mia': { code: 'MIA', name: 'Miami' },
  'fll': { code: 'FLL', name: 'Fort Lauderdale' },
  'fort worth': { code: 'DFW', name: 'Dallas/Fort Worth' },
  'dfw': { code: 'DFW', name: 'Dallas/Fort Worth' },
  'dallas fort worth': { code: 'DFW', name: 'Dallas/Fort Worth' },
  'iah': { code: 'IAH', name: 'Houston Intercontinental' },
  'houston hobby': { code: 'HOU', name: 'Houston Hobby' },
  'hobby': { code: 'HOU', name: 'Houston Hobby' },
  'hou': { code: 'HOU', name: 'Houston Hobby' },
  'lax': { code: 'LAX', name: 'Los Angeles' },
  'sfo': { code: 'SFO', name: 'San Francisco' },
  'den': { code: 'DEN', name: 'Denver' },
  'sea': { code: 'SEA', name: 'Seattle' },
  'atl': { code: 'ATL', name: 'Atlanta' },
  'bos': { code: 'BOS', name: 'Boston' },
  'las': { code: 'LAS', name: 'Las Vegas' },
  // ── US States (map to primary hub) ───────────────────────────────────────────
  'california': { code: 'LAX', name: 'California' },
  'florida': { code: 'MIA', name: 'Florida' },
  'texas': { code: 'DFW', name: 'Texas' },
  'illinois': { code: 'ORD', name: 'Illinois' },
  'new mexico': { code: 'ABQ', name: 'New Mexico' },
  'new hampshire': { code: 'MHT', name: 'New Hampshire' },
  'north carolina': { code: 'CLT', name: 'North Carolina' },
  'south carolina': { code: 'CHS', name: 'South Carolina' },
  'north dakota': { code: 'BIS', name: 'North Dakota' },
  'south dakota': { code: 'FSD', name: 'South Dakota' },
  'rhode island': { code: 'PVD', name: 'Rhode Island' },
  'providence': { code: 'PVD', name: 'Providence (Rhode Island)' },
  'pvd': { code: 'PVD', name: 'Providence' },
  'connecticut': { code: 'BDL', name: 'Connecticut' },
  'west virginia': { code: 'CRW', name: 'West Virginia' },
  'alaska': { code: 'ANC', name: 'Alaska' },
  'anchorage': { code: 'ANC', name: 'Anchorage' },
  'anc': { code: 'ANC', name: 'Anchorage' },
  'juneau': { code: 'JNU', name: 'Juneau' },
  'fairbanks': { code: 'FAI', name: 'Fairbanks' },
  'michigan': { code: 'DTW', name: 'Michigan' },
  'minnesota': { code: 'MSP', name: 'Minnesota' },
  'ohio': { code: 'CMH', name: 'Ohio' },
  'tennessee': { code: 'BNA', name: 'Tennessee' },
  'louisiana': { code: 'MSY', name: 'Louisiana' },
  'kentucky': { code: 'SDF', name: 'Kentucky' },
  'louisville': { code: 'SDF', name: 'Louisville' },
  'sdf': { code: 'SDF', name: 'Louisville' },
  'nevada': { code: 'LAS', name: 'Nevada' },
  'arizona': { code: 'PHX', name: 'Arizona' },
  'utah': { code: 'SLC', name: 'Utah' },
  'colorado': { code: 'DEN', name: 'Colorado' },
  'oregon': { code: 'PDX', name: 'Oregon' },
  'pennsylvania': { code: 'PHL', name: 'Pennsylvania' },
  'virginia': { code: 'DCA', name: 'Virginia' },
  'maryland': { code: 'BWI', name: 'Maryland' },
  'massachusetts': { code: 'BOS', name: 'Massachusetts' },
  'georgia usa': { code: 'ATL', name: 'Georgia (US)' },
  'georgia us': { code: 'ATL', name: 'Georgia (US)' },
  'georgia state': { code: 'ATL', name: 'Georgia (US)' },
  'milwaukee': { code: 'MKE', name: 'Milwaukee' },
  'mke': { code: 'MKE', name: 'Milwaukee' },
  'la crosse': { code: 'LSE', name: 'La Crosse' },
  'lacrosse': { code: 'LSE', name: 'La Crosse' },
  'crosse': { code: 'LSE', name: 'La Crosse' },
  'lse': { code: 'LSE', name: 'La Crosse' },
  'iowa': { code: 'DSM', name: 'Iowa' },
  'des moines': { code: 'DSM', name: 'Des Moines' },
  'dsm': { code: 'DSM', name: 'Des Moines' },
  'missouri': { code: 'STL', name: 'Missouri' },
  'arkansas': { code: 'LIT', name: 'Arkansas' },
  'little rock': { code: 'LIT', name: 'Little Rock' },
  'lit': { code: 'LIT', name: 'Little Rock' },
  'mississippi': { code: 'JAN', name: 'Mississippi' },
  'jackson mississippi': { code: 'JAN', name: 'Jackson (MS)' },
  'jan': { code: 'JAN', name: 'Jackson (MS)' },
  'alabama': { code: 'BHM', name: 'Alabama' },
  'birmingham alabama': { code: 'BHM', name: 'Birmingham (AL)' },
  'bhm': { code: 'BHM', name: 'Birmingham (AL)' },
  'south carolina charleston': { code: 'CHS', name: 'Charleston (SC)' },
  'charleston sc': { code: 'CHS', name: 'Charleston (SC)' },
  'chs': { code: 'CHS', name: 'Charleston (SC)' },
  'savannah': { code: 'SAV', name: 'Savannah' },
  'sav': { code: 'SAV', name: 'Savannah' },
  'jacksonville': { code: 'JAX', name: 'Jacksonville' },
  'jax': { code: 'JAX', name: 'Jacksonville' },
  'fort myers': { code: 'RSW', name: 'Fort Myers' },
  'rsw': { code: 'RSW', name: 'Fort Myers' },
  'west palm beach': { code: 'PBI', name: 'West Palm Beach' },
  'pbi': { code: 'PBI', name: 'West Palm Beach' },
  'daytona': { code: 'DAB', name: 'Daytona Beach' },
  'daytona beach': { code: 'DAB', name: 'Daytona Beach' },
  'gainesville': { code: 'GNV', name: 'Gainesville' },
  'gnv': { code: 'GNV', name: 'Gainesville' },
  'tallahassee': { code: 'TLH', name: 'Tallahassee' },
  'tlh': { code: 'TLH', name: 'Tallahassee' },
  'pensacola': { code: 'PNS', name: 'Pensacola' },
  'pns': { code: 'PNS', name: 'Pensacola' },
  'key west': { code: 'EYW', name: 'Key West' },
  'eyw': { code: 'EYW', name: 'Key West' },
  'florida keys': { code: 'EYW', name: 'Florida Keys (Key West)' },
  'marco island': { code: 'RSW', name: 'Marco Island (via Fort Myers)' },
  'naples fl': { code: 'RSW', name: 'Naples FL (via Fort Myers)' },
  // ── US mountain/ski/nature ────────────────────────────────────────────────────
  'aspen': { code: 'ASE', name: 'Aspen' },
  'ase': { code: 'ASE', name: 'Aspen' },
  'snowmass': { code: 'ASE', name: 'Snowmass (via Aspen)' },
  'vail': { code: 'EGE', name: 'Vail (Eagle County)' },
  'ege': { code: 'EGE', name: 'Vail (Eagle County)' },
  'beaver creek': { code: 'EGE', name: 'Beaver Creek (via Eagle County)' },
  'telluride': { code: 'TEX', name: 'Telluride' },
  'tex': { code: 'TEX', name: 'Telluride' },
  'grand junction': { code: 'GJT', name: 'Grand Junction' },
  'gjt': { code: 'GJT', name: 'Grand Junction' },
  'moab': { code: 'CNY', name: 'Moab (Canyonlands)' },
  'arches': { code: 'CNY', name: 'Arches NP (via Canyonlands)' },
  'canyonlands': { code: 'CNY', name: 'Canyonlands / Moab' },
  'cny': { code: 'CNY', name: 'Canyonlands' },
  'sedona': { code: 'FLG', name: 'Sedona (via Flagstaff)' },
  'flagstaff': { code: 'FLG', name: 'Flagstaff' },
  'flg': { code: 'FLG', name: 'Flagstaff' },
  'grand canyon': { code: 'FLG', name: 'Grand Canyon (via Flagstaff)' },
  'scottsdale': { code: 'PHX', name: 'Scottsdale (via Phoenix)' },
  'tempe': { code: 'PHX', name: 'Tempe (via Phoenix)' },
  'mesa az': { code: 'PHX', name: 'Mesa AZ (via Phoenix)' },
  'yellowstone': { code: 'JAC', name: 'Yellowstone (via Jackson Hole)' },
  'glacier national park': { code: 'FCA', name: 'Glacier NP (Kalispell)' },
  'kalispell': { code: 'FCA', name: 'Kalispell' },
  'fca': { code: 'FCA', name: 'Kalispell (Glacier NP)' },
  'zion': { code: 'SGU', name: 'Zion NP (St George)' },
  'zion national park': { code: 'SGU', name: 'Zion NP (St George)' },
  'st george utah': { code: 'SGU', name: 'St George (Zion NP)' },
  'sgu': { code: 'SGU', name: 'St George' },
  'bryce canyon': { code: 'CDC', name: 'Bryce Canyon (Cedar City)' },
  'cedar city': { code: 'CDC', name: 'Cedar City' },
  'cdc': { code: 'CDC', name: 'Cedar City' },
  'yosemite': { code: 'FAT', name: 'Yosemite (via Fresno)' },
  'fat': { code: 'FAT', name: 'Fresno' },
  'lake tahoe': { code: 'RNO', name: 'Lake Tahoe (via Reno)' },
  'tahoe': { code: 'RNO', name: 'Lake Tahoe (via Reno)' },
  'rno': { code: 'RNO', name: 'Reno' },
  'asheville': { code: 'AVL', name: 'Asheville' },
  'avl': { code: 'AVL', name: 'Asheville' },
  'great smoky mountains': { code: 'TYS', name: 'Smoky Mountains (Knoxville)' },
  'smoky mountains': { code: 'TYS', name: 'Smoky Mountains (Knoxville)' },
  'knoxville': { code: 'TYS', name: 'Knoxville' },
  'tys': { code: 'TYS', name: 'Knoxville' },
  'myrtle beach': { code: 'MYR', name: 'Myrtle Beach' },
  'myr': { code: 'MYR', name: 'Myrtle Beach' },
  'hilton head': { code: 'HHH', name: 'Hilton Head Island' },
  'hhh': { code: 'HHH', name: 'Hilton Head' },
  // ── US New England / East Coast islands ────────────────────────────────────────
  'napa valley': { code: 'SFO', name: 'Napa Valley (via San Francisco)' },
  'napa': { code: 'SFO', name: 'Napa (via San Francisco)' },
  'sonoma': { code: 'SFO', name: 'Sonoma (via San Francisco)' },
  'wine country': { code: 'SFO', name: 'Wine Country CA (via SFO)' },
  'niagara falls': { code: 'BUF', name: 'Niagara Falls (via Buffalo)' },
  'niagara': { code: 'BUF', name: 'Niagara Falls (via Buffalo)' },
  'buf': { code: 'BUF', name: 'Buffalo' },
  'the hamptons': { code: 'HTO', name: 'Hamptons (East Hampton)' },
  'hamptons': { code: 'HTO', name: 'Hamptons (East Hampton)' },
  'east hampton': { code: 'HTO', name: 'East Hampton' },
  'hto': { code: 'HTO', name: 'East Hampton (Hamptons)' },
  "martha's vineyard": { code: 'MVY', name: "Martha's Vineyard" },
  'marthas vineyard': { code: 'MVY', name: "Martha's Vineyard" },
  'mvy': { code: 'MVY', name: "Martha's Vineyard" },
  'nantucket': { code: 'ACK', name: 'Nantucket' },
  'ack': { code: 'ACK', name: 'Nantucket' },
  'cape cod': { code: 'HYA', name: 'Cape Cod (Hyannis)' },
  'hyannis': { code: 'HYA', name: 'Hyannis (Cape Cod)' },
  'hya': { code: 'HYA', name: 'Hyannis' },
  'bar harbor': { code: 'BGR', name: 'Bar Harbor / Acadia (via Bangor)' },
  'acadia': { code: 'BGR', name: 'Acadia NP (via Bangor)' },
  'bangor maine': { code: 'BGR', name: 'Bangor ME' },
  'bgr': { code: 'BGR', name: 'Bangor ME' },
  'portland maine': { code: 'PWM', name: 'Portland ME' },
  'pwm': { code: 'PWM', name: 'Portland ME' },
  'burlington vt': { code: 'BTV', name: 'Burlington VT' },
  'btv': { code: 'BTV', name: 'Burlington VT' },
  'stowe': { code: 'BTV', name: 'Stowe (via Burlington VT)' },
  'mackinac island': { code: 'PLN', name: 'Mackinac Island (via Pellston)' },
  'traverse city': { code: 'TVC', name: 'Traverse City' },
  'tvc': { code: 'TVC', name: 'Traverse City' },
  'disney world': { code: 'MCO', name: 'Disney World (Orlando)' },
  'walt disney world': { code: 'MCO', name: 'Disney World (Orlando)' },
  'saf': { code: 'SAF', name: 'Santa Fe' },
  'albuquerque nm': { code: 'ABQ', name: 'Albuquerque' },
  'el paso': { code: 'ELP', name: 'El Paso' },
  'elp': { code: 'ELP', name: 'El Paso' },
  'tucson az': { code: 'TUS', name: 'Tucson' },
  'billings': { code: 'BIL', name: 'Billings' },
  'bozeman': { code: 'BZN', name: 'Bozeman' },
  'bzn': { code: 'BZN', name: 'Bozeman' },
  'jackson hole': { code: 'JAC', name: 'Jackson Hole' },
  'jac': { code: 'JAC', name: 'Jackson Hole' },
  'idaho': { code: 'BOI', name: 'Idaho' },
  'boise': { code: 'BOI', name: 'Boise' },
  'boi': { code: 'BOI', name: 'Boise' },
  'spokane': { code: 'GEG', name: 'Spokane' },
  'geg': { code: 'GEG', name: 'Spokane' },
  // ── US Territories ────────────────────────────────────────────────────────────
  'puerto rico': { code: 'SJU', name: 'Puerto Rico (San Juan)' },
  'san juan': { code: 'SJU', name: 'San Juan (Puerto Rico)' },
  'sju': { code: 'SJU', name: 'San Juan' },
  'st thomas': { code: 'STT', name: 'St Thomas (US Virgin Islands)' },
  'st. thomas': { code: 'STT', name: 'St Thomas (US Virgin Islands)' },
  'saint thomas': { code: 'STT', name: 'St Thomas (US Virgin Islands)' },
  'stt': { code: 'STT', name: 'St Thomas' },
  'virgin islands': { code: 'STT', name: 'US Virgin Islands (St Thomas)' },
  'us virgin islands': { code: 'STT', name: 'US Virgin Islands' },
  'st croix': { code: 'STX', name: 'St Croix' },
  'stx': { code: 'STX', name: 'St Croix' },
  'guam': { code: 'GUM', name: 'Guam' },
  'gum': { code: 'GUM', name: 'Guam' },
  'vancouver': { code: 'YVR', name: 'Vancouver' },
  'montreal': { code: 'YUL', name: 'Montreal' },
  'calgary': { code: 'YYC', name: 'Calgary' },
  'edmonton': { code: 'YEG', name: 'Edmonton' },
  'ottawa': { code: 'YOW', name: 'Ottawa' },
  'quebec city': { code: 'YQB', name: 'Québec City' },
  'québec': { code: 'YQB', name: 'Québec City' },
  'halifax': { code: 'YHZ', name: 'Halifax' },
  'victoria': { code: 'YYJ', name: 'Victoria (BC)' },
  'winnipeg': { code: 'YWG', name: 'Winnipeg' },
  'ywg': { code: 'YWG', name: 'Winnipeg' },
  'toronto': { code: 'YYZ', name: 'Toronto' },
  'yyz': { code: 'YYZ', name: 'Toronto Pearson' },
  'billy bishop': { code: 'YTZ', name: 'Toronto Billy Bishop' },
  'ytz': { code: 'YTZ', name: 'Toronto Billy Bishop' },
  'saskatoon': { code: 'YXE', name: 'Saskatoon' },
  'regina': { code: 'YQR', name: 'Regina' },
  'st johns': { code: 'YYT', name: "St John's (Newfoundland)" },
  "st john's": { code: 'YYT', name: "St John's (Newfoundland)" },
  'newfoundland': { code: 'YYT', name: "St John's (Newfoundland)" },
  'fredericton': { code: 'YFC', name: 'Fredericton' },
  'moncton': { code: 'YQM', name: 'Moncton' },
  'charlottetown': { code: 'YYG', name: 'Charlottetown (PEI)' },
  'prince edward island': { code: 'YYG', name: 'Charlottetown (PEI)' },
  'pei': { code: 'YYG', name: 'PEI (Charlottetown)' },
  'whistler': { code: 'YVR', name: 'Whistler (via Vancouver)' },
  'banff': { code: 'YYC', name: 'Banff (via Calgary)' },
  'jasper': { code: 'YEG', name: 'Jasper (via Edmonton)' },
  'kelowna': { code: 'YLW', name: 'Kelowna' },
  'ylw': { code: 'YLW', name: 'Kelowna' },
  'kamloops': { code: 'YKA', name: 'Kamloops' },
  'cancun': { code: 'CUN', name: 'Cancun' },
  'playa del carmen': { code: 'CUN', name: 'Playa del Carmen (via Cancun)' },
  'tulum': { code: 'CUN', name: 'Tulum (via Cancun)' },
  'guadalajara': { code: 'GDL', name: 'Guadalajara' },
  // ── More Mexico cities ────────────────────────────────────────────────────────
  'los cabos': { code: 'SJD', name: 'Los Cabos' },
  'cabo san lucas': { code: 'SJD', name: 'Los Cabos (Cabo San Lucas)' },
  'cabo': { code: 'SJD', name: 'Los Cabos (Cabo)' },
  'san jose del cabo': { code: 'SJD', name: 'San José del Cabo' },
  'sjd': { code: 'SJD', name: 'Los Cabos' },
  'puerto vallarta': { code: 'PVR', name: 'Puerto Vallarta' },
  'vallarta': { code: 'PVR', name: 'Puerto Vallarta' },
  'pvr': { code: 'PVR', name: 'Puerto Vallarta' },
  'nuevo vallarta': { code: 'PVR', name: 'Nuevo Vallarta (via Puerto Vallarta)' },
  'riviera nayarit': { code: 'PVR', name: 'Riviera Nayarit (via Puerto Vallarta)' },
  'mazatlan': { code: 'MZT', name: 'Mazatlán' },
  'mazatlán': { code: 'MZT', name: 'Mazatlán' },
  'mzt': { code: 'MZT', name: 'Mazatlán' },
  'monterrey': { code: 'MTY', name: 'Monterrey' },
  'mty': { code: 'MTY', name: 'Monterrey' },
  'tijuana': { code: 'TIJ', name: 'Tijuana' },
  'tij': { code: 'TIJ', name: 'Tijuana' },
  'oaxaca': { code: 'OAX', name: 'Oaxaca' },
  'oax': { code: 'OAX', name: 'Oaxaca' },
  'merida': { code: 'MID', name: 'Mérida (Mexico)' },
  'mérida': { code: 'MID', name: 'Mérida (Mexico)' },
  'mid': { code: 'MID', name: 'Mérida' },
  'acapulco': { code: 'ACA', name: 'Acapulco' },
  'aca': { code: 'ACA', name: 'Acapulco' },
  'zihuatanejo': { code: 'ZIH', name: 'Zihuatanejo/Ixtapa' },
  'ixtapa': { code: 'ZIH', name: 'Ixtapa/Zihuatanejo' },
  'zih': { code: 'ZIH', name: 'Zihuatanejo' },
  'manzanillo': { code: 'ZLO', name: 'Manzanillo' },
  'zlo': { code: 'ZLO', name: 'Manzanillo' },
  'puerto escondido': { code: 'PXM', name: 'Puerto Escondido' },
  'pxm': { code: 'PXM', name: 'Puerto Escondido' },
  'huatulco': { code: 'HUX', name: 'Huatulco' },
  'hux': { code: 'HUX', name: 'Huatulco' },
  'veracruz': { code: 'VER', name: 'Veracruz' },
  'ver': { code: 'VER', name: 'Veracruz' },
  'leon': { code: 'BJX', name: 'León (Bajío)' },
  'bjx': { code: 'BJX', name: 'León (Bajío)' },
  'morelia': { code: 'MLM', name: 'Morelia' },
  'mlm': { code: 'MLM', name: 'Morelia' },
  'culiacan': { code: 'CUL', name: 'Culiacán' },
  'culiacán': { code: 'CUL', name: 'Culiacán' },
  'cul': { code: 'CUL', name: 'Culiacán' },
  'hermosillo': { code: 'HMO', name: 'Hermosillo' },
  'hmo': { code: 'HMO', name: 'Hermosillo' },
  'san cristobal de las casas': { code: 'TGZ', name: 'San Cristóbal (via Tuxtla Gutiérrez)' },
  'chiapas': { code: 'TGZ', name: 'Chiapas (Tuxtla Gutiérrez)' },
  'tuxtla gutierrez': { code: 'TGZ', name: 'Tuxtla Gutiérrez' },
  'tgz': { code: 'TGZ', name: 'Tuxtla Gutiérrez' },
  'puebla': { code: 'PBC', name: 'Puebla' },
  'pbc': { code: 'PBC', name: 'Puebla' },
  'havana': { code: 'HAV', name: 'Havana' },
  'la habana': { code: 'HAV', name: 'Havana' },
  'varadero': { code: 'VRA', name: 'Varadero (Cuba)' },
  'santo domingo': { code: 'SDQ', name: 'Santo Domingo' },
  'punta cana': { code: 'PUJ', name: 'Punta Cana' },
  'barbados': { code: 'BGI', name: 'Barbados (Bridgetown)' },
  'bridgetown': { code: 'BGI', name: 'Barbados (Bridgetown)' },
  'jamaica': { code: 'KIN', name: 'Jamaica (Kingston)' },
  'kingston': { code: 'KIN', name: 'Kingston, Jamaica' },
  'montego bay': { code: 'MBJ', name: 'Montego Bay (Jamaica)' },
  'nassau': { code: 'NAS', name: 'Nassau (Bahamas)' },
  'bahamas': { code: 'NAS', name: 'Nassau (Bahamas)' },
  'aruba': { code: 'AUA', name: 'Aruba' },
  'curacao': { code: 'CUR', name: 'Curaçao' },
  'curaçao': { code: 'CUR', name: 'Curaçao' },
  'st lucia': { code: 'UVF', name: 'St Lucia' },
  'saint lucia': { code: 'UVF', name: 'St Lucia' },
  'martinique': { code: 'FDF', name: 'Martinique' },
  'guadeloupe': { code: 'PTP', name: 'Guadeloupe' },
  'trinidad': { code: 'POS', name: 'Trinidad' },
  // ── More Caribbean & islands ─────────────────────────────────────────────────
  'antigua': { code: 'ANU', name: 'Antigua' },
  'anu': { code: 'ANU', name: 'Antigua' },
  'antigua and barbuda': { code: 'ANU', name: 'Antigua & Barbuda' },
  'grenada': { code: 'GND', name: 'Grenada (Caribbean)' },
  'gnd': { code: 'GND', name: 'Grenada' },
  'st kitts': { code: 'SKB', name: 'St Kitts' },
  'saint kitts': { code: 'SKB', name: 'St Kitts' },
  'nevis': { code: 'SKB', name: 'St Kitts & Nevis' },
  'skb': { code: 'SKB', name: 'St Kitts' },
  'dominica': { code: 'DOM', name: 'Dominica' },
  'dom': { code: 'DOM', name: 'Dominica' },
  'st vincent': { code: 'SVD', name: 'St Vincent' },
  'saint vincent': { code: 'SVD', name: 'St Vincent' },
  'svd': { code: 'SVD', name: 'St Vincent' },
  'turks and caicos': { code: 'PLS', name: 'Turks & Caicos (Providenciales)' },
  'providenciales': { code: 'PLS', name: 'Providenciales (Turks & Caicos)' },
  'pls': { code: 'PLS', name: 'Providenciales' },
  'anguilla': { code: 'AXA', name: 'Anguilla' },
  'cayman islands': { code: 'GCM', name: 'Grand Cayman' },
  'grand cayman': { code: 'GCM', name: 'Grand Cayman' },
  'gcm': { code: 'GCM', name: 'Grand Cayman' },
  'bermuda': { code: 'BDA', name: 'Bermuda' },
  'bda': { code: 'BDA', name: 'Bermuda' },
  'haiti': { code: 'PAP', name: 'Port-au-Prince (Haiti)' },
  'port-au-prince': { code: 'PAP', name: 'Port-au-Prince' },
  'port au prince': { code: 'PAP', name: 'Port-au-Prince' },
  'pap': { code: 'PAP', name: 'Port-au-Prince' },
  'trinidad and tobago': { code: 'POS', name: 'Trinidad & Tobago' },
  'port of spain': { code: 'POS', name: 'Port of Spain' },
  'pos': { code: 'POS', name: 'Port of Spain' },
  'tobago': { code: 'TAB', name: 'Tobago' },
  'tab': { code: 'TAB', name: 'Tobago' },
  // ── Central America ─────────────────────────────────────────────────────────
  'belize': { code: 'BZE', name: 'Belize City' },
  'belize city': { code: 'BZE', name: 'Belize City' },
  'bze': { code: 'BZE', name: 'Belize City' },
  'el salvador': { code: 'SAL', name: 'El Salvador (San Salvador)' },
  'san salvador': { code: 'SAL', name: 'San Salvador' },
  'sal': { code: 'SAL', name: 'San Salvador' },
  'honduras': { code: 'TGU', name: 'Tegucigalpa (Honduras)' },
  'tegucigalpa': { code: 'TGU', name: 'Tegucigalpa' },
  'tgu': { code: 'TGU', name: 'Tegucigalpa' },
  'san pedro sula': { code: 'SAP', name: 'San Pedro Sula (Honduras)' },
  'sap': { code: 'SAP', name: 'San Pedro Sula' },
  'nicaragua': { code: 'MGA', name: 'Managua (Nicaragua)' },
  'managua': { code: 'MGA', name: 'Managua' },
  'mga': { code: 'MGA', name: 'Managua' },
  'guatemala': { code: 'GUA', name: 'Guatemala City' },
  'guatemala city': { code: 'GUA', name: 'Guatemala City' },
  'gua': { code: 'GUA', name: 'Guatemala City' },
  'san jose': { code: 'SJO', name: 'San José (Costa Rica)' },
  'sjo': { code: 'SJO', name: 'San José (Costa Rica)' },
  'liberia costa rica': { code: 'LIR', name: 'Liberia (Guanacaste, CR)' },
  'guanacaste': { code: 'LIR', name: 'Guanacaste (Costa Rica)' },
  'lir': { code: 'LIR', name: 'Liberia (Guanacaste)' },
  'panama city': { code: 'PTY', name: 'Panama City' },
  'bogota': { code: 'BOG', name: 'Bogotá' },
  'bogotá': { code: 'BOG', name: 'Bogotá' },
  'medellin': { code: 'MDE', name: 'Medellín' },
  'medellín': { code: 'MDE', name: 'Medellín' },
  'cali': { code: 'CLO', name: 'Cali (Colombia)' },
  'cali colombia': { code: 'CLO', name: 'Cali (Colombia)' },
  'clo': { code: 'CLO', name: 'Cali' },
  'barranquilla': { code: 'BAQ', name: 'Barranquilla' },
  'baq': { code: 'BAQ', name: 'Barranquilla' },
  'bucaramanga': { code: 'BGA', name: 'Bucaramanga' },
  'bga': { code: 'BGA', name: 'Bucaramanga' },
  'cartagena': { code: 'CTG', name: 'Cartagena (Colombia)' },
  'lima': { code: 'LIM', name: 'Lima' },
  'cusco': { code: 'CUZ', name: 'Cusco' },
  'cuzco': { code: 'CUZ', name: 'Cusco' },
  'machu picchu': { code: 'CUZ', name: 'Machu Picchu (via Cusco)' },
  'arequipa': { code: 'AQP', name: 'Arequipa' },
  'aqp': { code: 'AQP', name: 'Arequipa' },
  'iquitos': { code: 'IQT', name: 'Iquitos' },
  'iqt': { code: 'IQT', name: 'Iquitos' },
  'ecuador': { code: 'UIO', name: 'Quito (Ecuador)' },
  'santiago': { code: 'SCL', name: 'Santiago' },
  'santiago chile': { code: 'SCL', name: 'Santiago (Chile)' },
  'valparaiso': { code: 'SCL', name: 'Valparaíso (via Santiago)' },
  'punta arenas': { code: 'PUQ', name: 'Punta Arenas' },
  'puq': { code: 'PUQ', name: 'Punta Arenas' },
  'antofagasta': { code: 'ANF', name: 'Antofagasta' },
  'anf': { code: 'ANF', name: 'Antofagasta' },
  'buenos aires': { code: 'EZE', name: 'Buenos Aires' },
  'baires': { code: 'EZE', name: 'Buenos Aires' },
  'eze': { code: 'EZE', name: 'Buenos Aires (Ezeiza)' },
  'aeroparque': { code: 'AEP', name: 'Buenos Aires (Aeroparque)' },
  'aep': { code: 'AEP', name: 'Buenos Aires (Aeroparque)' },
  'rosario': { code: 'ROS', name: 'Rosario (Argentina)' },
  'ros': { code: 'ROS', name: 'Rosario' },
  'mendoza': { code: 'MDZ', name: 'Mendoza' },
  'mdz': { code: 'MDZ', name: 'Mendoza' },
  'cordoba argentina': { code: 'COR', name: 'Córdoba (Argentina)' },
  'cordoba ar': { code: 'COR', name: 'Córdoba (Argentina)' },
  'cor': { code: 'COR', name: 'Córdoba (Argentina)' },
  'bariloche': { code: 'BRC', name: 'Bariloche' },
  'brc': { code: 'BRC', name: 'Bariloche' },
  'sao paulo': { code: 'GRU', name: 'São Paulo' },
  'são paulo': { code: 'GRU', name: 'São Paulo' },
  'gru': { code: 'GRU', name: 'São Paulo (Guarulhos)' },
  'rio de janeiro': { code: 'GIG', name: 'Rio de Janeiro' },
  'rio': { code: 'GIG', name: 'Rio de Janeiro' },
  'gig': { code: 'GIG', name: 'Rio de Janeiro (Galeão)' },
  'brasilia': { code: 'BSB', name: 'Brasília' },
  'brasília': { code: 'BSB', name: 'Brasília' },
  'bsb': { code: 'BSB', name: 'Brasília' },
  'fortaleza': { code: 'FOR', name: 'Fortaleza' },
  // NOTE: bare 'for' alias intentionally removed — collides with the English
  // preposition ("guadalajara for a couple" used to resolve as Fortaleza).
  // Users wanting Fortaleza can type 'fortaleza' or its IATA code FOR via the
  // explicit 3-letter scan (which is itself blocked by _COMMON_WORDS for 'for'
  // — the airport-database fallback still handles uppercase FOR).
  // 'for': { code: 'FOR', name: 'Fortaleza' },
  'recife': { code: 'REC', name: 'Recife' },
  'rec': { code: 'REC', name: 'Recife' },
  'salvador bahia': { code: 'SSA', name: 'Salvador (Bahia)' },
  'salvador brazil': { code: 'SSA', name: 'Salvador (Bahia)' },
  'ssa': { code: 'SSA', name: 'Salvador (Bahia)' },
  'belo horizonte': { code: 'CNF', name: 'Belo Horizonte' },
  'cnf': { code: 'CNF', name: 'Belo Horizonte' },
  'porto alegre': { code: 'POA', name: 'Porto Alegre' },
  'poa': { code: 'POA', name: 'Porto Alegre' },
  'florianopolis': { code: 'FLN', name: 'Florianópolis' },
  'florianópolis': { code: 'FLN', name: 'Florianópolis' },
  'fln': { code: 'FLN', name: 'Florianópolis' },
  'natal brazil': { code: 'NAT', name: 'Natal (Brazil)' },
  'nat': { code: 'NAT', name: 'Natal (Brazil)' },
  'belem': { code: 'BEL', name: 'Belém' },
  'belém': { code: 'BEL', name: 'Belém' },
  'bel': { code: 'BEL', name: 'Belém' },
  'curitiba': { code: 'CWB', name: 'Curitiba' },
  'cwb': { code: 'CWB', name: 'Curitiba' },
  'manaus': { code: 'MAO', name: 'Manaus' },
  'mao': { code: 'MAO', name: 'Manaus' },
  'quito': { code: 'UIO', name: 'Quito' },
  'uio': { code: 'UIO', name: 'Quito' },
  'guayaquil': { code: 'GYE', name: 'Guayaquil' },
  'gye': { code: 'GYE', name: 'Guayaquil' },
  'la paz': { code: 'LPB', name: 'La Paz (Bolivia)' },
  'lpb': { code: 'LPB', name: 'La Paz' },
  'cochabamba': { code: 'CBB', name: 'Cochabamba' },
  'cbb': { code: 'CBB', name: 'Cochabamba' },
  'santa cruz bolivia': { code: 'VVI', name: 'Santa Cruz de la Sierra' },
  'santa cruz de la sierra': { code: 'VVI', name: 'Santa Cruz de la Sierra' },
  'vvi': { code: 'VVI', name: 'Santa Cruz de la Sierra' },
  'montevideo': { code: 'MVD', name: 'Montevideo' },
  'mvd': { code: 'MVD', name: 'Montevideo' },
  'asuncion': { code: 'ASU', name: 'Asunción' },
  'asunción': { code: 'ASU', name: 'Asunción' },
  'asu': { code: 'ASU', name: 'Asunción' },
  'venezuela': { code: 'CCS', name: 'Caracas (Venezuela)' },
  'caracas': { code: 'CCS', name: 'Caracas' },
  'ccs': { code: 'CCS', name: 'Caracas' },
  'bogota colombia': { code: 'BOG', name: 'Bogotá' },
  // ── Oceania ──────────────────────────────────────────────────────────────────
  'sydney': { code: 'SYD', name: 'Sydney' },
  'melbourne': { code: 'MEL', name: 'Melbourne' },
  'brisbane': { code: 'BNE', name: 'Brisbane' },
  'perth': { code: 'PER', name: 'Perth' },
  'adelaide': { code: 'ADL', name: 'Adelaide' },
  'canberra': { code: 'CBR', name: 'Canberra' },
  'hobart': { code: 'HBA', name: 'Hobart' },
  'gold coast': { code: 'OOL', name: 'Gold Coast' },
  'cairns': { code: 'CNS', name: 'Cairns' },
  'darwin': { code: 'DRW', name: 'Darwin' },
  'townsville': { code: 'TSV', name: 'Townsville' },
  'mackay': { code: 'MKY', name: 'Mackay' },
  'rockhampton': { code: 'ROK', name: 'Rockhampton' },
  'alice springs': { code: 'ASP', name: 'Alice Springs' },
  'asp': { code: 'ASP', name: 'Alice Springs' },
  'broome': { code: 'BME', name: 'Broome' },
  'launceston': { code: 'LST', name: 'Launceston' },
  'sunshine coast': { code: 'MCY', name: 'Sunshine Coast' },
  'mcy': { code: 'MCY', name: 'Sunshine Coast' },
  'auckland': { code: 'AKL', name: 'Auckland' },
  'akl': { code: 'AKL', name: 'Auckland' },
  'wellington': { code: 'WLG', name: 'Wellington' },
  'wlg': { code: 'WLG', name: 'Wellington' },
  'christchurch': { code: 'CHC', name: 'Christchurch' },
  'chc': { code: 'CHC', name: 'Christchurch' },
  'queenstown': { code: 'ZQN', name: 'Queenstown' },
  'zqn': { code: 'ZQN', name: 'Queenstown' },
  'dunedin': { code: 'DUD', name: 'Dunedin' },
  'nadi': { code: 'NAN', name: 'Nadi (Fiji)' },
  'fiji': { code: 'NAN', name: 'Nadi (Fiji)' },
  'nan': { code: 'NAN', name: 'Nadi (Fiji)' },
  'samoa': { code: 'APW', name: 'Apia (Samoa)' },
  'apia': { code: 'APW', name: 'Apia (Samoa)' },
  'apw': { code: 'APW', name: 'Apia' },
  'tonga': { code: 'TBU', name: "Nuku'alofa (Tonga)" },
  "nuku'alofa": { code: 'TBU', name: "Nuku'alofa" },
  'vanuatu': { code: 'VLI', name: 'Port Vila (Vanuatu)' },
  'port vila': { code: 'VLI', name: 'Port Vila' },
  'solomon islands': { code: 'HIR', name: 'Honiara' },
  'honiara': { code: 'HIR', name: 'Honiara' },
  'papua new guinea': { code: 'POM', name: 'Port Moresby' },
  'port moresby': { code: 'POM', name: 'Port Moresby' },
  // ── Hawaii ───────────────────────────────────────────────────────────────────
  'honolulu': { code: 'HNL', name: 'Honolulu' },
  'hawaii': { code: 'HNL', name: 'Honolulu' },
  'oahu': { code: 'HNL', name: 'Honolulu' },
  'maui': { code: 'OGG', name: 'Maui (Kahului)' },
  'kahului': { code: 'OGG', name: 'Maui (Kahului)' },
  'kona': { code: 'KOA', name: 'Kona (Big Island)' },
  'kailua-kona': { code: 'KOA', name: 'Kona (Big Island)' },
  'big island': { code: 'KOA', name: 'Kona (Big Island)' },
  'kauai': { code: 'LIH', name: 'Kauai (Lihue)' },
  'lihue': { code: 'LIH', name: 'Kauai (Lihue)' },
  'hilo': { code: 'ITO', name: 'Hilo' },
  'papeete': { code: 'PPT', name: 'Papeete (Tahiti)' },
  'tahiti': { code: 'PPT', name: 'Papeete (Tahiti)' },
  'ppt': { code: 'PPT', name: 'Papeete' },
  'french polynesia': { code: 'PPT', name: 'French Polynesia (Papeete)' },
  'bora bora': { code: 'BOB', name: 'Bora Bora' },
  'bob': { code: 'BOB', name: 'Bora Bora' },
  'moorea': { code: 'MOZ', name: 'Moorea' },
  'moz': { code: 'MOZ', name: 'Moorea' },
  'cook islands': { code: 'RAR', name: 'Rarotonga (Cook Islands)' },
  'rarotonga': { code: 'RAR', name: 'Rarotonga' },
  'rar': { code: 'RAR', name: 'Rarotonga' },
  'noumea': { code: 'NOU', name: 'Nouméa' },
  'nou': { code: 'NOU', name: 'Nouméa' },
  // ── Caribbean extra islands ──────────────────────────────────────────────────
  'st martin': { code: 'SXM', name: 'St Martin / Sint Maarten' },
  'sint maarten': { code: 'SXM', name: 'Sint Maarten (Dutch side)' },
  'saint martin': { code: 'SXM', name: 'St Martin' },
  'sxm': { code: 'SXM', name: 'Sint Maarten' },
  'st barts': { code: 'SBH', name: 'St Barths (Gustavia)' },
  'st barths': { code: 'SBH', name: 'St Barths' },
  'saint barthelemy': { code: 'SBH', name: 'St Barths' },
  'saint-barths': { code: 'SBH', name: 'St Barths' },
  'sbh': { code: 'SBH', name: 'St Barths' },
  'bonaire': { code: 'BON', name: 'Bonaire' },
  'bon': { code: 'BON', name: 'Bonaire' },
  'saba': { code: 'SAB', name: 'Saba' },
  'st eustatius': { code: 'EUX', name: 'St Eustatius' },
  'cayman brac': { code: 'CYB', name: 'Cayman Brac' },
  'little cayman': { code: 'LYB', name: 'Little Cayman' },
  'montserrat': { code: 'MNI', name: 'Montserrat' },
  'guyana': { code: 'GEO', name: 'Georgetown (Guyana)' },
  'suriname': { code: 'PBM', name: 'Paramaribo (Suriname)' },
  'paramaribo': { code: 'PBM', name: 'Paramaribo' },
  // ── South America unique destinations ────────────────────────────────────────
  'galapagos': { code: 'GPS', name: 'Galápagos Islands' },
  'galápagos': { code: 'GPS', name: 'Galápagos Islands' },
  'galapagos islands': { code: 'GPS', name: 'Galápagos Islands' },
  'gps': { code: 'GPS', name: 'Galápagos' },
  'easter island': { code: 'IPC', name: 'Easter Island (Hanga Roa)' },
  'isla de pascua': { code: 'IPC', name: 'Easter Island' },
  'rapa nui': { code: 'IPC', name: 'Rapa Nui / Easter Island' },
  'ipc': { code: 'IPC', name: 'Easter Island' },
  'iguazu falls': { code: 'IGR', name: 'Iguazú Falls (Argentina side)' },
  'iguazú falls': { code: 'IGR', name: 'Iguazú Falls (Argentina side)' },
  'iguazu argentina': { code: 'IGR', name: 'Iguazú Falls Argentina' },
  'igr': { code: 'IGR', name: 'Iguazú (Argentina)' },
  'foz do iguacu': { code: 'IGU', name: 'Foz do Iguaçu (Brazil side)' },
  'foz do iguaçu': { code: 'IGU', name: 'Foz do Iguaçu' },
  'iguazu brazil': { code: 'IGU', name: 'Iguazú Falls Brazil' },
  'igu': { code: 'IGU', name: 'Foz do Iguaçu' },
  'ushuaia': { code: 'USH', name: 'Ushuaia (Patagonia)' },
  'patagonia argentina': { code: 'USH', name: 'Patagonia (via Ushuaia)' },
  'ush': { code: 'USH', name: 'Ushuaia' },
  'el calafate': { code: 'FTE', name: 'El Calafate (Patagonia)' },
  'perito moreno': { code: 'FTE', name: 'Perito Moreno Glacier (via El Calafate)' },
  'fte': { code: 'FTE', name: 'El Calafate' },
  'el chalten': { code: 'FTE', name: 'El Chaltén (via El Calafate)' },
  'torres del paine': { code: 'PUQ', name: 'Torres del Paine (via Punta Arenas)' },
  'patagonia chile': { code: 'PUQ', name: 'Chilean Patagonia (Punta Arenas)' },
  'tierra del fuego': { code: 'USH', name: 'Tierra del Fuego (via Ushuaia)' },
  // ── Africa wildlife & nature ─────────────────────────────────────────────────
  'kilimanjaro': { code: 'JRO', name: 'Kilimanjaro' },
  'jro': { code: 'JRO', name: 'Kilimanjaro' },
  'arusha': { code: 'ARK', name: 'Arusha (Tanzania)' },
  'ark': { code: 'ARK', name: 'Arusha' },
  'serengeti': { code: 'JRO', name: 'Serengeti (via Kilimanjaro)' },
  'ngorongoro': { code: 'JRO', name: 'Ngorongoro (via Kilimanjaro)' },
  'victoria falls': { code: 'VFA', name: 'Victoria Falls (Zimbabwe)' },
  'vfa': { code: 'VFA', name: 'Victoria Falls' },
  'livingstone': { code: 'LVI', name: 'Livingstone (Zambia, Victoria Falls)' },
  'lvi': { code: 'LVI', name: 'Livingstone' },
  'okavango': { code: 'MUB', name: 'Okavango Delta (via Maun)' },
  'maun': { code: 'MUB', name: 'Maun (Okavango Delta)' },
  'mub': { code: 'MUB', name: 'Maun' },
  'chobe': { code: 'BBK', name: 'Kasane (Chobe NP)' },
  'kasane': { code: 'BBK', name: 'Kasane (Chobe NP)' },
  'bbk': { code: 'BBK', name: 'Kasane' },
  'kruger park': { code: 'HLA', name: 'Kruger Park (Hoedspruit)' },
  'hoedspruit': { code: 'HLA', name: 'Hoedspruit (Kruger)' },
  'hla': { code: 'HLA', name: 'Hoedspruit' },
  'masai mara': { code: 'MRE', name: 'Masai Mara' },
  'maasai mara': { code: 'MRE', name: 'Masai Mara' },
  'mre': { code: 'MRE', name: 'Masai Mara' },
  'amboseli': { code: 'ASV', name: 'Amboseli NP' },
  'asv': { code: 'ASV', name: 'Amboseli' },
  'abu simbel': { code: 'ABS', name: 'Abu Simbel' },
  'abs': { code: 'ABS', name: 'Abu Simbel' },
  // ── Greek islands not yet listed ─────────────────────────────────────────────
  'paros': { code: 'PAS', name: 'Paros' },
  'pas': { code: 'PAS', name: 'Paros' },
  'naxos': { code: 'JNX', name: 'Naxos' },
  'jnx': { code: 'JNX', name: 'Naxos' },
  'milos': { code: 'MLO', name: 'Milos' },
  'mlo': { code: 'MLO', name: 'Milos' },
  'lemnos': { code: 'LXS', name: 'Lemnos (Myrina)' },
  'limnos': { code: 'LXS', name: 'Lemnos' },
  'lxs': { code: 'LXS', name: 'Lemnos' },
  'skyros': { code: 'SKU', name: 'Skyros' },
  'sku': { code: 'SKU', name: 'Skyros' },
  'ikaria': { code: 'JIK', name: 'Ikaria' },
  'jik': { code: 'JIK', name: 'Ikaria' },
  // ── Asian tourist highlights ─────────────────────────────────────────────────
  'halong bay': { code: 'HAN', name: 'Ha Long Bay (via Hanoi)' },
  'ha long bay': { code: 'HAN', name: 'Ha Long Bay (via Hanoi)' },
  'hue': { code: 'HUI', name: 'Hue (Vietnam)' },
  'hui': { code: 'HUI', name: 'Hue' },
  'hoi an': { code: 'DAD', name: 'Hoi An (via Da Nang)' },
  'pattaya': { code: 'BKK', name: 'Pattaya (via Bangkok)' },
  'hua hin': { code: 'HHQ', name: 'Hua Hin' },
  'hhq': { code: 'HHQ', name: 'Hua Hin' },
  'koh phangan': { code: 'USM', name: 'Koh Phangan (via Koh Samui)' },
  'koh tao': { code: 'USM', name: 'Koh Tao (via Koh Samui)' },
  'ko phangan': { code: 'USM', name: 'Koh Phangan (via Koh Samui)' },
  'chiang rai': { code: 'CEI', name: 'Chiang Rai' },
  'cei': { code: 'CEI', name: 'Chiang Rai' },
  'bagan': { code: 'NYU', name: 'Bagan (Myanmar)' },
  'nyu': { code: 'NYU', name: 'Bagan (Nyaung U)' },
  'inle lake': { code: 'HEH', name: 'Inle Lake (Heho)' },
  'heho': { code: 'HEH', name: 'Heho (Inle Lake)' },
  'heh': { code: 'HEH', name: 'Heho' },
  'leh': { code: 'IXL', name: 'Leh (Ladakh)' },
  'ladakh': { code: 'IXL', name: 'Ladakh (Leh)' },
  'ixl': { code: 'IXL', name: 'Leh / Ladakh' },
  'dharamsala': { code: 'DHM', name: 'Dharamsala / McLeod Ganj' },
  'mcleod ganj': { code: 'DHM', name: 'McLeod Ganj (Dharamsala)' },
  'dhm': { code: 'DHM', name: 'Dharamsala' },
  'jodhpur': { code: 'JDH', name: 'Jodhpur' },
  'jdh': { code: 'JDH', name: 'Jodhpur' },
  'khajuraho': { code: 'HJR', name: 'Khajuraho' },
  'hjr': { code: 'HJR', name: 'Khajuraho' },
  'varanasi india': { code: 'VNS', name: 'Varanasi' },
  'benares': { code: 'VNS', name: 'Varanasi (Benares)' },
  'aurangabad': { code: 'IXU', name: 'Aurangabad (Ellora/Ajanta Caves)' },
  'ellora': { code: 'IXU', name: 'Ellora Caves (via Aurangabad)' },
  'ajanta': { code: 'IXU', name: 'Ajanta Caves (via Aurangabad)' },
  'ixu': { code: 'IXU', name: 'Aurangabad' },
  'hampi': { code: 'HYD', name: 'Hampi (via Hyderabad)' },
  'pondicherry': { code: 'MAA', name: 'Pondicherry (via Chennai)' },
  'puducherry': { code: 'MAA', name: 'Puducherry (via Chennai)' },
  'varkala': { code: 'TRV', name: 'Varkala (via Trivandrum)' },
  'kovalam': { code: 'TRV', name: 'Kovalam (via Trivandrum)' },
  'gokarna': { code: 'GOI', name: 'Gokarna (via Goa)' },
  'wadi rum': { code: 'AQJ', name: 'Wadi Rum (via Aqaba)' },
  'dead sea': { code: 'AMM', name: 'Dead Sea (via Amman)' },
  'nazareth': { code: 'TLV', name: 'Nazareth (via Tel Aviv)' },

  // ── Japanese-language city names (katakana / kanji) ───────────────────────
  '東京': { code: 'TYO', name: 'Tokyo' },
  'ロンドン': { code: 'LON', name: 'London' },
  'パリ': { code: 'CDG', name: 'Paris' },
  'ニューヨーク': { code: 'JFK', name: 'New York' },
  'ベルリン': { code: 'BER', name: 'Berlin' },
  'バルセロナ': { code: 'BCN', name: 'Barcelona' },
  'ローマ': { code: 'FCO', name: 'Rome' },
  'ミラノ': { code: 'MXP', name: 'Milan' },
  'ナポリ': { code: 'NAP', name: 'Naples' },
  'ベネチア': { code: 'VCE', name: 'Venice' },
  'フィレンツェ': { code: 'FLR', name: 'Florence' },
  'マドリード': { code: 'MAD', name: 'Madrid' },
  'アムステルダム': { code: 'AMS', name: 'Amsterdam' },
  'ウィーン': { code: 'VIE', name: 'Vienna' },
  'ブリュッセル': { code: 'BRU', name: 'Brussels' },
  'プラハ': { code: 'PRG', name: 'Prague' },
  'ブダペスト': { code: 'BUD', name: 'Budapest' },
  'ワルシャワ': { code: 'WAW', name: 'Warsaw' },
  'イスタンブール': { code: 'IST', name: 'Istanbul' },
  'アテネ': { code: 'ATH', name: 'Athens' },
  'コペンハーゲン': { code: 'CPH', name: 'Copenhagen' },
  'ストックホルム': { code: 'ARN', name: 'Stockholm' },
  'ヘルシンキ': { code: 'HEL', name: 'Helsinki' },
  'オスロ': { code: 'OSL', name: 'Oslo' },
  'リスボン': { code: 'LIS', name: 'Lisbon' },
  'シンガポール': { code: 'SIN', name: 'Singapore' },
  'ドバイ': { code: 'DXB', name: 'Dubai' },
  'バンコク': { code: 'BKK', name: 'Bangkok' },
  'シドニー': { code: 'SYD', name: 'Sydney' },
  'ソウル': { code: 'ICN', name: 'Seoul' },
  '北京': { code: 'PEK', name: 'Beijing' },
  '上海': { code: 'PVG', name: 'Shanghai' },
  '大阪': { code: 'KIX', name: 'Osaka' },
  '香港': { code: 'HKG', name: 'Hong Kong' },
  'バリ': { code: 'DPS', name: 'Bali' },
  'プーケット': { code: 'HKT', name: 'Phuket' },
  'クアラルンプール': { code: 'KUL', name: 'Kuala Lumpur' },
  'ジャカルタ': { code: 'CGK', name: 'Jakarta' },
  'ホーチミン': { code: 'SGN', name: 'Ho Chi Minh City' },
  'ハノイ': { code: 'HAN', name: 'Hanoi' },
  'カイロ': { code: 'CAI', name: 'Cairo' },
  'モスクワ': { code: 'SVO', name: 'Moscow' },
  'ミュンヘン': { code: 'MUC', name: 'Munich' },
  'フランクフルト': { code: 'FRA', name: 'Frankfurt' },
  'ハンブルク': { code: 'HAM', name: 'Hamburg' },
  'チューリッヒ': { code: 'ZRH', name: 'Zurich' },
  'ジュネーブ': { code: 'GVA', name: 'Geneva' },
  'バンクーバー': { code: 'YVR', name: 'Vancouver' },
  'トロント': { code: 'YYZ', name: 'Toronto' },
  'シカゴ': { code: 'ORD', name: 'Chicago' },
  'ロサンゼルス': { code: 'LAX', name: 'Los Angeles' },
  'マイアミ': { code: 'MIA', name: 'Miami' },
  'ムンバイ': { code: 'BOM', name: 'Mumbai' },
  'デリー': { code: 'DEL', name: 'Delhi' },
  'チェンナイ': { code: 'MAA', name: 'Chennai' },
  'ドーハ': { code: 'DOH', name: 'Doha' },
  'アブダビ': { code: 'AUH', name: 'Abu Dhabi' },
  'リヤド': { code: 'RUH', name: 'Riyadh' },
  'メキシコシティ': { code: 'MEX', name: 'Mexico City' },
  'サンパウロ': { code: 'GRU', name: 'São Paulo' },
  'ブエノスアイレス': { code: 'EZE', name: 'Buenos Aires' },
  'ヨハネスブルグ': { code: 'JNB', name: 'Johannesburg' },
  'ナイロビ': { code: 'NBO', name: 'Nairobi' },
  'ケープタウン': { code: 'CPT', name: 'Cape Town' },

  // ── Chinese-language city names (simplified hanzi) ────────────────────────
  '伦敦': { code: 'LON', name: 'London' },
  '巴黎': { code: 'CDG', name: 'Paris' },
  '柏林': { code: 'BER', name: 'Berlin' },
  '纽约': { code: 'JFK', name: 'New York' },
  '罗马': { code: 'FCO', name: 'Rome' },
  '巴塞罗那': { code: 'BCN', name: 'Barcelona' },
  '马德里': { code: 'MAD', name: 'Madrid' },
  '阿姆斯特丹': { code: 'AMS', name: 'Amsterdam' },
  '布鲁塞尔': { code: 'BRU', name: 'Brussels' },
  '维也纳': { code: 'VIE', name: 'Vienna' },
  '伊斯坦布尔': { code: 'IST', name: 'Istanbul' },
  '雅典': { code: 'ATH', name: 'Athens' },
  '哥本哈根': { code: 'CPH', name: 'Copenhagen' },
  '斯德哥尔摩': { code: 'ARN', name: 'Stockholm' },
  '赫尔辛基': { code: 'HEL', name: 'Helsinki' },
  '奥斯陆': { code: 'OSL', name: 'Oslo' },
  '里斯本': { code: 'LIS', name: 'Lisbon' },
  '米兰': { code: 'MXP', name: 'Milan' },
  '那不勒斯': { code: 'NAP', name: 'Naples' },
  '威尼斯': { code: 'VCE', name: 'Venice' },
  '佛罗伦萨': { code: 'FLR', name: 'Florence' },
  '开罗': { code: 'CAI', name: 'Cairo' },
  '迪拜': { code: 'DXB', name: 'Dubai' },
  '莫斯科': { code: 'SVO', name: 'Moscow' },
  '新加坡': { code: 'SIN', name: 'Singapore' },
  '曼谷': { code: 'BKK', name: 'Bangkok' },
  '悉尼': { code: 'SYD', name: 'Sydney' },
  '吉隆坡': { code: 'KUL', name: 'Kuala Lumpur' },
  '雅加达': { code: 'CGK', name: 'Jakarta' },
  '河内': { code: 'HAN', name: 'Hanoi' },
  '胡志明市': { code: 'SGN', name: 'Ho Chi Minh City' },
  '东京': { code: 'TYO', name: 'Tokyo' },
  '首尔': { code: 'ICN', name: 'Seoul' },
  '澳门': { code: 'MFM', name: 'Macau' },
  '台北': { code: 'TPE', name: 'Taipei' },
  '慕尼黑': { code: 'MUC', name: 'Munich' },
  '法兰克福': { code: 'FRA', name: 'Frankfurt' },
  '汉堡': { code: 'HAM', name: 'Hamburg' },
  '苏黎世': { code: 'ZRH', name: 'Zurich' },
  '日内瓦': { code: 'GVA', name: 'Geneva' },
  '温哥华': { code: 'YVR', name: 'Vancouver' },
  '多伦多': { code: 'YYZ', name: 'Toronto' },
  '芝加哥': { code: 'ORD', name: 'Chicago' },
  '洛杉矶': { code: 'LAX', name: 'Los Angeles' },
  '迈阿密': { code: 'MIA', name: 'Miami' },
  '孟买': { code: 'BOM', name: 'Mumbai' },
  '新德里': { code: 'DEL', name: 'Delhi' },
  '金奈': { code: 'MAA', name: 'Chennai' },
  '多哈': { code: 'DOH', name: 'Doha' },
  '阿布扎比': { code: 'AUH', name: 'Abu Dhabi' },
  '利雅得': { code: 'RUH', name: 'Riyadh' },
  '墨西哥城': { code: 'MEX', name: 'Mexico City' },
  '圣保罗': { code: 'GRU', name: 'São Paulo' },
  '约翰内斯堡': { code: 'JNB', name: 'Johannesburg' },
  '内罗毕': { code: 'NBO', name: 'Nairobi' },
  '开普敦': { code: 'CPT', name: 'Cape Town' },

  // ── Russian-language city names (Cyrillic) ────────────────────────────────
  'москва': { code: 'SVO', name: 'Moscow' },
  'санкт-петербург': { code: 'LED', name: 'Saint Petersburg' },
  'лондон': { code: 'LON', name: 'London' },
  'париж': { code: 'CDG', name: 'Paris' },
  'берлин': { code: 'BER', name: 'Berlin' },
  'рим': { code: 'FCO', name: 'Rome' },
  'мюнхен': { code: 'MUC', name: 'Munich' },
  'франкфурт': { code: 'FRA', name: 'Frankfurt' },
  'гамбург': { code: 'HAM', name: 'Hamburg' },
  'вена': { code: 'VIE', name: 'Vienna' },
  'прага': { code: 'PRG', name: 'Prague' },
  'будапешт': { code: 'BUD', name: 'Budapest' },
  'варшава': { code: 'WAW', name: 'Warsaw' },
  'краков': { code: 'KRK', name: 'Krakow' },
  'стокгольм': { code: 'ARN', name: 'Stockholm' },
  'копенгаген': { code: 'CPH', name: 'Copenhagen' },
  'хельсинки': { code: 'HEL', name: 'Helsinki' },
  'осло': { code: 'OSL', name: 'Oslo' },
  'амстердам': { code: 'AMS', name: 'Amsterdam' },
  'брюссель': { code: 'BRU', name: 'Brussels' },
  'барселона': { code: 'BCN', name: 'Barcelona' },
  'мадрид': { code: 'MAD', name: 'Madrid' },
  'лиссабон': { code: 'LIS', name: 'Lisbon' },
  'стамбул': { code: 'IST', name: 'Istanbul' },
  'афины': { code: 'ATH', name: 'Athens' },
  'дубай': { code: 'DXB', name: 'Dubai' },
  'нью-йорк': { code: 'JFK', name: 'New York' },
  'токио': { code: 'TYO', name: 'Tokyo' },
  'пекин': { code: 'PEK', name: 'Beijing' },
  'шанхай': { code: 'PVG', name: 'Shanghai' },
  'гонконг': { code: 'HKG', name: 'Hong Kong' },
  'сингапур': { code: 'SIN', name: 'Singapore' },
  'бангкок': { code: 'BKK', name: 'Bangkok' },
  'сидней': { code: 'SYD', name: 'Sydney' },
  'куала-лумпур': { code: 'KUL', name: 'Kuala Lumpur' },
  'джакарта': { code: 'CGK', name: 'Jakarta' },
  'каир': { code: 'CAI', name: 'Cairo' },
  'найроби': { code: 'NBO', name: 'Nairobi' },
  'йоханнесбург': { code: 'JNB', name: 'Johannesburg' },
  'кейптаун': { code: 'CPT', name: 'Cape Town' },
  'дели': { code: 'DEL', name: 'Delhi' },
  'мумбаи': { code: 'BOM', name: 'Mumbai' },
  'мехико': { code: 'MEX', name: 'Mexico City' },
  'торонто': { code: 'YYZ', name: 'Toronto' },
  'ванкувер': { code: 'YVR', name: 'Vancouver' },
  'чикаго': { code: 'ORD', name: 'Chicago' },
  'лос-анджелес': { code: 'LAX', name: 'Los Angeles' },
  'майами': { code: 'MIA', name: 'Miami' },
  'милан': { code: 'MXP', name: 'Milan' },
  'неаполь': { code: 'NAP', name: 'Naples' },
  'венеция': { code: 'VCE', name: 'Venice' },
  'флоренция': { code: 'FLR', name: 'Florence' },
  'доха': { code: 'DOH', name: 'Doha' },
  'абу-даби': { code: 'AUH', name: 'Abu Dhabi' },
  'эр-рияд': { code: 'RUH', name: 'Riyadh' },
  'сеул': { code: 'ICN', name: 'Seoul' },
  'осака': { code: 'KIX', name: 'Osaka' },
  'ханой': { code: 'HAN', name: 'Hanoi' },
  'хошимин': { code: 'SGN', name: 'Ho Chi Minh City' },
  'пхукет': { code: 'HKT', name: 'Phuket' },
  'бали': { code: 'DPS', name: 'Bali' },
  'цюрих': { code: 'ZRH', name: 'Zurich' },
  'женева': { code: 'GVA', name: 'Geneva' },
  'сан-паулу': { code: 'GRU', name: 'São Paulo' },
  'буэнос-айрес': { code: 'EZE', name: 'Buenos Aires' },

  // ── Korean-language city names (Hangul) ───────────────────────────────────
  '런던': { code: 'LON', name: 'London' },
  '파리': { code: 'CDG', name: 'Paris' },
  '베를린': { code: 'BER', name: 'Berlin' },
  '뉴욕': { code: 'JFK', name: 'New York' },
  '로마': { code: 'FCO', name: 'Rome' },
  '바르셀로나': { code: 'BCN', name: 'Barcelona' },
  '마드리드': { code: 'MAD', name: 'Madrid' },
  '암스테르담': { code: 'AMS', name: 'Amsterdam' },
  '브뤼셀': { code: 'BRU', name: 'Brussels' },
  '비엔나': { code: 'VIE', name: 'Vienna' },
  '이스탄불': { code: 'IST', name: 'Istanbul' },
  '아테네': { code: 'ATH', name: 'Athens' },
  '코펜하겐': { code: 'CPH', name: 'Copenhagen' },
  '스톡홀름': { code: 'ARN', name: 'Stockholm' },
  '헬싱키': { code: 'HEL', name: 'Helsinki' },
  '오슬로': { code: 'OSL', name: 'Oslo' },
  '리스본': { code: 'LIS', name: 'Lisbon' },
  '밀라노': { code: 'MXP', name: 'Milan' },
  '나폴리': { code: 'NAP', name: 'Naples' },
  '베네치아': { code: 'VCE', name: 'Venice' },
  '피렌체': { code: 'FLR', name: 'Florence' },
  '도쿄': { code: 'TYO', name: 'Tokyo' },
  '오사카': { code: 'KIX', name: 'Osaka' },
  '베이징': { code: 'PEK', name: 'Beijing' },
  '상하이': { code: 'PVG', name: 'Shanghai' },
  '홍콩': { code: 'HKG', name: 'Hong Kong' },
  '싱가포르': { code: 'SIN', name: 'Singapore' },
  '방콕': { code: 'BKK', name: 'Bangkok' },
  '시드니': { code: 'SYD', name: 'Sydney' },
  '쿠알라룸푸르': { code: 'KUL', name: 'Kuala Lumpur' },
  '자카르타': { code: 'CGK', name: 'Jakarta' },
  '하노이': { code: 'HAN', name: 'Hanoi' },
  '호치민': { code: 'SGN', name: 'Ho Chi Minh City' },
  '카이로': { code: 'CAI', name: 'Cairo' },
  '모스크바': { code: 'SVO', name: 'Moscow' },
  '뮌헨': { code: 'MUC', name: 'Munich' },
  '프라하': { code: 'PRG', name: 'Prague' },
  '부다페스트': { code: 'BUD', name: 'Budapest' },
  '바르샤바': { code: 'WAW', name: 'Warsaw' },
  '두바이': { code: 'DXB', name: 'Dubai' },
  '발리': { code: 'DPS', name: 'Bali' },
  '푸껫': { code: 'HKT', name: 'Phuket' },
  '취리히': { code: 'ZRH', name: 'Zurich' },
  '제네바': { code: 'GVA', name: 'Geneva' },
  '멜버른': { code: 'MEL', name: 'Melbourne' },
  '토론토': { code: 'YYZ', name: 'Toronto' },
  '밴쿠버': { code: 'YVR', name: 'Vancouver' },
  '시카고': { code: 'ORD', name: 'Chicago' },
  '로스앤젤레스': { code: 'LAX', name: 'Los Angeles' },
  '마이애미': { code: 'MIA', name: 'Miami' },
  '뭄바이': { code: 'BOM', name: 'Mumbai' },
  '델리': { code: 'DEL', name: 'Delhi' },
  '도하': { code: 'DOH', name: 'Doha' },
  '아부다비': { code: 'AUH', name: 'Abu Dhabi' },
  '리야드': { code: 'RUH', name: 'Riyadh' },
  '멕시코시티': { code: 'MEX', name: 'Mexico City' },
  '상파울루': { code: 'GRU', name: 'São Paulo' },
  '부에노스아이레스': { code: 'EZE', name: 'Buenos Aires' },
  '요하네스버그': { code: 'JNB', name: 'Johannesburg' },
  '나이로비': { code: 'NBO', name: 'Nairobi' },
  '케이프타운': { code: 'CPT', name: 'Cape Town' },

  // ── Arabic-language city names ────────────────────────────────────────────
  'لندن': { code: 'LON', name: 'London' },
  'باريس': { code: 'CDG', name: 'Paris' },
  'برلين': { code: 'BER', name: 'Berlin' },
  'نيويورك': { code: 'JFK', name: 'New York' },
  'روما': { code: 'FCO', name: 'Rome' },
  'برشلونة': { code: 'BCN', name: 'Barcelona' },
  'مدريد': { code: 'MAD', name: 'Madrid' },
  'أمستردام': { code: 'AMS', name: 'Amsterdam' },
  'بروكسل': { code: 'BRU', name: 'Brussels' },
  'فيينا': { code: 'VIE', name: 'Vienna' },
  'إسطنبول': { code: 'IST', name: 'Istanbul' },
  'أثينا': { code: 'ATH', name: 'Athens' },
  'كوبنهاغن': { code: 'CPH', name: 'Copenhagen' },
  'ستوكهولم': { code: 'ARN', name: 'Stockholm' },
  'هلسنكي': { code: 'HEL', name: 'Helsinki' },
  'أوسلو': { code: 'OSL', name: 'Oslo' },
  'لشبونة': { code: 'LIS', name: 'Lisbon' },
  'ميلانو': { code: 'MXP', name: 'Milan' },
  'البندقية': { code: 'VCE', name: 'Venice' },
  'فلورنسا': { code: 'FLR', name: 'Florence' },
  'القاهرة': { code: 'CAI', name: 'Cairo' },
  'دبي': { code: 'DXB', name: 'Dubai' },
  'موسكو': { code: 'SVO', name: 'Moscow' },
  'سنغافورة': { code: 'SIN', name: 'Singapore' },
  'بانكوك': { code: 'BKK', name: 'Bangkok' },
  'سيدني': { code: 'SYD', name: 'Sydney' },
  'كوالالمبور': { code: 'KUL', name: 'Kuala Lumpur' },
  'جاكرتا': { code: 'CGK', name: 'Jakarta' },
  'هانوي': { code: 'HAN', name: 'Hanoi' },
  'طوكيو': { code: 'TYO', name: 'Tokyo' },
  'بكين': { code: 'PEK', name: 'Beijing' },
  'شنغهاي': { code: 'PVG', name: 'Shanghai' },
  'هونغ كونغ': { code: 'HKG', name: 'Hong Kong' },
  'الرياض': { code: 'RUH', name: 'Riyadh' },
  'أبوظبي': { code: 'AUH', name: 'Abu Dhabi' },
  'الدوحة': { code: 'DOH', name: 'Doha' },
  'مومباي': { code: 'BOM', name: 'Mumbai' },
  'دلهي': { code: 'DEL', name: 'Delhi' },
  'مراكش': { code: 'RAK', name: 'Marrakech' },
  'كازابلانكا': { code: 'CMN', name: 'Casablanca' },
  'نيروبي': { code: 'NBO', name: 'Nairobi' },
  'جوهانسبرغ': { code: 'JNB', name: 'Johannesburg' },
  'كيب تاون': { code: 'CPT', name: 'Cape Town' },
  'مكسيكو سيتي': { code: 'MEX', name: 'Mexico City' },
  'سان باولو': { code: 'GRU', name: 'São Paulo' },
  'بوينوس آيريس': { code: 'EZE', name: 'Buenos Aires' },
  'تورنتو': { code: 'YYZ', name: 'Toronto' },
  'فانكوفر': { code: 'YVR', name: 'Vancouver' },
  'شيكاغو': { code: 'ORD', name: 'Chicago' },
  'لوس أنجلوس': { code: 'LAX', name: 'Los Angeles' },
  'ميامي': { code: 'MIA', name: 'Miami' },
  'ميونخ': { code: 'MUC', name: 'Munich' },
  'فرانكفورت': { code: 'FRA', name: 'Frankfurt' },
  'زيورخ': { code: 'ZRH', name: 'Zurich' },
  'جنيف': { code: 'GVA', name: 'Geneva' },
  'سيول': { code: 'ICN', name: 'Seoul' },
  'أوساكا': { code: 'KIX', name: 'Osaka' },
  'بالي': { code: 'DPS', name: 'Bali' },
  'بوكيت': { code: 'HKT', name: 'Phuket' },
}

// ── Country name → primary hub airport ───────────────────────────────────────
// Keys are lowercase, accent-free. Used as last-resort fallback in resolveCity.
const COUNTRY_TO_IATA: Record<string, { code: string; name: string }> = {
  // Europe
  'switzerland': { code: 'ZRH', name: 'Switzerland' },
  'schweiz': { code: 'ZRH', name: 'Switzerland' },
  'suisse': { code: 'ZRH', name: 'Switzerland' },
  'svizzera': { code: 'ZRH', name: 'Switzerland' },
  'germany': { code: 'FRA', name: 'Germany' },
  'deutschland': { code: 'FRA', name: 'Germany' },
  'allemagne': { code: 'FRA', name: 'Germany' },
  'france': { code: 'CDG', name: 'France' },
  'frankreich': { code: 'CDG', name: 'France' },
  'italia': { code: 'FCO', name: 'Italy' },
  'italy': { code: 'FCO', name: 'Italy' },
  'italie': { code: 'FCO', name: 'Italy' },
  'italien': { code: 'FCO', name: 'Italy' },
  'spain': { code: 'MAD', name: 'Spain' },
  'espana': { code: 'MAD', name: 'Spain' },
  'españa': { code: 'MAD', name: 'Spain' },
  'spanien': { code: 'MAD', name: 'Spain' },
  'portugal': { code: 'LIS', name: 'Portugal' },
  'netherlands': { code: 'AMS', name: 'Netherlands' },
  'holland': { code: 'AMS', name: 'Netherlands' },
  'nederland': { code: 'AMS', name: 'Netherlands' },
  'belgium': { code: 'BRU', name: 'Belgium' },
  'belgie': { code: 'BRU', name: 'Belgium' },
  'belgique': { code: 'BRU', name: 'Belgium' },
  'belgien': { code: 'BRU', name: 'Belgium' },
  'austria': { code: 'VIE', name: 'Austria' },
  'osterreich': { code: 'VIE', name: 'Austria' },
  'österreich': { code: 'VIE', name: 'Austria' },
  'autriche': { code: 'VIE', name: 'Austria' },
  'sweden': { code: 'ARN', name: 'Sweden' },
  'sverige': { code: 'ARN', name: 'Sweden' },
  'schweden': { code: 'ARN', name: 'Sweden' },
  'norway': { code: 'OSL', name: 'Norway' },
  'norge': { code: 'OSL', name: 'Norway' },
  'norwegen': { code: 'OSL', name: 'Norway' },
  'denmark': { code: 'CPH', name: 'Denmark' },
  'danemark': { code: 'CPH', name: 'Denmark' },
  'dänemark': { code: 'CPH', name: 'Denmark' },
  'finland': { code: 'HEL', name: 'Finland' },
  'finlande': { code: 'HEL', name: 'Finland' },
  'finnland': { code: 'HEL', name: 'Finland' },
  'poland': { code: 'WAW', name: 'Poland' },
  'polska': { code: 'WAW', name: 'Poland' },
  'pologne': { code: 'WAW', name: 'Poland' },
  'czech republic': { code: 'PRG', name: 'Czech Republic' },
  'czechia': { code: 'PRG', name: 'Czech Republic' },
  'czech': { code: 'PRG', name: 'Czech Republic' },
  'tschechien': { code: 'PRG', name: 'Czech Republic' },
  'hungary': { code: 'BUD', name: 'Hungary' },
  'ungarn': { code: 'BUD', name: 'Hungary' },
  'hongrie': { code: 'BUD', name: 'Hungary' },
  'romania': { code: 'OTP', name: 'Romania' },
  'rumanien': { code: 'OTP', name: 'Romania' },
  'roumanie': { code: 'OTP', name: 'Romania' },
  'bulgaria': { code: 'SOF', name: 'Bulgaria' },
  'bulgarien': { code: 'SOF', name: 'Bulgaria' },
  'bulgarie': { code: 'SOF', name: 'Bulgaria' },
  'greece': { code: 'ATH', name: 'Greece' },
  'griechenland': { code: 'ATH', name: 'Greece' },
  'grece': { code: 'ATH', name: 'Greece' },
  'grèce': { code: 'ATH', name: 'Greece' },
  'turkey': { code: 'IST', name: 'Turkey' },
  'turkei': { code: 'IST', name: 'Turkey' },
  'türkei': { code: 'IST', name: 'Turkey' },
  'turquie': { code: 'IST', name: 'Turkey' },
  'russia': { code: 'SVO', name: 'Russia' },
  'russland': { code: 'SVO', name: 'Russia' },
  'ukraine': { code: 'KBP', name: 'Ukraine' },
  'croatia': { code: 'ZAG', name: 'Croatia' },
  'kroatien': { code: 'ZAG', name: 'Croatia' },
  'croatie': { code: 'ZAG', name: 'Croatia' },
  'hrvatska': { code: 'ZAG', name: 'Croatia' },
  'serbia': { code: 'BEG', name: 'Serbia' },
  'serbien': { code: 'BEG', name: 'Serbia' },
  'slovakei': { code: 'BTS', name: 'Slovakia' },
  'slovakia': { code: 'BTS', name: 'Slovakia' },
  'slowakei': { code: 'BTS', name: 'Slovakia' },
  'slovensko': { code: 'BTS', name: 'Slovakia' },
  'slovenia': { code: 'LJU', name: 'Slovenia' },
  'slowenien': { code: 'LJU', name: 'Slovenia' },
  'albanien': { code: 'TIA', name: 'Albania' },
  'albania': { code: 'TIA', name: 'Albania' },
  'ireland': { code: 'DUB', name: 'Ireland' },
  'irland': { code: 'DUB', name: 'Ireland' },
  'irlande': { code: 'DUB', name: 'Ireland' },
  'united kingdom': { code: 'LON', name: 'United Kingdom' },
  'uk': { code: 'LON', name: 'United Kingdom' },
  'england': { code: 'LON', name: 'England' },
  'scotland': { code: 'EDI', name: 'Scotland' },
  'wales': { code: 'CWL', name: 'Wales' },
  'luxembourg': { code: 'LUX', name: 'Luxembourg' },
  'luxemburg': { code: 'LUX', name: 'Luxembourg' },
  'iceland': { code: 'KEF', name: 'Iceland' },
  'island': { code: 'KEF', name: 'Iceland' },
  'islande': { code: 'KEF', name: 'Iceland' },
  'cyprus': { code: 'LCA', name: 'Cyprus' },
  'zypern': { code: 'LCA', name: 'Cyprus' },
  'chypre': { code: 'LCA', name: 'Cyprus' },
  'estonia': { code: 'TLL', name: 'Estonia' },
  'estland': { code: 'TLL', name: 'Estonia' },
  'latvia': { code: 'RIX', name: 'Latvia' },
  'lettland': { code: 'RIX', name: 'Latvia' },
  'lithuania': { code: 'VNO', name: 'Lithuania' },
  'litauen': { code: 'VNO', name: 'Lithuania' },
  'belarus': { code: 'MSQ', name: 'Belarus' },
  'moldova': { code: 'KIV', name: 'Moldova' },
  'north macedonia': { code: 'SKP', name: 'North Macedonia' },
  'mazedonien': { code: 'SKP', name: 'North Macedonia' },
  'kosovo': { code: 'PRN', name: 'Kosovo' },
  'bosnia': { code: 'SJJ', name: 'Bosnia & Herzegovina' },
  'bosnien': { code: 'SJJ', name: 'Bosnia & Herzegovina' },
  'montenegro': { code: 'TGD', name: 'Montenegro' },
  // Americas
  'usa': { code: 'NYC', name: 'United States' },
  'united states': { code: 'NYC', name: 'United States' },
  'america': { code: 'NYC', name: 'United States' },
  'us': { code: 'NYC', name: 'United States' },
  'canada': { code: 'YYZ', name: 'Canada' },
  'kanada': { code: 'YYZ', name: 'Canada' },
  'mexico': { code: 'MEX', name: 'Mexico' },
  'mexiko': { code: 'MEX', name: 'Mexico' },
  'mexique': { code: 'MEX', name: 'Mexico' },
  'brazil': { code: 'GRU', name: 'Brazil' },
  'brasil': { code: 'GRU', name: 'Brazil' },
  'bresil': { code: 'GRU', name: 'Brazil' },
  'brésil': { code: 'GRU', name: 'Brazil' },
  'argentina': { code: 'EZE', name: 'Argentina' },
  'argentinien': { code: 'EZE', name: 'Argentina' },
  'colombia': { code: 'BOG', name: 'Colombia' },
  'kolumbien': { code: 'BOG', name: 'Colombia' },
  'peru': { code: 'LIM', name: 'Peru' },
  'chile': { code: 'SCL', name: 'Chile' },
  'ecuador': { code: 'UIO', name: 'Ecuador' },
  'bolivia': { code: 'LPB', name: 'Bolivia' },
  'venezuela': { code: 'CCS', name: 'Venezuela' },
  'cuba': { code: 'HAV', name: 'Cuba' },
  'costa rica': { code: 'SJO', name: 'Costa Rica' },
  'panama': { code: 'PTY', name: 'Panama' },
  'dominican republic': { code: 'SDQ', name: 'Dominican Republic' },
  'dom rep': { code: 'SDQ', name: 'Dominican Republic' },
  // Asia
  'china': { code: 'PEK', name: 'China' },
  'chine': { code: 'PEK', name: 'China' },
  'japan': { code: 'TYO', name: 'Japan' },
  'japon': { code: 'TYO', name: 'Japan' },
  'south korea': { code: 'ICN', name: 'South Korea' },
  'korea': { code: 'ICN', name: 'South Korea' },
  'sudkorea': { code: 'ICN', name: 'South Korea' },
  'südkorea': { code: 'ICN', name: 'South Korea' },
  'india': { code: 'DEL', name: 'India' },
  'indien': { code: 'DEL', name: 'India' },
  'inde': { code: 'DEL', name: 'India' },
  'thailand': { code: 'BKK', name: 'Thailand' },
  'indonesien': { code: 'CGK', name: 'Indonesia' },
  'indonesia': { code: 'CGK', name: 'Indonesia' },
  'malaysia': { code: 'KUL', name: 'Malaysia' },
  'vietnam': { code: 'SGN', name: 'Vietnam' },
  'philippines': { code: 'MNL', name: 'Philippines' },
  'philippinen': { code: 'MNL', name: 'Philippines' },
  'myanmar': { code: 'RGN', name: 'Myanmar' },
  'cambodia': { code: 'PNH', name: 'Cambodia' },
  'kambodscha': { code: 'PNH', name: 'Cambodia' },
  'laos': { code: 'VTE', name: 'Laos' },
  'sri lanka': { code: 'CMB', name: 'Sri Lanka' },
  'nepal': { code: 'KTM', name: 'Nepal' },
  'bangladesh': { code: 'DAC', name: 'Bangladesh' },
  'pakistan': { code: 'KHI', name: 'Pakistan' },
  'afghanistan': { code: 'KBL', name: 'Afghanistan' },
  'kazakhstan': { code: 'ALA', name: 'Kazakhstan' },
  'uzbekistan': { code: 'TAS', name: 'Uzbekistan' },
  'georgia': { code: 'TBS', name: 'Georgia' },
  'georgien': { code: 'TBS', name: 'Georgia' },
  'armenia': { code: 'EVN', name: 'Armenia' },
  'armenien': { code: 'EVN', name: 'Armenia' },
  'azerbaijan': { code: 'GYD', name: 'Azerbaijan' },
  'aserbaidschan': { code: 'GYD', name: 'Azerbaijan' },
  'iran': { code: 'IKA', name: 'Iran' },
  'iraq': { code: 'BGW', name: 'Iraq' },
  'irak': { code: 'BGW', name: 'Iraq' },
  'saudi arabia': { code: 'RUH', name: 'Saudi Arabia' },
  'saudi-arabien': { code: 'RUH', name: 'Saudi Arabia' },
  'uae': { code: 'DXB', name: 'UAE' },
  'united arab emirates': { code: 'DXB', name: 'UAE' },
  'vae': { code: 'DXB', name: 'UAE' },
  'vereinigte arabische emirate': { code: 'DXB', name: 'UAE' },
  'israel': { code: 'TLV', name: 'Israel' },
  'jordan': { code: 'AMM', name: 'Jordan' },
  'jordanien': { code: 'AMM', name: 'Jordan' },
  'oman': { code: 'MCT', name: 'Oman' },
  'qatar': { code: 'DOH', name: 'Qatar' },
  'katar': { code: 'DOH', name: 'Qatar' },
  // Africa
  'egypt': { code: 'CAI', name: 'Egypt' },
  'agypten': { code: 'CAI', name: 'Egypt' },
  'ägypten': { code: 'CAI', name: 'Egypt' },
  'egypte': { code: 'CAI', name: 'Egypt' },
  'south africa': { code: 'JNB', name: 'South Africa' },
  'sudafrika': { code: 'JNB', name: 'South Africa' },
  'südafrika': { code: 'JNB', name: 'South Africa' },
  'kenya': { code: 'NBO', name: 'Kenya' },
  'kenia': { code: 'NBO', name: 'Kenya' },
  'morocco': { code: 'CMN', name: 'Morocco' },
  'marokko': { code: 'CMN', name: 'Morocco' },
  'maroc': { code: 'CMN', name: 'Morocco' },
  'nigeria': { code: 'LOS', name: 'Nigeria' },
  'ethiopia': { code: 'ADD', name: 'Ethiopia' },
  'athiopien': { code: 'ADD', name: 'Ethiopia' },
  'äthiopien': { code: 'ADD', name: 'Ethiopia' },
  'ghana': { code: 'ACC', name: 'Ghana' },
  'tanzania': { code: 'DAR', name: 'Tanzania' },
  'tansania': { code: 'DAR', name: 'Tanzania' },
  'senegal': { code: 'DSS', name: 'Senegal' },
  'angola': { code: 'LAD', name: 'Angola' },
  'mozambique': { code: 'MPM', name: 'Mozambique' },
  'tunesien': { code: 'TUN', name: 'Tunisia' },
  'tunisia': { code: 'TUN', name: 'Tunisia' },
  'tunisie': { code: 'TUN', name: 'Tunisia' },
  'algerien': { code: 'ALG', name: 'Algeria' },
  'algeria': { code: 'ALG', name: 'Algeria' },
  'algerie': { code: 'ALG', name: 'Algeria' },
  'algérie': { code: 'ALG', name: 'Algeria' },
  'libyen': { code: 'TIP', name: 'Libya' },
  'libya': { code: 'TIP', name: 'Libya' },
  // Oceania
  'australia': { code: 'SYD', name: 'Australia' },
  'australien': { code: 'SYD', name: 'Australia' },
  'australie': { code: 'SYD', name: 'Australia' },
  'new zealand': { code: 'AKL', name: 'New Zealand' },
  'neuseeland': { code: 'AKL', name: 'New Zealand' },
  'nouvelle-zelande': { code: 'AKL', name: 'New Zealand' },
  'nouvelle zélande': { code: 'AKL', name: 'New Zealand' },
}

export interface ParsedQuery {
  origin?: string
  origin_name?: string
  destination?: string
  destination_name?: string
  date?: string
  return_date?: string
  cabin?: 'M' | 'W' | 'C' | 'F'   // M=economy, W=premium economy, C=business, F=first
  stops?: number                     // 0 = direct/nonstop only
  failed_origin_raw?: string         // raw text that didn't resolve to an airport
  failed_destination_raw?: string
  origin_candidates?: Array<{ code: string; name: string }>      // top fuzzy matches when origin failed (for disambiguation chips)
  destination_candidates?: Array<{ code: string; name: string }> // top fuzzy matches when destination failed
  date_is_default?: boolean          // true when no date in query (parser defaulted to today+7) — used to gate the "when?" question
  preferred_sort?: 'price' | 'duration' // user explicitly asked for cheapest/fastest — auto-applies sort on results page
  // ── Flexible search extensions ──────────────────────────────────────────────
  min_trip_days?: number             // "for 14 days", "14-18 day trip" — min trip length
  max_trip_days?: number             // upper bound of trip duration range
  date_month_only?: boolean          // true when user typed "in September" (no specific day)
  anywhere_destination?: boolean     // true for "to anywhere", "wherever is cheapest", etc.
  max_price?: number                 // "for $200 or less", "under €150", "max 300 EUR"
  via_iata?: string                  // preferred stopover city IATA, e.g. "HKG"
  via_name?: string                  // human-readable stopover city name
  min_layover_hours?: number         // minimum desired layover at via city (hours)
  max_layover_hours?: number         // maximum desired layover at via city (hours)

  // ── Passenger composition ────────────────────────────────────────────────────
  adults?: number                    // ≥16 — default 1 when unspecified
  children?: number                  // age 2–15
  infants?: number                   // age <2, travelling on lap
  passenger_context?: 'solo' | 'couple' | 'family' | 'group' | 'business_traveler'
  group_size?: number                // total party (adults + children + infants)

  // ── Inferred booking requirements (from passenger context) ───────────────────
  require_adjacent_seats?: boolean   // "with kids" / "sit together" → must sit next to each other
  require_seat_selection?: boolean   // seat selection required (inferred from kids / explicit)
  require_bassinet?: boolean         // "with baby/infant" → bassinet row needed
  prefer_direct?: boolean            // soft preference for direct (separate from stops=0 hard filter)
  prefer_quick_flight?: boolean       // user wants shortest possible total flight time

  // ── Ancillary inclusions ─────────────────────────────────────────────────────
  require_checked_baggage?: boolean  // "with bags", "hold luggage included"
  carry_on_only?: boolean            // "hand luggage only", "no hold baggage", "cabin bag only"
  require_meals?: boolean            // "with meals", "including food"
  require_cancellation?: boolean     // "refundable", "free cancellation", "fully flexible"
  require_lounge?: boolean           // "with lounge access"

  // ── Time-of-day preferences ──────────────────────────────────────────────────
  depart_time_pref?: 'early_morning' | 'morning' | 'afternoon' | 'evening' | 'red_eye'
  arrive_time_pref?: 'morning' | 'afternoon' | 'evening'
  return_depart_time_pref?: 'early_morning' | 'morning' | 'afternoon' | 'evening' | 'red_eye'

  // ── Airline preferences ──────────────────────────────────────────────────────
  preferred_airline?: string         // "on Ryanair", "with British Airways" (lowercase normalised)
  excluded_airline?: string          // "not Ryanair", "avoid easyJet"

  // ── Trip purpose / occasion ──────────────────────────────────────────────────
  trip_purpose?: 'honeymoon' | 'business' | 'ski' | 'beach' | 'city_break' | 'family_holiday' | 'graduation' | 'concert_festival' | 'sports_event' | 'spring_break'

  // ── Seat preference ──────────────────────────────────────────────────────────
  seat_pref?: 'window' | 'aisle' | 'extra_legroom'

  // ── Flexible date window strategy ────────────────────────────────────────────
  // Triggered by: "in June for 2 weeks" (date_month_only + min_trip_days)
  //              OR "cheapest week in August", "best window in July"
  find_best_window?: boolean         // true → scan month/range for cheapest N-day block
  date_window_month?: number         // 1–12: month to search for best window
  date_window_year?: number          // year for best-window search

  // ── Urgency ──────────────────────────────────────────────────────────────────
  urgency?: 'last_minute' | 'asap'

  // ── Arrival-time hard constraint ──────────────────────────────────────────────
  // Parsed from "need to land by 3pm", "must be back in the office at 15:00", etc.
  max_arrival_time?: string          // "HH:MM" 24-hour, e.g. "15:00"
}

// ── Internal helpers ──────────────────────────────────────────────────────────

// Strip accents/diacritics for fuzzy city matching
function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Format a Date as YYYY-MM-DD in local time (avoids UTC-shift issues)
function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getNthWeekdayOfMonth(year: number, monthIndex: number, weekday: number, occurrence: number): Date {
  const date = new Date(year, monthIndex, 1)
  const offset = (weekday - date.getDay() + 7) % 7
  date.setDate(1 + offset + (occurrence - 1) * 7)
  return date
}

function getUpcomingUsThanksgiving(baseDate: Date): Date {
  let thanksgiving = getNthWeekdayOfMonth(baseDate.getFullYear(), 10, 4, 4)
  if (thanksgiving < baseDate) {
    thanksgiving = getNthWeekdayOfMonth(baseDate.getFullYear() + 1, 10, 4, 4)
  }
  return thanksgiving
}

// Edit distance (Levenshtein) — for typo tolerance in city matching
function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = i
    for (let j = 1; j <= b.length; j++) {
      const val = a[i - 1] === b[j - 1] ? row[j - 1] : Math.min(row[j - 1], row[j], prev) + 1
      row[j - 1] = prev
      prev = val
    }
    row[b.length] = prev
  }
  return row[b.length]
}

function containsLocationKey(text: string, key: string): boolean {
  const haystack = stripAccents(text.toLowerCase())
  const needle = stripAccents(key.toLowerCase())
  return new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(needle)}(?:$|[^a-z0-9])`, 'i').test(haystack)
}

// ── Fast city candidate index (built once at module load) ─────────────────
// Pre-computes stripped key + length for every CITY_TO_IATA entry so
// findCityCandidates() can do a single linear scan with cheap length-window
// pruning instead of sorting + regex-compiling the whole map per call.
type _CityIdxEntry = { key: string; stripped: string; len: number; code: string; name: string }
const _cityIdx: _CityIdxEntry[] = (() => {
  const out: _CityIdxEntry[] = []
  for (const [k, v] of Object.entries(CITY_TO_IATA)) {
    const stripped = stripAccents(k.toLowerCase())
    out.push({ key: k, stripped, len: stripped.length, code: v.code, name: v.name })
  }
  return out
})()

/**
 * Return up to `limit` typo-tolerant city suggestions for an unresolved
 * city phrase. Designed for the disambiguation UI ("did you mean?" chips).
 *
 * Performance: O(N) where N = |CITY_TO_IATA| (~5000), with a length-window
 * filter that skips ~95% of entries. Typical cost <2ms per call. Only invoked
 * on the rare path where resolveLocation already returned null, so it never
 * runs on the hot 3→2→1 token-walk path that caused the 2026-05 regression.
 */
export function findCityCandidates(raw: string, limit = 4): Array<{ code: string; name: string }> {
  const s = stripAccents(raw.toLowerCase().trim())
  if (!s || s.length < 3) return []

  // Try the full phrase first; if multi-word and short, also try the longest single word
  // (helps "hethrow international" → "heathrow" without burning extra cycles).
  const probes = [s]
  const words = s.split(/\s+/).filter(w => w.length >= 3)
  if (words.length > 1) {
    const longest = words.reduce((a, b) => (b.length > a.length ? b : a))
    if (longest !== s) probes.push(longest)
  }

  const seen = new Map<string, { code: string; name: string; dist: number }>()
  for (const probe of probes) {
    const probeLen = probe.length
    // Tolerance scales with length. Cap at 2 — beyond that suggestions become noise.
    const maxDist = probeLen <= 5 ? 1 : 2
    for (let i = 0; i < _cityIdx.length; i++) {
      const e = _cityIdx[i]
      // Length-window prune: edit distance can't be smaller than |len difference|
      if (Math.abs(e.len - probeLen) > maxDist) continue
      // Skip very short keys to avoid junk like "la" matching "lax"
      if (e.len < 4) continue
      const dist = editDistance(probe, e.stripped)
      if (dist > maxDist) continue
      const prev = seen.get(e.code)
      if (!prev || dist < prev.dist) seen.set(e.code, { code: e.code, name: e.name, dist })
    }
    // If the first probe already produced enough good hits, skip the fallback probe
    if (seen.size >= limit && probe === s) break
  }

  return Array.from(seen.values())
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit)
    .map(({ code, name }) => ({ code, name }))
}

// Module-level blocklist of 3-letter strings that collide with English / Romance
// prepositions, articles, and common words. Used by both resolveCity() and
// findTwoCitiesInText() to avoid e.g. "for" → FOR (Fortaleza), "the" → THE
// (Thaba'Nchu), "sun" → SUN (Friedman Memorial), "two" → TWO, etc.
const _COMMON_WORDS_BLOCKLIST: Set<string> = new Set([
  // English articles / prepositions / conjunctions
  'the', 'and', 'for', 'not', 'but', 'nor', 'yet', 'via', 'per',
  // Spanish/Portuguese/Italian/French articles & prepositions that are also IATA codes
  'del', 'los', 'las', 'des', 'der', 'die',
  // "new" → NEW (New Orleans Lakefront) — always wrong in "New X" city phrases
  'new',
  // "san" → SAN (San Diego) — San Diego is explicit in the map; "San X" cities resolve via aliases
  'san',
  // "sea" → SEA (Seattle) — Seattle is explicit in the map; "sea" as English word is common
  'sea',
  // Common English adjectives / verbs that happen to be minor airport codes
  'hot', 'top', 'far', 'old', 'low', 'big', 'mid', 'end', 'bay', 'air', 'sun',
  // Common English pronouns / auxiliary verbs
  'all', 'any', 'can', 'may', 'our', 'has', 'his', 'her', 'its', 'own',
  'out', 'off', 'one', 'day', 'few', 'got', 'let', 'put', 'run', 'set',
  'try', 'use', 'was', 'who', 'why', 'yes', 'ago', 'due', 'get', 'had',
  'him', 'how', 'now', 'see', 'too', 'two', 'did', 'are', 'men', 'way',
  // Direction verb / day-of-week abbreviations that are ambiguous 3-letter IATA-like strings
  'fly', 'fri', 'sat', 'sun', 'mon', 'tue', 'wed', 'thu',
])

// Look up a city string → IATA:
// 1. Exact match (accent-aware)
// 2. Explicit 3-letter code inside a longer phrase ("new york jfk" → JFK)
// 3. Boundary-aware contained phrase match (longest key first)
// 4. Fuzzy edit-distance fallback (handles typos like "Barcelna" → Barcelona)
export function resolveCity(raw: string): { code: string; name: string } | null {
  const s = raw.toLowerCase().trim()
  if (!s || s.length < 2) return null

  // Exact match
  if (CITY_TO_IATA[s]) return CITY_TO_IATA[s]

  // Accent-stripped exact
  const stripped = stripAccents(s)
  if (CITY_TO_IATA[stripped]) return CITY_TO_IATA[stripped]

  // Common English words / Romance-language prepositions that happen to be 3-letter IATA codes.
  // Without this guard, multi-word locations like "New Jersey" extract "new" → NEW (New Orleans
  // Lakefront), "San Juan" extracts "san" → SAN (San Diego), "Los Cabos" extracts "los" → LOS
  // (Lagos Nigeria), "Las Palmas" extracts "las" → LAS (Las Vegas), etc.
  // Only blocklist words that are genuinely ambiguous — real airport-code hints ("jfk", "lhr")
  // are NOT common English words and are intentionally left through.
  // Hoisted to module scope (see _COMMON_WORDS_BLOCKLIST below); kept aliased here for clarity.
  const _COMMON_WORDS = _COMMON_WORDS_BLOCKLIST
  // 3-letter token scan: catches explicit IATA codes typed inline (e.g. "fly to LHR",
  // "Hawaii KOA"). Runs after phrase lookup to avoid matching sub-words of city names.
  const explicitCodeTokens = stripped.match(/\b[a-z]{3}\b/g) || []
  for (let idx = explicitCodeTokens.length - 1; idx >= 0; idx -= 1) {
    const token = explicitCodeTokens[idx]
    if (_COMMON_WORDS.has(token)) continue
    // Check CITY_TO_IATA first (city codes like LON, NYC that map to metro areas)
    const mapped = CITY_TO_IATA[token]
    if (mapped) return mapped
    // Then check the full airport database for explicit IATA codes (e.g. "Hawaii KOA" → KOA).
    // Guard: only do this for short strings (≤4 words). Long strings are full airport names
    // like "Tan Son Nhat International Airport" where sub-tokens like "son" → SON are accidental.
    // For long strings we fall through to the phrase lookup which correctly finds the city name.
    if (stripped.split(/\s+/).length <= 4) {
      const airportMatch = findExactLocationMatch(token)
      if (airportMatch) return { code: airportMatch.code, name: airportMatch.name }
    }
  }

  // Boundary-aware contained phrase: longest key first so "new york" beats "york"
  const entries = Object.entries(CITY_TO_IATA).sort((a, b) => b[0].length - a[0].length)
  for (const [k, v] of entries) {
    if (containsLocationKey(s, k)) return v
  }

  // Fuzzy: edit distance tolerance scales with word length
  // ≤4 chars: exact only (avoid "la" matching "lag" etc)
  // 5-7 chars: allow 1 edit
  // 8+ chars: allow 2 edits
  if (stripped.length >= 5) {
    const maxDist = stripped.length >= 8 ? 2 : 1
    let best: { dist: number; val: { code: string; name: string } } | null = null
    for (const [k, v] of entries) {
      // Skip very short keys to avoid false positives
      if (k.length < 4) continue
      const dist = editDistance(stripped, stripAccents(k))
      if (dist <= maxDist && (!best || dist < best.dist)) {
        best = { dist, val: v }
      }
    }
    if (best) return best.val
  }

  // Country name lookup — last resort (e.g. "Switzerland" → ZRH, "China" → PEK)
  const countryExact = COUNTRY_TO_IATA[stripped] || COUNTRY_TO_IATA[s]
  if (countryExact) return countryExact

  // Multi-word country names (e.g. "United Arab Emirates", "South Korea")
  const countryEntries = Object.entries(COUNTRY_TO_IATA).sort((a, b) => b[0].length - a[0].length)
  for (const [k, v] of countryEntries) {
    if (k.length >= 4 && containsLocationKey(s, k)) return v
  }

  return null
}

function resolveLocation(raw: string): { code: string; name: string } | null {
  // Guard: bare lowercase common words ("for", "the", "sun", etc.) that happen
  // to be 3-letter IATA codes must NOT resolve via the airport database.
  // Otherwise queries like "guadalajara for a couple" treat "for" as Fortaleza.
  // We allow UPPERCASE 3-letter input (e.g. "SAN", "FOR") through so explicit
  // IATA codes still work.
  const _trimmed = raw.trim()
  const _bareTok = stripAccents(_trimmed.toLowerCase())
  const _isExplicitIata = /^[A-Z]{3}$/.test(_trimmed)
  if (!_isExplicitIata && _COMMON_WORDS_BLOCKLIST.has(_bareTok)) return null

  // Multi-word inputs may be route-pattern misfires that glued a preposition onto
  // a city name (e.g. originStr "guadalahara for" from "guadalahara for a couple").
  // Try resolveCity first (which handles "new york" → NYC via boundary phrase match
  // and is the safest path), and only fall through to the airport DB / fuzzy matcher
  // if resolveCity succeeds OR the input has no blocklist tokens (so we don't fuzzy
  // -resolve "X for" as FOR Fortaleza).
  const _hasMultiWord = /\s/.test(_bareTok)
  if (_hasMultiWord) {
    const tokens = _bareTok.split(/\s+/).filter(Boolean)
    // Also keep the original-cased tokens so we can preserve UPPERCASE 3-letter
    // IATA codes (e.g. "SAN" in "BDL to SAN the week of thanksgiving") that would
    // otherwise be stripped as the blocklist word "san".
    const rawTokens = raw.trim().split(/\s+/).filter(Boolean)
    const isUppercaseIata = (i: number) => {
      const t = rawTokens[i]
      return !!t && /^[A-Z]{3}$/.test(t)
    }
    const hasBlocklistToken = tokens.some((t, i) => _COMMON_WORDS_BLOCKLIST.has(t) && !isUppercaseIata(i))
    const cityFirst = resolveCity(raw)
    if (cityFirst) return cityFirst
    if (hasBlocklistToken) {
      // Strip blocklist tokens (preposition glued on by route-pattern misfire,
      // or trailing stopwords like "SAN the week of thanksgiving") and retry with
      // the cleaned text. Preserve uppercase 3-letter tokens (likely IATA codes).
      const cleanedTokens = rawTokens.filter((rt, i) => {
        if (isUppercaseIata(i)) return true
        return !_COMMON_WORDS_BLOCKLIST.has(tokens[i])
      })
      if (cleanedTokens.length === 0) return null
      const cleaned = cleanedTokens.join(' ').trim()
      if (cleaned.toLowerCase() !== _bareTok) {
        // If a single uppercase 3-letter IATA token survived, resolve it directly.
        // Handles "SAN the week of thanksgiving" → SAN.
        const iataOnly = cleanedTokens.filter((t) => /^[A-Z]{3}$/.test(t))
        if (iataOnly.length === 1) {
          const code = iataOnly[0]
          const exact = findExactLocationMatch(code)
          if (exact) return { code: exact.code, name: exact.name }
          const cityCode = CITY_TO_IATA[code.toLowerCase()]
          if (cityCode) return cityCode
          return { code, name: code }
        }
        const r = resolveCity(cleaned)
        if (r) return r
        const exact = findExactLocationMatch(cleaned)
        if (exact) return { code: exact.code, name: exact.name }
        const best = findBestLocationMatch(cleaned)
        if (best) return { code: best.code, name: best.name }
        if (/^[a-zA-Z]{3}$/.test(cleaned)) {
          const code = cleaned.toUpperCase()
          return { code, name: code }
        }
        return null
      }
    }
  }

  const exactGenerated = findExactLocationMatch(raw)
  const normalized = raw.toLowerCase().trim()
  const stripped = stripAccents(normalized)
  if (exactGenerated?.type === 'city') {
    const mapped = CITY_TO_IATA[normalized] || CITY_TO_IATA[stripped]
    return {
      code: exactGenerated.code,
      name: mapped?.name || exactGenerated.name,
    }
  }

  const resolved = resolveCity(raw)
  if (resolved) return resolved

  if (exactGenerated) {
    return { code: exactGenerated.code, name: exactGenerated.name }
  }

  const generated = findBestLocationMatch(raw)
  if (generated) return { code: generated.code, name: generated.name }
  if (/^[a-zA-Z]{3}$/.test(raw.trim())) {
    const code = raw.toUpperCase()
    return { code, name: code }
  }
  return null
}

// ── Cabin class extraction (all languages) ─────────────────────────────────────
function extractCabin(text: string): 'M' | 'W' | 'C' | 'F' | undefined {
  const t = stripAccents(text.toLowerCase())
  // Order: most specific first (first class before first, premium economy before economy)
  if (/\b(?:first\s+class|erste\s+klasse|primera\s+clase|premi[eè]re\s+classe|prima\s+classe|eerste\s+klas|pierwsza\s+klasa|primeira\s+classe|f[oö]rsta\s+klass|prva\s+klasa|klasa\s+e\s+par[eë])\b/.test(t) ||
      /ファーストクラス|一等座/.test(text) || /фарский класс|первый класс/.test(text) || /일등석|퍼스트 클래스/.test(text)) return 'F'
  if (/\b(?:premium\s+economy|premium\s+[eé]conomique|premium\s+economi[ck]a|premium\s+econ[oô]mica|premium\s+econ[oô]mica)\b/.test(t) ||
      /プレミアムエコノミー/.test(text) || /премиум эконом/.test(text) || /프리미엄 이코노미/.test(text)) return 'W'
  if (/\b(?:business\s+class|businessklasse|clase\s+(?:business|ejecutiva)|ejecutiva|classe\s+(?:affaires|business)|affaires|klasa\s+biznes|classe\s+executiva|executiva|businessklass|poslovna\s+klasa|zakenklasse|zakelijk|biznes|business)\b/.test(t) ||
      /ビジネスクラス|ビジネス座/.test(text) || /бизнес[- ]класс|класс бизнес/.test(text) || /비즈니스 클래스/.test(text)) return 'C'
  if (/\b(?:economy\s+class|wirtschaftsklasse|clase\s+turista|turista|classe\s+[eé]conomique|[eé]conomique|classe\s+economica|economica|economyclass|klasa\s+ekonomiczna|ekonomiklass|ekonomska\s+klasa|economy|coach|economica|economi[ck]a)\b/.test(t) ||
      /エコノミークラス|エコノミー座/.test(text) || /эконом[ыич]еский класс|эконом/.test(text) || /이코노미 클래스/.test(text)) return 'M'
  return undefined
}

// ── Direct/nonstop extraction (all languages) ─────────────────────────────────
function extractDirect(text: string): boolean {
  const t = stripAccents(text.toLowerCase())
  return /\b(?:direct|nonstop|non[- ]stop|direkt(?:flug)?|ohne\s+(?:umstieg|zwischenstopp|stop)|nur\s+direkt|directo|sin\s+escalas?|vuelo\s+directo|sin\s+paradas?|sans?\s+escale[s]?|vol\s+direct|sans?\s+(?:correspondance|connexion)|diretto|volo\s+diretto|senza\s+scal[ei]|senza\s+fermate|rechtstreeks|zonder\s+(?:tussenstop|overstap)|directe\s+vlucht|bezpo[śs]rednio|bezpo[śs]redni|tylko\s+bezpo[śs]redni(?:e)?|bez\s+przesiadek|lot\s+bezpo[śs]redni|sem\s+escala[s]?|direto|voo\s+direto|direktflyg|utan\s+mellanlandning|utan\s+stopp|izravno|bez\s+presjedanja|direktni\s+let|pa\s+ndalese|fluturim\s+direkt|direktni|no\s+layovers?|no\s+stops?|only\s+direct|straight\s+through)\b/.test(t) ||
    // JA (Japanese)
    /直行便|ノンストップ|乗り継ぎなし|指定便|直行/.test(text) ||
    // RU (Russian)
    /\b(?:прямой\s+рейс|без\s+пересадок|прямой\s+перелёт|прямые\s+рейсы|без\s+стопов|только\s+прямые)\b/.test(text) ||
    // KO (Korean)
    /직항편|직항|경유편 없이/.test(text)
}

// ── Passenger count + context extraction ──────────────────────────────────────
// Handles: explicit counts ("2 adults, 1 child"), contextual ("with kids", "as a couple",
// "family of 4", "group of 6"), and infers seat/bassinet/direct requirements.
interface PassengerExtraction {
  adults?: number
  children?: number
  infants?: number
  context?: ParsedQuery['passenger_context']
  group_size?: number
  require_adjacent_seats?: boolean
  require_seat_selection?: boolean
  require_bassinet?: boolean
  prefer_direct?: boolean
}

function extractPassengers(text: string): PassengerExtraction {
  const t = stripAccents(text.toLowerCase())
  const result: PassengerExtraction = {}

  // ── Explicit numeric counts ───────────────────────────────────────────────
  // Adults — EN/DE/ES/FR/IT/NL/PL/PT/SQ/HR/SV
  const adultM = t.match(/\b(\d+)\s+(?:adults?|grown[- ]?ups?|erwachsene?|adultos?|adultes?|adulti|volwassenen?|vuxna?|vuxen|dorośł(?:ych|e)|odrasli(?:h)?|t[eë]\s+rritur|punasovjet[eë])\b/)
  if (adultM) result.adults = parseInt(adultM[1])
  // JA/RU/KO adult fallback
  if (!result.adults) {
    const jaA = text.match(/(\d+)\s*(?:大人|おとな)/); if (jaA) result.adults = parseInt(jaA[1])
    const ruA = text.match(/(\d+)\s*(?:взрослых|человека)/); if (ruA) result.adults = parseInt(ruA[1])
    const koA = text.match(/(\d+)\s*명\s*(?:어른)/); if (koA) result.adults = parseInt(koA[1])
  }

  // Children — EN/DE/ES/FR/IT/NL/PL/PT/SQ/HR/SV
  const childM = t.match(/\b(\d+)\s+(?:child(?:ren)?|kids?|bambini?|enfants?|ni[ñn]os?|kinder|kinderen|dzieci|crianças?|barn|djeca|f[eë]mij[eë]|ungdomar|ungdom|barn\s+och\s+unga|barne?|callan[eë])\b/)
  if (childM) result.children = parseInt(childM[1])
  // JA/RU/KO child fallback
  if (!result.children) {
    const jaC = text.match(/(\d+)\s*(?:子供|コドモ|子ども)/); if (jaC) result.children = parseInt(jaC[1])
    const ruC = text.match(/(\d+)\s*(?:детей|ребёнка)/); if (ruC) result.children = parseInt(ruC[1])
    const koC = text.match(/(\d+)\s*명\s*(?:어린이|소아)/); if (koC) result.children = parseInt(koC[1])
  }

  // Infants — EN/DE/ES/FR/IT/NL/PL/PT/SQ/HR/SV
  const infantM = t.match(/\b(\d+)\s+(?:infants?|babies|babys?|b[eé]b[eé]s?|b[eé]b[eé]|neonati?|zuigeling(?:en)?|niemowl[eę]ta?|bebê|foshnja?|dojenčad?|spädbarn|spädbarns?)\b/)
  if (infantM) result.infants = parseInt(infantM[1])
  // JA/RU/KO infant fallback
  if (!result.infants) {
    const jaI = text.match(/(\d+)\s*(?:赤ちゃん|乳児|幼児)/); if (jaI) result.infants = parseInt(jaI[1])
    const ruI = text.match(/(\d+)\s*(?:младенца|грудничка)/); if (ruI) result.infants = parseInt(ruI[1])
    const koI = text.match(/(\d+)\s*명\s*(?:유아|영아)/); if (koI) result.infants = parseInt(koI[1])
  }
  // Contextual infant signals in all languages
  else if (/\bwith\s+(?:a|an|the|my|our)\s+(?:baby|infant|babe|newborn|toddler)\b/.test(t) ||
           /\btravell?ing?\s+with\s+(?:a\s+)?(?:baby|infant|toddler)\b/.test(t) ||
           /\bmit\s+(?:einem?\s+)?(?:baby|kleinkind|säugling)\b/.test(t) ||
           /\bcon\s+(?:un\s+)?(?:bebé|bebe|reci[eé]n\s+nacido)\b/.test(t) ||
           /\bavec\s+(?:un\s+)?(?:b[eé]b[eé]|nourrisson|tout[-\s]petit)\b/.test(t) ||
           /\bcon\s+(?:un\s+)?(?:neonato|bambino\s+piccolo|lattante)\b/.test(t) ||
           /\bmet\s+(?:een\s+)?(?:baby|zuigeling|peuter)\b/.test(t) ||
           /\bz\s+(?:niemowl[eę]ciem|maluchem|niemowlakiem)\b/.test(t) ||
           /\bcom\s+(?:um\s+)?(?:beb[eê]|rec[eé]m[-\s]nascido)\b/.test(t) ||
           /\bmed\s+(?:ett?\s+)?(?:spädbarn|litet\s+barn|ettåring)\b/.test(t) ||
           /\bs\s+(?:dojenčetom|beb[io]m)\b/.test(t) ||
           /\bme\s+(?:një\s+)?(?:foshnjë|bebe)\b/.test(t)) {
    result.infants = (result.infants ?? 0) + 1
  }

  // "family of 4", "group of 6", "party of 3" — EN/DE/ES/FR/IT/NL/PL/PT/HR/SQ/SV
  const groupSizeM = t.match(/\b(?:family|group|party|gruppe|familia|groupe|famille|famiglia|gruppo|gezin|groep|familia|grupo|família|grupo|familj|grupp|obitelj|grup|familje|grup)\s+of\s+(\d+)\b/) ??
                     t.match(/\b(\d+)[-\s](?:köpfe?|personen?)\s+(?:gruppe|reisegruppe)\b/i) ??
                     t.match(/\b(?:wir\s+sind|nous\s+sommes|siamo|wij\s+zijn|jesteśmy|somos|vi\s+är|nas\s+je|jemi)\s+(\d+)\s+(?:personen?|leute|mensen|personnes?|persone|osób|pessoas?|personer|osoba|persona|vetë)\b/)
  if (groupSizeM) {
    const n = parseInt(groupSizeM[1] ?? groupSizeM[0].match(/\d+/)?.[0] ?? '0')
    if (n > 0) {
      result.group_size = n
      if (!result.adults && !result.children) {
        if (/family|familie|familia|famille|famiglia|gezin|familia|família|familj|obitelj|familje/.test(t)) {
          result.adults = Math.min(2, n)
          if (n > 2) result.children = n - result.adults
          result.context = 'family'
        } else {
          result.adults = n
        }
      }
    }
  }

  // "for 2", "for 3 people", "3 passengers", "N tickets" — EN + multilingual
  const forNM = t.match(/\bfor\s+(\d+)(?:\s+(?:people|persons?|pax|passengers?|adults?|guests?|travell?ers?|seats?))\b/) ??
                t.match(/\bf[üu]r\s+(\d+)(?:\s+(?:personen?|erwachsene?|leute|plätze?))?\b/) ??
                t.match(/\bpour\s+(\d+)(?:\s+(?:personnes?|adultes?|passagers?|places?))?\b/) ??
                t.match(/\bper\s+(\d+)(?:\s+(?:persone?|adulti|passeggeri?|posti))?\b/) ??
                t.match(/\bvoor\s+(\d+)(?:\s+(?:personen?|volwassenen?|passagiers?))?\b/) ??
                t.match(/\bdla\s+(\d+)(?:\s+(?:os[oó]b|doros[lł]ych|pasa[zż]er[oó]w))?\b/) ??
                t.match(/\bpara\s+(\d+)(?:\s+(?:personas?|adultos?|pasajeros?|pessoas?|adultos?|passageiros?))?\b/) ??
                t.match(/\bf[oö]r\s+(\d+)(?!\s+(?:days?|nights?|weeks?|hours?|months?|minutes?|years?|yrs?|hrs?|nätter?|dagar?|veckor?|timmar?|månader?))(?:\s+(?:personer?|vuxna?|passagerare?))?\b/)
  if (forNM && !result.group_size) {
    const n = parseInt(forNM[1])
    if (n >= 1 && n <= 20) { result.group_size = n; if (!result.adults) result.adults = n }
  }
  const nPplM = t.match(/\b(\d+)\s+(?:people|persons?|pax|passengers?|travell?ers?|guests?|seats?)\b/) ??
                t.match(/\b(\d+)\s+(?:personen?|leute|reisende?|fahrgäste?)\b/) ??
                t.match(/\b(\d+)\s+(?:personnes?|voyageurs?|passagers?)\b/) ??
                t.match(/\b(\d+)\s+(?:persone?|viaggiatori?|passeggeri?)\b/) ??
                t.match(/\b(\d+)\s+(?:personen?|reizigers?|passagiers?)\b/) ??
                t.match(/\b(\d+)\s+(?:os[oó]b|pod[oó][zż]nych|pasa[zż]er[oó]w)\b/) ??
                t.match(/\b(\d+)\s+(?:pessoas?|viajantes?|passageiros?)\b/) ??
                t.match(/\b(\d+)\s+(?:personer?|resenärer?|passagerare?)\b/) ??
                t.match(/\b(\d+)\s+(?:osob[ae]?|putnika?|putnici?)\b/) ??
                t.match(/\b(\d+)\s+(?:persona|udhëtar[eë]?|pasagjer[eë]?)\b/)
  if (nPplM && !result.group_size) {
    result.group_size = parseInt(nPplM[1])
    if (!result.adults) result.adults = result.group_size
  }

  // ── Word numerals across languages: "dla dwóch osób", "per due persone",
  //    "pour deux personnes", "para dos personas", "für zwei Personen", etc.
  if (!result.group_size) {
    const WORD_NUM: Record<string, number> = {
      // PL
      'dwoch': 2, 'dwóch': 2, 'dwojga': 2, 'dwa': 2, 'dwie': 2, 'trzech': 3, 'trojga': 3, 'czterech': 4, 'pieciu': 5, 'pięciu': 5,
      // ES/PT
      'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5, 'duas': 2, 'três': 3, 'tres ': 3,
      // FR
      'deux': 2, 'trois': 3, 'quatre': 4, 'cinq': 5,
      // IT
      'due': 2, 'tre': 3, 'quattro': 4, 'cinque': 5,
      // DE
      'zwei': 2, 'drei': 3, 'vier': 4, 'fünf': 5, 'funf': 5,
      // NL
      'twee': 2, 'drie': 3, 'vier nl': 4, 'vijf': 5,
      // SV
      'två': 2, 'tva': 2, 'fyra': 4, 'fem': 5,
      // HR
      'dvije': 2, 'dvoje': 2, 'troje': 3, 'četvero': 4, 'cetvero': 4,
      // SQ
      'dy': 2, 'katër': 4, 'kater': 4, 'pesë': 5, 'pese': 5,
    }
    const wordNumRe = /\b(?:dla|para|pour|f[üu]r|per|voor|f[oö]r|za|p[ëe]r)\s+(dwoch|dwóch|dwojga|dwa|dwie|trzech|trojga|czterech|pieciu|pięciu|dos|tres|cuatro|cinco|duas|três|deux|trois|quatre|cinq|due|tre|quattro|cinque|zwei|drei|vier|fünf|funf|twee|drie|vijf|två|tva|fyra|fem|dvije|dvoje|troje|četvero|cetvero|dy|katër|kater|pesë|pese)\s+(?:os[oó]b|persona[s]?|persone|personnes?|personen?|pessoas?|leute|osoba|vetë|vete)\b/iu
    const wm = t.match(wordNumRe)
    if (wm) {
      const n = WORD_NUM[wm[1].toLowerCase()] ?? 0
      if (n > 0) {
        result.group_size = n
        if (!result.adults) result.adults = n
      }
    }
  }

  // ── Solo signals — all languages ──────────────────────────────────────────
  const hasSoloSignal =
    /\b(?:solo|alone|just\s+me|only\s+me|(?:travell?ing?|flying?|going?)\s+(?:alone|solo|by\s+myself)|by\s+myself|on\s+my\s+own|for\s+one|single\s+travell?er)\b/.test(t) ||                      // EN
    /\b(?:allein(?:e|reisend)?|als?\s+einzelperson|nur\s+ich|f[üu]r\s+(?:eine[n]?\s+)?(?:person|mich)|als?\s+solopassagier|f[üu]r\s+mich\s+allein(?:e)?)\b/.test(t) ||                        // DE
    /\b(?:solo(?:\/sola)?|sola?\b|por\s+mi\s+cuenta|yo\s+solo(?:\/sola)?|viajando\s+solo(?:\/sola)?|para\s+m[ií]\s+solo(?:\/sola)?|por\s+mi\s+mismo(?:\/misma)?)\b/.test(t) ||                 // ES
    /\b(?:seul(?:e)?|tout(?:e)?\s+seul(?:e)?|pour\s+moi\s+seul(?:e)?|en\s+solo|par\s+moi[- ]même|seul(?:e)?\s+voyageur(?:se)?)\b/.test(t) ||                                                   // FR
    /\b(?:da\s+solo(?:\/sola)?|per\s+me\s+solo(?:\/sola)?|in\s+solitaria|da\s+solo|viaggio\s+solitario)\b/.test(t) ||                                                                           // IT
    /\b(?:alleen|als\s+enige|voor\s+mezelf|op\s+mijn\s+eentje|in\s+mijn\s+eentje|soloreis(?:iger)?)\b/.test(t) ||                                                                               // NL
    /\b(?:sam(?:otnie)?|sama?\b|w\s+pojedynk[eę]|tylko\s+ja|dla\s+siebie|jako\s+solo)\b/.test(t) ||                                                                                             // PL
    /\b(?:sozinho(?:\/sozinha)?|sozinha?\b|s[oó]\s+eu|por\s+conta\s+pr[oó]pria|viajando\s+sozinho(?:\/sozinha)?)\b/.test(t) ||                                                                   // PT
    /\b(?:ensam(?:t)?|f[oö]r\s+mig\s+sj[äa]lv|ensam\s+resa(?:nde)?|solo|bara\s+jag)\b/.test(t) ||                                                                                              // SV
    /\b(?:sam(?:a)?\b|kao\s+solo(?:\s+putnik)?|sama?\s+putovati|za\s+(?:jednu\s+)?osobu)\b/.test(t) ||                                                                                          // HR
    /\b(?:vet[eë]m|i\s+vet[eë]m|e\s+vet[eë]me?|vet[eë]m\s+un[eë]?|udh[eë]tar\s+i\s+vet[eë]m)\b/.test(t)                                                                                      // SQ

  // ── Couple / partner signals — all languages ───────────────────────────────
  const hasCoupleSignal =
    /\b(?:as\s+a\s+couple|for\s+(?:a\s+)?couple|for\s+(?:the\s+)?(?:two|2)(?:\s+of\s+us)?|with\s+(?:my\s+)?(?:partner|wife|husband|boyfriend|girlfriend|fianc[eé]e?|spouse|other\s+half|significant\s+other)|the\s+two\s+of\s+us|just\s+(?:the\s+)?(?:two|2)\s+of\s+us|just\s+us\s+two|us\s+two|we\s+two|date\s+(?:night|trip|flight))\b/.test(t) ||   // EN
    /\b(?:zu\s+zweit|als\s+paar|mit\s+(?:meiner\s+frau|meinem\s+mann|meiner\s+partnerin|meinem\s+partner|meiner\s+freundin|meinem\s+freund)|wir\s+(?:zwei|2)|als?\s+pärchen)\b/.test(t) ||   // DE
    /\b(?:en\s+pareja|con\s+mi\s+pareja|con\s+mi\s+(?:esposa|esposo|novia|novio|marido|mujer)|somos\s+dos|los\s+dos|nosotros\s+dos|para\s+dos(?:\s+personas?)?|viaje\s+(?:en\s+pareja|romantic[ao]))\b/.test(t) || // ES
    /\b(?:en\s+couple|avec\s+(?:ma\s+femme|mon\s+mari|ma\s+partenaire|mon\s+partenaire|ma\s+copine|mon\s+copain|ma\s+compagne|mon\s+compagnon)|tous\s+les\s+deux|nous\s+deux|pour\s+deux(?:\s+personnes?)?)\b/.test(t) || // FR
    /\b(?:in\s+coppia|con\s+(?:mia\s+moglie|mio\s+marito|la\s+mia\s+ragazza|il\s+mio\s+ragazzo|la\s+mia\s+compagna|il\s+mio\s+compagno)|siamo\s+in\s+due|noi\s+due|per\s+due(?:\s+persone?)?)\b/.test(t) || // IT
    /\b(?:als\s+(?:koppel|stel|paar)|met\s+(?:mijn\s+vrouw|mijn\s+man|mijn\s+partner|mijn\s+meisje|mijn\s+vriend(?:je)?)|met\s+z[''']n\s+twee[ën]n?|wij\s+twee[ën]n?|voor\s+twee(?:\s+personen?)?\b)\b/.test(t) || // NL
    /\b(?:jako\s+para|z\s+(?:[żz]on[ąa]|m[eę][żz]em|partnerk[ąa]|partnerem|dziewczyn[ąa]|chłopakiem)|we\s+dwoj(?:e|gu)|nas\s+dwoj(?:e|gu)|dla\s+dwojga)\b/.test(t) || // PL
    /\b(?:em\s+casal|com\s+(?:minha\s+esposa|meu\s+marido|minha\s+namorada|meu\s+namorado|minha\s+companheira|meu\s+companheiro)|n[oó]s\s+dois|para\s+dois(?:\s+pessoas?)?\b)\b/.test(t) || // PT
    /\b(?:som\s+par|med\s+(?:min\s+fru|min\s+man|min\s+partner|min\s+flickv[äa]n|min\s+pojkv[äa]n)|vi\s+tv[åa]|f[oö]r\s+tv[åa](?:\s+personer?)?\b)\b/.test(t) || // SV
    /\b(?:kao\s+par|s\s+(?:mojom\s+[žz]enom|mojim\s+mu[žz]em|mojom\s+djevojkom|mojim\s+de[čc]kom|partnerom|partnericom)|nas\s+dvoje|za\s+(?:dvoje|par)(?:\s+osoba?)?\b)\b/.test(t) || // HR
    /\b(?:si\s+[çc]ift|me\s+(?:gruan|burrin\s+tim|t[eë]\s+dashur[eë]n|t[eë]\s+dashurin\s+tim|partneren|partnerin)|ne\s+t[eë]\s+dy|p[eë]r\s+dy(?:\s+vetë)?\b)\b/.test(t) ||  // SQ
    // Generic "for a/the couple" patterns across all langs (catches "para una pareja",
    // "voor een koppel/stel", "für ein paar", "per una coppia", "para um casal", etc.)
    /\b(?:para\s+(?:una|la|mi)\s+pareja|para\s+(?:um|o|meu)\s+casal|pour\s+(?:un|le|notre)\s+couple|f[üu]r\s+(?:ein|das|unser)\s+(?:paar|p[äa]rchen)|per\s+(?:una|la|nostra)\s+coppia|voor\s+(?:een|het|ons)\s+(?:koppel|stel|paar)|f[oö]r\s+(?:ett|v[åa]rt|mitt)\s+par|za\s+(?:jedan|na[šs])\s+par|p[eë]r\s+nj[eë]\s+[çc]ift|dla\s+pary)\b/i.test(t)

  // ── Honeymoon signals ─────────────────────────────────────────────────────
  const hasHoneymoonSignal =
    /\b(?:honeymoon|romantic\s+(?:trip|getaway|holiday|escape|flight)|anniversary\s+(?:trip|holiday))\b/.test(t) ||            // EN
    /\b(?:flitterwochen|hochzeitsreise|romantische(?:r|s|n)?\s+(?:urlaub|reise|trip)|hochzeitsreise)\b/.test(t) ||             // DE
    /\b(?:luna\s+de\s+miel|viaje\s+rom[aá]ntico|viaje\s+de\s+novios)\b/.test(t) ||                                             // ES
    /\b(?:lune\s+de\s+miel|voyage\s+romantique|voyage\s+de\s+noces|escapade\s+romantique)\b/.test(t) ||                        // FR
    /\b(?:luna\s+di\s+miele|viaggio\s+romantico|viaggio\s+di\s+nozze)\b/.test(t) ||                                            // IT
    /\b(?:huwelijksreis|romantische\s+(?:reis|trip)|wittebroodsweken)\b/.test(t) ||                                             // NL
    /\b(?:miodowy\s+miesi[ąa]c|podr[oó][zż]\s+romantyczna|podr[oó][zż]\s+poślubna)\b/.test(t) ||                              // PL
    /\b(?:lua\s+de\s+mel|viagem\s+rom[aâ]ntica|viagem\s+de\s+n[uú]pcias)\b/.test(t) ||                                        // PT
    /\b(?:smekmånad|romantisk\s+resa|bröllopsresa)\b/.test(t) ||                                                                // SV
    /\b(?:medeni\s+mjesec|romantično\s+putovanje|bračno\s+putovanje)\b/.test(t) ||                                              // HR
    /\b(?:mua[lj]a\s+e\s+mjaltit|udh[eë]tim\s+romantik|udh[eë]tim\s+martese[s]?)\b/.test(t)                                   // SQ

  // ── Family signals — all languages ────────────────────────────────────────
  const hasFamilySignal =
    /\b(?:with\s+(?:(?:the\s+)?kids?|children|family|my\s+family|the\s+family|grandchildren?|grandkids?)|family\s+(?:trip|holiday|vacation|flight|break|getaway)|taking\s+(?:the\s+)?kids?|travell?ing?\s+with\s+(?:kids?|children|family)|kid-friendly)\b/.test(t) || // EN
    /\b(?:mit\s+(?:(?:den?\s+)?kindern?|der\s+familie|meiner\s+familie|kleinen?|meinen\s+kindern)|als\s+familie|familienurlaub|familienreise|familienflug|familienausflug|mit\s+meinen\s+kindern)\b/.test(t) || // DE
    /\b(?:con\s+(?:(?:los|mis)\s+ni[ñn]os?|(?:los|mis)\s+hijos?|(?:la|mi)\s+familia)|en\s+familia|viaje\s+(?:familiar|en\s+familia)|con\s+ni[ñn]os?|con\s+hijos?|viaje\s+familiar)\b/.test(t) || // ES
    /\b(?:avec\s+(?:(?:les|mes)\s+enfants?|(?:la|ma)\s+famille)|en\s+famille|voyage\s+(?:en\s+famille|familial)|avec\s+des\s+enfants?)\b/.test(t) || // FR
    /\b(?:con\s+(?:(?:i|miei)\s+bambini|(?:la|mia)\s+famiglia|i\s+figli)|in\s+famiglia|viaggio\s+in\s+famiglia|con\s+bambini)\b/.test(t) || // IT
    /\b(?:met\s+(?:(?:de|mijn)\s+kinderen|(?:het|mijn)\s+gezin|de\s+kids?|de\s+familie)|als\s+gezin|gezinsreis|gezinsvakantie|met\s+kinderen)\b/.test(t) || // NL
    /\b(?:z\s+(?:dzie[cć]mi|rodzin[ąa]|moją\s+rodzin[ąa])|jako\s+rodzina|wyjazd\s+rodzinny|podró[zż]\s+rodzinna|z\s+dzie[cć]mi)\b/.test(t) || // PL
    /\b(?:com\s+(?:(?:as|minhas)\s+crianças?|(?:a|minha)\s+família|(?:os|meus)\s+filhos?)|em\s+família|viagem\s+(?:em\s+família|familiar)|com\s+crianças?)\b/.test(t) || // PT
    /\b(?:med\s+(?:(?:barnen?|mina\s+barn)|(?:familjen|min\s+familj)|ungarna?)|som\s+familj|familjesemester|familjeresa|med\s+barn)\b/.test(t) || // SV
    /\b(?:s\s+(?:djecom|obitelju|mojom\s+obitelju|(?:svojom\s+)?djecom)|kao\s+obitelj|obiteljski\s+odmor|obiteljsko\s+putovanje|s\s+djecom)\b/.test(t) || // HR
    /\b(?:me\s+(?:f[eë]mij[eë]t?|familjen|familjes\s+time?)|si\s+familje|pushime\s+familjare|udh[eë]tim\s+familjar|me\s+f[eë]mij[eë])\b/i.test(t) ||  // SQ
    // Generic "for a/the family" patterns across all langs (catches "pour une famille",
    // "para una/uma familia", "voor een gezin", "für eine Familie", "per una famiglia", etc.)
    /\b(?:para\s+(?:una|la|mi)\s+familia|para\s+(?:uma|a|minha)\s+fam[ií]lia|pour\s+(?:une|la|notre|ma)\s+famille|f[üu]r\s+(?:eine|die|unsere|meine)\s+familie|per\s+(?:una|la|nostra|mia)\s+famiglia|voor\s+(?:een|het|ons|mijn)\s+(?:gezin|familie)|f[oö]r\s+(?:en|v[åa]r|min)\s+familj|za\s+(?:jednu|na[šs]u)\s+obitelj|p[eë]r\s+nj[eë]\s+familje|dla\s+rodziny)\b/i.test(t)

  // ── Group / friends signals — all languages ───────────────────────────────
  const hasGroupSignal =
    /\b(?:with\s+(?:friends?|mates?|colleagues?|coworkers?|the\s+lads?|the\s+girls?|the\s+team|the\s+squad|buddies|pals?|work(?:mates?)?|uni\s+friends?)|stag\s+(?:do|party|trip)|hen\s+(?:do|party|trip)|bachelorette(?:\s+party)?|bachelor\s+party|group\s+(?:trip|booking|travel|holiday)|lads\s+(?:trip|holiday|weekend)|girls\s+(?:trip|holiday|weekend))\b/.test(t) || // EN
    /\b(?:mit\s+(?:freunden?|freundinnen?|kollegen?|kolleginnen?|jungs?|m[äa]dels?|der\s+gruppe|der\s+clique)|junggesellenabschied|grouppenreise|als\s+gruppe|klassenfahrt|betriebsausflug)\b/.test(t) || // DE
    /\b(?:con\s+(?:amigos?|amigas?|colegas?|compa[ñn]eros?|el\s+grupo|la\s+pandilla|los\s+chicos?|las\s+chicas?)|viaje\s+(?:en\s+grupo|de\s+amigos?)|despedida\s+de\s+(?:soltero|soltera)|excursi[oó]n\s+(?:escolar|de\s+empresa))\b/.test(t) || // ES
    /\b(?:avec\s+(?:(?:des|mes)\s+amis?|(?:des|mes)\s+coll[eè]gues?|la\s+bande|le\s+groupe|les\s+copains?|les\s+copines?)|en\s+groupe|enterrement\s+de\s+vie\s+de\s+(?:gar[çc]on|jeune\s+fille)|voyage\s+de\s+groupe|sortie\s+(?:scolaire|d['']entreprise))\b/.test(t) || // FR
    /\b(?:con\s+(?:(?:gli|i\s+miei)\s+amici|(?:le\s+mie)\s+amiche|colleghi?|il\s+gruppo|la\s+comitiva)|in\s+gruppo|addio\s+al\s+(?:celibato|nubilato)|gita\s+(?:scolastica|aziendale)|viaggio\s+di\s+gruppo)\b/.test(t) || // IT
    /\b(?:met\s+(?:(?:mijn\s+)?vrienden?|vriendinnen?|collega[''s]?|de\s+groep|de\s+jongens?|de\s+meiden?)|als\s+groep|vrijgezellenfeest|groepsreis|schoolreis|bedrijfsuitje)\b/.test(t) || // NL
    /\b(?:z\s+(?:przyjació[łl]mi|przyjaci[oó][łl]kami|kolegami|kole[zż]ankami|grup[ąa])|jako\s+grupa|wieczór\s+kawalerski|wieczór\s+panieński|wycieczka\s+grupowa|wyjazdowa\s+firmowa)\b/.test(t) || // PL
    /\b(?:com\s+(?:(?:os|meus)\s+amigos?|(?:as|minhas)\s+amigas?|colegas?|o\s+grupo|a\s+turma)|em\s+grupo|despedida\s+de\s+(?:solteiro|solteira)|viagem\s+em\s+grupo|excurs[aã]o\s+escolar)\b/.test(t) || // PT
    /\b(?:med\s+(?:(?:mina\s+)?v[äa]nner|kollegor|g[äa]nget|grabbarna|tjejerna)|som\s+grupp|svensexa|m[oö]hippa|gruppresor?|skolresa|f[öo]retagsresa)\b/.test(t) || // SV
    /\b(?:s\s+(?:(?:mojim\s+)?prijateljima|kolegama|kolicama|ekipom?)|kao\s+grupa|moma[čc]ka\s+ve[čc]er|djevoja[čc]ka\s+ve[čc]er|grupno\s+putovanje|izlet\s+(?:školski|za\s+posao))\b/.test(t) || // HR
    /\b(?:me\s+(?:(?:miqt[eë]|shoq[eë]rit[eë])|koleget?|grupin|djemtë|vajzat)|si\s+grup|natë\s+djali|natë\s+vajzash|udh[eë]tim\s+grupi)\b/.test(t) // SQ

  // ── Business / work signals — all languages ───────────────────────────────
  const hasBizSignal =
    /\b(?:(?:for\s+(?:a\s+)?)?business\s+(?:trip|travel|meeting|conference|summit|event|flight)|work\s+trip|for\s+work|corporate\s+travel|client\s+meeting|work\s+flight|business\s+class\s+(?:trip|travel)|flying\s+for\s+work|on\s+business)\b/.test(t) || // EN
    /\b(?:gesch[äa]ftsreise|gesch[äa]ftlich|f[üu]r\s+die\s+arbeit|dienstreise|konferenzreise|gesch[äa]ftsflug|dienstlich|arbeitsreise|messe|fachtagung)\b/.test(t) || // DE
    /\b(?:viaje\s+de\s+negocios|por\s+(?:motivos?\s+de\s+)?trabajo|viaje\s+(?:de\s+trabajo|corporativo|de\s+empresa)|reunión\s+de\s+negocios|congreso|conferencia|vuelo\s+de\s+negocios)\b/.test(t) || // ES
    /\b(?:voyage\s+d['']affaires|pour\s+(?:le\s+)?travail|d[eé]placement\s+professionnel|conf[eé]rence|r[eé]union\s+d['']affaires|vol\s+d['']affaires)\b/.test(t) || // FR
    /\b(?:viaggio\s+d['']affari|per\s+(?:lavoro|motivi\s+di\s+lavoro)|trasferta|conferenza|riunione\s+d['']affari|volo\s+d['']affari)\b/.test(t) || // IT
    /\b(?:zakenreis|voor\s+(?:het\s+)?werk|zakelijk|zakenreis|conferentie|zakelijke\s+reis|werkvlucht)\b/.test(t) || // NL
    /\b(?:podr[oó][zż]\s+s[lł]u[zż]bowa|w\s+celach?\s+s[lł]u[zż]bowych|dla\s+pracy|konferencja|delegacja|lot\s+s[lł]u[zż]bowy)\b/.test(t) || // PL
    /\b(?:viagem\s+de\s+neg[oó]cios|a\s+(?:trabalho|neg[oó]cios)|viagem\s+(?:corporativa|de\s+trabalho)|confer[eê]ncia|reuni[aã]o\s+de\s+neg[oó]cios)\b/.test(t) || // PT
    /\b(?:aff[äa]rsresa|f[oö]r\s+jobbet|tj[äa]nsteresa|konferensresa|aff[äa]rsflyg|yrkesresa)\b/.test(t) || // SV
    /\b(?:poslovno\s+putovanje|zbog\s+posla|slu[žz]beno\s+putovanje|konferencija|poslovni\s+let|na\s+posao)\b/.test(t) || // HR
    /\b(?:udh[eë]tim\s+biznesi|p[eë]r\s+pun[eë]|konferenc[eë]|udh[eë]tim\s+pune|fluturim\s+biznesi)\b/.test(t) // SQ

  // ── Apply context + defaults ──────────────────────────────────────────────
  if (hasSoloSignal) { result.context = 'solo'; if (!result.adults) result.adults = 1 }
  else if (hasHoneymoonSignal || hasCoupleSignal) { result.context = 'couple'; if (!result.adults) result.adults = 2 }
  else if (hasFamilySignal) { result.context = 'family'; if (!result.children) result.children = 1 }
  else if (hasGroupSignal) { result.context = 'group' }
  else if (hasBizSignal) { result.context = 'business_traveler' }

  // ── Inferred booking requirements ────────────────────────────────────────
  const hasKids = (result.children ?? 0) > 0 || (result.infants ?? 0) > 0 || result.context === 'family'
  const hasInfants = (result.infants ?? 0) > 0 ||
    /\bwith\s+(?:a\s+)?(?:baby|infant|toddler|newborn)\b/.test(t) ||
    /\bmit\s+(?:einem?\s+)?(?:baby|kleinkind|säugling)\b/.test(t) ||
    /\bcon\s+(?:un\s+)?(?:bebé|neonato)\b/.test(t) ||
    /\bavec\s+(?:un\s+)?b[eé]b[eé]\b/.test(t)

  if (hasKids) {
    result.require_adjacent_seats = true
    result.require_seat_selection = true
    result.prefer_direct = true
  }
  if (hasInfants) {
    result.require_bassinet = true
    result.prefer_direct = true
    result.require_seat_selection = true
  }

  // "sit together" signals in all languages
  if (/\b(?:sit\s+(?:together|next\s+to\s+each\s+other|beside\s+each\s+other|side\s+by\s+side)|adjacent\s+seats?|seats?\s+together|together\s+on\s+the\s+(?:plane|flight)|nebeneinander\s+sitzen|zusammen\s+sitzen|sentarse\s+juntos?|assentos?\s+juntos?|assis\s+ensemble|côte\s+à\s+côte|sedere\s+insieme|posti\s+vicini|naast\s+elkaar\s+zitten|samen\s+zitten|siedź(?:my|cie)?\s+razem|siedzieć\s+razem|sentar\s+juntos?|sitta\s+bredvid\s+varandra|sjediti\s+zajedno|rri(?:ni)?\s+bashkë)\b/.test(t)) {
    result.require_adjacent_seats = true
    result.require_seat_selection = true
  }

  // Explicit seat selection request in all languages
  if (/\b(?:with\s+seat\s+selection|seat\s+selection\s+(?:included|required|needed|must)|select(?:ing)?\s+(?:my\s+|our\s+)?seats?|mit\s+sitzplatzwahl|sitzplatzreservierung|con\s+selecci[oó]n\s+de\s+asiento|avec\s+s[eé]lection\s+de\s+si[eè]ge|con\s+scelta\s+del\s+posto|met\s+stoelkeuze|z\s+wyborem\s+miejsca|com\s+escolha\s+de\s+assento|med\s+sätesval|s\s+odabirom\s+sjedala|me\s+zgjedhje\s+ulëse)\b/.test(t)) {
    result.require_seat_selection = true
  }

  // Elderly / mobility / accessibility → prefer direct + seat selection
  if (/\b(?:with\s+(?:elderly|older|senior)\s+(?:parents?|relatives?|grandparents?|people)|wheelchair|disabled|accessibility|special\s+(?:assistance|needs|requirements?)|mobility\s+(?:aid|assistance|issues?|problems?)|reduced\s+mobility|handicapped|alte(?:n|r)?\s+(?:eltern|leute)|rollstuhl|gehbehindert|barrierefreiheit|en\s+silla\s+de\s+ruedas|discapacitado|mobilidad\s+reducida|en\s+fauteuil\s+roulant|handicap[eé]|mobilité\s+réduite|in\s+sedia\s+a\s+rotelle|disabile|mobilità\s+ridotta|rolstoel|gehandicapt|beperkte\s+mobiliteit|wózek\s+inwalidzki|niepełnosprawny|cadeira\s+de\s+rodas|deficiente|mobilidade\s+reduzida|rullstol|funktionsnedsättning|invalidska\s+kolica|invalid|kolica|karrocë\s+me\s+rrota|me\s+aftësi\s+të\s+kufizuara)\b/.test(t)) {
    result.prefer_direct = true
    result.require_seat_selection = true
  }

  if (result.context === 'business_traveler') result.prefer_direct = true

  return result
}

// ── Ancillary requirements extraction ─────────────────────────────────────────
interface AncillaryExtraction {
  require_checked_baggage?: boolean
  carry_on_only?: boolean
  require_meals?: boolean
  require_cancellation?: boolean
  require_lounge?: boolean
}

function extractAncillaries(text: string): AncillaryExtraction {
  const t = stripAccents(text.toLowerCase())
  const r: AncillaryExtraction = {}

  // ── Checked baggage — all languages ───────────────────────────────────────
  if (
    // EN
    /\b(?:with\s+(?:checked?\s+)?(?:bag(?:gage)?s?|luggage|hold\s+(?:luggage|bag(?:gage)?s?)|suitcase)|including\s+(?:bag(?:gage)?s?|luggage)|bags?\s+included|baggage\s+included|with\s+hold|checked?\s+bag(?:gage)?\s+included|luggage\s+included|including\s+(?:a\s+)?suitcase|with\s+a\s+suitcase|extra\s+bag(?:gage)?|baggage\s+allowance|bag\s+allowance|\d+\s*kg\s+(?:bag|luggage|baggage)|hold\s+bag)\b/.test(t) ||
    // DE
    /\b(?:mit\s+(?:aufgabegep[äa]ck|koffer|gep[äa]ck|reisegep[äa]ck|eingecheckt(?:em)?\s+gep[äa]ck)|aufgabegep[äa]ck\s+(?:inkl(?:usive)?|inklusive|enthalten|dabei|inbegriffen)|gep[äa]ck\s+(?:aufgeben|inklusive|inkl|dabei|inbegriffen|enthalten)|mit\s+koffer\s+aufgeben|mit\s+gep[äa]ck\s+aufgeben)\b/.test(t) ||
    // ES
    /\b(?:con\s+(?:maleta\s+(?:facturada?)?|equipaje\s+(?:facturado?|en\s+bodega|incluido)|maleta\s+grande)|equipaje\s+(?:incluido|facturado?|en\s+la\s+bodega|de\s+bodega)|con\s+maleta|maleta\s+incluida?)\b/.test(t) ||
    // FR
    /\b(?:avec\s+(?:(?:les\s+)?bagages?\s+(?:en\s+soute|enregistr[eé]s?)?|(?:une\s+)?valise(?:\s+en\s+soute)?)|bagages?\s+(?:inclus|compris|en\s+soute)|valise\s+(?:incluse|comprise)|avec\s+bagage)\b/.test(t) ||
    // IT
    /\b(?:con\s+(?:(?:il\s+)?bagaglio\s+(?:in\s+stiva|registrato)?|(?:la\s+)?valigia(?:\s+in\s+stiva)?)|bagaglio\s+(?:incluso|compreso|in\s+stiva)|valigia\s+(?:inclusa|compresa)|con\s+bagaglio)\b/.test(t) ||
    // NL
    /\b(?:met\s+(?:(?:ingecheckte\s+)?bagage|koffer|ruimbagage)|bagage\s+(?:inbegrepen|inclusief|ingecheckt)|koffer\s+(?:inbegrepen|incl)|met\s+bagage\s+inchecken)\b/.test(t) ||
    // PL
    /\b(?:z\s+(?:bagażem\s+(?:rejestrowanym|nadanym)?|walizk[ąa]|walizkami?)|bagaż\s+(?:w\s+cenie|wliczony|rejestrowany|nadany|w\s+zestawie)|z\s+walizką\s+w\s+cenie)\b/.test(t) ||
    // PT
    /\b(?:com\s+(?:(?:a\s+)?bagagem\s+(?:despachada?|registada?|faturada?)?|(?:a\s+)?mala\s+grande)|bagagem\s+(?:incluída?|despachada?|no\s+por[aã]o)|mala\s+(?:incluída?|despachada?))\b/.test(t) ||
    // SV
    /\b(?:med\s+(?:incheckat\s+bagage|v[äa]ska|resv[äa]ska)|bagage\s+(?:ingår|inkl(?:uderat)?)|incheckat\s+bagage\s+(?:ingår|inkl))\b/.test(t) ||
    // HR
    /\b(?:s\s+(?:(?:predanom\s+)?prtljagom|koferom|predanom\s+torbom)|prtljaga\s+(?:uključena|u\s+cijeni)|s\s+koferom)\b/.test(t) ||
    // SQ
    /\b(?:me\s+(?:(?:bagazh\s+(?:t[eë]\s+paraqitur)?|çant[eë]n?\s+(?:t[eë]\s+madhe)?|valixhen?))|bagazhi\s+(?:i\s+p[eë]rfshir[eë]|t[eë]\s+paraqitur))\b/.test(t)
  ) { r.require_checked_baggage = true }

  // ── Carry-on only — all languages ─────────────────────────────────────────
  if (
    // EN
    /\b(?:carry[- ]?on\s+only|hand\s+(?:luggage|baggage)\s+only|cabin\s+bag(?:gage)?\s+only|no\s+(?:hold|checked?)\s+(?:bag(?:gage)?|luggage)|without\s+(?:checked?\s+)?(?:bag(?:gage)?|luggage)|hand\s+only|cabin\s+only|no\s+bags?\s+checked?|carry[- ]?on\s+bag(?:gage)?|just\s+(?:a\s+)?hand\s+(?:luggage|baggage)|just\s+cabin\s+bag)\b/.test(t) ||
    // DE
    /\b(?:nur\s+handgep[äa]ck|handgep[äa]ck\s+only|kein\s+aufgabegep[äa]ck|ohne\s+(?:aufgabegep[äa]ck|koffer\s+aufgeben)|nur\s+kabinengep[äa]ck|handgep[äa]ck\s+nur)\b/.test(t) ||
    // ES
    /\b(?:solo\s+(?:equipaje\s+de\s+mano|bolsa\s+de\s+mano|mochila)|sin\s+maleta\s+(?:facturada?|en\s+bodega)|solo\s+cabina|sin\s+equipaje\s+(?:en\s+bodega|facturado?)|equipaje\s+de\s+mano\s+(?:solo|únicamente))\b/.test(t) ||
    // FR
    /\b(?:seulement\s+(?:bagage\s+(?:cabine|à\s+main)|sac\s+(?:cabine|à\s+main))|sans\s+bagage\s+en\s+soute|juste\s+(?:un\s+)?bagage\s+(?:cabine|à\s+main)|sans\s+valise|cabine\s+seulement|bagage\s+cabine\s+seulement)\b/.test(t) ||
    // IT
    /\b(?:solo\s+(?:bagaglio\s+a\s+mano|bagagli\s+a\s+mano)|senza\s+bagaglio\s+in\s+stiva|solo\s+cabina|senza\s+valigia\s+(?:grande|registrata))\b/.test(t) ||
    // NL
    /\b(?:alleen\s+handbagage|geen\s+(?:ingecheckte\s+)?bagage|zonder\s+koffer|handbagage\s+alleen|geen\s+ruimbagage)\b/.test(t) ||
    // PL
    /\b(?:tylko\s+bagaż\s+podr[eę]czny|bez\s+bagażu\s+rejestrowanego|tylko\s+kabina|bez\s+walizki\s+nadanej)\b/.test(t) ||
    // PT
    /\b(?:s[oó]\s+bagagem\s+de\s+m[aã]o|sem\s+bagagem\s+despachada?|apenas\s+bagagem\s+de\s+m[aã]o|sem\s+mala\s+grande)\b/.test(t) ||
    // SV
    /\b(?:bara\s+handbagage|inget\s+incheckat\s+bagage|utan\s+resv[äa]ska|handbagage\s+bara)\b/.test(t) ||
    // HR/SQ
    /\b(?:samo\s+ru[čc]na\s+prtljaga|bez\s+predane\s+prtljage|bez\s+kofera|vet[eë]m\s+bagazh\s+dore|pa\s+bagazh\s+t[eë]\s+paraqitur)\b/.test(t)
  ) { r.carry_on_only = true }

  // ── Meals — all languages ─────────────────────────────────────────────────
  if (
    /\b(?:with\s+(?:meals?|food|catering|dinner|lunch|breakfast|a\s+meal|inflight\s+(?:meal|food))|including\s+meals?|meals?\s+included|hot\s+meal|in-flight\s+(?:meal|catering))\b/.test(t) ||     // EN
    /\b(?:mit\s+(?:mahlzeit(?:en)?|essen|verpflegung|bordverpflegung|men[üu])|essen\s+(?:inklusive|inbegriffen)|mahlzeit(?:en)?\s+inklusive)\b/.test(t) ||                                         // DE
    /\b(?:con\s+(?:comida(?:s)?|men[uú]|servicio\s+de\s+comida|alimentaci[oó]n)|comida\s+incluida?|servicio\s+de\s+a\s+bordo\s+incluido)\b/.test(t) ||                                             // ES
    /\b(?:avec\s+(?:(?:les\s+)?repas|nourriture|restauration(?:\s+bord)?)|repas\s+(?:inclus|compris)|restauration\s+(?:incluse|comprise))\b/.test(t) ||                                             // FR
    /\b(?:con\s+(?:pasto|pasti|vitto|cibo)|pasto\s+(?:incluso|compreso)|pasti\s+(?:inclusi|compresi))\b/.test(t) ||                                                                                // IT
    /\b(?:met\s+(?:maaltijd(?:en)?|eten|catering)|maaltijd(?:en)?\s+(?:inbegrepen|inclusief))\b/.test(t) ||                                                                                        // NL
    /\b(?:z\s+(?:posiłkiem|jedzeniem|wy[zż]ywieniem)|posiłek\s+(?:wliczony|w\s+cenie))\b/.test(t) ||                                                                                              // PL
    /\b(?:com\s+(?:refeição|refeições|alimentação|comida\s+a\s+bordo)|refeição\s+incluída?)\b/.test(t) ||                                                                                          // PT
    /\b(?:med\s+(?:m[åa]ltid(?:er)?|mat|f[öo]rtäring)|m[åa]ltid(?:er)?\s+(?:ingår|inkluderat))\b/.test(t) ||                                                                                     // SV
    /\b(?:s\s+(?:obrokom|jelom|hranom)|obrok\s+uključen)\b/.test(t) ||                                                                                                                            // HR
    /\b(?:me\s+(?:vakt(?:in|e)|ushqim|ushqimin)|vakti\s+i\s+p[eë]rfshir[eë])\b/.test(t)                                                                                                          // SQ
  ) { r.require_meals = true }

  // ── Refundable / cancellation — all languages ─────────────────────────────
  if (
    /\b(?:fully\s+refundable|free\s+cancellation|with\s+(?:free\s+)?cancellation|cancellation\s+included|refundable|fully\s+flexible|no\s+cancellation\s+fee|can\s+cancel|able\s+to\s+cancel|changeable\s+ticket|flexible\s+ticket|can\s+change|changeable|modifiable|amendable)\b/.test(t) || // EN
    /\b(?:erstattungsf[äa]hig|kostenlos\s+stornierbar|mit\s+stornierungsm[öo]glichkeit|flexibel\s+buchbar|umbuchbar|kostenfreie\s+stornierung|kostenlose\s+stornierung|r[üu]ckgabe(?:fähig)?|erstattbar)\b/.test(t) || // DE
    /\b(?:reembolsable|cancelaci[oó]n\s+gratuita|con\s+(?:posibilidad\s+de\s+cancelar|cancelaci[oó]n\s+gratis)|ticket\s+flexible|billete\s+flexible|cambio\s+gratuito|con\s+cambio)\b/.test(t) || // ES
    /\b(?:remboursable|annulation\s+gratuite|avec\s+(?:annulation\s+(?:gratuite|possible)|possibilit[eé]\s+d['']annulation)|billet\s+flexible|modifiable|[eé]changeable)\b/.test(t) || // FR
    /\b(?:rimborsabile|cancellazione\s+gratuita|con\s+(?:possibilit[aà]\s+di\s+(?:cancellare|annullare)|cancellazione\s+gratuita)|biglietto\s+flessibile|modificabile|cambiabile)\b/.test(t) || // IT
    /\b(?:restitueerbaar|gratis\s+annulering|met\s+(?:annuleringsoptie|gratis\s+annulering)|flexibel\s+ticket|omboekbaar|annuleerbaar)\b/.test(t) || // NL
    /\b(?:zwrotny|darmowe\s+odwołanie|z\s+(?:możliwością\s+odwołania|bezpłatnym\s+odwołaniem)|elastyczny\s+bilet|do\s+zmiany)\b/.test(t) || // PL
    /\b(?:reembolsável|cancelamento\s+gratuito|com\s+(?:possibilidade\s+de\s+cancelar|cancelamento\s+gratuito)|bilhete\s+flex[ií]vel|alter[aá]vel|modificável)\b/.test(t) || // PT
    /\b(?:[aå]terbetalningsbar|kostnadsfri\s+avbokning|med\s+avbokningsrätt|flexibel\s+biljett|ombokningsbar)\b/.test(t) || // SV
    /\b(?:povrativi|besplatno\s+otkazivanje|s\s+mogu[cć]nosti\s+otkazivanja|fleksibilna\s+karta|promjenjiva\s+karta)\b/.test(t) || // HR
    /\b(?:i\s+rimbursuesh[eë]m|anulim\s+falas|me\s+mundësi\s+anulimi|bilet[eë]\s+fleksib[eë]l)\b/.test(t) // SQ
  ) { r.require_cancellation = true }

  // ── Lounge access — all languages ─────────────────────────────────────────
  if (
    /\b(?:with\s+lounge(?:\s+access)?|lounge\s+(?:included|access)|airport\s+lounge|priority\s+(?:lounge|pass)|vip\s+lounge)\b/.test(t) ||
    /\b(?:mit\s+loungeZugang|lounge\s+zugang|flughafenlounge|vip\s+lounge)\b/.test(t) ||
    /\b(?:con\s+acceso\s+(?:al?\s+)?sal[oó]n|sal[oó]n\s+vip|lounge\s+incluida?)\b/.test(t) ||
    /\b(?:avec\s+acc[eè]s\s+(?:au\s+)?salon|salon\s+vip|lounge\s+inclus)\b/.test(t) ||
    /\b(?:con\s+accesso\s+(?:alla\s+)?lounge|lounge\s+vip|lounge\s+inclusa)\b/.test(t) ||
    /\b(?:met\s+lounge(?:[- ]toegang)?|vip\s+lounge\s+toegang)\b/.test(t)
  ) { r.require_lounge = true }

  return r
}

// ── Time-of-day preference extraction ─────────────────────────────────────────
interface TimePrefs {
  depart_time_pref?: ParsedQuery['depart_time_pref']
  arrive_time_pref?: ParsedQuery['arrive_time_pref']
}

function extractTimePrefs(text: string): TimePrefs {
  const t = stripAccents(text.toLowerCase())
  const r: TimePrefs = {}

  // ── Arrival preferences ────────────────────────────────────────────────────
  const arrMorning =
    /\b(?:arrive\s+(?:in\s+the\s+)?morning|morning\s+arrival|land(?:ing)?\s+(?:in\s+the\s+)?morning|get\s+there\s+(?:in\s+the\s+)?morning|arrive\s+early(?:\s+morning)?)\b/.test(t) ||             // EN
    /\b(?:morgens?\s+ankommen|morgens?\s+landen|ankunft\s+(?:am\s+morgen|morgens?)|fr[üu]h\s+ankommen)\b/.test(t) ||                                                                                  // DE
    /\b(?:llegar\s+(?:por\s+la\s+)?mañana|llegada\s+(?:por\s+la\s+)?mañana|aterrizar\s+(?:por\s+la\s+)?mañana)\b/.test(t) ||                                                                        // ES
    /\b(?:arriver\s+(?:le\s+|en\s+)?matin|arriv[eé]e\s+(?:le\s+|en\s+)?matin|atterrir\s+(?:le\s+|en\s+)?matin)\b/.test(t) ||                                                                       // FR
    /\b(?:arrivare\s+(?:di\s+)?mattina|arrivo\s+(?:di\s+)?mattina|atterrare\s+(?:di\s+)?mattina)\b/.test(t) ||                                                                                       // IT
    /\b(?:['s]\s*ochtends?\s+aankomen|ochtend(?:aankomst|landing)?|aankomen\s+['s]\s*ochtends?)\b/.test(t)                                                                                           // NL
  if (arrMorning) r.arrive_time_pref = 'morning'

  const arrAfternoon =
    /\b(?:arrive\s+(?:in\s+the\s+)?afternoon|afternoon\s+arrival|land(?:ing)?\s+(?:in\s+the\s+)?afternoon)\b/.test(t) ||                                                                             // EN
    /\b(?:nachmittags?\s+ankommen|ankunft\s+(?:am\s+nachmittag|nachmittags?))\b/.test(t) ||                                                                                                          // DE
    /\b(?:llegar\s+(?:por\s+la\s+)?tarde|llegada\s+(?:por\s+la\s+)?tarde)\b/.test(t) ||                                                                                                              // ES
    /\b(?:arriver\s+(?:l['']|en\s+)?apr[eè]s[-\s]midi|arriv[eé]e\s+(?:l['']|en\s+)?apr[eè]s[-\s]midi)\b/.test(t)                                                                                   // FR
  if (!r.arrive_time_pref && arrAfternoon) r.arrive_time_pref = 'afternoon'

  const arrEvening =
    /\b(?:arrive\s+(?:in\s+the\s+)?evening|evening\s+arrival|land(?:ing)?\s+(?:in\s+the\s+)?evening)\b/.test(t) ||                                                                                   // EN
    /\b(?:abends?\s+ankommen|ankunft\s+(?:am\s+abend|abends?|abendlich))\b/.test(t) ||                                                                                                               // DE
    /\b(?:llegar\s+(?:por\s+la\s+)?(?:tarde|noche)|llegada\s+(?:nocturna|tarde))\b/.test(t) ||                                                                                                       // ES
    /\b(?:arriver\s+(?:le\s+)?soir|arriv[eé]e\s+(?:le\s+)?soir|arriver\s+(?:la\s+)?nuit)\b/.test(t) ||                                                                                              // FR
    /\b(?:arrivare\s+(?:di\s+)?sera|arrivo\s+(?:di\s+)?sera)\b/.test(t)                                                                                                                              // IT
  if (!r.arrive_time_pref && arrEvening) r.arrive_time_pref = 'evening'

  // ── Departure preferences ──────────────────────────────────────────────────
  const isRedEye =
    /\b(?:red[- ]?eye|overnight\s+(?:flight|service)|night\s+flight|fly(?:ing)?\s+(?:overnight|through\s+the\s+night)|night\s+departure|late[- ]night\s+flight)\b/.test(t) ||                        // EN
    /\b(?:nachtflug|[üu]ber\s+nacht\s+fliegen|nachts\s+fliegen|sp[äa]tnacht\s+flug)\b/.test(t) ||                                                                                                   // DE
    /\b(?:vuelo\s+(?:nocturno|de\s+noche|de\s+madrugada)|volar\s+de\s+noche|vuelo\s+overnight)\b/.test(t) ||                                                                                         // ES
    /\b(?:vol\s+(?:de\s+nuit|nocturne)|voler\s+de\s+nuit|vol\s+overnight)\b/.test(t) ||                                                                                                              // FR
    /\b(?:volo\s+(?:notturno|di\s+notte)|volare\s+di\s+notte)\b/.test(t) ||                                                                                                                          // IT
    /\b(?:nachtvlucht|['s]\s*nachts?\s+vliegen|nacht\s+vlucht)\b/.test(t) ||                                                                                                                         // NL
    /\b(?:nocny\s+lot|lecieć\s+w\s+nocy|lot\s+nocny)\b/.test(t) ||                                                                                                                                   // PL
    /\b(?:voo\s+noturno|voar\s+à\s+noite|voo\s+da\s+noite)\b/.test(t) ||                                                                                                                             // PT
    /\b(?:natflyg|flyga\s+(?:på\s+natten|overnight)|nattflyg)\b/.test(t) ||                                                                                                                          // SV
    /\b(?:no[čc]ni\s+let|letjeti\s+no[čc]u|noćni\s+let)\b/.test(t)                                                                                                                                  // HR
  if (isRedEye) { r.depart_time_pref = 'red_eye'; return r }

  const isEarlyMorning =
    /\b(?:very\s+early|early\s+morning\s+(?:flight|departure)|before\s+[67]\s*am|first\s+flight\s+(?:out|of\s+the\s+day)|crack\s+of\s+dawn|first\s+thing|early\s+as\s+possible)\b/.test(t) ||       // EN
    /\b(?:sehr\s+früh|fr[üu]hester\s+flug|fr[üu]h\s+morgens?|fr[üu]hmorgens?|erste[rn]?\s+flug\s+(?:des\s+tages|früh)|so\s+fr[üu]h\s+wie\s+möglich)\b/.test(t) ||                                // DE
    /\b(?:muy\s+temprano|vuelo\s+muy\s+(?:temprano|matutino)|primer\s+vuelo|lo\s+m[aá]s\s+temprano\s+posible)\b/.test(t) ||                                                                          // ES
    /\b(?:très\s+(?:tôt|tot)|(?:premier|le\s+premier)\s+vol\s+(?:du\s+jour|possible)|le\s+plus\s+tôt\s+possible)\b/.test(t) ||                                                                      // FR
    /\b(?:molto\s+presto|primo\s+volo|il\s+prima\s+possibile|all'alba)\b/.test(t)                                                                                                                    // IT
  if (!r.depart_time_pref && isEarlyMorning) { r.depart_time_pref = 'early_morning'; return r }

  const isMorning =
    /\b(?:morning\s+(?:flight|departure|dep)|depart(?:ing|ure)?\s+(?:in\s+the\s+)?morning|leaving?\s+(?:in\s+the\s+)?morning|fly(?:ing)?\s+(?:in\s+the\s+)?morning|morning\s+dep)\b/.test(t) ||     // EN
    /\b(?:morgenflug|morgens?\s+(?:abfliegen|fliegen|starten)|abflug\s+(?:am\s+morgen|morgens?))\b/.test(t) ||                                                                                       // DE
    /\b(?:vuelo\s+(?:de\s+mañana|matutino|por\s+la\s+mañana)|salir\s+(?:por\s+la\s+)?mañana|vuelo\s+mañana)\b/.test(t) ||                                                                           // ES
    /\b(?:vol\s+du\s+matin|partir\s+(?:le\s+)?matin|d[eé]coller\s+(?:le\s+)?matin|d[eé]part\s+(?:le\s+)?matin)\b/.test(t) ||                                                                       // FR
    /\b(?:volo\s+(?:del\s+)?mattino|partire\s+(?:di\s+)?mattina|decollo\s+(?:di\s+)?mattina)\b/.test(t) ||                                                                                          // IT
    /\b(?:ochtendvlucht|['s]\s*ochtends?\s+(?:vliegen|vertrekken)|vertrek\s+['s]\s*ochtends?)\b/.test(t) ||                                                                                          // NL
    /\b(?:poranny\s+lot|rano\s+lecieć|lot\s+rano|rano\s+wylot)\b/.test(t) ||                                                                                                                         // PL
    /\b(?:voo\s+(?:da\s+manhã|matinal)|partir\s+(?:de\s+)?manhã|decolagem\s+de\s+manhã)\b/.test(t) ||                                                                                                // PT
    /\b(?:morgonflyg|flyga\s+(?:p[åa]\s+morgonen|på\s+fm)|avresa\s+p[åa]\s+morgonen)\b/.test(t) ||                                                                                                   // SV
    /\b(?:jutarnji\s+let|ujutro\s+letjeti|jutarnji\s+polazak)\b/.test(t) ||                                                                                                                             // HR
    /朝の便|午前便|朝一便/.test(text) ||                                                                                                                                   // JA
    /\b(?:утренний\s+рейс|вылететь\s+утром|утро\s+вылететь)\b/.test(text) ||                                          // RU
    /아침\s*(?:항공편|출발|비행)/.test(text)                                                                                                                    // KO
  if (!r.depart_time_pref && isMorning) { r.depart_time_pref = 'morning'; return r }

  const isAfternoon =
    /\b(?:afternoon\s+(?:flight|departure)|depart(?:ing|ure)?\s+(?:in\s+the\s+)?afternoon|leaving?\s+(?:in\s+the\s+)?afternoon|fly(?:ing)?\s+(?:in\s+the\s+)?afternoon)\b/.test(t) ||              // EN
    /\b(?:nachmittagsflug|nachmittags?\s+(?:fliegen|abfliegen)|abflug\s+(?:am\s+nachmittag|nachmittags?))\b/.test(t) ||                                                                              // DE
    /\b(?:vuelo\s+(?:de\s+tarde|por\s+la\s+tarde)|salir\s+(?:por\s+la\s+)?tarde)\b/.test(t) ||                                                                                                       // ES
    /\b(?:vol\s+(?:de\s+l[''])?apr[eè]s[-\s]midi|partir\s+(?:l['']|en\s+)?apr[eè]s[-\s]midi)\b/.test(t) ||                                                                                          // FR
    /\b(?:volo\s+(?:del\s+)?pomeriggio|partire\s+(?:di\s+)?pomeriggio)\b/.test(t) ||                                                                                                                 // IT
    /\b(?:middagvlucht|['s]\s*middags?\s+(?:vliegen|vertrekken))\b/.test(t)                                                                                                                          // NL
  if (!r.depart_time_pref && isAfternoon) { r.depart_time_pref = 'afternoon'; return r }

  const isEvening =
    /\b(?:evening\s+(?:flight|departure)|depart(?:ing|ure)?\s+(?:in\s+the\s+)?evening|leaving?\s+(?:in\s+the\s+)?evening|fly(?:ing)?\s+(?:in\s+the\s+)?evening|night\s+departure)\b/.test(t) ||   // EN
    /\b(?:abendflug|abends?\s+(?:fliegen|abfliegen)|abflug\s+(?:am\s+abend|abends?))\b/.test(t) ||                                                                                                   // DE
    /\b(?:vuelo\s+(?:de\s+(?:tarde|noche)|vespertino|nocturno)|salir\s+(?:por\s+la\s+)?(?:tarde|noche))\b/.test(t) ||                                                                               // ES
    /\b(?:vol\s+(?:du\s+soir|de\s+nuit)|partir\s+(?:le\s+)?soir)\b/.test(t) ||                                                                                                                       // FR
    /\b(?:volo\s+(?:serale|di\s+sera|notturno)|partire\s+(?:di\s+)?sera)\b/.test(t) ||                                                                                                               // IT
    /\b(?:avondvlucht|[''s]\s*avonds?\s+(?:vliegen|vertrekken))\b/.test(t) ||                                                                                                       // NL
    /\b(?:wieczorem|wieczorny\s+lot|wylot\s+wieczorem|lot\s+wieczorny|wyjazd\s+wieczorem)\b/.test(t) ||                                                                                  // PL
    /夕方の便|夜の便|夜便|午後便/.test(text) ||                                                                                                                                     // JA
    /\b(?:вечерний\s+рейс|ночной\s+рейс|вылететь\s+вечером)\b/.test(text) ||                                           // RU
    /저녁\s*(?:항공편|출발)|밤\s*항공편/.test(text)                                                                                                   // KO
  if (!r.depart_time_pref && isEvening) { r.depart_time_pref = 'evening'; return r }

  // Specific time clues: "after 2pm", "before noon" — EN + DE/ES/FR
  if (!r.depart_time_pref) {
    const afterM = t.match(/\b(?:departing?|leaving?|flying?|ab(?:flug)?(?:\s+um)?)\s+after\s+(\d{1,2})(?::?\d{0,2})?\s*(am|pm|uhr)?\b/) ??
                   t.match(/\bnach\s+(\d{1,2})\s*(?:uhr|h)\b/)
    if (afterM) {
      const h = parseInt(afterM[1]) + (afterM[2] === 'pm' && parseInt(afterM[1]) < 12 ? 12 : 0)
      if (h >= 18) r.depart_time_pref = 'evening'
      else if (h >= 12) r.depart_time_pref = 'afternoon'
      else r.depart_time_pref = 'morning'
    }
    const beforeM = t.match(/\b(?:departing?|leaving?|flying?)\s+before\s+(\d{1,2})(?::?\d{0,2})?\s*(am|pm)?\b/) ??
                    t.match(/\bvor\s+(\d{1,2})\s*(?:uhr|h)\b/)
    if (beforeM) {
      const h = parseInt(beforeM[1]) + (beforeM[2] === 'pm' && parseInt(beforeM[1]) < 12 ? 12 : 0)
      if (h <= 9) r.depart_time_pref = 'early_morning'
      else if (h <= 14) r.depart_time_pref = 'morning'
      else r.depart_time_pref = 'afternoon'
    }
  }

  return r
}

// ── Max arrival time extraction ───────────────────────────────────────────────
// Parses phrases like "need to land by 3pm", "have to be back in the office at 3",
// "must arrive before 15:00", "back at work by 2pm", "need to be there by 5"
function extractMaxArrivalTime(text: string): string | undefined {
  const t = stripAccents(text.toLowerCase())
  // Capture group 1 = hour, 2 = minute (optional), 3 = am/pm (optional)
  const timeCapture = '(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?'
  const contexts = [
    // "need to land / arrive / touch down by/before/at X"
    /\b(?:need\s+to\s+|must\s+|have\s+to\s+|got\s+to\s+)?(?:land|arrive|touch\s+down)\s+(?:by|before|at)\s+/i,
    // "need to be back / home / there by/at X"
    /\b(?:need\s+to\s+be|must\s+be|have\s+to\s+be|got\s+to\s+be|need\s+to\s+get)\s+(?:back|home|there)\b[^.!?]{0,30}?\b(?:by|at|before)\s+/i,
    // "back in the office / at work / at home by/at X"
    /\bback\s+(?:in\s+(?:the\s+)?|at\s+(?:the\s+)?)?(?:office|work|hotel|home)\s+(?:by|at)\s+/i,
    // "in the office / at work by/at X"
    /\b(?:in\s+(?:the\s+)?(?:office|work)|at\s+(?:the\s+)?(?:office|work))\s+(?:by|at)\s+/i,
    // "be at my desk / in a meeting by X"
    /\b(?:have\s+to\s+be|need\s+to\s+be|must\s+be)\s+(?:at\s+(?:my\s+)?(?:desk|office|work)|in\s+(?:a\s+)?(?:meeting|the\s+office))\s+(?:by|at)\s+/i,
    // "get back to the office / work by X"
    /\bget\s+(?:back\s+)?to\s+(?:the\s+)?(?:office|work)\s+(?:by|at)\s+/i,
    // "home by X" (short form)
    /\bhome\s+(?:by|at)\s+/i,
  ]

  for (const ctxRe of contexts) {
    const combined = new RegExp(ctxRe.source + timeCapture, 'i')
    const m = t.match(combined)
    if (!m) continue
    // Last 3 capture groups are hour, minute, meridiem
    const groups = m.slice(1) // m[1..n]
    // Find numeric hour — it's the first digit group after the context
    let hStr: string | undefined, mStr: string | undefined, mer: string | undefined
    // groups may have spurious captures from context alternations; scan backwards for time
    for (let i = groups.length - 1; i >= 0; i--) {
      if (/^(am|pm)$/i.test(groups[i] ?? '')) { mer = groups[i]; continue }
      if (/^\d{2}$/.test(groups[i] ?? '') && !hStr) { mStr = groups[i]; continue }
      if (/^\d{1,2}$/.test(groups[i] ?? '') && !hStr) { hStr = groups[i]; break }
    }
    if (!hStr) {
      // Simpler: just match the trailing time part directly
      const timeM = (m[0] + ' ').match(new RegExp(timeCapture + '\\s', 'i'))
      if (timeM) { hStr = timeM[1]; mStr = timeM[2]; mer = timeM[3] }
    }
    if (!hStr) continue
    let hour = parseInt(hStr)
    const minute = parseInt(mStr ?? '0')
    if (isNaN(hour) || hour < 0 || hour > 23) continue
    const merLc = (mer ?? '').toLowerCase()
    if (merLc === 'pm' && hour < 12) hour += 12
    if (merLc === 'am' && hour === 12) hour = 0
    // Heuristic: no meridiem + hour 1–11 → assume PM (office context)
    if (!merLc && hour >= 1 && hour <= 11) hour += 12
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }
  return undefined
}

// ── Trip purpose / occasion extraction ────────────────────────────────────────
function extractTripPurpose(text: string): ParsedQuery['trip_purpose'] {
  const t = stripAccents(text.toLowerCase())

  // ── Honeymoon / romantic ────────────────────────────────────────────────────
  if (
    /\b(?:honeymoon|romantic\s+(?:trip|getaway|holiday|escape|flight|vacation)|anniversary\s+(?:trip|holiday|vacation))\b/.test(t) ||
    /\b(?:flitterwochen|hochzeitsreise|romantische\s+(?:reise|trip|urlaub))\b/.test(t) ||         // DE
    /\b(?:luna\s+de\s+miel|viaje\s+(?:rom[aá]ntico|de\s+novios))\b/.test(t) ||                    // ES
    /\b(?:lune\s+de\s+miel|voyage\s+(?:romantique|de\s+noces))\b/.test(t) ||                       // FR
    /\b(?:luna\s+di\s+miele|viaggio\s+(?:romantico|di\s+nozze))\b/.test(t) ||                      // IT
    /\b(?:huwelijksreis|wittebroodsweken|romantische\s+reis)\b/.test(t) ||                          // NL
    /\b(?:miodowy\s+miesi[ąa]c|podr[oó][zż]\s+po[śs]lubna)\b/.test(t) ||                          // PL
    /\b(?:lua\s+de\s+mel|viagem\s+(?:rom[aâ]ntica|de\s+n[uú]pcias))\b/.test(t) ||                 // PT
    /\b(?:smekmånad|bröllopsresa|romantisk\s+resa)\b/.test(t) ||                                   // SV
    /\b(?:medeni\s+mjesec|romantično\s+putovanje|bračno\s+putovanje)\b/.test(t) ||                 // HR
    /\b(?:muaja\s+e\s+mjaltit|udh[eë]tim\s+romantik)\b/.test(t)                                    // SQ
  ) return 'honeymoon'

  // ── Business / work ─────────────────────────────────────────────────────────
  if (
    /\b(?:(?:for\s+(?:a\s+)?)?business\s+(?:trip|travel|meeting|conference|summit|event|flight)|work\s+trip|for\s+work|corporate\s+travel|client\s+meeting|on\s+business)\b/.test(t) ||
    /\b(?:gesch[äa]ftsreise|dienstreise|gesch[äa]ftlich|konferenzreise|dienst(?:reise|lich))\b/.test(t) ||   // DE
    /\b(?:viaje\s+de\s+negocios|por\s+(?:trabajo|negocios)|congreso\s+(?:profesional)?)\b/.test(t) ||         // ES
    /\b(?:voyage\s+d['']affaires|d[eé]placement\s+professionnel|conf[eé]rence\s+professionnelle)\b/.test(t) || // FR
    /\b(?:viaggio\s+d['']affari|per\s+(?:lavoro|affari)|trasferta\s+(?:di\s+lavoro)?)\b/.test(t) ||           // IT
    /\b(?:zakenreis|zakelijk|voor\s+(?:het\s+)?werk|zakenvlucht)\b/.test(t) ||                                 // NL
    /\b(?:podr[oó][zż]\s+s[lł]u[zż]bowa|w\s+celach?\s+s[lł]u[zż]bowych|delegacja)\b/.test(t) ||             // PL
    /\b(?:viagem\s+de\s+neg[oó]cios|a\s+(?:trabalho|neg[oó]cios)|corporativo)\b/.test(t) ||                   // PT
    /\b(?:aff[äa]rsresa|tj[äa]nsteresa|f[oö]r\s+jobbet)\b/.test(t) ||                                         // SV
    /\b(?:poslovno\s+putovanje|slu[žz]beno\s+putovanje|zbog\s+posla)\b/.test(t) ||                             // HR
    /\b(?:udh[eë]tim\s+(?:biznesi|pune)|p[eë]r\s+pun[eë])\b/.test(t)                                          // SQ
  ) return 'business'

  // ── Ski ─────────────────────────────────────────────────────────────────────
  if (
    /\b(?:ski(?:ing)?\s+(?:trip|holiday|vacation|break|resort)|to\s+(?:go\s+)?ski(?:ing)?|snowboarding?\s+(?:trip|holiday)|ski\s+season|ski\s+slopes|on\s+the\s+piste)\b/.test(t) ||
    /\b(?:skiurlaub|skifahren|skigebiet|schireise|schnee(?:urlaub|reise)?|wintersport(?:urlaub)?)\b/.test(t) || // DE
    /\b(?:vacaciones\s+de\s+esqu[ií]|esqu[ií](?:ar)?|estaci[oó]n\s+de\s+esqu[ií]|nieve\s+(?:trip|viaje))\b/.test(t) || // ES
    /\b(?:vacances\s+(?:au\s+ski|à\s+la\s+montagne|de\s+ski)|ski(?:er)?|station\s+de\s+ski)\b/.test(t) ||     // FR
    /\b(?:vacanze\s+sulla\s+neve|sciare|impianto\s+sciistico|ski(?:\s+(?:trip|holiday))?)\b/.test(t) ||         // IT
    /\b(?:skivakantie|skiën|skigebied|wintersport)\b/.test(t) ||                                                // NL
    /\b(?:wyjazd\s+narciarski|narty|na\s+narty|narciarstwo)\b/.test(t) ||                                       // PL
    /\b(?:f[eé]rias\s+de\s+esqu[ií]|esquiar|estância\s+de\s+esqui)\b/.test(t) ||                              // PT
    /\b(?:skidsemester|åka\s+skidor|ski(?:resa)?)\b/.test(t) ||                                                 // SV
    /\b(?:skijanje|zimovanje|ski\s+(?:odmoralište|putovanje)|na\s+skijanje)\b/.test(t) ||                       // HR
    /\b(?:pushime\s+ski|ski(?:m)?|borë\s+(?:pushime|udh[eë]tim))\b/.test(t)                                    // SQ
  ) return 'ski'

  // ── Beach / sun ─────────────────────────────────────────────────────────────
  if (
    /\b(?:beach\s+(?:trip|holiday|vacation|getaway|break)|sun\s+(?:holiday|vacation|trip|break)|to\s+the\s+beach|beach\s+destination|sun(?:bathing|shine)?\s+(?:trip|holiday)|all\s+inclusive|pool\s+holiday)\b/.test(t) ||
    /\b(?:strandurlaub|badeurlaub|am\s+strand|sonnenurlaub|strand(?:reise|urlaub)?|mittelmeerurlaub)\b/.test(t) || // DE
    /\b(?:vacaciones\s+en\s+(?:la\s+)?playa|a\s+la\s+playa|viaje\s+(?:de\s+sol\s+y\s+playa|a\s+la\s+playa|de\s+playa)|turismo\s+de\s+sol)\b/.test(t) || // ES
    /\b(?:vacances\s+(?:à\s+la\s+plage|bain[eé]es?|au\s+soleil)|balnéaire|mer\s+(?:et\s+soleil)?)\b/.test(t) || // FR
    /\b(?:vacanze\s+al\s+mare|in\s+spiaggia|al\s+sole|mare\s+(?:e\s+sole)?|villeggiatura\s+balneare)\b/.test(t) || // IT
    /\b(?:strandvakantie|zon(?:vakantie|neholiday)?|aan\s+het\s+strand|mediterraan\s+vakantie)\b/.test(t) ||     // NL
    /\b(?:wyjazd\s+(?:nad\s+morze|plażowy|słoneczny)|nad\s+morze)\b/.test(t) ||                                 // PL
    /\b(?:f[eé]rias\s+na\s+praia|praia|sol\s+e\s+praia|destino\s+de\s+praia)\b/.test(t) ||                     // PT
    /\b(?:strandsemester|sol(?:resa)?|till\s+stranden|semester\s+vid\s+havet)\b/.test(t) ||                     // SV
    /\b(?:odmor\s+(?:na\s+plaži|uz\s+more|na\s+moru)|ljetovanje|uz\s+more)\b/.test(t) ||                       // HR
    /\b(?:pushime\s+(?:plazhi|deti|diellit)|plazh(?:i)?)\b/.test(t)                                            // SQ
  ) return 'beach'

  // ── City break / short trip ───────────────────────────────────────────────
  if (
    /\b(?:city\s+break|weekend\s+(?:break|trip|getaway|away)|short\s+(?:break|trip|hop)|long\s+weekend\s+(?:trip|away)|quick\s+(?:trip|getaway|visit|break)|sightseeing\s+trip|cultural\s+(?:trip|tour)|mini\s+(?:break|vacation|trip))\b/.test(t) ||
    /\b(?:st[äa]dtereise|kurztrip|kurzreise|wochenendreise|mini(?:urlaub|trip)|besichtigung\s+trip)\b/.test(t) || // DE
    /\b(?:escapada|(?:viaje\s+de\s+)?fin\s+de\s+semana|visita\s+(?:a\s+la\s+)?ciudad|turismo\s+urbano)\b/.test(t) || // ES
    /\b(?:escapade\s+(?:urbaine|en\s+ville)?|city\s+break|week-end\s+(?:à|en)|visite\s+de\s+la\s+ville)\b/.test(t) || // FR
    /\b(?:city\s+break|weekend\s+(?:breve|fuori\s+porta)|gita\s+(?:in\s+città|breve)|turismo\s+urbano)\b/.test(t) || // IT
    /\b(?:stedentrip|city\s+trip|weekendje?\s+(?:weg|op\s+pad)|kort\s+uitstapje)\b/.test(t) ||                 // NL
    /\b(?:city\s+break|wypad\s+(?:do\s+miasta|weekendowy)|weekendowy?\s+wyjazd)\b/.test(t) ||                  // PL
    /\b(?:escapada|fim\s+de\s+semana\s+(?:fora|na\s+cidade)|visita\s+(?:à\s+)?cidade)\b/.test(t) ||           // PT
    /\b(?:stadsresa|weekendresa|city\s+break|kort\s+resa)\b/.test(t) ||                                        // SV
    /\b(?:gradski\s+(?:odmor|izlet)|kratki\s+(?:odmor|izlet)|vikend\s+putovanje)\b/.test(t) ||                 // HR
    /\b(?:udh[eë]tim\s+(?:qyteti|i\s+shkurt)|fundjavë\s+(?:udhëtim|jashtë))\b/.test(t)                       // SQ
  ) return 'city_break'

  // ── Family holiday ────────────────────────────────────────────────────────
  if (
    /\b(?:family\s+(?:trip|holiday|vacation|break|getaway|time)|with\s+(?:the\s+)?(?:kids?|children|family)|taking\s+(?:the\s+)?(?:kids?|children)|travelling\s+with\s+(?:kids?|children|family))\b/.test(t) ||
    /\b(?:familienurlaub|familienreise|mit\s+(?:den\s+)?kindern?|mit\s+(?:der\s+)?familie)\b/.test(t) ||      // DE
    /\b(?:vacaciones\s+(?:familiares|en\s+familia)|viaje\s+familiar|con\s+(?:los\s+)?ni[ñn]os?)\b/.test(t) || // ES
    /\b(?:vacances\s+en\s+famille|voyage\s+familial|avec\s+(?:les\s+)?enfants?)\b/.test(t) ||                  // FR
    /\b(?:vacanza\s+(?:in\s+famiglia|familiare)|vacanza\s+con\s+bambini)\b/.test(t) ||                          // IT
    /\b(?:gezinsvakantie|gezinsreis|met\s+(?:de\s+)?kinderen)\b/.test(t) ||                                    // NL
    /\b(?:wakacje\s+rodzinne|wyjazd\s+rodzinny|z\s+(?:dzie[cć]mi|rodzin[ąa]))\b/.test(t) ||                  // PL
    /\b(?:f[eé]rias\s+(?:em\s+família|familiares)|viagem\s+(?:familiar|em\s+família))\b/.test(t) ||           // PT
    /\b(?:familjesemester|familjeresa|med\s+(?:barnen?|familjen))\b/.test(t) ||                                // SV
    /\b(?:obiteljski\s+odmor|obiteljsko\s+putovanje|s\s+(?:djecom|obitelju))\b/.test(t) ||                    // HR
    /\b(?:pushime\s+familjare|udh[eë]tim\s+familjar|me\s+f[eë]mij[eë])\b/.test(t)                            // SQ
  ) return 'family_holiday'

  // ── Graduation / education milestone ─────────────────────────────────────
  if (
    /\b(?:graduation\s+(?:trip|gift|present|holiday|celebration)|after\s+(?:graduation|finishing\s+(?:uni|university|college|school))|end\s+of\s+(?:uni|university|college|exams)|gap\s+year|erasmus|study\s+abroad|language\s+(?:course|school))\b/.test(t) ||
    /\b(?:abschlussreise|abiturreise|nach\s+dem\s+(?:abschluss|abitur|studium))\b/.test(t) ||
    /\b(?:viaje\s+de\s+graduaci[oó]n|erasmus|año\s+sabático|intercambio\s+estudiantil)\b/.test(t) ||
    /\b(?:voyage\s+de\s+fin\s+d['']études|erasmus|année\s+sabbatique)\b/.test(t) ||
    /\b(?:viaggio\s+di\s+laurea|erasmus|anno\s+sabbatico)\b/.test(t)
  ) return 'graduation'

  // ── Concert / festival ────────────────────────────────────────────────────
  if (
    /\b(?:for\s+(?:a\s+)?(?:concert|festival|gig|music\s+festival|show|event)|concert\s+(?:trip|travel)|festival\s+(?:trip|travel)|to\s+(?:see|watch)\s+.{0,30}(?:concert|festival|perform))\b/.test(t) ||
    /\b(?:konzertreise|festival(?:reise)?|zur\s+(?:konzert|veranstaltung))\b/.test(t) ||
    /\b(?:viaje\s+(?:al?\s+)?(?:concierto|festival)|para\s+(?:ver\s+(?:un|al?))\s+(?:concierto|festival))\b/.test(t)
  ) return 'concert_festival'

  // ── Sports event ──────────────────────────────────────────────────────────
  if (
    /\b(?:for\s+(?:the\s+)?(?:match|game|tournament|world\s+cup|olympics?|euro\s+(?:\d{4})?|championship)|sports?\s+(?:trip|event|travel)|to\s+(?:see|watch)\s+.{0,30}(?:play|match|game))\b/.test(t) ||
    /\b(?:sportreise|sportevent|zum\s+(?:spiel|turnier|finale))\b/.test(t) ||
    /\b(?:viaje\s+deportivo|para\s+(?:ver\s+)?(?:el\s+)?(?:partido|torneo|mundial))\b/.test(t)
  ) return 'sports_event'

  // ── Spring break ──────────────────────────────────────────────────────────
  if (/\b(?:spring\s+break|spring\s+break\s+trip|frühlingspause|vacaciones\s+de\s+primavera|vacances\s+de\s+printemps)\b/.test(t)) return 'spring_break'

  return undefined
}

// ── Seat preference extraction ─────────────────────────────────────────────────
function extractSeatPref(text: string): ParsedQuery['seat_pref'] {
  const t = stripAccents(text.toLowerCase())

  // Extra legroom — all languages
  if (
    /\b(?:extra\s+leg(?:s?\s+)?room|exit\s+row|bulkhead\s+seat|more\s+legroom|leg\s+room|extra\s+space)\b/.test(t) ||
    /\b(?:mehr\s+beinfreiheit|sitzplatz\s+mit\s+mehr\s+platz|notsitzreihe|extralegroom)\b/.test(t) ||      // DE
    /\b(?:m[aá]s\s+espacio\s+para\s+las\s+piernas|asiento\s+con\s+m[aá]s\s+espacio|fila\s+de\s+emergencia)\b/.test(t) || // ES
    /\b(?:plus\s+d['']espace\s+pour\s+les\s+jambes|si[eè]ge\s+avec\s+plus\s+d['']espace|rang[eé]e\s+de\s+sortie)\b/.test(t) || // FR
    /\b(?:pi[uù]\s+spazio\s+per\s+le\s+gambe|sedile\s+con\s+pi[uù]\s+spazio|fila\s+di\s+emergenza)\b/.test(t) || // IT
    /\b(?:meer\s+beenruimte|stoel\s+met\s+meer\s+ruimte|nooduitgang\s+rij)\b/.test(t) ||                   // NL
    /\b(?:wi[eę]cej\s+miejsca\s+na\s+nogi|siedzenie\s+z\s+wi[eę]kszym\s+miejscem|rz[aą]d\s+awaryjny)\b/.test(t) || // PL
    /\b(?:mais\s+espa[çc]o\s+para\s+as\s+pernas|assento\s+com\s+mais\s+espa[çc]o|fila\s+de\s+emerg[eê]ncia)\b/.test(t) // PT
  ) return 'extra_legroom'

  // Window seat — all languages
  if (
    /\b(?:window\s+seat|(?:sitting?|seat)\s+by\s+(?:the\s+)?window|window\s+side)\b/.test(t) ||
    /\b(?:fensterplatz|sitzplatz\s+am\s+fenster|am\s+fenster\s+sitzen)\b/.test(t) ||                       // DE
    /\b(?:asiento\s+(?:de\s+)?ventana|(?:asiento\s+)?al\s+lado\s+de\s+la\s+ventana|ventanilla)\b/.test(t) || // ES
    /\b(?:si[eè]ge\s+(?:c[oô]t[eé]\s+)?fen[eê]tre|place\s+(?:c[oô]t[eé]\s+)?fen[eê]tre|côt[eé]\s+fen[eê]tre)\b/.test(t) || // FR
    /\b(?:posto\s+(?:al\s+)?finestrino|sedile\s+(?:al\s+)?finestrino|lato\s+finestrino)\b/.test(t) ||     // IT
    /\b(?:raamstoel|stoel\s+(?:bij\s+(?:het\s+)?raam|aan\s+(?:het\s+)?raam)|raamkant)\b/.test(t) ||       // NL
    /\b(?:miejsce\s+przy\s+oknie|siedzenie\s+przy\s+oknie)\b/.test(t) ||                                   // PL
    /\b(?:assento\s+(?:da\s+)?janela|lugar\s+(?:na\s+)?janela)\b/.test(t)                                  // PT
  ) return 'window'

  // Aisle seat — all languages
  if (
    /\b(?:aisle\s+seat|(?:sitting?|seat)\s+(?:on\s+|by\s+)?(?:the\s+)?aisle|aisle\s+side)\b/.test(t) ||
    /\b(?:gangplatz|sitzplatz\s+am\s+gang|am\s+gang\s+sitzen)\b/.test(t) ||                                // DE
    /\b(?:asiento\s+(?:de\s+)?pasillo|(?:asiento\s+)?en\s+(?:el\s+)?pasillo|pasillo)\b/.test(t) ||        // ES
    /\b(?:si[eè]ge\s+(?:c[oô]t[eé]\s+)?couloir|place\s+(?:c[oô]t[eé]\s+)?couloir|c[oô]t[eé]\s+couloir)\b/.test(t) || // FR
    /\b(?:posto\s+(?:al\s+)?corridoio|sedile\s+(?:al\s+)?corridoio|lato\s+corridoio)\b/.test(t) ||        // IT
    /\b(?:gangstoel|stoel\s+(?:bij\s+(?:het\s+)?gangpad|aan\s+(?:het\s+)?gangpad)|gangkant)\b/.test(t) || // NL
    /\b(?:miejsce\s+przy\s+przej[śs]ciu|siedzenie\s+przy\s+korytarzu)\b/.test(t) ||                       // PL
    /\b(?:assento\s+(?:do\s+)?corredor|lugar\s+(?:no\s+)?corredor)\b/.test(t)                              // PT
  ) return 'aisle'

  return undefined
}

// ── Airline preference / exclusion extraction ──────────────────────────────────
// Matches 60+ carriers in natural phrases: "on Ryanair", "with BA", "avoid easyJet"
const _AIRLINE_RE = /\b(?:ryanair|ryanair\s+uk|easyjet(?:\s+europe)?|wizz(?:\s+air)?(?:\s+(?:uk|abu\s+dhabi|ukraine))?|norwegian|vueling|transavia|british\s+airways?|lufthansa|air\s+france|klm|iberia|tap|alitalia|ita\s+airways?|swiss(?:\s+air(?:lines?)?)?|austrian(?:\s+airlines?)?|brussels\s+airlines?|turkish\s+airlines?|pegasus(?:\s+airlines?)?|sunexpress|jet2|tui(?:\s+fly)?|condor|corendon|flydubai|flynas|air\s+arabia|airasia(?:\s+x)?|airasiax|scoot|lion\s+air|batik\s+air|cebu\s+pacific|jetstar(?:\s+(?:asia|pacific))?|qantas|virgin\s+australia|air\s+new\s+zealand|westjet|air\s+canada|southwest|delta|united(?:\s+airlines?)?|american(?:\s+airlines?)?|jetblue|frontier(?:\s+airlines?)?|spirit(?:\s+airlines?)?|allegiant(?:\s+air)?|sun\s+country|air\s+transat|volaris|vivaaerobus|aerom[eé]xico|latam(?:\s+airlines?)?|gol|azul|copa(?:\s+airlines?)?|avianca|sky\s+airline|jetsmart|indigo|indigo\s+india|spicejet|air\s+india|vistara|go\s+first|emirates|etihad(?:\s+airways?)?|qatar\s+airways?|saudia|flyadeal|aeroflot|ukraine\s+international|air\s+serbia|air\s+cairo|air\s+europa|volotea|binter|lot(?:\s+polish\s+airlines?)?|tarom|loganair|flybe|eastern\s+airways?|ba\b|ua\b|aa\b|dl\b|fr\b|u2\b|w6\b|dy\b|vy\b)\b/i

function extractAirlinePreference(text: string): { preferred?: string; excluded?: string } {
  const t = text.toLowerCase()
  const r: { preferred?: string; excluded?: string } = {}

  // Preferred: "on Ryanair", "with BA", "fly with Emirates", "preferably British Airways"
  const prefM = t.match(new RegExp(
    `\\b(?:on|with|fly(?:ing)?\\s+with|travel(?:l?ing)?\\s+with|prefer(?:ably)?(?:\\s+(?:on|with))?|(?:book(?:ing)?|travel(?:l?ing)?)\\s+with)\\s+(${_AIRLINE_RE.source})`, 'i',
  ))
  if (prefM) r.preferred = prefM[1].trim().toLowerCase()

  // Excluded: "not Ryanair", "avoid easyJet", "no Ryanair flights", "not flying with easyJet"
  const exclM = t.match(new RegExp(
    `\\b(?:not(?:\\s+(?:on|with))?|avoid|no|not\\s+flying?(?:\\s+with)?|excluding?|without|skip(?:ping)?)\\s+(${_AIRLINE_RE.source})`, 'i',
  ))
  if (exclM) r.excluded = exclM[1].trim().toLowerCase()

  return r
}

// ── Urgency extraction ─────────────────────────────────────────────────────────
function extractUrgency(text: string): ParsedQuery['urgency'] {
  const t = stripAccents(text.toLowerCase())

  // ASAP — all languages
  if (
    /\b(?:asap|as\s+soon\s+as\s+possible|earliest\s+(?:possible\s+)?(?:flight|option)|first\s+(?:available|possible)\s+flight|right\s+away|immediately)\b/.test(t) ||
    /\b(?:so\s+schnell\s+wie\s+m[öo]glich|sofort|schnellstm[öo]glich|fr[üu]hester\s+(?:flug|termin))\b/.test(t) ||                   // DE
    /\b(?:lo\s+antes\s+posible|cuanto\s+antes|inmediatamente|urgente(?:mente)?)\b/.test(t) ||                                          // ES
    /\b(?:le\s+plus\s+t[oô]t\s+possible|d[eè]s\s+que\s+possible|imm[eé]diatement|urgemment)\b/.test(t) ||                            // FR
    /\b(?:il\s+prima\s+possibile|subito|immediatamente|urgentemente)\b/.test(t) ||                                                      // IT
    /\b(?:zo\s+snel\s+mogelijk|onmiddellijk|zo\s+vroeg\s+mogelijk|met\s+spoed)\b/.test(t) ||                                           // NL
    /\b(?:jak\s+najszybciej|natychmiast|niezw[lł]ocznie|pilnie)\b/.test(t) ||                                                          // PL
    /\b(?:o\s+mais\s+cedo\s+poss[ií]vel|imediatamente|urgentemente)\b/.test(t) ||                                                      // PT
    /\b(?:s[åa]\s+snart\s+som\s+m[öo]jligt|omedelbart|genast)\b/.test(t) ||                                                           // SV
    /\b(?:sto\s+prije\s+mogu[cć]e|odmah|hitno)\b/.test(t) ||                                                                          // HR
    /\b(?:sa\s+shpejt\s+sa\s+[eë]sht[eë]\s+e\s+mundur|menjëherë|urgjentisht)\b/.test(t)                                              // SQ
  ) return 'asap'

  // Last minute — all languages
  if (
    /\b(?:last[- ]?minute|tonight|today|right\s+now|this\s+(?:evening|afternoon|morning|weekend|week)|urgent(?:ly)?|tomorrow)\b/.test(t) ||
    /\b(?:kurzfristig|heute|morgen|sofort|dringend|last[- ]?minute|heute\s+(?:abend|nacht|noch)|morgen\s+früh)\b/.test(t) ||          // DE
    /\b(?:last\s+minute|hoy|ma[nñ]ana|esta\s+(?:noche|tarde|mañana|semana)|urgente|para\s+hoy)\b/.test(t) ||                         // ES
    /\b(?:last\s+minute|aujourd['']hui|demain|ce\s+soir|cet\s+apr[eè]s[-\s]midi|cette\s+(?:semaine|nuit)|urgent)\b/.test(t) ||        // FR
    /\b(?:last\s+minute|oggi|domani|stasera|questa\s+(?:sera|mattina|settimana)|urgente)\b/.test(t) ||                                 // IT
    /\b(?:last\s+minute|vandaag|morgen|vanavond|deze\s+(?:avond|week)|dringend|snel)\b/.test(t) ||                                    // NL
    /\b(?:last\s+minute|dzisiaj|jutro|tej\s+nocy|tego\s+wieczoru|w\s+tym\s+tygodniu|pilne)\b/.test(t) ||                              // PL
    /\b(?:last\s+minute|hoje|amanhã|esta\s+(?:noite|tarde|semana)|urgente|para\s+hoje)\b/.test(t) ||                                  // PT
    /\b(?:last\s+minute|idag|imorgon|ikv[äa]ll|den\s+h[äa]r\s+veckan|brådskande)\b/.test(t) ||                                       // SV
    /\b(?:last\s+minute|danas|sutra|ve[čc]eras|ovog\s+tjedna|hitno|u\s+zadnji\s+[čc]as)\b/.test(t) ||                               // HR
    /\b(?:last\s+minute|sot|nes[eë]r|kur\s+m[uë]\s+m[uë]ndohet|urg[eë]ntisht|pr\s+kët[eë]\s+jav[eë])\b/.test(t)                    // SQ
  ) return 'last_minute'

  return undefined
}

// ── Best-window detection ──────────────────────────────────────────────────────
// Explicit: "cheapest week in June", "best time in July", "find the best window in August"
// Implicit: date_month_only=true + min_trip_days set → triggered in parseNLQuery after date parsing
interface BestWindowResult {
  find_best_window: boolean
  date_window_month?: number
  date_window_year?: number
}

function extractExplicitBestWindow(text: string): BestWindowResult {
  const t = stripAccents(text.toLowerCase())
  const r: BestWindowResult = { find_best_window: false }

  // ── "cheapest week in June 2026", "best time to go in August" — EN ────────
  const m = t.match(/\b(?:cheapest|best|optimal|find(?:\s+the)?\s+(?:cheapest|best)|good\s+(?:time|window|week|dates?))\s+(?:(?:time|week|window|period|dates?)\s+)?(?:to\s+(?:go|fly|travel|visit)?\s*)?(?:in|during|for)\s+([a-z]{3,}(?:\s+[a-z]{3,})?)(?:\s+(\d{4}))?\b/i)
  if (m) {
    r.find_best_window = true
    const mIdx = _matchMonthByName(m[1].trim())
    if (mIdx !== null) r.date_window_month = mIdx + 1
    if (m[2]) r.date_window_year = parseInt(m[2])
  }

  // ── "when is it cheapest", "what's the cheapest time" — EN ───────────────
  if (/\b(?:when(?:\s+is\s+(?:it\s+)?)?(?:cheapest|best|cheapest\s+to\s+fly)|what(?:'s|\s+is)\s+the\s+(?:cheapest|best)\s+(?:week|time|day|date)|find\s+(?:the\s+)?(?:cheapest|best)\s+(?:dates?|week|time))\b/i.test(t)) {
    r.find_best_window = true
  }

  // ── DE: "günstigste Woche in Juni", "wann ist es am günstigsten" ──────────
  const deM = t.match(/\b(?:g[uü]nstigste[rn]?\s+(?:woche|zeitraum|flug|ticket)|beste[rn]?\s+(?:woche|zeitraum|preis))\s+(?:in|im|f[üu]r)\s+([a-zäöüß]{3,}(?:\s+[a-zäöüß]{3,})?)(?:\s+(\d{4}))?\b/)
  if (deM) {
    r.find_best_window = true
    const mIdx = _matchMonthByName(deM[1].trim())
    if (mIdx !== null) r.date_window_month = mIdx + 1
    if (deM[2]) r.date_window_year = parseInt(deM[2])
  }
  if (/\b(?:wann\s+ist\s+es\s+am\s+g[uü]nstigsten|wann\s+sind\s+fl[üu]ge\s+am\s+billigsten|wann\s+ist\s+der\s+beste\s+zeitpunkt)\b/.test(t)) {
    r.find_best_window = true
  }

  // ── ES: "semana más barata en julio", "cuándo es más barato" ─────────────
  const esM = t.match(/\b(?:semana\s+m[aá]s\s+barata?|mejor\s+(?:semana|momento|época|época)\s+(?:para\s+volar)?)\s+en\s+([a-záéíóúüñ]{3,}(?:\s+[a-záéíóúüñ]{3,})?)(?:\s+(?:de\s+)?(\d{4}))?\b/)
  if (esM) {
    r.find_best_window = true
    const mIdx = _matchMonthByName(esM[1].trim())
    if (mIdx !== null) r.date_window_month = mIdx + 1
  }
  if (/\b(?:cu[aá]ndo\s+es\s+m[aá]s\s+barato|cu[aá]ndo\s+es\s+(?:el\s+)?mejor\s+momento|cu[aá]ndo\s+est[aá]n\s+(?:los\s+)?vuelos\s+m[aá]s\s+baratos)\b/.test(t)) {
    r.find_best_window = true
  }

  // ── FR: "semaine la moins chère en juillet", "quand c'est le moins cher" ──
  const frM = t.match(/\b(?:semaine\s+(?:la\s+)?moins\s+ch[eè]re?|meilleure?\s+(?:semaine|p[eé]riode|moment))\s+en\s+([a-zàâéèêëîïôùûüç]{3,}(?:\s+[a-zàâéèêëîïôùûüç]{3,})?)(?:\s+(\d{4}))?\b/)
  if (frM) {
    r.find_best_window = true
    const mIdx = _matchMonthByName(frM[1].trim())
    if (mIdx !== null) r.date_window_month = mIdx + 1
  }
  if (/\b(?:quand\s+(?:c['']est|est[-\s]il)\s+(?:le\s+)?moins\s+cher|quand\s+sont\s+les\s+vols\s+(?:les\s+)?moins\s+chers?|quel(?:le)?\s+est\s+(?:la\s+)?meilleure\s+p[eé]riode)\b/.test(t)) {
    r.find_best_window = true
  }

  // ── IT: "settimana più economica in agosto" ───────────────────────────────
  const itM = t.match(/\b(?:settimana\s+pi[uù]\s+economica?|miglior(?:e)?\s+(?:settimana|periodo|momento))\s+(?:in|a|ad|di)\s+([a-záéíóúü]{3,}(?:\s+[a-záéíóúü]{3,})?)(?:\s+(\d{4}))?\b/)
  if (itM) {
    r.find_best_window = true
    const mIdx = _matchMonthByName(itM[1].trim())
    if (mIdx !== null) r.date_window_month = mIdx + 1
  }
  if (/\b(?:quando\s+[eè]\s+pi[uù]\s+economico|quando\s+conviene\s+(?:di\s+pi[uù]\s+)?volare|qual[eè]\s+(?:il\s+)?miglior\s+periodo)\b/.test(t)) {
    r.find_best_window = true
  }

  // ── NL: "goedkoopste week in september" ───────────────────────────────────
  const nlM = t.match(/\b(?:goedkoopste\s+(?:week|periode|moment)|beste\s+(?:week|periode|moment))\s+(?:in|voor)\s+([a-z]{3,}(?:\s+[a-z]{3,})?)(?:\s+(\d{4}))?\b/)
  if (nlM) {
    r.find_best_window = true
    const mIdx = _matchMonthByName(nlM[1].trim())
    if (mIdx !== null) r.date_window_month = mIdx + 1
  }
  if (/\b(?:wanneer\s+is\s+het\s+(?:het\s+)?goedkoopst|wanneer\s+zijn\s+vluchten\s+(?:het\s+)?goedkoopst|wat\s+is\s+de\s+beste\s+(?:week|periode))\b/.test(t)) {
    r.find_best_window = true
  }

  // ── PL: "najtańszy tydzień w październiku" ────────────────────────────────
  const plM = t.match(/\b(?:najta[nń]szy\s+(?:tydzie[nń]|okres|lot)|najlepsz[ay]\s+(?:tydzie[nń]|termin))\s+w\s+([a-ząćęłńóśźż]{3,}(?:\s+[a-ząćęłńóśźż]{3,})?)(?:\s+(\d{4}))?\b/)
  if (plM) {
    r.find_best_window = true
    const mIdx = _matchMonthByName(plM[1].trim())
    if (mIdx !== null) r.date_window_month = mIdx + 1
  }
  if (/\b(?:kiedy\s+(?:jest\s+)?(?:najta[nń]iej|najlepiej)\s+(?:lecieć|polecieć)|kiedy\s+s[aą]\s+(?:najtańsze|najlepsze)\s+(?:loty|bilety))\b/.test(t)) {
    r.find_best_window = true
  }

  // ── PT: "semana mais barata em novembro" ──────────────────────────────────
  const ptM = t.match(/\b(?:semana\s+mais\s+barata?|melhor\s+(?:semana|per[ií]odo|altura))\s+em\s+([a-záéíóúâêîôûàãõç]{3,}(?:\s+[a-záéíóúâêîôûàãõç]{3,})?)(?:\s+(?:de\s+)?(\d{4}))?\b/)
  if (ptM) {
    r.find_best_window = true
    const mIdx = _matchMonthByName(ptM[1].trim())
    if (mIdx !== null) r.date_window_month = mIdx + 1
  }
  if (/\b(?:quando\s+[eé]\s+mais\s+barato|quando\s+est[aã]o\s+(?:os\s+)?voos\s+mais\s+baratos|qual\s+(?:a\s+)?melhor\s+(?:altura|per[ií]odo))\b/.test(t)) {
    r.find_best_window = true
  }

  // ── SV: "billigaste veckan i december" ────────────────────────────────────
  const svM = t.match(/\b(?:billigaste\s+(?:veckan|perioden|flyget)|bästa\s+(?:veckan|perioden|tid))\s+i\s+([a-zåäö]{3,}(?:\s+[a-zåäö]{3,})?)(?:\s+(\d{4}))?\b/)
  if (svM) {
    r.find_best_window = true
    const mIdx = _matchMonthByName(svM[1].trim())
    if (mIdx !== null) r.date_window_month = mIdx + 1
  }
  if (/\b(?:när\s+[äa]r\s+det\s+(?:billigast|bäst)\s+att\s+flyga|när\s+[äa]r\s+flygbiljetterna\s+billigast)\b/.test(t)) {
    r.find_best_window = true
  }

  // ── HR: "najjeftiniji tjedan u siječnju" ──────────────────────────────────
  const hrM = t.match(/\b(?:najjeftiniji\s+(?:tjedan|period|let)|najbolji\s+(?:tjedan|period|termin))\s+u\s+([a-zčćžšđ]{3,}(?:\s+[a-zčćžšđ]{3,})?)(?:\s+(\d{4}))?\b/)
  if (hrM) {
    r.find_best_window = true
    const mIdx = _matchMonthByName(hrM[1].trim())
    if (mIdx !== null) r.date_window_month = mIdx + 1
  }
  if (/\b(?:kada\s+su\s+letovi\s+(?:najjeftiniji|najpovoljniji)|kada\s+je\s+(?:najjeftinije|najbolje)\s+letjeti)\b/.test(t)) {
    r.find_best_window = true
  }

  // ── SQ: "java më e lirë në shkurt" ───────────────────────────────────────
  const sqM = t.match(/\b(?:java\s+m[eë]\s+e\s+lir[eë]|periudha\s+m[eë]\s+e\s+mir[eë])\s+n[eë]\s+([a-zëç]{3,}(?:\s+[a-zëç]{3,})?)(?:\s+(\d{4}))?\b/)
  if (sqM) {
    r.find_best_window = true
    const mIdx = _matchMonthByName(sqM[1].trim())
    if (mIdx !== null) r.date_window_month = mIdx + 1
  }
  if (/\b(?:kur[eë]?\s+[eë]sht[eë]\s+m[eë]\s+e\s+lir[eë]\s+t[eë]\s+fluturosh|kur[eë]?\s+jan[eë]\s+fluturimet\s+m[eë]\s+t[eë]\s+lira)\b/.test(t)) {
    r.find_best_window = true
  }

  return r
}

// Shared month-name resolver (used by extractExplicitBestWindow)
function _matchMonthByName(name: string): number | null {
  const MAP: Record<string, number> = {
    january:0, jan:0, janvier:0, januar:0, enero:0, gennaio:0, janeiro:0, januari:0,
    february:1, feb:1, février:1, fevrier:1, februar:1, febrero:1, febbraio:1, fevereiro:1,
    march:2, mar:2, mars:2, märz:2, maerz:2, marzo:2, março:2,
    april:3, apr:3, avril:3, april2:3, abril:3, aprile:3,
    may:4, mai:4, mayo:4, maggio:4, maio:4, maj:4,
    june:5, jun:5, juin:5, juni:5, junio:5, giugno:5, junho:5,
    july:6, jul:6, juillet:6, juli:6, julio:6, luglio:6, julho:6,
    august:7, aug:7, août:7, aout:7, august2:7, agosto:7, augustus:7, augusti:7,
    september:8, sep:8, septembre:8, setembro:8, settembre:8,
    october:9, oct:9, octobre:9, oktober:9, octubre:9, ottobre:9, outubro:9,
    november:10, nov:10, novembre:10,
    december:11, dec:11, décembre:11, decembre:11, dezember:11, diciembre:11, dicembre:11, dezembro:11,
  }
  return MAP[stripAccents(name.toLowerCase())] ?? null
}

// ── Month names across all supported languages ────────────────────────────────
// Each entry maps localised name → 0-based month index.
// Sorted longest-first so 'janvier' matches before 'jan'.
const MONTH_MAP: [string, number][] = ([
  // EN
  ['january',0],['february',1],['march',2],['april',3],['may',4],['june',5],
  ['july',6],['august',7],['september',8],['october',9],['november',10],['december',11],
  ['jan',0],['feb',1],['mar',2],['apr',3],['jun',5],['jul',6],['aug',7],
  ['sep',8],['oct',9],['nov',10],['dec',11],
  // DE
  ['januar',0],['februar',1],['märz',2],['maerz',2],['mai',4],['juni',5],
  ['juli',6],['oktober',9],['dezember',11],
  // ES / IT / PT
  ['enero',0],['febrero',1],['marzo',2],['abril',3],['mayo',4],['junio',5],
  ['julio',6],['agosto',7],['septiembre',8],['setiembre',8],['octubre',9],['noviembre',10],['diciembre',11],
  ['gen',0],['gennaio',0],['febbraio',1],['giugno',5],['luglio',6],['agosto',7],
  ['settembre',8],['ottobre',9],['novembre',10],['dicembre',11],
  ['janeiro',0],['fevereiro',1],['marco',2],['março',2],['junho',5],['julho',6],
  ['setembro',8],['outubro',9],['dezembro',11],
  // FR
  ['janvier',0],['février',1],['fevrier',1],['mars',2],['avril',3],['mai',4],['juin',5],
  ['juillet',6],['août',7],['aout',7],['septembre',8],['octobre',9],['novembre',10],['décembre',11],['decembre',11],
  // NL
  ['januari',0],['februari',1],['maart',2],['april',3],['mei',4],['juni',5],
  ['juli',6],['augustus',7],['september',8],['oktober',9],['november',10],['december',11],
  // PL — nominative
  ['styczeń',0],['styczen',0],['luty',1],['marzec',2],['kwiecień',3],['kwiecien',3],
  ['maj',4],['czerwiec',5],['lipiec',6],['sierpień',7],['sierpien',7],
  ['wrzesień',8],['wrzesien',8],['październik',9],['pazdziernik',9],
  ['listopad',10],['grudzień',11],['grudzien',11],
  // PL — genitive (used in dates: "18 lipca" = 18th of July)
  ['stycznia',0],['lutego',1],['marca',2],['kwietnia',3],['maja',4],['czerwca',5],
  ['lipca',6],['sierpnia',7],['września',8],['wrzesnia',8],
  ['października',9],['pazdziernika',9],['listopada',10],['grudnia',11],
  // SV
  ['januari',0],['februari',1],['mars',2],['april',3],['maj',4],['juni',5],
  ['juli',6],['augusti',7],['september',8],['oktober',9],['november',10],['december',11],
  // HR — nominative
  ['siječanj',0],['sijecanj',0],['veljača',1],['veljaca',1],['oĵujak',2],['ozujak',2],
  ['travanj',3],['svibanj',4],['lipanj',5],['srpanj',6],['kolovoz',7],
  ['rujan',8],['listopad',9],['studeni',10],['prosinac',11],
  // HR — genitive (used in dates: "18. srpnja" = 18th of July)
  ['siječnja',0],['sijecnja',0],['veljače',1],['veljace',1],['ožujka',2],['ozujka',2],
  ['travnja',3],['svibnja',4],['lipnja',5],['srpnja',6],['kolovoza',7],
  ['rujna',8],['listopada',9],['studenog',10],['prosinca',11],
  // SQ

  ['janar',0],['shkurt',1],['prill',3],['qershor',5],
  ['korrik',6],['gusht',7],['shtator',8],['tetor',9],['nëntor',10],['nentor',10],['dhjetor',11],
  // JA (Japanese — 1月 through 12月)
  ['1月',0],['2月',1],['3月',2],['4月',3],['5月',4],['6月',5],
  ['7月',6],['8月',7],['9月',8],['10月',9],['11月',10],['12月',11],
  ['一月',0],['二月',1],['三月',2],['四月',3],['五月',4],['六月',5],
  ['七月',6],['八月',7],['九月',8],['十月',9],['十一月',10],['十二月',11],
  // KO (Korean — 1월 through 12월)
  ['1월',0],['2월',1],['3월',2],['4월',3],['5월',4],['6월',5],
  ['7월',6],['8월',7],['9월',8],['10월',9],['11월',10],['12월',11],
  // RU (Russian Cyrillic — nominative and genitive)
  ['январь',0],['февраль',1],['март',2],['апрель',3],['май',4],['июнь',5],
  ['июль',6],['август',7],['сентябрь',8],['октябрь',9],['ноябрь',10],['декабрь',11],
  ['января',0],['февраля',1],['марта',2],['апреля',3],['мая',4],['июня',5],
  ['июля',6],['августа',7],['сентября',8],['октября',9],['ноября',10],['декабря',11],
] as [string, number][]).sort((a, b) => b[0].length - a[0].length)

function matchMonth(text: string): number | null {
  const t = stripAccents(text.toLowerCase())
  for (const [name, idx] of MONTH_MAP) {
    if (t.startsWith(stripAccents(name))) return idx
  }
  return null
}

// ── Weekday names across all supported languages ───────────────────────────────
// Value = 0 (Sun)–6 (Sat), matching Date.getDay()
const WEEKDAY_MAP: [string, number][] = ([
  // EN
  ['sunday',0],['monday',1],['tuesday',2],['wednesday',3],['thursday',4],['friday',5],['saturday',6],
  // DE
  ['sonntag',0],['montag',1],['dienstag',2],['mittwoch',3],['donnerstag',4],['freitag',5],['samstag',6],
  // ES
  ['domingo',0],['lunes',1],['martes',2],['miércoles',3],['miercoles',3],['jueves',4],['viernes',5],['sábado',6],['sabado',6],
  // FR
  ['dimanche',0],['lundi',1],['mardi',2],['mercredi',3],['jeudi',4],['vendredi',5],['samedi',6],
  // IT
  ['domenica',0],['lunedì',1],['lunedi',1],['martedì',2],['martedi',2],['mercoledì',3],['mercoledi',3],
  ['giovedì',4],['giovedi',4],['venerdì',5],['venerdi',5],['sabato',6],
  // NL
  ['zondag',0],['maandag',1],['dinsdag',2],['woensdag',3],['donderdag',4],['vrijdag',5],['zaterdag',6],
  // PL
  ['niedziela',0],['poniedziałek',1],['poniedzialek',1],['wtorek',2],['środa',3],['sroda',3],
  ['czwartek',4],['piątek',5],['piatek',5],['sobota',6],
  // PL accusative ("w sobotę", "w niedzielę", "w środę")
  ['sobotę',6],['niedzielę',0],['środę',3],
  // PT
  ['domingo',0],['segunda',1],['terça',2],['terca',2],['quarta',3],['quinta',4],['sexta',5],['sábado',6],['sabado',6],
  // SV
  ['söndag',0],['sondag',0],['måndag',1],['mandag',1],['tisdag',2],['onsdag',3],['torsdag',4],['fredag',5],['lördag',6],['lordag',6],
  // HR
  ['nedjelja',0],['ponedjeljak',1],['utorak',2],['srijeda',3],['četvrtak',4],['petak',5],['subota',6],
  // SQ
  ['e diele',0],['e hënë',1],['e hene',1],['e martë',2],['e marte',2],['e mërkurë',3],['e merkure',3],
  ['e enjte',4],['e premte',5],['e shtunë',6],['e shtune',6],
  // JA (Japanese)
  ['日曜日',0],['月曜日',1],['火曜日',2],['水曜日',3],['木曜日',4],['金曜日',5],['土曜日',6],
  ['日曜',0],['月曜',1],['火曜',2],['水曜',3],['木曜',4],['金曜',5],['土曜',6],
  // RU (Russian Cyrillic — accusative forms used in "в среду", "в субботу")
  ['воскресенье',0],['понедельник',1],['вторник',2],['среда',3],['четверг',4],['пятница',5],['суббота',6],
  ['воскресенья',0],['понедельника',1],['вторника',2],['среду',3],['четверга',4],['пятницу',5],['субботу',6],
  // KO (Korean)
  ['일요일',0],['월요일',1],['화요일',2],['수요일',3],['목요일',4],['금요일',5],['토요일',6],
] as [string, number][]).sort((a, b) => b[0].length - a[0].length)

// ── Keywords that introduce return date (all languages) ───────────────────────
// Order matters: longer strings first to avoid partial matches
const RETURN_SPLIT_RE = new RegExp(
  '\\s+(?:' + [
    // EN
    'returning on','returning','return on','return date','return','come back on','coming back on','coming back','back on','back',
    // DE
    'rückflug am','rückflug','zurück am','zurück','ruckreise am','ruckreise',
    // ES
    'regresando el','regresando','vuelta el','vuelta','de vuelta el','de vuelta','regreso el','regreso',
    // FR
    'retour le','retour',
    // IT
    'ritorno il','ritorno','di ritorno il','di ritorno',
    // NL
    'terug op','terug','retour op','retour',
    // PL
    'powrót','powrot','wracam',
    // PT
    'retorno em','retorno','de volta em','de volta','volta em','volta',
    // SV
    'återresa','aterresa','tillbaka',
    // HR
    'povratak','natrag',
    // SQ
    'kthim',
  ].join('|') + ')\\s+',
  'i'
)

// ── Preposition/filler words before city names (all languages) ────────────────
const ORIGIN_PREFIX_RE = /^(?:from|from the|fly|flight|flights?|a\s+flight|some\s+flights?|book|find|cheap|cheapest|best|search|get me|show me|i want to fly|i want to go|i need to fly|i need to go|i need (?:a |some )?(?:flights?|tickets?)|i want (?:a |some )?(?:flights?|tickets?)|looking for (?:a |some )?(?:flights?|tickets?)|tickets?|booking|von|ab|von\s+|aus|desde|desde el|desde la|de|de\s+|depuis|depuis le|depuis la|da|da\s+|uit|van|vanaf|vanuit|z|ze|ze\s+|från|fran|iz|nga)\s+/i
const DEST_PREFIX_RE = /^(?:(?:to(?:\s+the)?|into|nach|in(?:\s+die|\s+den|\s+das)?|a|à|zu|para|til|naar|do|till|na|ne|drejt)\b|→|->|–|-)\s*/i

// ── Route connector words / arrows (split origin from destination) ─────────────
const ROUTE_SEP_RE = new RegExp(
  '\\s+(?:to(?:\\s+the)?|→|->|–|nach|nach\s+|aan|a\s+(?=\\p{L})|à\s+|au\s+|en\s+(?=\\p{L})|para\s+|til\s+|naar\s+|do\s+|till\s+|na\s+|drejt\s+|vo\s+|leti\s+|let\s+|leten\s+)(?=\\S)',
  'i'
)

// ── Date phrase modifiers ─────────────────────────────────────────────────────
// "next friday", "this saturday", "the friday after next", etc.
const REL_DATE_NEXT_RE = /\b(?:next|diese[rns]?|nächste[rns]?|nachste[rns]?|proxim[ao]|prochain[e]?|prossim[ao]|volgende|następn[ya]|nastepn[ya]|nästa|nasta|sljedeć[ia]|sljedeci[a]?)\b/i
const REL_DATE_THIS_RE = /\b(?:this|heute|hoy|aujourd'?hui|oggi|vandaag|dzisiaj|hoje|idag|danas|sot)\b/i
const REL_WEEKEND_RE = /\b(?:weekend|this weekend|ten weekend|tego weekendu?|wochenende|dieses wochenende?|fin de semana|este fin de semana|week-?end|ce week-?end|fine settimana|questo fine settimana|weekeinde|dit weekeinde?|vikend|ovaj vikend|helg|denna helg|週末|今週末|この週末|выходные|эти выходные|в эти выходные|이번 주말|주말)\b/i
const THANKSGIVING_WEEK_RE = /\b(?:(?:the\s+)?week\s+of\s+thanksgiving|thanksgiving\s+week)\b/i
const THANKSGIVING_RE = /\bthanksgiving\b/i

// ── Two-city bare match helper ────────────────────────────────────────────────
// Scans `text` for the two earliest-occurring city names from CITY_TO_IATA.
// Used as a fallback when no route separator ("to", "→", etc.) is found.
function findTwoCitiesInText(
  text: string,
): [{ code: string; name: string }, { code: string; name: string }] | null {
  const t = stripAccents(text.toLowerCase())
  const ranges: Array<{ start: number; end: number; code: string; name: string }> = []
  // Longest key first so "new york" is matched before "york"
  // Also include COUNTRY_TO_IATA so "malta", "iceland", "cyprus" etc. resolve correctly.
  // CITY_TO_IATA entries win on key conflicts (spread last).
  const combined = { ...COUNTRY_TO_IATA, ...CITY_TO_IATA }
  const entries = Object.entries(combined)
    .filter(([k]) => k.length >= 3)
    .sort((a, b) => b[0].length - a[0].length)

  for (const [k, v] of entries) {
    const needle = stripAccents(k.toLowerCase())
    const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(needle)}(?:$|[^a-z0-9])`, 'i')
    const m = re.exec(t)
    if (!m) continue
    const leadOffset = /[^a-z0-9]/i.test(m[0][0]) ? 1 : 0
    const start = m.index + leadOffset
    const end = start + needle.length
    if (!ranges.some(r => start < r.end && end > r.start)) {
      ranges.push({ start, end, code: v.code, name: v.name })
    }
  }

  // Also scan for bare 3-letter IATA codes not in the city/country dictionary
  // (e.g. "SFO", "WAW", "BCN", "CDG" typed directly without a "to" separator).
  // Uses the same airport DB lookup that resolveCity() uses for explicit codes.
  const iataWordRe = /\b[a-z]{3}\b/g
  let iataWm: RegExpExecArray | null
  while ((iataWm = iataWordRe.exec(t)) !== null) {
    const token = iataWm[0]
    // Skip common English/Romance words that collide with IATA codes
    // (e.g. "for" → FOR Fortaleza, "the" → THE Thaba’Nchu, "sun" → SUN Friedman)
    if (_COMMON_WORDS_BLOCKLIST.has(token)) continue
    const start = iataWm.index
    const end = start + 3
    if (ranges.some(r => start < r.end && end > r.start)) continue
    const cityEntry = CITY_TO_IATA[token]
    if (cityEntry) { ranges.push({ start, end, code: cityEntry.code, name: cityEntry.name }); continue }
    const airportEntry = findExactLocationMatch(token)
    if (airportEntry) ranges.push({ start, end, code: airportEntry.code, name: airportEntry.name })
  }

  // Final pass: airport-DB lookup over 1-2 word windows for cities NOT in
  // CITY_TO_IATA (e.g. "Paris", "Hong Kong", "Helsinki"). resolveCity already
  // handles airport-name fuzzy/exact matching against the global airport DB.
  // We tokenize on word boundaries and try each token + 2-word window, taking
  // the earliest non-overlapping matches that don't collide with existing ranges.
  const tokenRe = /[a-z][a-z'-]*/g
  const tokens: Array<{ text: string; start: number; end: number }> = []
  let tm: RegExpExecArray | null
  while ((tm = tokenRe.exec(t)) !== null) {
    tokens.push({ text: tm[0], start: tm.index, end: tm.index + tm[0].length })
  }
  // Try 2-word windows first (longer wins), then single words.
  for (let winLen = 2; winLen >= 1; winLen -= 1) {
    for (let i = 0; i + winLen <= tokens.length; i += 1) {
      const slice = tokens.slice(i, i + winLen)
      const phrase = slice.map(s => s.text).join(' ')
      if (phrase.length < 3) continue
      // Skip pure stopwords / connector tokens; they're not city names.
      if (winLen === 1 && _COMMON_WORDS_BLOCKLIST.has(phrase)) continue
      const start = slice[0].start
      const end = slice[slice.length - 1].end
      if (ranges.some(r => start < r.end && end > r.start)) continue
      const hit = resolveCity(phrase)
      if (hit) ranges.push({ start, end, code: hit.code, name: hit.name })
    }
  }

  if (ranges.length < 2) return null
  ranges.sort((a, b) => a.start - b.start)
  return [ranges[0], ranges[1]]
}

// ── Pre-clean: strip conversational preambles in all supported languages ──────
// Removes phrases like "Can you find me a flight", "Ich suche einen Flug", etc.
// from the start of the query before route extraction. Also strips trailing
// politeness suffixes ("please", "danke", etc.).
function _preClean(raw: string): string {
  // Order matters: longer/more specific patterns first so they match before shorter ones
  const preambles: RegExp[] = [
    // ── ENGLISH ──────────────────────────────────────────────────────────────
    // "Can you find / show / search for (me) (cheap) (a) flight(s)"
    /^(?:can\s+you\s+|could\s+you\s+|would\s+you\s+|please\s+)?(?:find|show|get|search(?:\s+for)?|look(?:\s+for)?|help\s+me\s+(?:find|search\s+for|look\s+for)|book)\s+me\s+(?:(?:the\s+)?(?:cheapest?|best|cheap|affordable|a\s+good)\s+)?(?:a\s+|an\s+|some\s+)?(?:flights?|plane\s+tickets?|air\s+tickets?|tickets?|connections?)\s*/i,
    /^(?:can\s+you\s+|could\s+you\s+|would\s+you\s+|please\s+)?(?:find|show|get|search(?:\s+for)?|look(?:\s+for)?)\s+(?:(?:the\s+)?(?:cheapest?|best|cheap|affordable)\s+)?(?:flights?|tickets?|connections?)\s*/i,
    // "I want/need/would like/am looking to fly / book / travel"
    /^i(?:'d|\s+would)\s+(?:like|love|prefer)\s+(?:to\s+)?(?:fly(?:ing)?|travel(?:l?ing)?|book(?:ing)?\s+(?:a\s+)?(?:flight|ticket)|find(?:ing)?\s+(?:a\s+)?(?:flight|ticket)|go)\s*/i,
    /^i\s+(?:want|need|have)\s+to\s+(?:fly|travel|book\s+(?:a\s+)?(?:flight|ticket)|find\s+(?:a\s+)?(?:flight|ticket)|get\s+(?:a\s+)?(?:flight|ticket))\s*/i,
    /^i(?:'m|\s+am)\s+(?:looking\s+(?:for\s+(?:a\s+)?(?:flight|ticket|connection)|to\s+(?:fly|book|travel))|planning\s+(?:to\s+(?:fly|travel)|a\s+trip)|trying\s+to\s+(?:fly|travel|get\s+(?:a\s+)?flight)|thinking\s+(?:about|of)\s+(?:flying|travelling))\s*/i,
    /^i(?:'m|\s+am)\s+(?:flying|travelling?|heading|going)\s*/i,
    /^i(?:'ll|\s+will)\s+be\s+(?:flying|travelling?|heading)\s*/i,
    // "Looking / Searching for (a/some/cheap) flight(s)"
    /^(?:looking|searching|in\s+search)\s+(?:for\s+)?(?:(?:a|an|some|cheap|affordable|the\s+cheapest?)\s+)?(?:flights?|tickets?|connections?)\s*/i,
    // "Any flights / Are there flights / Is there a flight"
    /^(?:are\s+there|is\s+there)\s+(?:any\s+)?(?:flights?|tickets?|connections?)\s*/i,
    /^any\s+(?:flights?|tickets?)\s*/i,
    // "What's the cheapest flight / best way to fly"
    /^what(?:'s|\s+is)\s+the\s+(?:cheapest?|best|fastest|most\s+(?:affordable|direct))\s+(?:(?:way|route)\s+to\s+(?:get|fly|travel|go)\s+)?/i,
    // "Show me / Get me / Find me / Book me"
    /^(?:show|get|find|book)\s+me\s+(?:(?:a|an|some|cheap|affordable|the\s+cheapest?)\s+)?(?:flights?|tickets?)?\s*/i,
    // "I need a flight" (without 'to fly')
    /^i\s+need\s+(?:a|an|some)?\s+(?:flight|ticket|connection)\s*/i,
    // "I have a business/family/etc trip to" — conversational opener
    /^i\s+have\s+(?:a|an)\s+(?:\w+\s+){0,3}(?:trip|flight|journey|holiday|vacation)\s+/i,
    // "I'm going on a [family/summer/etc] trip/holiday"
    /^i(?:'m|\s+am)\s+going\s+on\s+(?:a|an)\s+(?:\w+\s+){0,3}(?:trip|holiday|vacation|getaway)\s*/i,
    // "planning a [family/business/etc] trip" (without I'm prefix)
    /^planning\s+(?:a|an)\s+(?:\w+\s+){0,3}(?:trip|holiday|vacation|getaway)\s+/i,
    // "I'm planning a family trip" — extends existing to cover modifier words before "trip"
    /^i(?:'m|\s+am)\s+planning\s+(?:a|an)\s+(?:\w+\s+){0,3}(?:trip|holiday|vacation|getaway)\s+/i,
    // ── GERMAN ───────────────────────────────────────────────────────────────
    /^ich\s+(?:suche(?:\s+nach)?|m[öo]chte|will|brauche|w[üu]rde\s+gerne?\s+(?:einen?\s+)?(?:flug\s+)?(?:buchen|finden|haben))\s+(?:(?:einen?|einen?\s+g[üu]nstigen?|billigen?|g[üu]nstige\s+)?(?:fl[üu]ge?|flugticket|flugverbindung|ticket)s?)?\s*/i,
    /^ich\s+(?:m[öo]chte|will|w[üu]rde\s+gerne?)\s+(?:fliegen|reisen|einen?\s+flug\s+buchen)\s*/i,
    /^(?:gibt\s+es|k[öo]nnen\s+sie|kannst\s+du|k[öo]nnten\s+sie)\s+(?:mir\s+)?(?:(?:g[üu]nstige?|billige?)\s+)?(?:fl[üu]ge?|flugtickets?)\s+(?:finden|zeigen|suchen)?\s*/i,
    /^(?:zeig|finde?|such)\s+(?:mir\s+)?(?:(?:g[üu]nstige?|billige?|den?\s+g[üu]nstigsten?)\s+)?(?:fl[üu]ge?|flugtickets?)\s*/i,
    /^suche?\s+(?:nach\s+)?(?:(?:g[üu]nstige[mn]?|billige[mn]?)\s+)?(?:fl[üu]ge?|flugtickets?)\s*/i,
    // ── SPANISH ──────────────────────────────────────────────────────────────
    /^(?:busco|estoy\s+buscando|necesito|quiero\s+(?:buscar|encontrar|reservar)?)\s+(?:(?:un|vuelos?|billetes?|pasajes?)\s+)?(?:vuelos?|billetes?\s+de\s+avi[oó]n|pasajes?\s+a[eé]reos?|billetes?\s+baratos?|vuelos?\s+baratos?)\s*/i,
    /^quiero\s+(?:volar|viajar|ir(?:\s+en\s+avi[oó]n)?|reservar(?:\s+un\s+vuelo)?)\s*/i,
    /^(?:¿?hay|¿?existen?|¿?tienes?|¿?tienen)\s+(?:algún?\s+)?(?:vuelos?|billetes?)\s*/i,
    /^(?:enc[uú]entrame|b[uú]scame|mu[eé]strame)\s+(?:(?:un|vuelos?|billetes?)\s+)?(?:vuelos?|billetes?|pasajes?)\s*/i,
    /^planeo\s+(?:volar|viajar|ir\s+a)\s*/i,
    // ── FRENCH ───────────────────────────────────────────────────────────────
    /^(?:je\s+)?(?:cherche(?:\s+un)?|veux|voudrais|aimerais|souhaite|ai\s+besoin\s+(?:d['']un|de\s+)|suis\s+(?:[àa]\s+la\s+recherche\s+)?(?:d['']un|de\s+))\s+(?:(?:un\s+|des?\s+|(?:les?\s+)?)?(?:vol|billet|vols|billets))\s*/i,
    /^je\s+(?:veux|voudrais|aimerais|souhaite)\s+(?:voler|voyager|prendre\s+l['']avion|r[eé]server(?:\s+un\s+vol)?)\s*/i,
    /^(?:avez[-\s]vous|y\s+a[-\s]t[-\s]il|est[-\s]ce\s+qu['']il\s+y\s+a)\s+(?:des?\s+)?(?:vols?|billets?)\s*/i,
    /^(?:trouvez|montrez|cherchez|r[eé]servez)\s+(?:moi\s+)?(?:(?:des?|un|les?\s+)?(?:moins\s+chers?|moins\s+ch[eè]res?|pas\s+chers?)\s+)?(?:vols?|billets?)\s*/i,
    /^je\s+pr[eé]vois\s+de\s+(?:voyager|voler|prendre\s+l['']avion)\s*/i,
    // ── ITALIAN ──────────────────────────────────────────────────────────────
    /^(?:cerco|voglio|ho\s+bisogno\s+di|sto\s+cercando|vorrei)\s+(?:(?:un|dei|voli?|biglietti?)\s+)?(?:voli?|biglietti?\s+aerei?|biglietti?\s+aereo)\s*/i,
    /^voglio\s+(?:volare|viaggiare|andare(?:\s+in\s+aereo)?|prenotare(?:\s+un\s+volo)?)\s*/i,
    /^(?:ci\s+sono|esistono|avete)\s+(?:dei?\s+)?(?:voli?|biglietti?)\s*/i,
    /^(?:trovami|mostrami|cercami)\s+(?:(?:un|dei|voli?)\s+)?(?:voli?|biglietti?|connessioni?)\s*/i,
    /^sto\s+pianificando\s+(?:di\s+)?(?:volare|viaggiare|andare\s+a)\s*/i,
    // ── DUTCH ────────────────────────────────────────────────────────────────
    /^(?:ik\s+)?(?:zoek(?:\s+naar)?|wil(?:\s+graag)?|zou\s+graag|heb\s+(?:een\s+vlucht\s+|)nodig|ben\s+op\s+zoek\s+naar)\s+(?:(?:een|goedkope?|de\s+goedkoopste?)\s+)?(?:vlucht(?:en)?|ticket(?:s)?)\s*/i,
    /^ik\s+(?:wil|zou\s+graag|ga|ben\s+van\s+plan(?:\s+te)?)\s+(?:vliegen|reizen|een\s+vlucht\s+boeken)\s*/i,
    /^(?:zijn\s+er|heeft\s+u|heb\s+je)\s+(?:vluchten?|tickets?)\s*/i,
    /^(?:zoek|vind|toon)\s+(?:mij\s+)?(?:(?:goedkope?|de\s+goedkoopste?)\s+)?(?:vluchten?|tickets?)\s*/i,
    // ── POLISH ───────────────────────────────────────────────────────────────
    /^(?:szukam|chcę|potrzebuj[eę]|jestem\s+w\s+poszukiwaniu)\s+(?:(?:lot[uó]w?|bilet[uó]w?|połączeń)\s+)?(?:lot[uó]w?|bilet[uó]w?|połączeń)\s*/i,
    /^chcę\s+(?:lecieć|polecieć|podróżować|zarezerwować\s+(?:bilet|lot)|znaleźć\s+(?:bilet|lot))\s*/i,
    /^(?:czy\s+są|czy\s+macie|znajdź(?:cie)?|poka[zż](?:cie)?)\s+(?:(?:tanie\s+)?(?:loty?|bilety?)\s*)?\s*/i,
    /^planuję\s+(?:lecieć|podróżować|polecieć\s+do)\s*/i,
    // ── PORTUGUESE ───────────────────────────────────────────────────────────
    /^(?:procuro|quero|preciso\s+de|estou\s+(?:[àa]\s+procura\s+de|procurando))\s+(?:(?:um|voos?|passagens?)\s+)?(?:voos?|passagens?\s+a[eé]reas?|bilhetes?\s+de\s+avi[aã]o)\s*/i,
    /^quero\s+(?:voar|viajar|ir(?:\s+de\s+avi[aã]o)?|reservar(?:\s+um\s+voo)?)\s*/i,
    /^(?:h[aá]|existem|vocês\s+têm)\s+(?:algum?\s+)?(?:voos?|passagens?)\s*/i,
    /^(?:encontre|mostre|busque)\s+(?:(?:para\s+mim\s+)?(?:um|voos?)\s+)?(?:voos?|passagens?|bilhetes?)\s*/i,
    /^estou\s+planejando\s+(?:voar|viajar|ir\s+a)\s*/i,
    // ── SWEDISH ──────────────────────────────────────────────────────────────
    /^(?:jag\s+)?(?:söker?|vill\s+(?:ha|hitta|boka)|behöver|letar\s+efter)\s+(?:(?:ett|billiga?|det\s+billigaste)\s+)?(?:flyg(?:biljett|resa)?|biljett(?:er)?)\s*/i,
    /^jag\s+(?:vill|skulle\s+vilja|tänker|planerar\s+att)\s+(?:flyga|resa|boka\s+(?:ett\s+)?flyg)\s*/i,
    /^(?:finns\s+det|har\s+ni)\s+(?:n[aå]got\s+)?(?:flyg|biljetter)\s*/i,
    /^(?:hitta|visa|s[oö]k)\s+(?:mig\s+)?(?:(?:billiga?\s+)?(?:flyg|biljetter))\s*/i,
    // ── CROATIAN ─────────────────────────────────────────────────────────────
    /^(?:tražim|želim|trebam|potražujem|radi\s+bih)\s+(?:(?:let|kartu|povoljne?)\s+)?(?:letove?|karte?|avionske\s+karte?)\s*/i,
    /^želim\s+(?:letjeti|putovati|otputovati|rezervirati\s+(?:let|kartu))\s*/i,
    /^(?:ima\s+li|postoje\s+li)\s+(?:kakvi?\s+)?(?:letovi?|karte?)\s*/i,
    /^(?:pronađi|pokaži|nađi)\s+(?:mi\s+)?(?:(?:jeftine?\s+)?(?:letove?|karte?))\s*/i,
    // ── ALBANIAN ─────────────────────────────────────────────────────────────
    /^(?:kërkoj|dua|kam\s+nevojë\s+(?:për\s+)?|po\s+kërkoj)\s+(?:(?:një\s+|fluturime?\s+)?)?(?:fluturime?|bileta?\s+avioni|bileta?)\s*/i,
    /^dua\s+(?:të\s+fluturoj|të\s+udhëtoj|të\s+rezervoj\s+(?:një\s+)?fluturim)\s*/i,
    /^(?:ka|a\s+ka|gjeni)\s+(?:ndonjë\s+)?(?:fluturime?|bileta?)\s*/i,
    // ── JAPANESE ─────────────────────────────────────────────────────────────
    /^(?:安い|格安|最安値の)?(?:フライト|航空券|便)を(?:探して|見つけて|検索して|予約して)(?:ください|くれ|もらえますか)?\s*/,
    /^(?:いちばん安い|最安|格安)(?:フライト|航空券|便)?を?\s*/,
    /^(?:[\u30d5\u30e9\u30a4\u30c8]|[\u822a\u7a7a\u5238])を?\s*(?:[\u691c\u7d22]|[\u4e88\u7d04]|[\u63a2\u3057])\s*/,
    // ── RUSSIAN ──────────────────────────────────────────────────────────────
    /^(?:ищу|хочу|мне\s+нужен?|ищу\s+(?:дешёвые?\s+)?|подберите?\s+)\s*(?:(?:дешёвые?\s+)?(?:рейс|билет|перелёт)(?:ы|ов)?)?\s*/i,
    /^хочу\s+(?:полететь|улететь|слетать|купить\s+(?:билет|рейс))\s*/i,
    /^(?:есть\s+ли|найдите?|покажите?)\s+(?:(?:дешёвые?\s+)?(?:рейсы?|билеты?))?\s*/i,
    /^планирую\s+(?:полететь|улететь|съездить\s+в)\s*/i,
    // ── KOREAN ───────────────────────────────────────────────────────────────
    /^(?:항공권|비행기\s*표|항공\s*티켓)(?:을|를)?\s*(?:찾아|검색해|예약해)(?:주세요|줘|줄\s*수\s*있나요)?\s*/,
    /^(?:저렴한|싼|가장\s*싼)\s*(?:항공권|비행기\s*표|항공편)?\s*/,
    /^(?:가고\s*싶어요?|여행하고\s*싶어요?|비행기\s*타고\s*싶어요?)\s*/,
  ]

  let s = raw
  for (const pat of preambles) {
    const m = s.match(pat)
    if (m && m.index === 0 && m[0].length < s.length) {
      s = s.slice(m[0].length).trim()
      break // only strip one preamble prefix
    }
  }

  // Strip trailing politeness suffixes in all languages
  s = s
    .replace(/\s*[,.]?\s*\b(?:please|thanks?|thank\s+you|cheers|asap|urgently|as\s+soon\s+as\s+possible|if\s+possible)\s*$/i, '')
    .replace(/\s*[,.]?\s*\b(?:bitte|danke(?:sch[oö]n)?|danke\s+vielmals?)\s*$/i, '')
    .replace(/\s*[,.]?\s*\b(?:por\s+favor|gracias|por\s+favor|muchas\s+gracias)\s*$/i, '')
    .replace(/\s*[,.]?\s*\b(?:s['']il\s+vous\s+pla[iî]t|s['']il\s+te\s+pla[iî]t|merci(?:\s+d'avance)?)\s*$/i, '')
    .replace(/\s*[,.]?\s*\b(?:per\s+favore|grazie(?:\s+mille)?)\s*$/i, '')
    .replace(/\s*[,.]?\s*\b(?:alsjeblieft|dank\s+(?:je|u)(?:\s+wel)?)\s*$/i, '')
    .replace(/\s*[,.]?\s*\b(?:proszę|dziękuję)\s*$/i, '')
    .replace(/\s*[,.]?\s*\b(?:por\s+favor|obrigado|obrigada)\s*$/i, '')
    .replace(/\s*[,.]?\s*\b(?:tack(?:\s+s[åa]\s+mycket)?|snälla?)\s*$/i, '')
    .replace(/\s*[,.]?\s*\b(?:molim|hvala(?:\s+lijepa)?)\s*$/i, '')
    .replace(/\s*[,.]?\s*\b(?:ju\s+lutem|faleminderit)\s*$/i, '')
    .replace(/\s*(?:お願いします|ください|くださいね|よろしくお願いします)\s*$/u, '')        // JA
    .replace(/\s*(?:пожалуйста|спасибо(?:\s+заранее)?)\s*$/iu, '')                        // RU
    .replace(/\s*(?:부탁드립니다|감사합니다|부탁해요)\s*$/u, '')                            // KO
    .trim()

  return s
}

// ── Main parse function ───────────────────────────────────────────────────────

export function parseNLQuery(query: string): ParsedQuery {
  // Normalise: trim, collapse whitespace, strip leading/trailing punctuation
  const q = _preClean(query.trim().replace(/\s+/g, ' ').replace(/^[,.:!?]+|[,.:!?]+$/g, ''))
  const ql = q.toLowerCase()
  const result: ParsedQuery = {}

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // ── 0. Fast path: raw IATA format "AAA BBB YYYY-MM-DD [YYYY-MM-DD]" ──────
  // This is what monitor email links use: ?q=LON+BCN+2026-06-16
  const iataFastRe = /^([A-Z]{3})\s+([A-Z]{3})\s+(\d{4}-\d{2}-\d{2})(?:\s+(\d{4}-\d{2}-\d{2}))?$/i
  const iataFast = q.trim().match(iataFastRe)
  if (iataFast) {
    const [, orig, dest, dep, ret] = iataFast
    const originUpper = orig.toUpperCase()
    const destUpper = dest.toUpperCase()
    const originEntry = Object.values(CITY_TO_IATA).find(v => v.code === originUpper)
    const destEntry = Object.values(CITY_TO_IATA).find(v => v.code === destUpper)
    result.origin = originUpper
    result.origin_name = originEntry?.name ?? originUpper
    result.destination = destUpper
    result.destination_name = destEntry?.name ?? destUpper
    result.date = dep
    if (ret) result.return_date = ret
    return result
  }

  // ── 0c. Directional day + time-of-day hints ────────────────────────────────
  // Detects which leg (outbound/return) a weekday + time-of-day applies to.
  // Covers many phrasings regardless of word order:
  //   "Friday evening out", "fly out Friday evening", "leave on Friday morning",
  //   "departing Friday afternoon", "Friday evening flight",
  //   "Sunday night back", "fly back Sunday evening", "returning Monday morning",
  //   "coming back Thursday afternoon", "home Sunday night", etc.
  {
    const _dn = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday'
    const _tw = 'early\\s+morning|morning|afternoon|evening|night|noon|lunchtime|midday'
    const _dc = `(${_dn})`           // day capture (required)
    const _tc = `(${_tw})?`          // tod capture (optional)
    const _tcR = `(${_tw})`          // tod capture (required — for patterns where tod must be present)
    const _oo = '(?:on\\s+)?'        // optional "on "

    // Extract [day, tod] from capture groups by matching against known word lists
    const _ext = (m: RegExpMatchArray | null): [string|undefined, string|undefined] => {
      if (!m) return [undefined, undefined]
      const _dRe = new RegExp(`^(${_dn})$`, 'i')
      const _tRe = /^(?:early\s+morning|morning|afternoon|evening|night|noon|lunchtime|midday)$/i
      let _d: string|undefined, _t: string|undefined
      for (const g of m.slice(1)) {
        if (!g) continue
        const gl = g.replace(/\s+/g, ' ').toLowerCase()
        if (!_d && _dRe.test(gl)) _d = gl
        else if (!_t && _tRe.test(gl)) _t = gl
      }
      return [_d, _t]
    }

    const _ql2 = q.toLowerCase()

    // ── Outbound patterns (day + optional time-of-day for the departure leg) ───
    const _outPats: RegExp[] = [
      // "Friday evening out / outbound / depart / leave / fly out / going out"
      new RegExp(`\\b${_dc}\\s+${_tc}\\s*(?:out(?:bound)?|depart(?:ure|ing)?|leave|leaving|fly(?:ing)?(?:\\s+out)?|going\\s+out|heading\\s+out|take\\s*off)\\b`, 'i'),
      // "fly out Friday evening", "leave Friday afternoon", "depart Friday morning"
      new RegExp(`\\b(?:fl(?:y|ying)\\s+out|leave|leaving|depart(?:ing)?|going\\s+out|heading\\s+out)\\s+${_oo}${_dc}(?:\\s+${_tc})?\\b`, 'i'),
      // "outbound Friday evening", "departing Friday morning", "departure Friday"
      new RegExp(`\\b(?:out(?:bound|going)|departing|departure)\\s+${_oo}${_dc}(?:\\s+${_tc})?\\b`, 'i'),
      // "fly on Friday evening", "leave on Friday afternoon"
      new RegExp(`\\b(?:fly(?:ing)?|leave|depart(?:ing)?)\\s+on\\s+${_dc}(?:\\s+${_tc})?\\b`, 'i'),
      // "Friday morning departure", "Friday evening flight", "Friday night service"
      new RegExp(`\\b${_dc}\\s+${_tcR}\\s+(?:departure|flight|service|dep(?:arture)?)\\b`, 'i'),
      // "morning flight on Friday", "evening departure Friday", "afternoon flight Friday"
      new RegExp(`\\b${_tcR}\\s+(?:departure|flight|service)\\s+${_oo}${_dc}\\b`, 'i'),
      // "take / catch an evening flight on Friday"
      new RegExp(`\\b(?:take|catch|get)\\s+(?:a|the|an)\\s+${_tcR}\\s+(?:flight|plane)\\s+${_oo}${_dc}\\b`, 'i'),
      // "going Friday evening", "heading out Friday afternoon"
      new RegExp(`\\b(?:going|heading)\\s+${_oo}${_dc}\\s+${_tc}\\b`, 'i'),
    ]

    // ── Return patterns (day + optional time-of-day for the return leg) ─────────
    const _retPats: RegExp[] = [
      // "Sunday night back / return / inbound / home"
      new RegExp(`\\b${_dc}\\s+${_tc}\\s*(?:back|return(?:ing)?|in(?:bound)?|home)\\b`, 'i'),
      // "fly back Sunday evening", "come back Monday morning", "head back Thursday afternoon"
      new RegExp(`\\b(?:fl(?:y|ying)\\s+back|come\\s+back|coming\\s+back|head(?:ing)?\\s+back|get(?:ting)?\\s+back|go(?:ing)?\\s+back|arrive\\s+back|land(?:ing)?\\s+back)\\s+${_oo}${_dc}(?:\\s+${_tc})?\\b`, 'i'),
      // "returning Sunday morning", "return on Monday afternoon"
      new RegExp(`\\breturn(?:ing)?\\s+${_oo}${_dc}(?:\\s+${_tc})?\\b`, 'i'),
      // "back on Sunday evening", "back Sunday morning"
      new RegExp(`\\bback\\s+${_oo}${_dc}(?:\\s+${_tc})?\\b`, 'i'),
      // "home Sunday night", "home on Monday morning"
      new RegExp(`\\bhome\\s+${_oo}${_dc}(?:\\s+${_tc})?\\b`, 'i'),
      // "inbound Sunday morning", "inbound on Monday"
      new RegExp(`\\binbound\\s+${_oo}${_dc}(?:\\s+${_tc})?\\b`, 'i'),
      // "Sunday morning inbound", "Sunday evening return flight"
      new RegExp(`\\b${_dc}\\s+${_tcR}\\s+(?:return(?:\\s+flight)?|inbound|flight\\s+back)\\b`, 'i'),
      // "evening return on Sunday", "morning flight back Monday"
      new RegExp(`\\b${_tcR}\\s+(?:return(?:\\s+flight)?|flight\\s+back)\\s+${_oo}${_dc}\\b`, 'i'),
      // "arriving back Sunday evening", "landing back Monday morning"
      new RegExp(`\\b(?:arriv(?:e|ing)|land(?:ing)?)\\s+back\\s+${_oo}${_dc}(?:\\s+${_tc})?\\b`, 'i'),
      // "Sunday back evening" (unusual but valid)
      new RegExp(`\\b${_dc}\\s+back\\s+${_tc}\\b`, 'i'),
    ]

    let _depDay: string|undefined, _depTod: string|undefined
    let _retDay: string|undefined, _retTod: string|undefined

    for (const _p of _outPats) {
      const [d, t] = _ext(_ql2.match(_p))
      if (d) { _depDay = d; _depTod = t; break }
    }
    for (const _p of _retPats) {
      const [d, t] = _ext(_ql2.match(_p))
      if (d) { _retDay = d; _retTod = t; break }
    }

    if (_depDay) (result as any).__explicitDepartureDay = _depDay
    if (_depTod) (result as any).__explicitDepartureTimePref = _depTod
    if (_retDay) (result as any).__explicitReturnDay = _retDay
    if (_retTod) (result as any).__explicitReturnTimePref = _retTod
  }

  // ── 1. Split at return keywords ──────────────────────────────────────────
  const returnSplitMatch = ql.match(RETURN_SPLIT_RE)
  const returnSplitIdx = returnSplitMatch ? ql.indexOf(returnSplitMatch[0]) : -1
  const outboundRaw = returnSplitIdx >= 0 ? q.slice(0, returnSplitIdx) : q
  const returnRaw = returnSplitIdx >= 0 ? q.slice(returnSplitIdx + returnSplitMatch![0].length) : null

  // ── 1b. Via / preferred-stopover extraction ───────────────────────────────
  // Runs before city-pair parsing to prevent the via city being mistaken for
  // origin or destination. City is always in the last capture group (m[m.length-1]).
  //
  // Covers English + DE/ES/FR/IT/NL/PL/PT/SV, including:
  //   "via Hong Kong", "fly through Dubai", "stopover in Singapore",
  //   "transit via Bangkok", "connecting through Tokyo",
  //   "with a layover in Seoul", "change planes in Doha",
  //   "break the journey in Abu Dhabi", "spend 2 days in Istanbul",
  //   "explore Hong Kong on the way", "with a Tokyo layover",
  //   "mit Zwischenstopp in Frankfurt", "con escala en Dubai", etc.
  const _viaPatterns: RegExp[] = [
    // "spend X days / a night / some time in CITY" (most specific — also implies duration)
    /\bspend(?:ing)?\s+(?:some\s+(?:time|days?|hours?)|an?\s+(?:extra\s+)?(?:night|day|week(?:end)?)|(?:a\s+)?(?:few|couple\s+of|number\s+of)\s+(?:days?|nights?|hours?)|\d+\s+(?:days?|nights?|hours?))\s+(?:in|at)\s+([\w\u00C0-\u024F]+(?:\s+[\w\u00C0-\u024F]+){0,3})(?=\s|[,.]|$)/i,
    // "explore CITY on the way / en route / during the layover"
    /\bexplor(?:e|ing)\s+(?:(?:a\s+bit\s+of|some\s+of|the)\s+)?([\w\u00C0-\u024F]+(?:\s+[\w\u00C0-\u024F]+){0,2})(?:\s+(?:on\s+the\s+way|en\s+route|during\s+(?:the\s+)?(?:layover|stopover|transit|stop)|while\s+(?:there|passing|transiting)))/i,
    // "visit CITY on the way / during the layover / for a day"
    /\bvisit(?:ing)?\s+([\w\u00C0-\u024F]+(?:\s+[\w\u00C0-\u024F]+){0,2})(?:\s+(?:on\s+the\s+way|en\s+route|during\s+(?:the\s+)?(?:layover|stopover|transit)|for\s+(?:a\s+)?(?:day|night|few\s+days?|couple\s+of\s+days?)|while\s+(?:there|passing)))/i,
    // "break the journey in CITY" / "break the trip up in CITY"
    /\bbreak(?:ing)?\s+(?:up\s+)?(?:the\s+)?(?:journey|flight|trip)\s+(?:in|at)\s+([\w\u00C0-\u024F]+(?:\s+[\w\u00C0-\u024F]+){0,3})(?=\s|[,.]|$)/i,
    // "change planes / flights in CITY"
    /\bchang(?:e|ing)\s+(?:planes?|flights?)\s+(?:in|at)\s+([\w\u00C0-\u024F]+(?:\s+[\w\u00C0-\u024F]+){0,3})(?=\s|[,.]|$)/i,
    // "touch down in CITY" / "pit stop in CITY"
    /\b(?:touch(?:ing)?\s+down|pit[- ]?stop)\s+(?:in|at)\s+([\w\u00C0-\u024F]+(?:\s+[\w\u00C0-\u024F]+){0,3})(?=\s|[,.]|$)/i,
    // "with a CITY stopover" / "a CITY layover" (reversed form, e.g. "with a Hong Kong stopover")
    /\bwith\s+(?:an?\s+)?([\w\u00C0-\u024F]+(?:\s+[\w\u00C0-\u024F]+){0,2})\s+(?:stopover|layover|connection|transfer|stop)\b/i,
    // "CITY as a stopover / as a layover"
    /\b([\w\u00C0-\u024F]+(?:\s+[\w\u00C0-\u024F]+){0,2})\s+as\s+(?:a\s+|an\s+)?(?:stopover|layover|connection|transfer)\b/i,
    // Main English compound — fly through / go via / pass through / route via / stopover /
    //   layover / transit / transfer / connect / make a stop / have a layover …
    /\b(?:fly(?:ing)?\s+(?:via|through|over)|go(?:ing)?\s+(?:via|through)|pass(?:ing)?\s+through|rout(?:e[sd]?|ing)\s+(?:via|through)|travel(?:l?ing)?\s+(?:via|through)|stop(?:ping)?\s+(?:over\s+)?(?:in|at|by)|stopp?over\s+(?:in|at)|layover\s+(?:in|at)|transit(?:ing)?\s+(?:in|through|via|at)|transfer(?:ring)?\s+(?:in|at|through|via)|connect(?:ing)?\s+(?:in|through|via|at)|connection\s+(?:in|at|through|via)|with\s+(?:an?\s+)?(?:connection|stop(?:over)?|layover|transfer|transit)\s+(?:in|at)|mak(?:e|ing)\s+(?:an?\s+)?(?:stop(?:over)?|layover|transfer)\s+(?:in|at)|hav(?:e|ing)\s+(?:an?\s+)?(?:stop(?:over)?|layover|transfer)\s+(?:in|at))\s+([\w\u00C0-\u024F]+(?:\s+[\w\u00C0-\u024F]+){0,3})(?=\s+(?:for|with|and|on|at|around|\d)|[,.]|\s+(?:long|short|over|quick|brief|overnight|a\b)|$)/i,
    // Bare "via CITY"
    /\bvia\s+([\w\u00C0-\u024F]+(?:\s+[\w\u00C0-\u024F]+){0,3})(?=\s+(?:for|with|and|on|at|around|\d)|[,.]|\s+(?:long|short|over|quick|brief|overnight|a\b)|$)/i,
    // German: "mit Zwischenstopp in Dubai", "mit Stopp in Singapur", "über Frankfurt"
    /\b(?:mit\s+(?:\w+\s+)?(?:zwischenstopp|layover|transfer|umstieg|aufenthalt|stopp)\s+(?:in|an|auf)|mit\s+stopp\s+in)\s+([\w\u00C0-\u024F]+(?:\s+[\w\u00C0-\u024F]+){0,3})(?=\s|[,.]|$)/i,
    /\büber\s+([\w\u00C0-\u024F]{3,}(?:\s+[\w\u00C0-\u024F]+){0,2})(?=\s+(?:fliegen|reisen|fahren|mit|nach|für|\d)|[,.]|$)/i,
    // Spanish: "con escala en Dubai", "haciendo escala en", "pasando por"
    /\b(?:con\s+escala\s+(?:en|a)|haciendo\s+escala\s+en|pasando\s+por)\s+([\w\u00C0-\u024F]+(?:\s+[\w\u00C0-\u024F]+){0,3})(?=\s|[,.]|$)/i,
    // French: "avec escale à Paris", "avec une correspondance à", "en passant par"
    /\b(?:avec\s+(?:une?\s+)?(?:escale|correspondance|connexion)\s+[aà]|en\s+passant\s+par)\s+([\w\u00C0-\u024F]+(?:\s+[\w\u00C0-\u024F]+){0,3})(?=\s|[,.]|$)/i,
    // Italian: "con scalo a Roma", "passando per Zurigo"
    /\b(?:con\s+scalo\s+(?:a|in)|passando\s+per)\s+([\w\u00C0-\u024F]+(?:\s+[\w\u00C0-\u024F]+){0,3})(?=\s|[,.]|$)/i,
    // Dutch: "met tussenstop in Amsterdam", "met een overstap in"
    /\bmet\s+(?:een?\s+)?(?:tussenstop|overstap|transfer)\s+(?:in|te)\s+([\w\u00C0-\u024F]+(?:\s+[\w\u00C0-\u024F]+){0,3})(?=\s|[,.]|$)/i,
    // Polish: "z przesiadką w Warszawie", "przez Dubaj"
    /\b(?:z\s+(?:przesiadką|przesiadka|postoj(?:em)?)\s+w|przez)\s+([\w\u00C0-\u024F]+(?:\s+[\w\u00C0-\u024F]+){0,3})(?=\s|[,.]|$)/i,
    // Portuguese: "com escala em Lisboa", "passando por Doha"
    /\b(?:com\s+escala\s+em|passando\s+por)\s+([\w\u00C0-\u024F]+(?:\s+[\w\u00C0-\u024F]+){0,3})(?=\s|[,.]|$)/i,
    // Swedish: "med mellanlandning i Stockholm"
    /\bmed\s+(?:mellanlandning|stopp|anslutning)\s+i\s+([\w\u00C0-\u024F]+(?:\s+[\w\u00C0-\u024F]+){0,3})(?=\s|[,.]|$)/i,
  ]

  let viaCityRawMatch: RegExpMatchArray | null = null
  for (const _vp of _viaPatterns) {
    const _vm = q.match(_vp)
    if (_vm) { viaCityRawMatch = _vm; break }
  }

  let outboundForParsing = outboundRaw

  // ── Normalize CJK directional markers to Latin "X to Y" so the route regex applies ──
  // JA: "東京からバルセロナへ" / "...まで" → "東京 to バルセロナ"
  // ZH: "北京到巴塞罗那" / "从北京到巴塞罗那" → "北京 to 巴塞罗那"
  // KO: "서울에서 바르셀로나로" / "...까지" → "서울 to 바르셀로나"
  outboundForParsing = outboundForParsing
    .replace(/^\s*(?:从|從)\s*/u, '')
    .replace(/([\p{L}\p{N} ]+?)から([\p{L}\p{N} ]+?)(?:へ|まで)/gu, '$1 to $2')
    .replace(/([\p{L}\p{N} ]+?)(?:到|至)([\p{L}\p{N} ]+)/gu, '$1 to $2')
    .replace(/([\p{L}\p{N} ]+?)에서\s*([\p{L}\p{N} ]+?)(?:로|으로|까지)/gu, '$1 to $2')

  // ── Strip leading multilingual filler prefixes ("Cheap flights from", "Vols pas chers de",
  //    "Voli economici da", "Voos baratos de", "Goedkope vluchten van", "Najtańsze bilety z",
  //    "Günstige Flüge von", "Billiga flyg från", "Jeftini letovi iz", "Fluturime të lira nga",
  //    "Lot z" — all reduce to just the connector preposition so the route regex can fire.
  outboundForParsing = outboundForParsing.replace(
    /^(?:cheap(?:est)?\s+(?:flights?|tickets?|fares?)|vols?\s+(?:pas\s+chers?|bon\s+march[eé]|[ée]conomiques?)|voli\s+(?:economic[oai]|a\s+basso\s+costo)|voos\s+(?:baratos|econ[oô]micos)|goedkope\s+vluchten|najta[nń]sze\s+(?:bilety|loty|przeloty)|tanie\s+(?:bilety|loty|przeloty)|g[üu]nstig(?:e|ste)\s+fl[üu]ge|billig(?:a|aste)?\s+flyg|jeftini\s+letovi|fluturime\s+t[ëe]\s+lir[ëe]a?|vuelos\s+barat[oa]s|loty|lot)\s+(?=(?:from|von|ab|aus|desde|de|depuis|da|uit|van|vanaf|vanuit|z|ze|fr[åa]n|iz|nga)\b)/i,
    ''
  )

  if (viaCityRawMatch) {
    const viaCityRaw = (viaCityRawMatch[viaCityRawMatch.length - 1] ?? '').trim()
    // Try progressively shorter prefixes to find the best city match
    // ("Hong Kong International" → tries "Hong Kong International", "Hong Kong", "Hong" → resolves on "Hong Kong")
    const _viaWords = viaCityRaw.split(/\s+/)
    for (let _vl = _viaWords.length; _vl >= 1; _vl--) {
      const cand = _viaWords.slice(0, _vl).join(' ')
      const viaResolved = resolveLocation(cand)
      if (viaResolved) {
        result.via_iata = viaResolved.code
        result.via_name = viaResolved.name
        // Strip the entire via clause so the city parser won't absorb it as destination
        outboundForParsing = outboundRaw.replace(viaCityRawMatch[0], ' ').replace(/\s{2,}/g, ' ').trim()
        break
      }
    }
  }

  // ── 1c. Layover duration extraction ──────────────────────────────────────
  // Fires when via city was found OR when any stopover/transfer keyword appears.
  // Checks in priority order: explicit min/max constraints → numeric ranges →
  // approximate singles → named ("overnight", "a day", "half a day", etc.) →
  // qualitative ("long layover", "short connection").
  const _hasLayoverKw = /\b(?:layover|stopover|stop[- ]over|transit|connection|transfer)\b/i.test(q)
  if (result.via_iata || _hasLayoverKw) {
    // ── P1: Explicit minimum constraint ──────────────────────────────────────
    // "at least 6 hours", "minimum 8 hours", "6 hours minimum", "6+ hours", "at least 2 days"
    const _minHr  = q.match(/\b(?:at\s+least|minimum|min\.?|no\s+less\s+than)\s+(\d+)\s*h(?:ours?|rs?)?/i)
    const _minDay = q.match(/\b(?:at\s+least|minimum|min\.?|no\s+less\s+than)\s+(\d+)\s*days?\b/i)
    const _minSuf = q.match(/\b(\d+)\s*h(?:ours?|rs?)?\s+(?:minimum|min\.?|or\s+more|plus)\b/i)
    const _minPlus = q.match(/\b(\d+)\+\s*h(?:ours?|rs?)?\b/i)
    // ── P2: Explicit maximum constraint ──────────────────────────────────────
    // "no more than 3 hours", "under 4 hours", "at most 5 hours", "max 6 hours", "less than 3 hours", "up to 2 hours"
    const _maxHr  = q.match(/\b(?:at\s+most|no\s+more\s+than|less\s+than|under|maximum|max\.?|up\s+to|no\s+longer\s+than)\s+(\d+)\s*h(?:ours?|rs?)?/i)
    const _maxDay = q.match(/\b(?:at\s+most|no\s+more\s+than|less\s+than|under|maximum|max\.?|up\s+to)\s+(\d+)\s*days?\b/i)
    const _maxSuf = q.match(/\b(\d+)\s*h(?:ours?|rs?)?\s+(?:maximum|max\.?|or\s+less)\b/i)
    // ── P3: Numeric hour range ────────────────────────────────────────────────
    // "6-8 hours", "6 to 8 hours", "between 6 and 8 hours"
    const _hrRange = q.match(/\b(\d+)\s*[-–]\s*(\d+)\s*h(?:ours?|rs?)?(?:\s*(?:layover|stopover|transit|connection|transfer|stop))?\b/i)
      ?? q.match(/\b(\d+)\s+to\s+(\d+)\s*h(?:ours?|rs?)?(?:\s*(?:layover|stopover|transit|connection|transfer|stop))?\b/i)
      ?? q.match(/\bbetween\s+(\d+)\s+and\s+(\d+)\s*h(?:ours?|rs?)?\b/i)
    // ── P4: Numeric day range ─────────────────────────────────────────────────
    // "1-2 days", "2 to 3 days", "between 1 and 3 days"
    const _dayRange = q.match(/\b(\d+)\s*[-–]\s*(\d+)\s*days?\b/i)
      ?? q.match(/\b(\d+)\s+to\s+(\d+)\s*days?\b/i)
      ?? q.match(/\bbetween\s+(\d+)\s+and\s+(\d+)\s*days?\b/i)
    // ── P5: Approximate single hours — "about 6 hours", "roughly 8 hours" ────
    const _approxHr = q.match(/\b(?:about|around|roughly|approximately|~)\s+(\d+)\s*h(?:ours?|rs?)\b/i)
    // ── P6: Exact single hours (requires stopover context word) ──────────────
    // "6 hour layover", "8 hours stopover", "layover of 6 hours"
    const _exactHr = q.match(/\b(\d+)\s*h(?:ours?|rs?)?\s+(?:layover|stopover|stop|connection|transfer|transit)\b/i)
      ?? q.match(/\b(?:layover|stopover|stop|connection|transfer|transit)\s+(?:of\s+)?(\d+)\s*h(?:ours?|rs?)?\b/i)
    // ── P7: Single day count (with explicit layover context or spend context) ─
    // "2 day layover", "3 days stopover", "spend 3 days"
    const _dayCount = q.match(/\b(\d+)[- ]?(?:full\s+)?days?\s+(?:layover|stopover|connection|transfer|stop)\b/i)
      ?? q.match(/\bspend(?:ing)?\s+(\d+)\s*days?\b/i)

    // ── Apply by priority ─────────────────────────────────────────────────────
    if (_minHr || _minDay || _minSuf || _minPlus) {
      if (_minHr)   result.min_layover_hours = parseInt(_minHr[1], 10)
      else if (_minDay) result.min_layover_hours = parseInt(_minDay[1], 10) * 24
      else if (_minSuf) result.min_layover_hours = parseInt(_minSuf[1], 10)
      else if (_minPlus) result.min_layover_hours = parseInt(_minPlus[1], 10)
      // Max can coexist with min
      if (_maxHr)   result.max_layover_hours = parseInt(_maxHr[1], 10)
      else if (_maxDay) result.max_layover_hours = parseInt(_maxDay[1], 10) * 24
      else if (_maxSuf) result.max_layover_hours = parseInt(_maxSuf[1], 10)
    } else if (_maxHr || _maxDay || _maxSuf) {
      if (_maxHr)   result.max_layover_hours = parseInt(_maxHr[1], 10)
      else if (_maxDay) result.max_layover_hours = parseInt(_maxDay[1], 10) * 24
      else if (_maxSuf) result.max_layover_hours = parseInt(_maxSuf[1], 10)
    } else if (_hrRange) {
      result.min_layover_hours = parseInt(_hrRange[1], 10)
      result.max_layover_hours = parseInt(_hrRange[2], 10)
    } else if (_dayRange) {
      result.min_layover_hours = parseInt(_dayRange[1], 10) * 24
      result.max_layover_hours = parseInt(_dayRange[2], 10) * 24
    } else if (_approxHr) {
      const h = parseInt(_approxHr[1], 10)
      result.min_layover_hours = Math.max(0, h - 3)
      result.max_layover_hours = h + 3
    } else if (_exactHr) {
      const h = parseInt(_exactHr[1], 10)
      result.min_layover_hours = Math.max(0, h - 2)
      result.max_layover_hours = h + 4
    } else if (_dayCount) {
      const d = parseInt(_dayCount[1], 10)
      result.min_layover_hours = Math.round((d - 0.5) * 24)
      result.max_layover_hours = Math.round((d + 0.5) * 24)
    } else if (/\b(?:a\s+)?(?:long\s+)?week[- ]?end\s*(?:layover|stopover|stop|there)?\b/i.test(q)) {
      // "a long weekend", "weekend layover"
      result.min_layover_hours = 48
      result.max_layover_hours = 78
    } else if (/\b(?:a\s+)?(?:couple\s+of|two)\s+days?\b/i.test(q)) {
      // "a couple of days", "two days"
      result.min_layover_hours = 36
      result.max_layover_hours = 60
    } else if (/\b(?:a\s+)?(?:few|several)\s+days?\b/i.test(q)) {
      // "a few days", "several days"
      result.min_layover_hours = 48
      result.max_layover_hours = 96
    } else if (
      /\b(?:a|one|1|full|whole|entire)\s*(?:full\s+)?day(?:\s+(?:layover|stopover|stop|connection|transit))?\b/i.test(q) ||
      /\ball[\s-]day\b/i.test(q) ||
      /\b(?:explore\s+for\s+(?:a\s+)?day|spend\s+(?:a|the)\s+day(?:\s+there)?|day[\s-](?:layover|stopover|trip|stop))\b/i.test(q)
    ) {
      // "a full day", "all day", "spend the day there"
      result.min_layover_hours = 16
      result.max_layover_hours = 28
    } else if (/\bhalf[- ]?(?:a[- ]?)?day\b/i.test(q)) {
      // "half a day", "half-day stopover"
      result.min_layover_hours = 10
      result.max_layover_hours = 16
    } else if (/\b(?:a\s+)?(?:few|couple\s+of)\s+hours?\b/i.test(q) || /\bsome\s+hours?\b/i.test(q)) {
      // "a few hours", "couple of hours"
      result.min_layover_hours = 2
      result.max_layover_hours = 7
    } else if (/\bseveral\s+hours?\b/i.test(q)) {
      result.min_layover_hours = 3
      result.max_layover_hours = 10
    } else if (/\b(?:a\s+)?couple\s+of\s+nights?\b/i.test(q) || /\btwo\s+nights?\b/i.test(q)) {
      // "a couple of nights"
      result.min_layover_hours = 24
      result.max_layover_hours = 48
    } else if (/\b(\d+)\s+nights?\b/i.test(q)) {
      const _nm = q.match(/\b(\d+)\s+nights?\b/i)!
      const n = parseInt(_nm[1], 10)
      result.min_layover_hours = Math.max(6, Math.round(n * 14))
      result.max_layover_hours = Math.round((n + 1) * 16)
    } else if (/\bovernight\b/i.test(q) || /\ba\s+night(?:\s+(?:there|over|layover|stopover))?\b/i.test(q)) {
      // "overnight", "a night there"
      result.min_layover_hours = 8
      result.max_layover_hours = 20
    } else if (/\b(?:long(?:est)?|very\s+long|extended|lengthy|substantial|as\s+long\s+as\s+possible|longest\s+possible)\s*(?:possible\s+)?(?:layover|stopover|connection|transit|stop|transfer)?\b/i.test(q)) {
      // "longest possible layover", "very long stopover", "extended connection"
      result.min_layover_hours = 8
      // no max — user wants as long as possible
    } else if (/\b(?:short(?:est)?|quick(?:est)?|brief|minimal?|as\s+short\s+as\s+possible|as\s+quick\s+as\s+possible)\s*(?:possible\s+)?(?:layover|stopover|connection|transit|transfer|stop)\b/i.test(q)) {
      // "short layover", "quickest connection", "minimal stopover"
      result.max_layover_hours = 4
    }
  }

  // ── 2. Extract cities from outbound part ─────────────────────────────────
  // Strip trailing passenger-context phrases ("for a couple", "for two", "en pareja",
  // "zu zweit", "in coppia", etc.) BEFORE route parsing so they can't be mistaken
  // for a route separator. The English "X a Y" route pattern uses [àa] as a
  // separator and would otherwise treat "buenos aires for a couple" as
  // origin="buenos aires for", separator="a", destination="couple".
  // extractPassengers still runs on the original cleaned query (`q`) so the
  // passenger context is preserved.
  // We work on a normalized (lowercase + accent-stripped) copy to find the match
  // index, then slice the original text — stripAccents() preserves character length
  // for all European/CJK scripts we support.
  const _normForStrip = stripAccents(outboundForParsing.toLowerCase())
  // Passenger suffix patterns, all 14 languages we support (EN/DE/ES/FR/IT/NL/PL/PT/SV/HR/SQ/JA/RU/KO).
  // Anchored to end of string with optional "with N passengers" / "for a family of N" phrasing.
  const PASSENGER_SUFFIX_RE = new RegExp(
    '(?:^|\\s+)(?:' +
    // EN
    'for\\s+(?:a\\s+|the\\s+)?(?:couple|two\\s+of\\s+us|two|2|three|3|four|4|five|5|six|6|family|kids?|children|us|me\\s+and\\s+(?:my\\s+)?(?:wife|husband|partner|girlfriend|boyfriend|kids?|family|son|daughter|friends?|colleagues?|mum|mom|dad|parents?))' +
    '|with\\s+(?:my\\s+)?(?:wife|husband|partner|girlfriend|boyfriend|family|kids?|children|fiancee?|spouse)' +
    '|as\\s+a\\s+(?:couple|family|group)' +
    '|just\\s+(?:the\\s+)?(?:two|2)\\s+of\\s+us' +
    '|on\\s+(?:my|our)\\s+(?:honeymoon|anniversary)' +
    '|date\\s+(?:night|trip|flight)' +
    // DE
    '|fu?r\\s+(?:eine|einen|zwei|drei|vier|2|3|4|5)\\s*(?:personen?|erwachsene?|kinder?|leute)?' +
    '|zu\\s+zweit|zu\\s+dritt|zu\\s+viert|als\\s+paar|als\\s+familie|mit\\s+(?:meiner|meinem)\\s+(?:frau|mann|partnerin|partner|freundin|freund|familie|kinder?|tochter|sohn|eltern)' +
    // ES
    '|para\\s+(?:dos|tres|cuatro|cinco|seis|2|3|4|5|6)(?:\\s+personas?|\\s+adultos?)?' +
    '|en\\s+pareja|en\\s+familia|con\\s+mi\\s+(?:pareja|esposa|esposo|novia|novio|marido|mujer|familia|hij[oa]s?|padres?)' +
    '|somos\\s+(?:dos|tres|cuatro|2|3|4)' +
    // FR
    '|pour\\s+(?:deux|trois|quatre|cinq|2|3|4|5)(?:\\s+personnes?|\\s+adultes?)?' +
    '|en\\s+couple|en\\s+famille|avec\\s+(?:ma|mon)\\s+(?:femme|mari|partenaire|copine|copain|compagne|compagnon|famille|enfants?|fille|fils|parents?|amie?s?)' +
    '|nous\\s+sommes\\s+(?:deux|trois|quatre|2|3|4)' +
    // IT
    '|per\\s+(?:due|tre|quattro|cinque|2|3|4|5)(?:\\s+persone?|\\s+adulti)?' +
    '|in\\s+coppia|in\\s+famiglia|con\\s+(?:mia|mio)\\s+(?:moglie|marito|ragazza|ragazzo|compagna|compagno|famiglia|figli[oa]?|genitori|amici?)' +
    '|siamo\\s+in\\s+(?:due|tre|quattro|2|3|4)' +
    // NL
    '|voor\\s+(?:twee|drie|vier|vijf|2|3|4|5)(?:\\s+personen?|\\s+volwassenen?)?' +
    '|met\\s+(?:zn?|z\'n|ons)\\s+(?:tweeen|drieen|vieren|tweeën|drieën)' +
    '|als\\s+(?:koppel|stel|gezin)|met\\s+mijn\\s+(?:vrouw|man|partner|vriendin|vriend|gezin|kinderen|familie|dochter|zoon|ouders)' +
    '|wij\\s+zijn\\s+met\\s+(?:tweeen|drieen|vieren|2|3|4)' +
    // PL
    '|dla\\s+(?:dwojga|trojga|czworga|2|3|4)(?:\\s+os[oó]b)?' +
    '|we\\s+dwoje|we\\s+troje|jako\\s+para|jako\\s+rodzina|z\\s+(?:moj[aą]|moim)\\s+(?:[zż]on[aą]|m[eę][zż]em|partner[kt][aą]?|dziewczyn[aą]|chlopak(?:iem)?|chłopak(?:iem)?|rodzin[aą]|dzie[ćc]mi|c[oó]rk[aą]|synem|rodzicami)' +
    // PT
    '|para\\s+(?:dois|duas|tr[eê]s|quatro|cinco|2|3|4|5)(?:\\s+pessoas?|\\s+adultos?)?' +
    '|em\\s+casal|em\\s+fam[ií]lia|com\\s+(?:minha|meu)\\s+(?:esposa|esposo|namorada|namorado|companheira|companheiro|fam[ií]lia|filh[oa]s?|pais)' +
    '|somos\\s+(?:dois|duas|tr[eê]s|2|3|4)' +
    // SV
    '|fo?r\\s+(?:tva?|tre|fyra|fem|2|3|4|5)(?:\\s+personer?|\\s+vuxna?)?' +
    '|som\\s+(?:par|familj)|med\\s+min\\s+(?:fru|man|partner|flickv[aä]n|pojkv[aä]n|familj|barn|dotter|son|f[oö]r[aä]ldrar)' +
    '|vi\\s+a?r\\s+(?:tva?|tre|fyra|2|3|4)' +
    // HR
    '|za\\s+(?:dvoje|troje|cetvero|četvero|2|3|4)(?:\\s+osoba)?' +
    '|kao\\s+par|kao\\s+obitelj|s\\s+(?:mojom|mojim)\\s+(?:zenom|ženom|muzem|mužem|partnericom|partnerom|djevojkom|deckom|dečkom|obitelji|djecom|kceri|kćeri|sinom|roditeljima)' +
    '|nas\\s+je\\s+(?:dvoje|troje|cetvero|četvero|2|3|4)' +
    // SQ
    '|per\\s+(?:dy|tre|kater|katër|pese|pesë|2|3|4|5)(?:\\s+persona|\\s+te?\\s+rritur|\\s+të\\s+rritur)?' +
    '|si\\s+(?:cift|çift|familje)|me\\s+(?:bashkeshorten|bashkëshorten|bashkeshortin|bashkëshortin|partneren|partnerin|familjen|femijet|fëmijët|vajzen|vajzën|djalin|prinderit|prindërit)' +
    '|jemi\\s+(?:dy|tre|kater|katër|2|3|4)' +
    // JA — "二人で", "家族で", "家族3人", "夫婦で", "カップルで"
    '|二人で|3人で|4人で|5人で|家族で?|夫婦で|カップルで|彼女と|彼氏と' +
    // RU — "вдвоём", "вдвоем", "с женой", "с мужем", "с семьёй", "семьёй", "парой"
    '|вдво[её]м|втро[её]м|вчетвером|с\\s+жен(?:ой|ою)|с\\s+муж(?:ем)|с\\s+семь[её]й|сем[её]й|парой|как\\s+пара|с\\s+девушкой|с\\s+парнем|с\\s+партн[её]ром' +
    // KO — "둘이서", "가족과", "신혼여행", "남편과", "아내와", "여자친구와"
    '|둘이서|셋이서|가족과(?:\\s*함께)?|신혼여행|남편과|아내와|여자친구와|남자친구와|커플로' +
    ')\\b.*$',
    'iu',
  )
  const _suffixMatch = _normForStrip.match(PASSENGER_SUFFIX_RE)
  if (_suffixMatch && _suffixMatch.index !== undefined) {
    outboundForParsing = outboundForParsing.slice(0, _suffixMatch.index).trim()
  }
  // Bare passenger phrases with no city ("couple", "for couple", "two of us", "vdvoem", etc.)
  // — strip entirely so the UI prompts for cities instead of throwing a "couldn't find airport".
  const BARE_PASSENGER_RE = new RegExp(
    '^(?:(?:a|an|the|just|only|un|una|une|der|die|das|ein|eine|el|la|il|lo|os|as|en|ett|jen[ao]?|nje?)\\s+)?(?:' +
    'couple|two\\s+of\\s+us|two|2|three|3|four|4|family|kids?|children|us' +
    '|paar|familie|zwei|drei|vier|kinder|leute|personen?' +
    '|pareja|familia|dos|tres|cuatro|personas?|ni[ñn]os?' +
    '|couple|famille|deux|trois|quatre|personnes?|enfants?' +
    '|coppia|famiglia|due|tre|quattro|persone?|bambini?' +
    '|koppel|stel|gezin|tweeen|tweeën|drieen|drieën|kinderen' +
    '|para|rodzina|dwoje|troje|dzieci' +
    '|casal|fam[ií]lia|dois|duas|tr[eê]s|crian[çc]as?' +
    '|par|familj|tva?|tre|fyra|barn' +
    '|par|obitelj|dvoje|troje|djeca' +
    '|cift|çift|familje|dy|tre|kater|katër|f[eë]mij[eë]?' +
    '|二人|家族|夫婦|カップル' +
    '|пара|семья|двое|трое|вдво[её]м|втро[её]м' +
    '|커플|가족|둘|셋' +
    ')$',
    'iu',
  )
  if (BARE_PASSENGER_RE.test(_normForStrip.trim())) outboundForParsing = ''

  // Try multiple route separator patterns
  const routePatterns = [
    // "ORIGIN to DESTINATION"
    /^(.+?)\s+(?:to(?:\s+the)?|→|->|–)\s+(.+?)(?:\s+(?:on|in|for|at|around|circa|um|am|le|el|il|em|på|na)\s|\s+\d|\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|januar|février|fevrier|mars|abril|mayo|junio|julio|agosto|septembre|outubro|novembre)|$)/i,
    // "ORIGIN - DESTINATION" (dash as separator, not range)
    /^(.+?)\s+-\s+(.+?)(?:\s+\d|\s+(?:jan|feb|mar|may|jun|jul|aug|sep|oct|nov|dec)|$)/i,
    // "ORIGIN nach/para/à/naar/do/till/na/drejt/leti DESTINATION" — includes all 11 lang separators
    // DE: nach, von X nach Y | ES: para, desde X a/hasta Y | FR: à, pour, vers | IT: a, per, da X a Y
    // NL: naar, van X naar Y | PL: do, z X do Y | PT: para, de X para Y | SV: till, från X till Y
    // HR: do, od X do Y | SQ: drejt, nga X drejt Y | also: leti (hr "let"), fly
    /^(.+?)\s+(?:nach|para|[àa]|naar|do|till|na|drejt|leti|vers|pour|per|bis|i|ng[aë])\s+(.+?)(?:\s+\d|\s+(?:jan|feb|mar|may)|$)/i,
    // "von X nach Y" (DE), "from X to Y" already covered above
    /^(?:von|fra|från|od|iz|da|de)\s+(.+?)\s+(?:nach|till|do|na|a(?:\s+|$)|para)\s+(.+?)(?:\s+\d|\s+(?:jan|feb|mar|may)|$)/i,
    // "da X a Y" — Italian "from X to Y"
    /^(?:da)\s+(.+?)\s+(?:a|ad)\s+(.+?)(?:\s+\d|\s+(?:jan|feb|mar|may)|$)/i,
  ]

  // Reversed patterns: "to DEST from ORIGIN"
  const reversedRoutePatterns = [
    /^to\s+(.+?)\s+from\s+(.+?)(?:\s+(?:on|in|for|at|around)\s|\s+\d|$)/i,
    /^(?:flying|travelling?|heading|going|fly)\s+to\s+(.+?)\s+from\s+(.+?)(?:\s+(?:on|in|for)\s|\s+\d|$)/i,
    // DE: "nach X von Y", "nach X aus Y"
    /^nach\s+(.+?)\s+(?:von|aus)\s+(.+?)(?:\s+\d|\s+(?:jan|feb|mar|may)|$)/i,
    // ES: "a X desde Y", "para X desde Y"
    /^(?:a|para)\s+(.+?)\s+desde\s+(.+?)(?:\s+\d|\s+(?:jan|feb|mar|may)|$)/i,
    // FR: "à X depuis Y", "pour X depuis Y"
    /^(?:[àa]|pour)\s+(.+?)\s+depuis\s+(.+?)(?:\s+\d|\s+(?:jan|feb|mar|may)|$)/i,
    // IT: "a X da Y"
    /^(?:a|ad)\s+(.+?)\s+da\s+(.+?)(?:\s+\d|\s+(?:jan|feb|mar|may)|$)/i,
    // NL: "naar X vanuit Y"
    /^naar\s+(.+?)\s+vanuit?\s+(.+?)(?:\s+\d|\s+(?:jan|feb|mar|may)|$)/i,
    // SV: "till X från Y"
    /^till\s+(.+?)\s+från\s+(.+?)(?:\s+\d|\s+(?:jan|feb|mar|may)|$)/i,
    // HR: "do X od Y" / "do X iz Y"
    /^do\s+(.+?)\s+(?:od|iz)\s+(.+?)(?:\s+\d|\s+(?:jan|feb|mar|may)|$)/i,
    // SQ: "drejt X nga Y"
    /^drejt\s+(.+?)\s+nga\s+(.+?)(?:\s+\d|\s+(?:jan|feb|mar|may)|$)/i,
  ]

  let originStr = '', destStr = ''
  for (const pat of routePatterns) {
    const m = outboundForParsing.match(pat)
    if (m) {
      originStr = m[1].trim()
      destStr = m[2].trim()
      break
    }
  }

  // If no forward route matched, try reversed "to DEST from ORIGIN" patterns
  if (!originStr && !destStr) {
    for (const pat of reversedRoutePatterns) {
      const m = outboundForParsing.match(pat)
      if (m) {
        destStr = m[1].trim()
        originStr = m[2].trim()
        break
      }
    }
  }

  // If still no match and query starts with "to <place>" (destination-only), extract dest
  if (!originStr && !destStr) {
    const destOnlyM = outboundForParsing.match(/^(?:to(?:\s+the)?)\s+(.+?)(?:\s+(?:on|in|for|at|around)\s|\s+\d|$)/i)
    if (destOnlyM) {
      destStr = destOnlyM[1].trim()
      // originStr stays empty — no origin provided
    }
  }

  // "flying out of X to Y", "departing from X to Y", "leaving X to Y" — alternative origin patterns
  if (!originStr) {
    const altOriginM = q.match(/\b(?:flying?\s+(?:out\s+of|from)|departing\s+(?:from)?|leaving\s+(?:from)?|going\s+from|setting\s+off\s+from|starting\s+(?:from|in))\s+([\w\u00C0-\u024F]+(?:\s+[\w\u00C0-\u024F]+){0,2})\b/i)
    if (altOriginM) {
      const alt = resolveLocation(altOriginM[1].trim())
      if (alt) {
        result.origin = alt.code
        result.origin_name = alt.name
        originStr = '' // already resolved
      }
    }
  }

  // Strip filler prefixes
  if (originStr) {
    originStr = originStr.replace(ORIGIN_PREFIX_RE, '').trim()
    // Also strip passenger-count phrases from origin (e.g. "2 adults 2 kids" in "2 adults 2 kids to Rome")
    originStr = originStr
      .replace(/^\d+\s+(?:adults?|erwachsene?|adultos?|adultes?|volwassene[n]?|dorosłych|adulti)\s*/gi, '')
      .replace(/^\d+\s+(?:children|child|kids?|enfants?|niños?|kinderen|dzieci|bambini)\s*/gi, '')
      .replace(/^\d+\s+(?:infants?|babies|baby|säuglinge?|bebés?|lactantes?|neonati)\s*/gi, '')
      .replace(/^(?:with\s+)?(?:my\s+|the\s+)?(?:wife|husband|partner|girlfriend|boyfriend|family|kids?|children)\s*/gi, '')
      .trim()
  }
  if (destStr) {
    // Stop destination string at common date lead-ins that weren't caught by the regex
    destStr = destStr
      // "next month" and multilingual equivalents must come first (before the next/this weekday rule)
      .replace(/\s+(?:next\s+month|nächsten?\s+monat|le\s+mois\s+prochain|el\s+(?:pr[oó]ximo\s+mes|mes\s+que\s+viene)|il\s+mese\s+prossimo|volgende\s+maand|n[aä]sta\s+m[aå]nad|sljedeći\s+miesięcu?|przyszłym?\s+miesiącu?|pr[oó]ximo\s+m[eê]s|muajin\s+e\s+ardhsh[eë]m|w\s+przyszłym\s+miesi[aą]cu)\b.*/i, '')
      .replace(/\s+(?:(?:next|this|ten|tego|t[ęe]|ta)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|vikend|helg|wochenende|fin\s+de\s+semana|week[-\s]?end|fine\s+settimana|weekeinde)|(?:the\s+week\s+of\s+thanksgiving|thanksgiving\s+week|thanksgiving))\b.*/i, '')
      // Strip Polish departure/arrival keywords absorbed into destStr (e.g. "Barcelony wyjazd piątek")
      .replace(/[,\s]+(?:wyjazd|wylot|odlot|powrót|przylot|lot\s+powrotny)\b.*/i, '')
      .replace(/\s+(?:on|in|for|at|around|circa|um|am|le|el|il|em|på|na|dne|dia|den|am|op|den|kl)\s.*/i, '')
      .replace(/\s+\d{1,2}(?:st|nd|rd|th)?\s.*/i, '')
      // Strip trailing multilingual passenger-count clause ("Rzymu dla dwóch osób",
      // "Buenos Aires para um casal", "Marrakech pour une famille", "Tokyo per due persone")
      .replace(/[,\s]+(?:dla|para|pour|f[üu]r|voor|f[oö]r|za|p[eë]r|per|with|met|com|mit|avec|con)\s+(?:un[ae]?|uma?|une?|ein[se]?|en|ett|jed[na]u?|nj[eë]|el|la|il|los|las|le|les|de|os|as|i|gli|den|det|ten|to|tw[oa]|the)?\s*(?:\d+|dwojga|dw[oó]ch|dw[ae]|trzech|trojga|czterech|pi[ęe]ciu|dos|tres|cuatro|cinco|deux|trois|quatre|cinq|due|tre|quattro|cinque|twee|drie|vier|vijf|dois|duas|tr[eê]s|cinco|dvoje|troje|dvije|tri|dy|tre|kat[ëe]r|pes[ëe]|persona|personas?|persone|personnes?|personen?|pessoas?|os[oó]b|osoba|leute|gente|family|familia|fam[í]lia|famille|famiglia|gezin|familje|obitelj|familj|couple|coppia|pareja|casal|paar|p[äa]rchen|koppel|stel|cift|çift|par|rodzin[ya])\b.*/iu, '')
      // Trailing dangling preposition (e.g. route regex captured "Barcelone le" because
      // it stopped at "\\s+\\d" boundary before the date number).
      .replace(/\s+(?:on|in|for|at|le|el|il|em|am|den|dia|na|op|po|um|på|w|do|de|di|dla|para|pour|f[üu]r|voor|f[oö]r|za|p[eë]r)\s*$/i, '')
      // Strip trailing time-position modifiers left over when the month name was consumed
      // by the route-regex lookahead (e.g. "Houston end of" ← "Grand Rapids to Houston end of May")
      .replace(/\s+(?:end|beginning|start|late|early|mid(?:dle)?)(?:\s+of)?\s*$/i, '')
      // Strip "fly out Thursday morning" / "fly back Sunday" suffixes that got absorbed into destStr
      .replace(/[,\s]+fly(?:ing)?\s+(?:out|back|return(?:ing)?)\b.*/i, '')
      // Strip numeric date expressions (e.g. "10.01 10.07", "7/3") that were not caught above
      .replace(/[,\s]+\d{1,2}[./]\d{1,2}(?:[,\s]+\d{1,2}[./]\d{1,2})?.*/i, '')
      // Strip trailing airport-name words so "Ho Chi Minh City Tan Son Nhat International Airport"
      // resolves to the city and not a token inside the airport name
      .replace(/\s+(?:international\s+)?(?:airport|intl\.?)\s*$/i, '')
      .replace(DEST_PREFIX_RE, '')
      .trim()
  }

  // If originStr still looks like a trip-type phrase (not a real place), discard it silently
  // so we don't set failed_origin_raw for "business trip to London" type queries.
  const TRIP_TYPE_ORIGIN_RE = /^(?:(?:my\s+|the\s+|a\s+)?(?:family|business|solo|group|work|corporate|ski(?:ing)?|beach|sun|city|honeymoon|romantic|anniversary|graduation|school|stag|hen|bachelorette|hen\s+do|girls?(?:'s?)?\s+trip|guys?(?:'s?)?\s+trip|holiday|summer|winter|spring|autumn|christmas|easter|new\s+year(?:'s)?)\s+)?(?:trip|flight|flights?|holiday|vacation|getaway|break|journey|travel|routes?|booking|tickets?)$/i
  if (originStr && TRIP_TYPE_ORIGIN_RE.test(originStr)) originStr = ''

  // Strip trailing punctuation that the route-regex terminator leaves behind
  // (e.g. destStr "warsaw paris," after "next month" was trimmed off).
  if (originStr) originStr = originStr.replace(/[\s,;:.\-—–]+$/u, '').trim()
  if (destStr) destStr = destStr.replace(/[\s,;:.\-—–]+$/u, '').trim()

  // Duplicate-origin typo guard: when the user accidentally repeats the origin
  // inside the destination ("from warsaw to warsaw paris"), the lazy route
  // regex captures origin="warsaw", dest="warsaw paris". If destStr starts with
  // originStr as a whole word AND the remainder resolves to a real city, drop
  // the duplicated prefix so we end up with origin=WAW, destination=PAR
  // instead of failing destination resolution entirely.
  if (originStr && destStr) {
    const dupRe = new RegExp(
      '^' + originStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b[\\s,;:.-]*',
      'i',
    )
    if (dupRe.test(destStr)) {
      const remainder = destStr.replace(dupRe, '').trim()
      if (remainder && resolveLocation(remainder)) {
        destStr = remainder
      }
    }
  }

  // Resolve cities. On failure, attach top fuzzy candidates so the UI can show
  // "did you mean?" chips. findCityCandidates is only called on the cold path —
  // resolveLocation already handles single-typo fuzzy matching internally.
  if (originStr) {
    const r = resolveLocation(originStr)
    if (r) { result.origin = r.code; result.origin_name = r.name }
    else {
      result.failed_origin_raw = originStr
      const cands = findCityCandidates(originStr, 4)
      if (cands.length > 0) result.origin_candidates = cands
    }
  }

  if (destStr) {
    const r = resolveLocation(destStr)
    if (r) { result.destination = r.code; result.destination_name = r.name }
    else {
      result.failed_destination_raw = destStr
      const cands = findCityCandidates(destStr, 4)
      if (cands.length > 0) result.destination_candidates = cands
    }
  }

  // ── 2b. Two-city fallback: no separator, no route match ─────────────────────
  // Handles bare city-pair queries: "Stuttgart Gdansk", "Berlin Rome June", etc.
  // Use outboundForParsing (already had passenger phrases stripped) when it differs
  // from the original query, so "Paris en couple" / "Stockholm för två" etc. fall
  // through to the single-city fallback with the connector words gone.
  //
  // Also fires when ONLY ONE side resolved — covers cases like "Paris Rome" or
  // "Hong Kong Singapore" where an upstream single-city resolver greedily matched
  // a substring (e.g. "Rome" out of "Paris Rome") and orphaned the other city.
  // In that case, if findTwoCitiesInText returns two distinct cities, we trust
  // the positional pair and overwrite the partial single-city resolution.
  const _hasOnlyOneSide = (!result.origin) !== (!result.destination)
  if ((!result.origin && !result.destination && !result.anywhere_destination) || _hasOnlyOneSide) {
    const _baseForFallback = (outboundForParsing && outboundForParsing.length > 0 && outboundForParsing.length < ql.length)
      ? outboundForParsing.toLowerCase()
      : ql
    const cleaned = _baseForFallback
      .replace(/\b\d{4}\b/g, ' ')
      .replace(/\b\d{1,2}(?:st|nd|rd|th)?\b/g, ' ')
      .replace(/\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/gi, ' ')
      .replace(/\b(?:januar|februar|m(?:ae|ä)rz|mai|juni|juli|oktober|dezember|avril|mayo|junio|julio|agosto|enero|diciembre)\b/gi, ' ')
      .replace(/\b(?:next|this|in|on|for|at|around|under|below|over|above|max|budget|up|to|less|than)\b/gi, ' ')
      .replace(/\b(?:weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, ' ')
      // Strip passenger-context tokens + multilingual connectors left over after the
      // suffix strip ("paris en couple" → "paris en" → "paris"; "amsterdam met zn tweeen"
      // → "amsterdam met zn"; "stockholm för två" → "stockholm").
      // EN: a/an/the/of/and/with + passenger words; DE: für/mit/und/zu/als + passenger;
      // ES: en/con/para/y/de + passenger; FR: en/avec/pour/et/de + passenger;
      // IT: in/con/per/e/di + passenger; NL: met/voor/en/van + passenger;
      // PL: dla/we/z/i + passenger; PT: em/com/para/e/de + passenger;
      // SV: för/med/och/som + passenger; HR: za/s/i + passenger; SQ: për/me/si/dhe + passenger.
      .replace(/\b(?:a|an|the|of|and|with|as|just|only|en|con|para|por|y|de|in|met|voor|als|zn|z'n|ons|mit|fur|für|zu|und|dla|we|z|em|com|fo?r|för|med|som|och|za|s|si|me|per|dhe|but|or|on|to|from|nach|para|naar|do|till|na|drejt|leti|vers|pour|bis)\b/gi, ' ')
      .replace(/\b(?:couple|two|three|four|five|six|family|kids?|children|adults?|us|me|my|our|wife|husband|partner|girlfriend|boyfriend|son|daughter|friends?|colleagues?|paar|familie|zwei|drei|vier|funf|fünf|kinder|leute|personen?|frau|mann|partnerin|freundin|freund|kind|tochter|sohn|pareja|familia|dos|tres|cuatro|cinco|personas?|ni[ñn]os?|esposa|esposo|novia|novio|marido|mujer|hij[oa]s?|padres?|famille|deux|trois|quatre|cinq|personnes?|enfants?|femme|mari|partenaire|copine|copain|compagne|compagnon|fille|fils|parents?|amie?s?|coppia|famiglia|due|tre|quattro|persone?|bambini?|moglie|marito|ragazza|ragazzo|compagna|compagno|figli[oa]?|genitori|amici?|koppel|stel|gezin|tweeen|tweeën|drieen|drieën|kinderen|volwassenen?|vrouw|man|vriendin|vriend|dochter|zoon|ouders|rodzina|dwoje|troje|dzieci|os[oó]b|[zż]ona|m[aą]ż|partner|partnerka|c[oó]rka|syn|rodzice|casal|fam[ií]lia|dois|duas|cinco|pessoas?|crian[çc]as?|namorada|namorado|companheira|companheiro|filh[oa]s?|pais|par|familj|tva?|fyra|fem|barn|fru|flickv[aä]n|pojkv[aä]n|f[oö]r[aä]ldrar|obitelj|cetvero|četvero|djeca|osoba|zena|žena|muz|muž|partnerica|djevojka|decko|dečko|kceri?|kći|sin|roditelji|cift|çift|familje|dy|kater|katër|f[eë]mij[eë]?|persona|bashkeshorten|bashkëshorten|bashkeshortin|bashkëshortin|partneren|partnerin|familjen|femijet|fëmijët|vajzen|vajzën|djalin|prinderit|prindërit|honeymoon|anniversary|spouse|fianc[eé]e?|date|night|trip|flight|二人|三人|家族|夫婦|カップル|彼女|彼氏|пара|семья|двое|трое|вдво[её]м|втро[её]м|жена|муж|партн[её]р|커플|가족|둘|셋|남편|아내|여자친구|남자친구)\b/giu, ' ')
      .replace(/[$€£¥₹]\s*\d+|\b\d+\s*(?:dollars?|euros?|pounds?|usd|eur|gbp)\b/gi, ' ')
      .replace(/\s+/g, ' ').trim()
    const pair = findTwoCitiesInText(cleaned)
    if (pair && pair[0].code !== pair[1].code) {
      result.origin = pair[0].code
      result.origin_name = pair[0].name
      result.destination = pair[1].code
      result.destination_name = pair[1].name
      // Clear partial-single-city failure markers if we recovered both sides.
      delete (result as { failed_origin_raw?: string }).failed_origin_raw
      delete (result as { failed_destination_raw?: string }).failed_destination_raw
      delete (result as { origin_candidates?: unknown }).origin_candidates
      delete (result as { destination_candidates?: unknown }).destination_candidates
    } else if (!result.origin && !result.destination) {
      // Single-city fallback: "guadalajara for two" → no route pattern fires
      // (no "to"/"a" separator), and findTwoCitiesInText needs two cities.
      // Try resolving the cleaned text as a single city — store as origin so the
      // home form's implicit-single-city-as-destination logic asks "where from?".
      if (cleaned.length >= 3) {
        const single = resolveCity(cleaned)
        if (single) {
          result.origin = single.code
          result.origin_name = single.name
        }
      }
    }
  }

  // ── 3. Date extraction helper ────────────────────────────────────────────
  function extractDate(text: string): string | undefined {
    const t = text.trim()
    const tl = stripAccents(t.toLowerCase())

    // ISO: 2026-05-15
    const isoM = t.match(/\b(\d{4}-\d{2}-\d{2})\b/)
    if (isoM) return isoM[1]

    // DD/MM/YYYY or DD.MM.YYYY or DD-MM-YYYY (European)
    const dmyM = t.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/)
    if (dmyM) {
      const [, d, m, y] = dmyM
      return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`
    }

    // DD/MM, DD.MM, or MM/DD (no year — assume current/next year)
    // For '/' separator with both numbers ≤12, prefer the interpretation that gives
    // the nearest future date — resolves US MM/DD vs European DD/MM ambiguity.
    // "7/3" from May 2026 → July 3 (MM/DD, 54 days) beats March 7 (DD/MM, 300 days).
    const dmM = t.match(/\b(\d{1,2})([./])(\d{1,2})\b/)
    if (dmM) {
      const a = parseInt(dmM[1]), sep = dmM[2], b = parseInt(dmM[3])
      const _tryD = (day: number, mon0: number): Date | null => {
        if (day < 1 || day > 31 || mon0 < 0 || mon0 > 11) return null
        const d = new Date(today.getFullYear(), mon0, day)
        if (d < today) d.setFullYear(today.getFullYear() + 1)
        return d
      }
      if (sep === '.') {
        // Dot separator is European DD.MM convention — but if DD.MM gives a past date
        // and MM.DD gives a nearer future date, prefer MM.DD (e.g. "10.01" on May 10
        // → Jan 10 is past/far-future 2027, but Oct 1 2026 is nearer).
        if (a > 12) {
          // a can't be a month → definitely DD.MM
          const d = _tryD(a, b - 1)
          if (d) return toLocalDateStr(d)
        } else if (b > 12) {
          // b can't be a month → definitely MM.DD (a=month, b=day)
          const d = _tryD(b, a - 1)
          if (d) return toLocalDateStr(d)
        } else {
          // Both ≤12: try DD.MM first (European convention), but fall back to MM.DD
          // if it gives a closer future date (avoids year-roll for "10.01" → Oct 1 not Jan 2027)
          const dDM = _tryD(a, b - 1)  // DD.MM
          const dMD = _tryD(b, a - 1)  // MM.DD
          if (dDM && dMD) return toLocalDateStr(dMD < dDM ? dMD : dDM)
          if (dDM) return toLocalDateStr(dDM)
          if (dMD) return toLocalDateStr(dMD)
        }
      } else {
        // Slash separator → possibly MM/DD (US) or DD/MM (EU)
        if (a > 12) {
          // First number can't be a month → must be DD/MM
          const d = _tryD(a, b - 1)
          if (d) return toLocalDateStr(d)
        } else if (b > 12) {
          // Second number can't be a month → must be MM/DD (a=month, b=day)
          const d = _tryD(b, a - 1)
          if (d) return toLocalDateStr(d)
        } else {
          // Both ≤12 — ambiguous: pick whichever gives the nearest future date
          const dDM = _tryD(a, b - 1)  // DD/MM: a=day, b=month
          const dMD = _tryD(b, a - 1)  // MM/DD: a=month, b=day
          if (dDM && dMD) return toLocalDateStr(dMD < dDM ? dMD : dDM)
          if (dMD) return toLocalDateStr(dMD)
          if (dDM) return toLocalDateStr(dDM)
        }
      }
    }

    // "15th May", "May 15", "15 mai", "le 15 mai", "am 15. mai", etc.
    // Build a token list and search for day+month in any order
    // First strip common lead-in / connective prepositions in dates across languages.
    // ES/PT "18 de julio", IT "il 18 di luglio", FR "le 18 de juillet", PL "dnia 18",
    // HR "dne 18.", DE "am 18.", NL "op 18", SV "den 18".
    const cleaned = tl
      .replace(/\b(?:on|le|am|el|il|em|dne|den|dia|på|na|the|de|di|del|do|od|od\s+dnia|op|the)\b/g, ' ')
      .replace(/(\d{1,2})\.\s/g, '$1 ')   // "18. srpnja" → "18 srpnja"
      .replace(/\s+/g,' ').trim()

    // Try: <number><ordinal?> <monthname>  or  <monthname> <number><ordinal?>
    // (?!\d) after the day digits prevents matching the first 1-2 digits of a year
    // (e.g. "2015" must not yield day=20 — it's a year, not a day)
    const dayMonthRe = /(\d{1,2})(?!\d)(?:st|nd|rd|th|er|ème|eme|º|ª|\.)?\.?\s+([a-zäöüčšžćđéèêëàâùûîïôœæñß]+)(?:\s*,?\s*(\d{4}))?/
    const monthDayRe = /([a-zäöüčšžćđéèêëàâùûîïôœæñß]+)\s+(\d{1,2})(?!\d)(?:st|nd|rd|th|er|ème|eme|º|ª|\.)?(?:\s*,?\s*(\d{4}))?/

    const dm = cleaned.match(dayMonthRe)
    if (dm) {
      const day = parseInt(dm[1])
      const mIdx = matchMonth(dm[2])
      if (mIdx !== null && day >= 1 && day <= 31) {
        const hasExplicitYear = Boolean(dm[3])
        const year = hasExplicitYear ? parseInt(dm[3]) : today.getFullYear()
        const d = new Date(year, mIdx, day)
        if (d < today) d.setFullYear(today.getFullYear() + 1)
        return toLocalDateStr(d)
      }
    }
    const md = cleaned.match(monthDayRe)
    if (md) {
      const mIdx = matchMonth(md[1])
      const day = parseInt(md[2])
      if (mIdx !== null && day >= 1 && day <= 31) {
        const hasExplicitYear = Boolean(md[3])
        const year = hasExplicitYear ? parseInt(md[3]) : today.getFullYear()
        const d = new Date(year, mIdx, day)
        if (d < today) d.setFullYear(today.getFullYear() + 1)
        return toLocalDateStr(d)
      }
    }

    // "end of May", "late May", "beginning of May", "early May", "mid May", "middle of May"
    // Also handles "end of next month", "early next month" etc.
    const modNextMonthRe = /\b(end\s+of|beginning\s+of|start\s+of|early|late|mid(?:dle\s+of)?)\s+next\s+month\b/i
    const mnmM = tl.match(modNextMonthRe)
    if (mnmM) {
      const mod = mnmM[1].replace(/\s+/g, ' ').trim().toLowerCase()
      const day = (mod === 'end of' || mod === 'late') ? 26
        : (mod === 'beginning of' || mod === 'start of' || mod === 'early') ? 5
        : 15
      const d = new Date(today.getFullYear(), today.getMonth() + 1, day)
      return toLocalDateStr(d)
    }

    const monthModRe = /\b(end\s+of|beginning\s+of|start\s+of|middle\s+of|early|late|mid(?:dle)?(?:\s+of)?)\s+([a-zäöüčšžćđéèêëàâùûîïôœæñß]+)(?:\s+(\d{4}))?\b/i
    const mmM = tl.match(monthModRe)
    if (mmM) {
      const mod = mmM[1].replace(/\s+/g, ' ').trim().toLowerCase()
      const mIdx = matchMonth(mmM[2])
      if (mIdx !== null) {
        const hasExplicitYear = Boolean(mmM[3])
        const year = hasExplicitYear ? parseInt(mmM[3]) : today.getFullYear()
        const day = (mod === 'end of' || mod === 'late') ? 26
          : (mod === 'beginning of' || mod === 'start of' || mod === 'early') ? 5
          : 15  // mid/middle of/middle
        const d = new Date(year, mIdx, day)
        if (!hasExplicitYear && d < today) d.setFullYear(today.getFullYear() + 1)
        return toLocalDateStr(d)
      }
    }

    // "Month YYYY" without preposition: "May 2015", "mai 2026", "mayo 2027"
    // Treat bare 4-digit year after month name as month-only; advance if in the past.
    const monthYearRe = /([a-zäöüčšžćđéèêëàâùûîïôœæñß]+)\s+(\d{4})\b/
    const myM = cleaned.match(monthYearRe)
    if (myM) {
      const mIdx = matchMonth(myM[1])
      const year = parseInt(myM[2])
      if (mIdx !== null) {
        const d = new Date(year, mIdx, 1)
        if (d < today) d.setFullYear(today.getFullYear() + 1)
        result.date_month_only = true
        return toLocalDateStr(d)
      }
    }

    // Month-only: "in May", "im Mai", "en mayo", "en juin"
    // → default to 1st of that month
    const monthOnlyRe = /(?:in|im|en|em|i|na|vo|à|au)\s+([a-zäöüčšžćđéèêëàâùûîïôœæñß]+)(?:\s+(\d{4}))?/
    const moM = tl.match(monthOnlyRe)
    if (moM) {
      const mIdx = matchMonth(moM[1])
      if (mIdx !== null) {
        const hasExplicitYear = Boolean(moM[2])
        const year = hasExplicitYear ? parseInt(moM[2]) : today.getFullYear()
        const d = new Date(year, mIdx, 1)
        if (!hasExplicitYear && d < today) d.setFullYear(today.getFullYear() + 1)
        result.date_month_only = true
        return toLocalDateStr(d)
      }
    }

    // "next month" and multilingual equivalents → 1st of next calendar month
    if (/\b(?:next\s+month|nächsten?\s+monat|le\s+mois\s+prochain|el\s+(?:pr[oó]ximo\s+mes|mes\s+que\s+viene)|il\s+mese\s+prossimo|volgende\s+maand|n[aä]sta\s+m[aå]nad|sljedeći\s+mjesec|przyszłym?\s+miesiącu?|pr[oó]ximo\s+m[eê]s|muajin\s+e\s+ardhsh[eë]m|w\s+przyszłym\s+miesi[aą]cu)\b/i.test(tl)) {
      const d = new Date(today.getFullYear(), today.getMonth() + 1, 1)
      return toLocalDateStr(d)
    }

    if (THANKSGIVING_WEEK_RE.test(tl)) {
      const thanksgiving = getUpcomingUsThanksgiving(today)
      const weekStart = new Date(thanksgiving)
      const mondayOffset = (thanksgiving.getDay() + 6) % 7
      weekStart.setDate(thanksgiving.getDate() - mondayOffset)
      return toLocalDateStr(weekStart)
    }

    if (THANKSGIVING_RE.test(tl)) {
      return toLocalDateStr(getUpcomingUsThanksgiving(today))
    }

    // Relative: "next friday", "nächsten montag", etc.
    if (REL_WEEKEND_RE.test(tl)) {
      // Next Saturday
      const d = new Date(today)
      const diff = (6 - today.getDay() + 7) % 7 || 7
      d.setDate(today.getDate() + diff)
      return toLocalDateStr(d)
    }

    const isNext = REL_DATE_NEXT_RE.test(tl)
    const isThis = REL_DATE_THIS_RE.test(tl)

    const stripped2 = stripAccents(tl)
    for (const [name, dayIdx] of WEEKDAY_MAP) {
      if (stripped2.includes(stripAccents(name))) {
        const d = new Date(today)
        let diff = (dayIdx - today.getDay() + 7) % 7
        if (diff === 0) diff = 7   // "this Monday" when today is Monday → next Monday
        if (isNext) diff = diff === 0 ? 7 : diff + (diff <= 0 ? 7 : 0)
        if (isThis && diff === 0) diff = 0  // today
        d.setDate(today.getDate() + diff)
        return toLocalDateStr(d)
      }
    }

    // "tomorrow" / "morgen" / "demain" / "mañana" / "domani" / "jutro" / "imorgon"
    if (/\b(?:tomorrow|morgen|demain|mañana|manana|domani|jutro|imorgon|nesër|nese|sutra)\b/i.test(t)) {
      const d = new Date(today)
      d.setDate(today.getDate() + 1)
      return toLocalDateStr(d)
    }

    // "in X days/weeks"
    const inXM = tl.match(/\bin\s+(\d+)\s+(?:days?|dag[ae]?n?|jours?|giorni?|dias?|dagar|dana|ditë|dite)\b/)
    if (inXM) {
      const d = new Date(today)
      d.setDate(today.getDate() + parseInt(inXM[1]))
      return toLocalDateStr(d)
    }
    const inXWM = tl.match(/\bin\s+(\d+)\s+(?:weeks?|wochen?|semaines?|settimane?|semanas?|veckor|tjedana|javë|jave)\b/)
    if (inXWM) {
      const d = new Date(today)
      d.setDate(today.getDate() + parseInt(inXWM[1]) * 7)
      return toLocalDateStr(d)
    }

    return undefined
  }

  // ── Implicit round-trip scanner ───────────────────────────────────────────
  // Finds up to 2 distinct date expressions in left-to-right order.
  // Used when no explicit return keyword (e.g. "May 1st, May 6th", "May 1-6", "1 May - 6 May").
  function scanTwoDates(text: string): [string, string] | null {
    const cleaned = stripAccents(text.toLowerCase())
      .replace(/\b(?:on|le|am|el|il|em|dne|den|dia|på|na|the)\b/g, ' ')
      .replace(/\s+/g, ' ')

    const hits: Array<{ pos: number; date: string }> = []

    const addHit = (pos: number, mIdx: number, day: number) => {
      if (mIdx < 0 || mIdx > 11 || day < 1 || day > 31) return
      const d = new Date(today.getFullYear(), mIdx, day)
      if (d < today) d.setFullYear(today.getFullYear() + 1)
      hits.push({ pos, date: toLocalDateStr(d) })
    }

    let m: RegExpExecArray | null

    // Same-month range: "May 1-6", "May 1–6"
    const smRange1Re = /([a-zäöüčšžćđéèêëàâùûîïôœæñß]{3,})\s+(\d{1,2})\s*[-–]\s*(\d{1,2})(?!\d)/g
    while ((m = smRange1Re.exec(cleaned)) !== null) {
      const mIdx = matchMonth(m[1])
      const d1 = parseInt(m[2]), d2 = parseInt(m[3])
      if (mIdx !== null && d1 < d2) {
        addHit(m.index, mIdx, d1)
        addHit(m.index + m[0].length - 1, mIdx, d2)
      }
    }

    // Same-month range reversed: "1-6 May", "1–6 May"
    const smRange2Re = /(\d{1,2})\s*[-–]\s*(\d{1,2})\s+([a-zäöüčšžćđéèêëàâùûîïôœæñß]{3,})/g
    while ((m = smRange2Re.exec(cleaned)) !== null) {
      const mIdx = matchMonth(m[3])
      const d1 = parseInt(m[1]), d2 = parseInt(m[2])
      if (mIdx !== null && d1 < d2) {
        addHit(m.index, mIdx, d1)
        addHit(m.index + m[0].length - 1, mIdx, d2)
      }
    }

    // "<month> <day>" e.g. "May 1st", "May 6th"
    const mdRe = /([a-zäöüčšžćđéèêëàâùûîïôœæñß]{3,})\s+(\d{1,2})(?:st|nd|rd|th|er|ème|eme|[.º])?(?!\d)/g
    while ((m = mdRe.exec(cleaned)) !== null) {
      const mIdx = matchMonth(m[1])
      if (mIdx !== null) addHit(m.index, mIdx, parseInt(m[2]))
    }

    // "<day> <month>" e.g. "1st May", "6 May"
    const dmRe = /(\d{1,2})(?:st|nd|rd|th|er|ème|eme|[.º])?\.?\s+([a-zäöüčšžćđéèêëàâùûîïôœæñß]{3,})/g
    while ((m = dmRe.exec(cleaned)) !== null) {
      const mIdx = matchMonth(m[2])
      if (mIdx !== null) addHit(m.index, mIdx, parseInt(m[1]))
    }

    // Numeric date pairs: "10.01 10.07", "7/3 7/5", "10.01, 10.07" etc.
    // Try both MM.DD and DD.MM conventions across the pair, pick the one where
    // BOTH dates are valid, chronological, and require no year-roll (i.e. both future).
    // Falls back to nearest-future if only one convention works.
    if (hits.length === 0) {
      const numPairRe = /(\d{1,2})([./])(\d{1,2})[,\s]+(\d{1,2})\2(\d{1,2})/g
      while ((m = numPairRe.exec(cleaned)) !== null) {
        const a1 = parseInt(m[1]), b1 = parseInt(m[3])
        const a2 = parseInt(m[4]), b2 = parseInt(m[5])
        const _nd = (day: number, mon0: number): Date | null => {
          if (day < 1 || day > 31 || mon0 < 0 || mon0 > 11) return null
          const d = new Date(today.getFullYear(), mon0, day)
          return d
        }
        // MM.DD interpretation (a=month, b=day)
        const dMD1 = _nd(b1, a1 - 1), dMD2 = _nd(b2, a2 - 1)
        // DD.MM interpretation (a=day, b=month)
        const dDM1 = _nd(a1, b1 - 1), dDM2 = _nd(a2, b2 - 1)
        const isGoodPair = (d1: Date | null, d2: Date | null): boolean => {
          if (!d1 || !d2) return false
          return d1 >= today && d2 > d1
        }
        let chosenD1: Date | null = null, chosenD2: Date | null = null
        if (isGoodPair(dMD1, dMD2) && !isGoodPair(dDM1, dDM2)) {
          chosenD1 = dMD1; chosenD2 = dMD2
        } else if (isGoodPair(dDM1, dDM2) && !isGoodPair(dMD1, dMD2)) {
          chosenD1 = dDM1; chosenD2 = dDM2
        } else if (isGoodPair(dMD1, dMD2) && isGoodPair(dDM1, dDM2)) {
          // Both valid: prefer the pair with the shorter span (more likely a trip)
          const spanMD = dMD2!.getTime() - dMD1!.getTime()
          const spanDM = dDM2!.getTime() - dDM1!.getTime()
          if (spanMD <= spanDM) { chosenD1 = dMD1; chosenD2 = dMD2 }
          else { chosenD1 = dDM1; chosenD2 = dDM2 }
        } else {
          // Neither pair is both-future: roll past dates to next year
          if (dMD1 && dMD2) { if (dMD1 < today) dMD1.setFullYear(today.getFullYear() + 1); if (dMD2 < today) dMD2.setFullYear(today.getFullYear() + 1); if (dMD2 > dMD1) { chosenD1 = dMD1; chosenD2 = dMD2 } }
          if (!chosenD1 && dDM1 && dDM2) { if (dDM1 < today) dDM1.setFullYear(today.getFullYear() + 1); if (dDM2 < today) dDM2.setFullYear(today.getFullYear() + 1); if (dDM2 > dDM1) { chosenD1 = dDM1; chosenD2 = dDM2 } }
        }
        if (chosenD1 && chosenD2) {
          hits.push({ pos: m.index, date: toLocalDateStr(chosenD1) })
          hits.push({ pos: m.index + m[0].length, date: toLocalDateStr(chosenD2) })
        }
      }
    }

    // Deduplicate by DATE VALUE, then sort chronologically.
    // Different regex patterns (mdRe, dmRe, smRange*) can match the same calendar date
    // at nearby positions — deduplicate by value to avoid counting "June 1st" twice.
    // Sorting ensures outbound < return regardless of query word order.
    const seen = new Set<string>()
    const deduped: string[] = []
    hits.sort((a, b) => a.pos - b.pos)
    for (const h of hits) {
      if (!seen.has(h.date)) {
        seen.add(h.date)
        deduped.push(h.date)
      }
    }
    deduped.sort()

    if (deduped.length >= 2 && deduped[0] !== deduped[1] && deduped[1] >= deduped[0]) {
      return [deduped[0], deduped[1]]
    }
    return null
  }

  // ── 4. Extract outbound date ─────────────────────────────────────────────
  result.date = extractDate(outboundRaw)

  // If no date found, default to 1 week from today and flag it as a default —
  // the convo flow uses this to decide whether to ask "when do you want to go?"
  // and to gate the background search pre-fire (don't burn a search on a guess).
  if (!result.date) {
    const d = new Date(today)
    d.setDate(today.getDate() + 7)
    result.date = toLocalDateStr(d)
    result.date_is_default = true
  }

  // Override with explicit "Friday evening out"-style weekday (more specific than "this weekend")
  const _explicitDepDay: string | undefined = (result as any).__explicitDepartureDay
  if (_explicitDepDay) {
    const _wi: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 }
    if (_explicitDepDay in _wi) {
      const _d = new Date(today)
      let _diff = (_wi[_explicitDepDay] - today.getDay() + 7) % 7
      if (_diff === 0) _diff = 7
      _d.setDate(today.getDate() + _diff)
      result.date = toLocalDateStr(_d)
    }
    delete (result as any).__explicitDepartureDay
  }

  // ── 5. Extract return date ───────────────────────────────────────────────
  if (returnRaw) {
    // Temporarily clear date_month_only before extracting return date so that
    // a month-only return ("returning in january") doesn't set the flag on the
    // shared result — that would incorrectly trigger find_best_window.
    const _depMonthOnly = result.date_month_only
    result.date_month_only = undefined
    const retDate = extractDate(returnRaw)
    // Restore departure's month-only flag; discard any month-only flag from return.
    // If the user said "in december returning in january" they have a concrete round-trip
    // — month-only flag no longer meaningful once we have a return date.
    if (retDate) {
      result.return_date = retDate
      result.date_month_only = undefined  // concrete round-trip: don't trigger best-window
    } else {
      // "Return 4 days" / "return after 5 days" / "returning in 7 days" — duration-based.
      // When the user expresses the return as a trip-length (no calendar date),
      // derive return_date = departure + N days. This handles the conversational
      // pattern produced by the home questionnaire ("Return 4 days") which would
      // otherwise be silently dropped, leaving the search as one-way.
      const durMatch = returnRaw.match(/^\s*(?:after\s+|in\s+)?(\d{1,2})\s*(?:day|days|d)\b/i)
      if (durMatch && result.date) {
        const days = parseInt(durMatch[1], 10)
        if (days > 0 && days <= 365) {
          const dep = new Date(result.date + 'T00:00:00Z')
          dep.setUTCDate(dep.getUTCDate() + days)
          result.return_date = toLocalDateStr(dep)
          result.date_month_only = undefined
        } else {
          result.date_month_only = _depMonthOnly
        }
      } else {
        result.date_month_only = _depMonthOnly
      }
    }
  } else {
    // No explicit return keyword — scan for two date expressions (implicit round-trip)
    // Handles: "May 1st, May 6th" / "May 1-6" / "1 May - 6 May" / "May 1 to May 6"
    const pair = scanTwoDates(outboundRaw)
    if (pair) result.return_date = pair[1]
  }

  // Apply "Sunday night back"-style return weekday when no return date was found yet
  const _explicitRetDay: string | undefined = (result as any).__explicitReturnDay
  if (_explicitRetDay && !result.return_date) {
    const _wi2: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 }
    if (_explicitRetDay in _wi2) {
      const _d = new Date(today)
      let _diff = (_wi2[_explicitRetDay] - today.getDay() + 7) % 7
      if (_diff === 0) _diff = 7
      _d.setDate(today.getDate() + _diff)
      // Ensure return is after departure
      if (result.date && toLocalDateStr(_d) <= result.date) _d.setDate(_d.getDate() + 7)
      result.return_date = toLocalDateStr(_d)
    }
  }
  delete (result as any).__explicitReturnDay

  // When departure was month-only ("in december") but we now have a return date,
  // use the 15th as the departure anchor instead of the 1st — gives connectors
  // a better mid-month target and avoids results that happen to be cheapest on Dec 1.
  if (result.date && result.return_date) {
    const depDate = result.date  // already set to 1st of month by extractDate
    // Only nudge if it's actually the 1st (i.e. came from month-only)
    if (depDate.endsWith('-01')) {
      const d = new Date(depDate)
      d.setDate(15)
      result.date = toLocalDateStr(d)
    }
  }

  // ── 6. Extract cabin class + direct filter from full query ───────────────
  const cabin = extractCabin(q)
  if (cabin) result.cabin = cabin
  if (extractDirect(q)) result.stops = 0
  if (/\b(?:quick(?:est)?|fast(?:est)?|short(?:est)?|minimum|lowest)\s*(?:possible\s*)?(?:flight\s+)?(?:time|duration|transit)?\s*(?:flight|route)?\b|\bflight\s+(?:time|duration)\s+(?:as\s+)?(?:short|quick|fast)\b|\bget\s+there\s+(?:as\s+)?(?:fast|quick|quick\s+as\s+possible)\b/i.test(q)) {
    result.prefer_quick_flight = true
  }

  // Explicit sort preference — auto-selects the sort tab on the results page.
  // Cheapest/fastest are the only two we surface; everything else stays default.
  // EN + major EU langs covered cheaply with a single regex per side; no per-token loop.
  if (/\b(?:cheap(?:est)?(?:\s+(?:option|flight|fare|deal|price))?|lowest\s+(?:price|fare|cost)|best\s+price|budget(?:\s+option)?|najtańsz[ye]?|najtaniej|tani[ae]?|tanio|le\s+(?:moins\s+cher|prix\s+le\s+plus\s+bas)|pas\s+cher[se]?|bon\s+march[eé]|m[aá]s\s+barato|el\s+m[aá]s\s+barato|barat[oa]s?|econ[oó]mic[oa]s?|mais\s+barato|barat[oa]s?|g[uü]nstig(?:e|er|en|ste(?:r|n)?)?|am\s+billigsten|billigst(?:e|er|en)?|billig(?:e|er|en)?|più\s+economic[oa]|economic[oai]|niedrigst(?:er|en)?\s+preis|laagst(?:e)?\s+prijs|goedkop(?:e|er|ste)?|billigast|jeftin[oa]?|lir[eë]|lir[eë]\s+t[eë])\b/i.test(q)) {
    result.preferred_sort = 'price'
  } else if (/\b(?:fast(?:est)?(?:\s+(?:option|flight))?|quickest|short(?:est)?\s+(?:flight|trip|duration|journey)|najszybsz[ye]?|le\s+plus\s+rapide|m[aá]s\s+r[aá]pido|el\s+m[aá]s\s+r[aá]pido|mais\s+r[aá]pido|schnellst(?:e|er|en)?|am\s+schnellsten|più\s+veloce|snelst(?:e)?|snabbast)\b/i.test(q)) {
    result.preferred_sort = 'duration'
  }

  // ── 7. Trip duration range ("for 14 days", "14-18 day trip", "back in 2 weeks") ──
  // Patterns: "for X days", "for X-Y days", "X-Y day trip", "X to Y days", "stay X-Y nights"
  const tripDurRe = /\bfor\s+(\d+)\s*[-–to]\s*(\d+)\s*(?:days?|nights?|nächte?|jours?|giorni?|dias?|netter|dagar|dana|ditë)\b/i
  const tripDurRe2 = /\b(\d+)\s*[-–]\s*(\d+)\s*[-\s]?(?:day|days|night|nights|nächte?|jours?|giorni?|dias?|dagar|dana)\s*(?:trip|holiday|vacation|urlaub|vacances|vacanza|vakantie|semester|ferien|viagem|viaje)?\b/i
  const tripDurSingleRe = /\bfor\s+(\d+)\s+(?:days?|nights?|nächte?|jours?|giorni?|dias?|dagar|dana|ditë)\b/i
  const tripDurWeeksRe = /\bfor\s+(\d+)\s*[-–to]\s*(\d+)\s*weeks?\b/i
  const tripDurWeekSingleRe = /\bfor\s+(?:(\d+)|a|an|one)\s+weeks?\b/i
  const returnAfterRe = /\b(?:come?\s+back|return(?:ing)?|back)\s+(?:between\s+)?(\d+)\s*(?:and|[-–to])\s*(\d+)\s*(?:days?|nights?)\s+(?:after|later|später|después|après|dopo)\b/i
  const returnAfterSingleRe = /\b(?:come?\s+back|return(?:ing)?|back)\s+(\d+)\s*(?:days?|nights?)\s+(?:after|later|später|después|après|dopo)\b/i

  const tdm = q.match(tripDurRe) || q.match(tripDurRe2)
  if (tdm) {
    result.min_trip_days = parseInt(tdm[1])
    result.max_trip_days = parseInt(tdm[2])
  } else {
    const twm = q.match(tripDurWeeksRe)
    if (twm) {
      result.min_trip_days = parseInt(twm[1]) * 7
      result.max_trip_days = parseInt(twm[2]) * 7
    } else {
      const rafm = q.match(returnAfterRe)
      if (rafm) {
        result.min_trip_days = parseInt(rafm[1])
        result.max_trip_days = parseInt(rafm[2])
      } else {
        const rasm = q.match(returnAfterSingleRe)
        if (rasm) {
          result.min_trip_days = parseInt(rasm[1])
          result.max_trip_days = parseInt(rasm[1])
        } else {
          const tdsm = q.match(tripDurSingleRe)
          if (tdsm) {
            result.min_trip_days = parseInt(tdsm[1])
            result.max_trip_days = parseInt(tdsm[1])
          } else {
            const twsm = q.match(tripDurWeekSingleRe)
            if (twsm) {
              const wks = twsm[1] ? parseInt(twsm[1]) : 1
              result.min_trip_days = wks * 7
              result.max_trip_days = wks * 7
            }
          }
        }
      }
    }
  }

  // ── "Round trip" / "return flight" signal — default trip duration ─────────
  // When the user explicitly says "round trip" (or multilingual equivalent) but
  // gives no trip duration, infer a sensible default so we can set return_date.
  // City-break queries → 3–4 days; everything else → 7 days.
  if (result.min_trip_days === undefined && !result.return_date) {
    const _rtRe = /\b(?:round[\s-]?trip|roundtrip|return\s+(?:flight|ticket|flights|tickets)|two[\s-]?way|aller[\s-]retour|hin\s+und\s+zur[üu]ck|andata\s+e\s+ritorno|ida\s+y\s+vuelta|tam\s+i\s+z\s+powrotem|bilet\s+(?:w\s+obie\s+strony|powrotny)|retourvlucht|heen\s+en\s+terug|tur\s+retur)\b/i
    if (_rtRe.test(q)) {
      const _cbRe = /\b(?:city\s+break|weekend\s+(?:break|trip|getaway|away)|short\s+(?:break|trip)|mini\s+(?:break|vacation|trip)|long\s+weekend)\b/i
      if (_cbRe.test(q)) {
        result.min_trip_days = 3
        result.max_trip_days = 4
      } else {
        result.min_trip_days = 7
        result.max_trip_days = 7
      }
    }
  }

  // If we have a trip duration and an outbound date but no return date,
  // derive a midpoint return date for the initial search
  if (result.min_trip_days !== undefined && result.date && !result.return_date) {
    const mid = Math.round(((result.min_trip_days ?? 0) + (result.max_trip_days ?? result.min_trip_days ?? 0)) / 2)
    const dep = new Date(result.date)
    dep.setDate(dep.getDate() + mid)
    result.return_date = toLocalDateStr(dep)
  }

  // ── 8b. Budget constraint parsing ─────────────────────────────────────────
  // Matches: "for $200 or less", "under €150", "max 300 EUR", "within 250 dollars",
  //          "up to 180 pounds", "budget of 400", "at most $500", "less than 120 EUR"
  // The pattern tries to capture the numeric amount; currency symbol/name is optional.
  const budgetRe = /(?:for\s+)?(?:under|below|less\s+than|at\s+most|no\s+more\s+than|up\s+to|within|max(?:imum)?|budget(?:\s+of)?|costing?(?:\s+up\s+to)?)\s*[$€£¥]\s*(\d+(?:[.,]\d+)?)|(?:for\s+)?[$€£¥]\s*(\d+(?:[.,]\d+)?)\s*(?:or\s+less|max(?:imum)?|budget)|(\d+(?:[.,]\d+)?)\s*(?:USD|EUR|GBP|PLN|dollars?|euros?|pounds?|z[lł]oty)\s*(?:or\s+less|max(?:imum)?|budget|or\s+under|or\s+below)?/i
  const budgetMatch = q.match(budgetRe)
  if (budgetMatch) {
    const raw = (budgetMatch[1] || budgetMatch[2] || budgetMatch[3] || '').replace(',', '.')
    const parsed = parseFloat(raw)
    if (!isNaN(parsed) && parsed > 0) {
      result.max_price = parsed
    }
  }

  // ── 8. "Anywhere" / open destination detection ──────────────────────────
  // Patterns: "to anywhere", "wherever", "cheapest destination", "any destination", "surprise me"
  // Also: "somewhere warm/sunny/cheap/nice/hot/abroad" and plain "somewhere"
  const anywhereRe = /\b(?:anywhere|wherever(?:\s+is\s+(?:cheapest|cheapest|cheaper|cheap|best))?|any(?:\s+destination|\s+airport|\s+country|\s+place)?|surprise\s+me|wherever\s+i\s+can\s+go|somewhere(?:\s+(?:warm|sunny|hot|cold|cheap|nice|beautiful|exotic|tropical|different|new|fun|interesting|affordable|nearby|abroad|in\s+europe|in\s+asia|in\s+africa|in\s+america|far\s+away|close|nearby))?|irgendwo(?:hin)?|peu\s+importe|partout|n'importe\s+où|qualunque\s+destinazione?|donde\s+sea|cualquier\s+(?:destino|lugar)|overalt|varsomhelst|bilo\s+gdje|kudo|ergens|irgendwohin)\b/i
  if (anywhereRe.test(q)) {
    result.anywhere_destination = true
    // Clear the failed destination since it's intentional
    delete result.failed_destination_raw
    delete result.destination_candidates
    // Keep destination undefined so the UI can show an "Explore" mode
  }

  // ── 9. Passenger composition ──────────────────────────────────────────────
  const pax = extractPassengers(q)
  if (pax.adults !== undefined) result.adults = pax.adults
  if (pax.children !== undefined) result.children = pax.children
  if (pax.infants !== undefined) result.infants = pax.infants
  if (pax.context) result.passenger_context = pax.context
  if (pax.group_size !== undefined) result.group_size = pax.group_size
  if (pax.require_adjacent_seats) result.require_adjacent_seats = true
  if (pax.require_seat_selection) result.require_seat_selection = true
  if (pax.require_bassinet) result.require_bassinet = true
  if (pax.prefer_direct) result.prefer_direct = true

  // ── 10. Ancillaries ───────────────────────────────────────────────────────
  const anc = extractAncillaries(q)
  if (anc.require_checked_baggage) result.require_checked_baggage = true
  if (anc.carry_on_only) result.carry_on_only = true
  if (anc.require_meals) result.require_meals = true
  if (anc.require_cancellation) result.require_cancellation = true
  if (anc.require_lounge) result.require_lounge = true

  // ── 11. Time-of-day preferences ───────────────────────────────────────────
  const tp = extractTimePrefs(q)
  if (tp.depart_time_pref) result.depart_time_pref = tp.depart_time_pref
  if (tp.arrive_time_pref) result.arrive_time_pref = tp.arrive_time_pref
  // Map raw time-of-day words → ParsedQuery enum values
  const _mapTod = (tod: string | undefined): ParsedQuery['depart_time_pref'] | undefined => {
    if (!tod) return undefined
    const t = tod.replace(/\s+/g, ' ').toLowerCase()
    if (t.includes('early') || t === 'early morning') return 'early_morning'
    if (t === 'morning') return 'morning'
    if (t === 'afternoon' || t === 'noon' || t === 'lunchtime' || t === 'midday') return 'afternoon'
    if (t === 'evening' || t === 'night') return 'evening'
    return undefined
  }
  // Apply departure time-of-day from step 0c (fills in when extractTimePrefs couldn't detect)
  const _depTod: string | undefined = (result as any).__explicitDepartureTimePref
  if (_depTod && !result.depart_time_pref) result.depart_time_pref = _mapTod(_depTod)
  delete (result as any).__explicitDepartureTimePref
  // Apply return time-of-day from step 0c
  const _retTod11: string | undefined = (result as any).__explicitReturnTimePref
  if (_retTod11) result.return_depart_time_pref = _mapTod(_retTod11)
  delete (result as any).__explicitReturnTimePref
  // If RETURN_SPLIT_RE fired, also scan the return portion for bare time-of-day words
  // (e.g. returnRaw="Sunday evening" → return_depart_time_pref='evening')
  if (returnRaw && !result.return_depart_time_pref) {
    const _rtp = extractTimePrefs(returnRaw)
    if (_rtp.depart_time_pref) {
      result.return_depart_time_pref = _rtp.depart_time_pref
    } else {
      const _rl = returnRaw.toLowerCase()
      if (/\bearly\s+morning\b/.test(_rl)) result.return_depart_time_pref = 'early_morning'
      else if (/\bmorning\b/.test(_rl)) result.return_depart_time_pref = 'morning'
      else if (/\b(?:afternoon|noon|lunchtime|midday)\b/.test(_rl)) result.return_depart_time_pref = 'afternoon'
      else if (/\b(?:evening|night)\b/.test(_rl)) result.return_depart_time_pref = 'evening'
    }
  }

  // ── 12. Trip purpose ──────────────────────────────────────────────────────
  const purpose = extractTripPurpose(q)
  if (purpose) result.trip_purpose = purpose

  // ── 13. Seat preference ───────────────────────────────────────────────────
  const seatPref = extractSeatPref(q)
  if (seatPref) result.seat_pref = seatPref

  // ── 14. Airline preference / exclusion ────────────────────────────────────
  const airlinePref = extractAirlinePreference(q)
  if (airlinePref.preferred) result.preferred_airline = airlinePref.preferred
  if (airlinePref.excluded) result.excluded_airline = airlinePref.excluded

  // ── 15. Urgency ───────────────────────────────────────────────────────────
  const urgency = extractUrgency(q)
  if (urgency) result.urgency = urgency

  // ── 16. Best-window strategy ──────────────────────────────────────────────
  // Explicit: "cheapest week in June", "best time in August"
  const bw = extractExplicitBestWindow(q)
  if (bw.find_best_window) {
    result.find_best_window = true
    if (bw.date_window_month) result.date_window_month = bw.date_window_month
    if (bw.date_window_year) result.date_window_year = bw.date_window_year
  }
  // Implicit: month-only date + trip duration → scan for cheapest window.
  // Guard: if the user already gave a return date (concrete round-trip like
  // "in december returning in january"), don't trigger best-window mode.
  if (!result.find_best_window && result.date_month_only && result.min_trip_days !== undefined && !result.return_date) {
    result.find_best_window = true
    // Extract the window month from the already-parsed date
    if (result.date) {
      const mFromDate = parseInt(result.date.slice(5, 7), 10)
      if (mFromDate >= 1 && mFromDate <= 12) result.date_window_month = mFromDate
    }
  }

  // ── 16b. "between MONTH and MONTH" / "MONTH or MONTH" → date window ──────
  // "between June and July", "June or July", "between June and August", "sometime in July or August"
  if (!result.find_best_window) {
    const monthRangeM =
      ql.match(/\bbetween\s+([a-z]+)\s+and\s+([a-z]+)\b/i) ??
      ql.match(/\bin\s+([a-z]+)\s+or\s+([a-z]+)\b/i) ??
      ql.match(/\b([a-z]+)\s+or\s+([a-z]+)\b/i)
    if (monthRangeM) {
      const m1 = _matchMonthByName(monthRangeM[1])
      const m2 = _matchMonthByName(monthRangeM[2])
      if (m1 !== null && m2 !== null) {
        result.find_best_window = true
        result.date_window_month = m1 + 1
        result.date_month_only = true
        // Set date to start of first month
        if (!result.date) {
          const yr = today.getFullYear()
          const d = new Date(yr, m1, 1)
          if (d < today) d.setFullYear(yr + 1)
          result.date = toLocalDateStr(d)
        }
      }
    }
  }

  // ── 16c. Season → date window ─────────────────────────────────────────────
  // "in summer", "this winter", "next spring", "autumn trip"
  // Northern hemisphere: spring=Mar-May, summer=Jun-Aug, autumn/fall=Sep-Nov, winter=Dec-Feb
  if (!result.find_best_window) {
    const seasonM = ql.match(/\b(?:(?:this|next|coming|upcoming|in(?:\s+the)?)\s+)?(?:(spring|summer|autumn|fall|winter))\b/i)
    if (seasonM) {
      const season = seasonM[1].toLowerCase()
      const isNext = /\bnext\b/i.test(ql)
      const seasonMonthMap: Record<string, number> = {
        spring: 3, summer: 6, autumn: 9, fall: 9, winter: 12,
      }
      const startMonth = seasonMonthMap[season]
      if (startMonth) {
        result.find_best_window = true
        result.date_window_month = startMonth
        result.date_month_only = true
        if (!result.date) {
          const yr = today.getFullYear()
          const d = new Date(yr, startMonth - 1, 1)
          if (!isNext && d < today) d.setFullYear(yr + 1)
          if (isNext) d.setFullYear(d < today ? yr + 1 : yr + 1)
          result.date = toLocalDateStr(d)
        }
      }
    }
  }

  // ── 16d. "flexible dates" / "anytime" / "open dates" → find_best_window ──
  if (!result.find_best_window) {
    const flexDatesRe = /\b(?:any(?:time|where\s+in\s+time)?|flexible(?:\s+(?:on\s+)?(?:dates?|timing|schedule))?|open\s+(?:dates?|schedule|to\s+dates?)|no\s+fixed\s+(?:dates?|schedule|timeline)|whenever(?:\s+(?:is\s+)?(?:cheapest|best|cheapest|cheapest))?|doesn?'?t?\s+matter\s+(?:when|the\s+date)|date\s+flexible|dates?\s+(?:don'?t?\s+matter|are\s+flexible)|pick\s+(?:any|the\s+best|cheapest)\s+(?:date|time|week))\b/i
    if (flexDatesRe.test(q)) {
      result.find_best_window = true
    }
  }

  // ── 16e. School holidays / holiday periods → date hints ───────────────────
  // "Easter", "Easter break/holidays", "Christmas", "school holidays", "half term", "summer holidays"
  if (!result.date) {
    const yr = today.getFullYear()
    const halfTermRe = /\b(?:half[\s-]?term(?:\s+(?:break|holiday|week))?|mid[\s-]?term\s+(?:break|holiday))\b/i
    const easterRe = /\b(?:easter(?:\s+(?:break|holiday|holidays|week|weekend))?)\b/i
    const christmasRe = /\b(?:christmas(?:\s+(?:break|holiday|holidays|week))?|xmas(?:\s+(?:break|holidays|week))?|festive(?:\s+(?:break|period|holidays))?)\b/i
    const summerHolRe = /\b(?:summer\s+holiday(?:s)?|school\s+(?:summer\s+)?holidays?|july\s+(?:or\s+)?august\b)\b/i
    const newYearRe = /\b(?:new\s+year(?:'s)?(?:\s+(?:eve|break|holiday))?)\b/i

    if (easterRe.test(q)) {
      // Easter typically falls in late March or April — use April 1 as approximate
      const d = new Date(yr, 3, 1)  // April 1
      if (d < today) d.setFullYear(yr + 1)
      result.date = toLocalDateStr(d)
      result.find_best_window = true
      result.date_window_month = 4
    } else if (christmasRe.test(q)) {
      const d = new Date(yr, 11, 20)  // Dec 20
      if (d < today) d.setFullYear(yr + 1)
      result.date = toLocalDateStr(d)
      result.date_window_month = 12
    } else if (newYearRe.test(q)) {
      const d = new Date(yr + 1, 0, 1)  // Jan 1
      result.date = toLocalDateStr(d)
      result.date_window_month = 1
    } else if (summerHolRe.test(q)) {
      const d = new Date(yr, 6, 15)  // Jul 15
      if (d < today) d.setFullYear(yr + 1)
      result.date = toLocalDateStr(d)
      result.find_best_window = true
      result.date_window_month = 7
    } else if (halfTermRe.test(q)) {
      // Half-term: approximately mid-Feb or late May or late Oct — use nearest upcoming
      const candidates = [new Date(yr, 1, 17), new Date(yr, 4, 26), new Date(yr, 9, 27)]
      const upcoming = candidates.find(d => d >= today) ?? new Date(yr + 1, 1, 17)
      result.date = toLocalDateStr(upcoming)
      result.find_best_window = true
      result.date_window_month = upcoming.getMonth() + 1
    }
  }

  // ── 17. Purpose → cabin upgrade hints ─────────────────────────────────────
  // Honeymoon / business trip → suggest business class if no cabin set
  if (!result.cabin) {
    if (result.trip_purpose === 'honeymoon') result.cabin = 'C' // business as a romantic upgrade hint
    // (business trip — leave cabin undefined; let user decide, but prefer_direct is already set)
  }

  // ── 18. Hard vs soft stop inference ─────────────────────────────────────
  // If prefer_direct is set but stops=0 not yet set, don't override user's filter.
  // The UI/search layer handles prefer_direct as a soft sort preference.

  // ── 19. Max arrival time (e.g. "need to land by 3pm", "back in office at 15:00") ──
  if (!result.max_arrival_time) {
    const fullText = query + (returnRaw ? ' ' + returnRaw : '')
    const maxArr = extractMaxArrivalTime(fullText)
    if (maxArr) result.max_arrival_time = maxArr
  }

  return result
}
