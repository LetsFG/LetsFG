// Shared NL query parser — used by /api/search and the SSR /results?q= page
// Handles: EN, DE, ES, FR, IT, NL, PL, PT, SQ (Albanian), HR (Croatian), SV (Swedish)
// Also handles: filler words, typos via accent-stripping, ordinals, DD/MM/YYYY, relative dates

import { findBestLocationMatch, findExactLocationMatch } from '../airports'

// ── City → IATA lookup ────────────────────────────────────────────────────────
// Keys are lowercase, accent-free. resolveCity() normalises input before lookup.

export const CITY_TO_IATA: Record<string, { code: string; name: string }> = {
  // ── UK & Ireland ────────────────────────────────────────────────────────────
  'london': { code: 'LON', name: 'London' },
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
  'dublin': { code: 'DUB', name: 'Dublin' },
  'cork': { code: 'ORK', name: 'Cork' },
  // ── Western Europe ──────────────────────────────────────────────────────────
  'barcelona': { code: 'BCN', name: 'Barcelona' },
  'madrid': { code: 'MAD', name: 'Madrid' },
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
  'tenerife': { code: 'TFS', name: 'Tenerife' },
  'gran canaria': { code: 'LPA', name: 'Gran Canaria' },
  'lanzarote': { code: 'ACE', name: 'Lanzarote' },
  'fuerteventura': { code: 'FUE', name: 'Fuerteventura' },
  'paris': { code: 'CDG', name: 'Paris' },
  'nice': { code: 'NCE', name: 'Nice' },
  'marseille': { code: 'MRS', name: 'Marseille' },
  'lyon': { code: 'LYS', name: 'Lyon' },
  'bordeaux': { code: 'BOD', name: 'Bordeaux' },
  'toulouse': { code: 'TLS', name: 'Toulouse' },
  'nantes': { code: 'NTE', name: 'Nantes' },
  'strasbourg': { code: 'SXB', name: 'Strasbourg' },
  'amsterdam': { code: 'AMS', name: 'Amsterdam' },
  'rotterdam': { code: 'RTM', name: 'Rotterdam' },
  'eindhoven': { code: 'EIN', name: 'Eindhoven' },
  'brussels': { code: 'BRU', name: 'Brussels' },
  'brussel': { code: 'BRU', name: 'Brussels' },
  'bruxelles': { code: 'BRU', name: 'Brussels' },
  'brüssel': { code: 'BRU', name: 'Brussels' },
  'lisbon': { code: 'LIS', name: 'Lisbon' },
  'lisbonne': { code: 'LIS', name: 'Lisbon' },
  'lissabon': { code: 'LIS', name: 'Lisbon' },
  'lisbona': { code: 'LIS', name: 'Lisbon' },
  'porto': { code: 'OPO', name: 'Porto' },
  'faro': { code: 'FAO', name: 'Faro' },
  'funchal': { code: 'FNC', name: 'Funchal (Madeira)' },
  'madeira': { code: 'FNC', name: 'Funchal (Madeira)' },
  'ponta delgada': { code: 'PDL', name: 'Ponta Delgada (Azores)' },
  'azores': { code: 'PDL', name: 'Ponta Delgada (Azores)' },
  // ── Central Europe ──────────────────────────────────────────────────────────
  'berlin': { code: 'BER', name: 'Berlin' },
  'munich': { code: 'MUC', name: 'Munich' },
  'munchen': { code: 'MUC', name: 'Munich' },
  'münchen': { code: 'MUC', name: 'Munich' },
  'frankfurt': { code: 'FRA', name: 'Frankfurt' },
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
  'zurich': { code: 'ZRH', name: 'Zurich' },
  'zürich': { code: 'ZRH', name: 'Zurich' },
  'geneva': { code: 'GVA', name: 'Geneva' },
  'geneve': { code: 'GVA', name: 'Geneva' },
  'genf': { code: 'GVA', name: 'Geneva' },
  'basel': { code: 'BSL', name: 'Basel' },
  'prague': { code: 'PRG', name: 'Prague' },
  'praha': { code: 'PRG', name: 'Prague' },
  'prag': { code: 'PRG', name: 'Prague' },
  'praga': { code: 'PRG', name: 'Prague' },
  'budapest': { code: 'BUD', name: 'Budapest' },
  'bratislava': { code: 'BTS', name: 'Bratislava' },
  'warsaw': { code: 'WAW', name: 'Warsaw' },
  'warsawa': { code: 'WAW', name: 'Warsaw' },
  'warszawa': { code: 'WAW', name: 'Warsaw' },
  'krakow': { code: 'KRK', name: 'Kraków' },
  'krakau': { code: 'KRK', name: 'Kraków' },
  'cracow': { code: 'KRK', name: 'Kraków' },
  'cracovie': { code: 'KRK', name: 'Kraków' },
  'gdansk': { code: 'GDN', name: 'Gdańsk' },
  'danzig': { code: 'GDN', name: 'Gdańsk' },
  'wroclaw': { code: 'WRO', name: 'Wrocław' },
  'breslau': { code: 'WRO', name: 'Wrocław' },
  'poznan': { code: 'POZ', name: 'Poznań' },
  'lodz': { code: 'LCJ', name: 'Łódź' },
  'katowice': { code: 'KTW', name: 'Katowice' },
  // ── Scandinavia & Baltics ────────────────────────────────────────────────────
  'stockholm': { code: 'ARN', name: 'Stockholm' },
  'arlanda': { code: 'ARN', name: 'Stockholm-Arlanda Airport' },
  'arl': { code: 'ARN', name: 'Stockholm-Arlanda Airport' },
  'goteborg': { code: 'GOT', name: 'Gothenburg' },
  'göteborg': { code: 'GOT', name: 'Gothenburg' },
  'gothenburg': { code: 'GOT', name: 'Gothenburg' },
  'malmo': { code: 'MMX', name: 'Malmö' },
  'malmö': { code: 'MMX', name: 'Malmö' },
  'oslo': { code: 'OSL', name: 'Oslo' },
  'bergen': { code: 'BGO', name: 'Bergen' },
  'trondheim': { code: 'TRD', name: 'Trondheim' },
  'copenhagen': { code: 'CPH', name: 'Copenhagen' },
  'kobenhavn': { code: 'CPH', name: 'Copenhagen' },
  'københavn': { code: 'CPH', name: 'Copenhagen' },
  'helsinki': { code: 'HEL', name: 'Helsinki' },
  'riga': { code: 'RIX', name: 'Riga' },
  'tallinn': { code: 'TLL', name: 'Tallinn' },
  'vilnius': { code: 'VNO', name: 'Vilnius' },
  // ── Southern Europe ──────────────────────────────────────────────────────────
  'rome': { code: 'FCO', name: 'Rome' },
  'roma': { code: 'FCO', name: 'Rome' },
  'milan': { code: 'MXP', name: 'Milan' },
  'milano': { code: 'MXP', name: 'Milan' },
  'naples': { code: 'NAP', name: 'Naples' },
  'napoli': { code: 'NAP', name: 'Naples' },
  'venice': { code: 'VCE', name: 'Venice' },
  'venezia': { code: 'VCE', name: 'Venice' },
  'florence': { code: 'FLR', name: 'Florence' },
  'firenze': { code: 'FLR', name: 'Florence' },
  'bologna': { code: 'BLQ', name: 'Bologna' },
  'catania': { code: 'CTA', name: 'Catania' },
  'palermo': { code: 'PMO', name: 'Palermo' },
  'bari': { code: 'BRI', name: 'Bari' },
  'athens': { code: 'ATH', name: 'Athens' },
  'athen': { code: 'ATH', name: 'Athens' },
  'athenes': { code: 'ATH', name: 'Athens' },
  'thessaloniki': { code: 'SKG', name: 'Thessaloniki' },
  'heraklion': { code: 'HER', name: 'Heraklion (Crete)' },
  'crete': { code: 'HER', name: 'Heraklion (Crete)' },
  'santorini': { code: 'JTR', name: 'Santorini' },
  'mykonos': { code: 'JMK', name: 'Mykonos' },
  'rhodes': { code: 'RHO', name: 'Rhodes' },
  'corfu': { code: 'CFU', name: 'Corfu' },
  'istanbul': { code: 'IST', name: 'Istanbul' },
  'ankara': { code: 'ESB', name: 'Ankara' },
  'antalya': { code: 'AYT', name: 'Antalya' },
  'izmir': { code: 'ADB', name: 'İzmir' },
  'bodrum': { code: 'BJV', name: 'Bodrum' },
  'belgrade': { code: 'BEG', name: 'Belgrade' },
  'beograd': { code: 'BEG', name: 'Belgrade' },
  'zagreb': { code: 'ZAG', name: 'Zagreb' },
  'split': { code: 'SPU', name: 'Split' },
  'dubrovnik': { code: 'DBV', name: 'Dubrovnik' },
  'sarajevo': { code: 'SJJ', name: 'Sarajevo' },
  'podgorica': { code: 'TGD', name: 'Podgorica' },
  'tirana': { code: 'TIA', name: 'Tirana' },
  'tirane': { code: 'TIA', name: 'Tirana' },
  'skopje': { code: 'SKP', name: 'Skopje' },
  'sofia': { code: 'SOF', name: 'Sofia' },
  'bucharest': { code: 'OTP', name: 'Bucharest' },
  'bukarest': { code: 'OTP', name: 'Bucharest' },
  'bucaresti': { code: 'OTP', name: 'Bucharest' },
  'cluj': { code: 'CLJ', name: 'Cluj-Napoca' },
  'chisinau': { code: 'KIV', name: 'Chișinău' },
  'kyiv': { code: 'KBP', name: 'Kyiv' },
  'kiev': { code: 'KBP', name: 'Kyiv' },
  'lviv': { code: 'LWO', name: 'Lviv' },
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
  'jeddah': { code: 'JED', name: 'Jeddah' },
  'dammam': { code: 'DMM', name: 'Dammam' },
  'amman': { code: 'AMM', name: 'Amman' },
  'beirut': { code: 'BEY', name: 'Beirut' },
  'tel aviv': { code: 'TLV', name: 'Tel Aviv' },
  'jerusalem': { code: 'TLV', name: 'Tel Aviv' },
  'baghdad': { code: 'BGW', name: 'Baghdad' },
  'tehran': { code: 'IKA', name: 'Tehran' },
  // ── Africa ───────────────────────────────────────────────────────────────────
  'cairo': { code: 'CAI', name: 'Cairo' },
  'kairo': { code: 'CAI', name: 'Cairo' },
  'casablanca': { code: 'CMN', name: 'Casablanca' },
  'marrakech': { code: 'RAK', name: 'Marrakech' },
  'marrakesh': { code: 'RAK', name: 'Marrakech' },
  'agadir': { code: 'AGA', name: 'Agadir' },
  'fez': { code: 'FEZ', name: 'Fez' },
  'tunis': { code: 'TUN', name: 'Tunis' },
  'algiers': { code: 'ALG', name: 'Algiers' },
  'tripoli': { code: 'TIP', name: 'Tripoli' },
  'nairobi': { code: 'NBO', name: 'Nairobi' },
  'mombasa': { code: 'MBA', name: 'Mombasa' },
  'addis ababa': { code: 'ADD', name: 'Addis Ababa' },
  'lagos': { code: 'LOS', name: 'Lagos' },
  'accra': { code: 'ACC', name: 'Accra' },
  'abuja': { code: 'ABV', name: 'Abuja' },
  'dakar': { code: 'DSS', name: 'Dakar' },
  'johannesburg': { code: 'JNB', name: 'Johannesburg' },
  'cape town': { code: 'CPT', name: 'Cape Town' },
  'durban': { code: 'DUR', name: 'Durban' },
  'dar es salaam': { code: 'DAR', name: 'Dar es Salaam' },
  'zanzibar': { code: 'ZNZ', name: 'Zanzibar' },
  'kampala': { code: 'EBB', name: 'Kampala' },
  'entebbe': { code: 'EBB', name: 'Kampala (Entebbe)' },
  'luanda': { code: 'LAD', name: 'Luanda' },
  'maputo': { code: 'MPM', name: 'Maputo' },
  'reunion': { code: 'RUN', name: 'Réunion' },
  'mauritius': { code: 'MRU', name: 'Mauritius' },
  // ── Asia ─────────────────────────────────────────────────────────────────────
  'tokyo': { code: 'TYO', name: 'Tokyo' },
  'osaka': { code: 'KIX', name: 'Osaka' },
  'nagoya': { code: 'NGO', name: 'Nagoya' },
  'sapporo': { code: 'CTS', name: 'Sapporo' },
  'fukuoka': { code: 'FUK', name: 'Fukuoka' },
  'seoul': { code: 'ICN', name: 'Seoul' },
  'busan': { code: 'PUS', name: 'Busan' },
  'beijing': { code: 'PEK', name: 'Beijing' },
  'peking': { code: 'PEK', name: 'Beijing' },
  'shanghai': { code: 'PVG', name: 'Shanghai' },
  'guangzhou': { code: 'CAN', name: 'Guangzhou' },
  'shenzhen': { code: 'SZX', name: 'Shenzhen' },
  'chengdu': { code: 'CTU', name: 'Chengdu' },
  'hong kong': { code: 'HKG', name: 'Hong Kong' },
  'macau': { code: 'MFM', name: 'Macau' },
  'taipei': { code: 'TPE', name: 'Taipei' },
  'singapore': { code: 'SIN', name: 'Singapore' },
  'bangkok': { code: 'BKK', name: 'Bangkok' },
  'phuket': { code: 'HKT', name: 'Phuket' },
  'chiang mai': { code: 'CNX', name: 'Chiang Mai' },
  'bali': { code: 'DPS', name: 'Bali' },
  'denpasar': { code: 'DPS', name: 'Bali' },
  'jakarta': { code: 'CGK', name: 'Jakarta' },
  'surabaya': { code: 'SUB', name: 'Surabaya' },
  'kuala lumpur': { code: 'KUL', name: 'Kuala Lumpur' },
  'penang': { code: 'PEN', name: 'Penang' },
  'manila': { code: 'MNL', name: 'Manila' },
  'cebu': { code: 'CEB', name: 'Cebu' },
  'ho chi minh': { code: 'SGN', name: 'Ho Chi Minh City' },
  'saigon': { code: 'SGN', name: 'Ho Chi Minh City' },
  'hanoi': { code: 'HAN', name: 'Hanoi' },
  'danang': { code: 'DAD', name: 'Da Nang' },
  'da nang': { code: 'DAD', name: 'Da Nang' },
  'phnom penh': { code: 'PNH', name: 'Phnom Penh' },
  'yangon': { code: 'RGN', name: 'Yangon' },
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
  'laguardia': { code: 'LGA', name: 'New York LaGuardia' },
  'los angeles': { code: 'LAX', name: 'Los Angeles' },
  'la': { code: 'LAX', name: 'Los Angeles' },
  'san francisco': { code: 'SFO', name: 'San Francisco' },
  'sf': { code: 'SFO', name: 'San Francisco' },
  'chicago': { code: 'ORD', name: 'Chicago' },
  'miami': { code: 'MIA', name: 'Miami' },
  'dallas': { code: 'DFW', name: 'Dallas' },
  'houston': { code: 'IAH', name: 'Houston' },
  'boston': { code: 'BOS', name: 'Boston' },
  'seattle': { code: 'SEA', name: 'Seattle' },
  'washington': { code: 'WAS', name: 'Washington DC' },
  'dc': { code: 'WAS', name: 'Washington DC' },
  'atlanta': { code: 'ATL', name: 'Atlanta' },
  'las vegas': { code: 'LAS', name: 'Las Vegas' },
  'orlando': { code: 'MCO', name: 'Orlando' },
  'denver': { code: 'DEN', name: 'Denver' },
  'phoenix': { code: 'PHX', name: 'Phoenix' },
  'minneapolis': { code: 'MSP', name: 'Minneapolis' },
  'detroit': { code: 'DTW', name: 'Detroit' },
  'san diego': { code: 'SAN', name: 'San Diego' },
  'portland': { code: 'PDX', name: 'Portland' },
  'toronto': { code: 'YYZ', name: 'Toronto' },
  'vancouver': { code: 'YVR', name: 'Vancouver' },
  'montreal': { code: 'YUL', name: 'Montreal' },
  'calgary': { code: 'YYC', name: 'Calgary' },
  'edmonton': { code: 'YEG', name: 'Edmonton' },
  'ottawa': { code: 'YOW', name: 'Ottawa' },
  'mexico city': { code: 'MEX', name: 'Mexico City' },
  'cancun': { code: 'CUN', name: 'Cancun' },
  'guadalajara': { code: 'GDL', name: 'Guadalajara' },
  'havana': { code: 'HAV', name: 'Havana' },
  'la habana': { code: 'HAV', name: 'Havana' },
  'santo domingo': { code: 'SDQ', name: 'Santo Domingo' },
  'san jose': { code: 'SJO', name: 'San José (CR)' },
  'panama city': { code: 'PTY', name: 'Panama City' },
  'bogota': { code: 'BOG', name: 'Bogotá' },
  'bogotá': { code: 'BOG', name: 'Bogotá' },
  'medellin': { code: 'MDE', name: 'Medellín' },
  'medellín': { code: 'MDE', name: 'Medellín' },
  'lima': { code: 'LIM', name: 'Lima' },
  'santiago': { code: 'SCL', name: 'Santiago' },
  'buenos aires': { code: 'EZE', name: 'Buenos Aires' },
  'sao paulo': { code: 'GRU', name: 'São Paulo' },
  'são paulo': { code: 'GRU', name: 'São Paulo' },
  'rio de janeiro': { code: 'GIG', name: 'Rio de Janeiro' },
  'rio': { code: 'GIG', name: 'Rio de Janeiro' },
  'brasilia': { code: 'BSB', name: 'Brasília' },
  'brasília': { code: 'BSB', name: 'Brasília' },
  'manaus': { code: 'MAO', name: 'Manaus' },
  'quito': { code: 'UIO', name: 'Quito' },
  'guayaquil': { code: 'GYE', name: 'Guayaquil' },
  'la paz': { code: 'LPB', name: 'La Paz' },
  'montevideo': { code: 'MVD', name: 'Montevideo' },
  'asuncion': { code: 'ASU', name: 'Asunción' },
  // ── Oceania ──────────────────────────────────────────────────────────────────
  'sydney': { code: 'SYD', name: 'Sydney' },
  'melbourne': { code: 'MEL', name: 'Melbourne' },
  'brisbane': { code: 'BNE', name: 'Brisbane' },
  'perth': { code: 'PER', name: 'Perth' },
  'adelaide': { code: 'ADL', name: 'Adelaide' },
  'gold coast': { code: 'OOL', name: 'Gold Coast' },
  'cairns': { code: 'CNS', name: 'Cairns' },
  'darwin': { code: 'DRW', name: 'Darwin' },
  'auckland': { code: 'AKL', name: 'Auckland' },
  'wellington': { code: 'WLG', name: 'Wellington' },
  'christchurch': { code: 'CHC', name: 'Christchurch' },
  'queenstown': { code: 'ZQN', name: 'Queenstown' },
  'nadi': { code: 'NAN', name: 'Nadi (Fiji)' },
  'fiji': { code: 'NAN', name: 'Nadi (Fiji)' },
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
  'noumea': { code: 'NOU', name: 'Nouméa' },
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
  'malta': { code: 'MLA', name: 'Malta' },
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
  // ── Flexible search extensions ──────────────────────────────────────────────
  min_trip_days?: number             // "for 14 days", "14-18 day trip" — min trip length
  max_trip_days?: number             // upper bound of trip duration range
  date_month_only?: boolean          // true when user typed "in September" (no specific day)
  anywhere_destination?: boolean     // true for "to anywhere", "wherever is cheapest", etc.
  max_price?: number                 // "for $200 or less", "under €150", "max 300 EUR"
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

// Look up a city string → IATA:
// 1. Exact match (accent-aware)
// 2. Explicit 3-letter code inside a longer phrase ("new york jfk" → JFK)
// 3. Boundary-aware contained phrase match (longest key first)
// 4. Fuzzy edit-distance fallback (handles typos like "Barcelna" → Barcelona)
function resolveCity(raw: string): { code: string; name: string } | null {
  const s = raw.toLowerCase().trim()
  if (!s || s.length < 2) return null

  // Exact match
  if (CITY_TO_IATA[s]) return CITY_TO_IATA[s]

  // Accent-stripped exact
  const stripped = stripAccents(s)
  if (CITY_TO_IATA[stripped]) return CITY_TO_IATA[stripped]

  const explicitCodeTokens = stripped.match(/\b[a-z]{3}\b/g) || []
  for (let idx = explicitCodeTokens.length - 1; idx >= 0; idx -= 1) {
    const token = explicitCodeTokens[idx]
    // Check CITY_TO_IATA first (city codes like LON, NYC that map to metro areas)
    const mapped = CITY_TO_IATA[token]
    if (mapped) return mapped
    // Then check the full airport database for explicit IATA codes (e.g. "Hawaii KOA" → KOA)
    const airportMatch = findExactLocationMatch(token)
    if (airportMatch) return { code: airportMatch.code, name: airportMatch.name }
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
  if (/\b(?:first\s+class|erste\s+klasse|primera\s+clase|premi[eè]re\s+classe|prima\s+classe|eerste\s+klas|pierwsza\s+klasa|primeira\s+classe|f[oö]rsta\s+klass|prva\s+klasa|klasa\s+e\s+par[eë])\b/.test(t)) return 'F'
  if (/\b(?:premium\s+economy|premium\s+[eé]conomique|premium\s+economi[ck]a|premium\s+econ[oô]mica|premium\s+econ[oô]mica)\b/.test(t)) return 'W'
  if (/\b(?:business\s+class|businessklasse|clase\s+(?:business|ejecutiva)|ejecutiva|classe\s+(?:affaires|business)|affaires|klasa\s+biznes|classe\s+executiva|executiva|businessklass|poslovna\s+klasa|zakenklasse|zakelijk|biznes|business)\b/.test(t)) return 'C'
  if (/\b(?:economy\s+class|wirtschaftsklasse|clase\s+turista|turista|classe\s+[eé]conomique|[eé]conomique|classe\s+economica|economica|economyclass|klasa\s+ekonomiczna|ekonomiklass|ekonomska\s+klasa|economy|coach|economica|economi[ck]a)\b/.test(t)) return 'M'
  return undefined
}

// ── Direct/nonstop extraction (all languages) ─────────────────────────────────
function extractDirect(text: string): boolean {
  const t = stripAccents(text.toLowerCase())
  return /\b(?:direct|nonstop|non[- ]stop|direkt(?:flug)?|ohne\s+(?:umstieg|zwischenstopp)|directo|sin\s+escalas?|vuelo\s+directo|sans?\s+escale|vol\s+direct|diretto|volo\s+diretto|senza\s+scal[ei]|rechtstreeks|zonder\s+tussenstop|bezposredni|bez\s+przesiadek|sem\s+escala[s]?|direto|direktflyg|izravno|bez\s+presjedanja|pa\s+ndalese)\b/.test(t)
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
  // PL
  ['styczeń',0],['styczen',0],['luty',1],['marzec',2],['kwiecień',3],['kwiecien',3],
  ['maj',4],['czerwiec',5],['lipiec',6],['sierpień',7],['sierpien',7],
  ['wrzesień',8],['wrzesien',8],['październik',9],['pazdziernik',9],
  ['listopad',10],['grudzień',11],['grudzien',11],
  // SV
  ['januari',0],['februari',1],['mars',2],['april',3],['maj',4],['juni',5],
  ['juli',6],['augusti',7],['september',8],['oktober',9],['november',10],['december',11],
  // HR/SQ
  ['siječanj',0],['sijecanj',0],['veljača',1],['veljaca',1],['oĵujak',2],['ozujak',2],
  ['travanj',3],['svibanj',4],['lipanj',5],['srpanj',6],['kolovoz',7],
  ['rujan',8],['listopad',9],['studeni',10],['prosinac',11],
  ['janar',0],['shkurt',1],['mars',2],['prill',3],['qershor',5],
  ['korrik',6],['gusht',7],['shtator',8],['tetor',9],['nëntor',10],['dhjetor',11],
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
  // PT
  ['domingo',0],['segunda',1],['terça',2],['terca',2],['quarta',3],['quinta',4],['sexta',5],['sábado',6],['sabado',6],
  // SV
  ['söndag',0],['sondag',0],['måndag',1],['mandag',1],['tisdag',2],['onsdag',3],['torsdag',4],['fredag',5],['lördag',6],['lordag',6],
  // HR
  ['nedjelja',0],['ponedjeljak',1],['utorak',2],['srijeda',3],['četvrtak',4],['petak',5],['subota',6],
  // SQ
  ['e diele',0],['e hënë',1],['e hene',1],['e martë',2],['e marte',2],['e mërkurë',3],['e merkure',3],
  ['e enjte',4],['e premte',5],['e shtunë',6],['e shtune',6],
] as [string, number][]).sort((a, b) => b[0].length - a[0].length)

// ── Keywords that introduce return date (all languages) ───────────────────────
// Order matters: longer strings first to avoid partial matches
const RETURN_SPLIT_RE = new RegExp(
  '\\s+(?:' + [
    // EN
    'returning on','returning','return on','return date','come back on','coming back on','coming back','back on','back',
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
const ORIGIN_PREFIX_RE = /^(?:from|from the|fly|flight|book|find|cheap|cheapest|best|search|get me|show me|i want to fly|i want to go|i need to fly|i need to go|von|ab|von\s+|aus|desde|desde el|desde la|de|de\s+|depuis|depuis le|depuis la|da|da\s+|uit|van|vanaf|vanuit|z|ze|ze\s+|från|fran|iz|nga)\s+/i
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
const REL_WEEKEND_RE = /\b(?:weekend|this weekend|wochenende|fin de semana|week-?end|fine settimana|weekeinde|vikend|helg)\b/i
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
    const start = iataWm.index
    const end = start + 3
    if (ranges.some(r => start < r.end && end > r.start)) continue
    const cityEntry = CITY_TO_IATA[token]
    if (cityEntry) { ranges.push({ start, end, code: cityEntry.code, name: cityEntry.name }); continue }
    const airportEntry = findExactLocationMatch(token)
    if (airportEntry) ranges.push({ start, end, code: airportEntry.code, name: airportEntry.name })
  }

  if (ranges.length < 2) return null
  ranges.sort((a, b) => a.start - b.start)
  return [ranges[0], ranges[1]]
}

// ── Main parse function ───────────────────────────────────────────────────────

export function parseNLQuery(query: string): ParsedQuery {
  // Normalise: trim, collapse whitespace, strip leading/trailing punctuation
  const q = query.trim().replace(/\s+/g, ' ').replace(/^[,.:!?]+|[,.:!?]+$/g, '')
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

  // ── 1. Split at return keywords ──────────────────────────────────────────
  const returnSplitMatch = ql.match(RETURN_SPLIT_RE)
  const returnSplitIdx = returnSplitMatch ? ql.indexOf(returnSplitMatch[0]) : -1
  const outboundRaw = returnSplitIdx >= 0 ? q.slice(0, returnSplitIdx) : q
  const returnRaw = returnSplitIdx >= 0 ? q.slice(returnSplitIdx + returnSplitMatch![0].length) : null

  // ── 2. Extract cities from outbound part ─────────────────────────────────
  // Try multiple route separator patterns
  const routePatterns = [
    // "ORIGIN to DESTINATION"
    /^(.+?)\s+(?:to(?:\s+the)?|→|->|–)\s+(.+?)(?:\s+(?:on|in|for|at|around|circa|um|am|le|el|il|em|på|na)\s|\s+\d|\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|januar|février|fevrier|mars|abril|mayo|junio|julio|agosto|septembre|outubro|novembre)|$)/i,
    // "ORIGIN - DESTINATION" (dash as separator, not range)
    /^(.+?)\s+-\s+(.+?)(?:\s+\d|\s+(?:jan|feb|mar|may|jun|jul|aug|sep|oct|nov|dec)|$)/i,
    // "ORIGIN nach/para/à/naar/do/till DESTINATION"
    /^(.+?)\s+(?:nach|para|à|naar|do|till|na|drejt|leti)\s+(.+?)(?:\s+\d|\s+(?:jan|feb|mar|may)|$)/i,
  ]

  let originStr = '', destStr = ''
  for (const pat of routePatterns) {
    const m = outboundRaw.match(pat)
    if (m) {
      originStr = m[1].trim()
      destStr = m[2].trim()
      break
    }
  }

  // Strip filler prefixes
  if (originStr) {
    originStr = originStr.replace(ORIGIN_PREFIX_RE, '').trim()
  }
  if (destStr) {
    // Stop destination string at common date lead-ins that weren't caught by the regex
    destStr = destStr
      // "next month" and multilingual equivalents must come first (before the next/this weekday rule)
      .replace(/\s+(?:next\s+month|nächsten?\s+monat|le\s+mois\s+prochain|el\s+(?:pr[oó]ximo\s+mes|mes\s+que\s+viene)|il\s+mese\s+prossimo|volgende\s+maand|n[aä]sta\s+m[aå]nad|sljedeći\s+mjesec|przyszłym?\s+miesiącu?|pr[oó]ximo\s+m[eê]s|muajin\s+e\s+ardhsh[eë]m|w\s+przyszłym\s+miesi[aą]cu)\b.*/i, '')
      .replace(/\s+(?:(?:next|this)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend)|(?:the\s+week\s+of\s+thanksgiving|thanksgiving\s+week|thanksgiving))\b.*/i, '')
      .replace(/\s+(?:on|in|for|at|around|circa|um|am|le|el|il|em|på|na|dne|dia|den|am)\s.*/i, '')
      .replace(/\s+\d{1,2}(?:st|nd|rd|th)?\s.*/i, '')
      .replace(DEST_PREFIX_RE, '')
      .trim()
  }

  // Resolve cities
  if (originStr) {
    const r = resolveLocation(originStr)
    if (r) { result.origin = r.code; result.origin_name = r.name }
    else result.failed_origin_raw = originStr
  }

  if (destStr) {
    const r = resolveLocation(destStr)
    if (r) { result.destination = r.code; result.destination_name = r.name }
    else result.failed_destination_raw = destStr
  }

  // ── 2b. Two-city fallback: no separator, no route match ─────────────────────
  // Handles bare city-pair queries: "Stuttgart Gdansk", "Berlin Rome June", etc.
  if (!result.origin && !result.destination && !result.anywhere_destination) {
    const cleaned = ql
      .replace(/\b\d{4}\b/g, ' ')
      .replace(/\b\d{1,2}(?:st|nd|rd|th)?\b/g, ' ')
      .replace(/\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/gi, ' ')
      .replace(/\b(?:januar|februar|m(?:ae|ä)rz|mai|juni|juli|oktober|dezember|avril|mayo|junio|julio|agosto|enero|diciembre)\b/gi, ' ')
      .replace(/\b(?:next|this|in|on|for|at|around|under|below|over|above|max|budget|up|to|less|than)\b/gi, ' ')
      .replace(/\b(?:weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, ' ')
      .replace(/[$€£¥₹]\s*\d+|\b\d+\s*(?:dollars?|euros?|pounds?|usd|eur|gbp)\b/gi, ' ')
      .replace(/\s+/g, ' ').trim()
    const pair = findTwoCitiesInText(cleaned)
    if (pair) {
      result.origin = pair[0].code
      result.origin_name = pair[0].name
      result.destination = pair[1].code
      result.destination_name = pair[1].name
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

    // DD/MM or DD.MM (no year — assume current/next year)
    const dmM = t.match(/\b(\d{1,2})[./](\d{1,2})\b/)
    if (dmM) {
      const day = parseInt(dmM[1]), mon = parseInt(dmM[2]) - 1
      if (day >= 1 && day <= 31 && mon >= 0 && mon <= 11) {
        const d = new Date(today.getFullYear(), mon, day)
        if (d < today) d.setFullYear(today.getFullYear() + 1)
        return toLocalDateStr(d)
      }
    }

    // "15th May", "May 15", "15 mai", "le 15 mai", "am 15. mai", etc.
    // Build a token list and search for day+month in any order
    // First strip common lead-in prepositions
    const cleaned = tl.replace(/\b(?:on|le|am|el|il|em|dne|den|dia|på|na|the)\b/g, ' ').replace(/\s+/g,' ').trim()

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

  // If no date found, default to 1 week from today
  if (!result.date) {
    const d = new Date(today)
    d.setDate(today.getDate() + 7)
    result.date = toLocalDateStr(d)
  }

  // ── 5. Extract return date ───────────────────────────────────────────────
  if (returnRaw) {
    result.return_date = extractDate(returnRaw)
  } else {
    // No explicit return keyword — scan for two date expressions (implicit round-trip)
    // Handles: "May 1st, May 6th" / "May 1-6" / "1 May - 6 May" / "May 1 to May 6"
    const pair = scanTwoDates(outboundRaw)
    if (pair) result.return_date = pair[1]
  }

  // ── 6. Extract cabin class + direct filter from full query ───────────────
  const cabin = extractCabin(q)
  if (cabin) result.cabin = cabin
  if (extractDirect(q)) result.stops = 0

  // ── 7. Trip duration range ("for 14 days", "14-18 day trip", "back in 2 weeks") ──
  // Patterns: "for X days", "for X-Y days", "X-Y day trip", "X to Y days", "stay X-Y nights"
  const tripDurRe = /\bfor\s+(\d+)\s*[-–to]\s*(\d+)\s*(?:days?|nights?|nächte?|jours?|giorni?|dias?|netter|dagar|dana|ditë)\b/i
  const tripDurRe2 = /\b(\d+)\s*[-–]\s*(\d+)\s*[-\s]?(?:day|days|night|nights|nächte?|jours?|giorni?|dias?|dagar|dana)\s*(?:trip|holiday|vacation|urlaub|vacances|vacanza|vakantie|semester|ferien|viagem|viaje)?\b/i
  const tripDurSingleRe = /\bfor\s+(\d+)\s+(?:days?|nights?|nächte?|jours?|giorni?|dias?|dagar|dana|ditë)\b/i
  const tripDurWeeksRe = /\bfor\s+(\d+)\s*[-–to]\s*(\d+)\s*weeks?\b/i
  const tripDurWeekSingleRe = /\bfor\s+(\d+)\s+weeks?\b/i
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
              result.min_trip_days = parseInt(twsm[1]) * 7
              result.max_trip_days = parseInt(twsm[1]) * 7
            }
          }
        }
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
  const anywhereRe = /\b(?:anywhere|wherever(?:\s+is\s+(?:cheapest|cheapest|cheaper|cheap|best))?|any(?:\s+destination|\s+airport|\s+country|\s+place)?|surprise\s+me|wherever\s+i\s+can\s+go|irgendwo(?:hin)?|peu\s+importe|partout|qualunque\s+destinazione?|donde\s+sea|cualquier\s+(?:destino|lugar)|overalt|varsomhelst|bilo\s+gdje|kudo)\b/i
  if (anywhereRe.test(q)) {
    result.anywhere_destination = true
    // Clear the failed destination since it's intentional
    delete result.failed_destination_raw
    // Keep destination undefined so the UI can show an "Explore" mode
  }

  return result
}
