import { GENERATED_AIRPORT_SUPPLEMENT } from './lib/generated-airport-supplement'
import { GENERATED_LOCATIONS, type GeneratedLocationEntry } from './lib/generated-locations'

// Airport database with locale-aware names
// Format: { code, names: { locale: name }, country }

export interface Airport {
  code: string
  names: Record<string, string>
  country: string
  isCity?: boolean  // true for multi-airport city entries (LON, NYC, PAR, …)
}

// Top 200+ airports worldwide with localized names where relevant
export const AIRPORTS: Airport[] = [
  // Poland
  { code: 'GDN', names: { en: 'Gdansk', pl: 'Gdańsk', de: 'Danzig', fr: 'Gdańsk', es: 'Gdansk', it: 'Danzica', nl: 'Gdansk', sv: 'Gdansk', zh: '格但斯克', ja: 'グダニスク' }, country: 'PL' },
  { code: 'WAW', names: { en: 'Warsaw', pl: 'Warszawa', de: 'Warschau', fr: 'Varsovie', es: 'Varsovia', it: 'Varsavia', nl: 'Warschau', sv: 'Warszawa', zh: '华沙', ja: 'ワルシャワ' }, country: 'PL' },
  { code: 'KRK', names: { en: 'Krakow', pl: 'Kraków', de: 'Krakau', fr: 'Cracovie', es: 'Cracovia', it: 'Cracovia', nl: 'Krakau', sv: 'Kraków', zh: '克拉科夫', ja: 'クラクフ' }, country: 'PL' },
  { code: 'WRO', names: { en: 'Wroclaw', pl: 'Wrocław', de: 'Breslau', fr: 'Wrocław', es: 'Breslavia', it: 'Breslavia', nl: 'Wroclaw', sv: 'Wrocław', zh: '弗罗茨瓦夫', ja: 'ヴロツワフ' }, country: 'PL' },
  { code: 'POZ', names: { en: 'Poznan', pl: 'Poznań', de: 'Posen', fr: 'Poznań', es: 'Poznań', it: 'Poznań', nl: 'Poznań', sv: 'Poznań', zh: '波兹南', ja: 'ポズナン' }, country: 'PL' },
  { code: 'KTW', names: { en: 'Katowice', pl: 'Katowice', de: 'Kattowitz', fr: 'Katowice', es: 'Katowice', it: 'Katowice', nl: 'Katowice', sv: 'Katowice', zh: '卡托维兹', ja: 'カトヴィツェ' }, country: 'PL' },
  { code: 'LCJ', names: { en: 'Lodz', pl: 'Łódź', de: 'Lodz', fr: 'Łódź', es: 'Łódź', it: 'Łódź', nl: 'Łódź', sv: 'Łódź', zh: '罗兹', ja: 'ウッチ' }, country: 'PL' },
  { code: 'RZE', names: { en: 'Rzeszow', pl: 'Rzeszów', de: 'Rzeszów', fr: 'Rzeszów', es: 'Rzeszów', it: 'Rzeszów', nl: 'Rzeszów', sv: 'Rzeszów', zh: '热舒夫', ja: 'ジェシュフ' }, country: 'PL' },
  { code: 'SZZ', names: { en: 'Szczecin', pl: 'Szczecin', de: 'Stettin', fr: 'Szczecin', es: 'Szczecin', it: 'Stettino', nl: 'Szczecin', sv: 'Szczecin', zh: '什切青', ja: 'シュチェチン' }, country: 'PL' },
  { code: 'BZG', names: { en: 'Bydgoszcz', pl: 'Bydgoszcz', de: 'Bromberg', fr: 'Bydgoszcz', es: 'Bydgoszcz', it: 'Bydgoszcz', nl: 'Bydgoszcz', sv: 'Bydgoszcz', zh: '比得哥什', ja: 'ビドゴシュチュ' }, country: 'PL' },

  // Spain
  { code: 'BCN', names: { en: 'Barcelona', es: 'Barcelona', fr: 'Barcelone', it: 'Barcellona', de: 'Barcelona', nl: 'Barcelona', pt: 'Barcelona', sv: 'Barcelona', zh: '巴塞罗那', ja: 'バルセロナ', pl: 'Barcelona' }, country: 'ES' },
  { code: 'MAD', names: { en: 'Madrid', es: 'Madrid', fr: 'Madrid', it: 'Madrid', de: 'Madrid', nl: 'Madrid', pt: 'Madrid', sv: 'Madrid', zh: '马德里', ja: 'マドリード', pl: 'Madryt' }, country: 'ES' },
  { code: 'PMI', names: { en: 'Palma de Mallorca', es: 'Palma de Mallorca', de: 'Palma de Mallorca', fr: 'Palma de Majorque', it: 'Palma di Maiorca', nl: 'Palma de Mallorca', pt: 'Palma de Maiorca', sv: 'Palma de Mallorca', zh: '马略卡岛帕尔马', ja: 'パルマ・デ・マヨルカ', pl: 'Palma de Mallorca' }, country: 'ES' },
  { code: 'AGP', names: { en: 'Malaga', es: 'Málaga', fr: 'Malaga', it: 'Malaga', de: 'Málaga', nl: 'Malaga', pt: 'Málaga', sv: 'Malaga', zh: '马拉加', ja: 'マラガ', pl: 'Malaga' }, country: 'ES' },
  { code: 'ALC', names: { en: 'Alicante', es: 'Alicante', fr: 'Alicante', it: 'Alicante', de: 'Alicante', nl: 'Alicante', pt: 'Alicante', sv: 'Alicante', zh: '阿利坎特', ja: 'アリカンテ', pl: 'Alicante' }, country: 'ES' },
  { code: 'VLC', names: { en: 'Valencia', es: 'Valencia', fr: 'Valence', it: 'Valencia', de: 'Valencia', nl: 'Valencia', pt: 'Valência', sv: 'Valencia', zh: '巴伦西亚', ja: 'バレンシア', pl: 'Walencja' }, country: 'ES' },
  { code: 'SVQ', names: { en: 'Seville', es: 'Sevilla', fr: 'Séville', it: 'Siviglia', de: 'Sevilla', nl: 'Sevilla', pt: 'Sevilha', sv: 'Sevilla', zh: '塞维利亚', ja: 'セビリャ', pl: 'Sewilla' }, country: 'ES' },
  { code: 'IBZ', names: { en: 'Ibiza', es: 'Ibiza', fr: 'Ibiza', it: 'Ibiza', de: 'Ibiza', nl: 'Ibiza', pt: 'Ibiza', sv: 'Ibiza', zh: '伊比沙岛', ja: 'イビサ', pl: 'Ibiza' }, country: 'ES' },
  { code: 'TFS', names: { en: 'Tenerife South', es: 'Tenerife Sur', fr: 'Ténérife Sud', it: 'Tenerife Sud', de: 'Teneriffa Süd', nl: 'Tenerife Zuid', pt: 'Tenerife Sul', sv: 'Teneriffa Syd', zh: '特内里费南部', ja: 'テネリフェ南', pl: 'Teneryfa Południe' }, country: 'ES' },
  { code: 'LPA', names: { en: 'Gran Canaria', es: 'Gran Canaria', fr: 'Grande Canarie', it: 'Gran Canaria', de: 'Gran Canaria', nl: 'Gran Canaria', pt: 'Gran Canária', sv: 'Gran Canaria', zh: '大加纳利岛', ja: 'グラン・カナリア', pl: 'Gran Canaria' }, country: 'ES' },
  { code: 'BIO', names: { en: 'Bilbao', es: 'Bilbao', fr: 'Bilbao', it: 'Bilbao', de: 'Bilbao', nl: 'Bilbao', pt: 'Bilbau', sv: 'Bilbao', zh: '毕尔巴鄂', ja: 'ビルバオ', pl: 'Bilbao' }, country: 'ES' },

  // UK
  { code: 'LHR', names: { en: 'London Heathrow', de: 'London Heathrow', fr: 'Londres Heathrow', es: 'Londres Heathrow', it: 'Londra Heathrow', nl: 'Londen Heathrow', pt: 'Londres Heathrow', sv: 'London Heathrow', zh: '伦敦希思罗', ja: 'ロンドン・ヒースロー', pl: 'Londyn Heathrow' }, country: 'GB' },
  { code: 'LGW', names: { en: 'London Gatwick', de: 'London Gatwick', fr: 'Londres Gatwick', es: 'Londres Gatwick', it: 'Londra Gatwick', nl: 'Londen Gatwick', pt: 'Londres Gatwick', sv: 'London Gatwick', zh: '伦敦盖特威克', ja: 'ロンドン・ガトウィック', pl: 'Londyn Gatwick' }, country: 'GB' },
  { code: 'STN', names: { en: 'London Stansted', de: 'London Stansted', fr: 'Londres Stansted', es: 'Londres Stansted', it: 'Londra Stansted', nl: 'Londen Stansted', pt: 'Londres Stansted', sv: 'London Stansted', zh: '伦敦斯坦斯特德', ja: 'ロンドン・スタンステッド', pl: 'Londyn Stansted' }, country: 'GB' },
  { code: 'LTN', names: { en: 'London Luton', de: 'London Luton', fr: 'Londres Luton', es: 'Londres Luton', it: 'Londra Luton', nl: 'Londen Luton', pt: 'Londres Luton', sv: 'London Luton', zh: '伦敦卢顿', ja: 'ロンドン・ルートン', pl: 'Londyn Luton' }, country: 'GB' },
  { code: 'MAN', names: { en: 'Manchester', de: 'Manchester', fr: 'Manchester', es: 'Mánchester', it: 'Manchester', nl: 'Manchester', pt: 'Manchester', sv: 'Manchester', zh: '曼彻斯特', ja: 'マンチェスター', pl: 'Manchester' }, country: 'GB' },
  { code: 'EDI', names: { en: 'Edinburgh', de: 'Edinburgh', fr: 'Édimbourg', es: 'Edimburgo', it: 'Edimburgo', nl: 'Edinburgh', pt: 'Edimburgo', sv: 'Edinburgh', zh: '爱丁堡', ja: 'エディンバラ', pl: 'Edynburg' }, country: 'GB' },
  { code: 'BHX', names: { en: 'Birmingham', de: 'Birmingham', fr: 'Birmingham', es: 'Birmingham', it: 'Birmingham', nl: 'Birmingham', pt: 'Birmingham', sv: 'Birmingham', zh: '伯明翰', ja: 'バーミンガム', pl: 'Birmingham' }, country: 'GB' },
  { code: 'GLA', names: { en: 'Glasgow', de: 'Glasgow', fr: 'Glasgow', es: 'Glasgow', it: 'Glasgow', nl: 'Glasgow', pt: 'Glasgow', sv: 'Glasgow', zh: '格拉斯哥', ja: 'グラスゴー', pl: 'Glasgow' }, country: 'GB' },
  { code: 'BRS', names: { en: 'Bristol', de: 'Bristol', fr: 'Bristol', es: 'Bristol', it: 'Bristol', nl: 'Bristol', pt: 'Bristol', sv: 'Bristol', zh: '布里斯托尔', ja: 'ブリストル', pl: 'Bristol' }, country: 'GB' },
  { code: 'NCL', names: { en: 'Newcastle', de: 'Newcastle', fr: 'Newcastle', es: 'Newcastle', it: 'Newcastle', nl: 'Newcastle', pt: 'Newcastle', sv: 'Newcastle', zh: '纽卡斯尔', ja: 'ニューカッスル', pl: 'Newcastle' }, country: 'GB' },
  { code: 'LPL', names: { en: 'Liverpool', de: 'Liverpool', fr: 'Liverpool', es: 'Liverpool', it: 'Liverpool', nl: 'Liverpool', pt: 'Liverpool', sv: 'Liverpool', zh: '利物浦', ja: 'リバプール', pl: 'Liverpool' }, country: 'GB' },
  { code: 'EMA', names: { en: 'East Midlands', de: 'East Midlands', fr: 'East Midlands', es: 'East Midlands', it: 'East Midlands', nl: 'East Midlands', pt: 'East Midlands', sv: 'East Midlands', zh: '东米德兰兹', ja: 'イースト・ミッドランズ', pl: 'East Midlands' }, country: 'GB' },
  { code: 'LBA', names: { en: 'Leeds Bradford', de: 'Leeds Bradford', fr: 'Leeds Bradford', es: 'Leeds Bradford', it: 'Leeds Bradford', nl: 'Leeds Bradford', pt: 'Leeds Bradford', sv: 'Leeds Bradford', zh: '利兹布拉德福德', ja: 'リーズ・ブラッドフォード', pl: 'Leeds Bradford' }, country: 'GB' },

  // Germany
  { code: 'FRA', names: { en: 'Frankfurt', de: 'Frankfurt', fr: 'Francfort', es: 'Fráncfort', it: 'Francoforte', nl: 'Frankfurt', pt: 'Francoforte', sv: 'Frankfurt', zh: '法兰克福', ja: 'フランクフルト', pl: 'Frankfurt' }, country: 'DE' },
  { code: 'MUC', names: { en: 'Munich', de: 'München', fr: 'Munich', it: 'Monaco', es: 'Múnich', nl: 'München', pt: 'Munique', sv: 'München', zh: '慕尼黑', ja: 'ミュンヘン', pl: 'Monachium' }, country: 'DE' },
  { code: 'BER', names: { en: 'Berlin', de: 'Berlin', fr: 'Berlin', it: 'Berlino', es: 'Berlín', nl: 'Berlijn', pt: 'Berlim', sv: 'Berlin', zh: '柏林', ja: 'ベルリン', pl: 'Berlin' }, country: 'DE' },
  { code: 'DUS', names: { en: 'Dusseldorf', de: 'Düsseldorf', fr: 'Düsseldorf', it: 'Düsseldorf', es: 'Düsseldorf', nl: 'Düsseldorf', pt: 'Düsseldorf', sv: 'Düsseldorf', zh: '杜塞尔多夫', ja: 'デュッセルドルフ', pl: 'Düsseldorf' }, country: 'DE' },
  { code: 'HAM', names: { en: 'Hamburg', de: 'Hamburg', fr: 'Hambourg', it: 'Amburgo', es: 'Hamburgo', nl: 'Hamburg', pt: 'Hamburgo', sv: 'Hamburg', zh: '汉堡', ja: 'ハンブルク', pl: 'Hamburg' }, country: 'DE' },
  { code: 'CGN', names: { en: 'Cologne', de: 'Köln', fr: 'Cologne', it: 'Colonia', es: 'Colonia', nl: 'Keulen', pt: 'Colônia', sv: 'Köln', zh: '科隆', ja: 'ケルン', pl: 'Kolonia' }, country: 'DE' },
  { code: 'STR', names: { en: 'Stuttgart', de: 'Stuttgart', fr: 'Stuttgart', it: 'Stoccarda', es: 'Stuttgart', nl: 'Stuttgart', pt: 'Stuttgart', sv: 'Stuttgart', zh: '斯图加特', ja: 'シュトゥットガルト', pl: 'Stuttgart' }, country: 'DE' },
  { code: 'HAJ', names: { en: 'Hanover', de: 'Hannover', fr: 'Hanovre', it: 'Hannover', es: 'Hannover', nl: 'Hannover', pt: 'Hanover', sv: 'Hannover', zh: '汉诺威', ja: 'ハノーファー', pl: 'Hanower' }, country: 'DE' },
  { code: 'NUE', names: { en: 'Nuremberg', de: 'Nürnberg', fr: 'Nuremberg', it: 'Norimberga', es: 'Núremberg', nl: 'Neurenberg', pt: 'Nuremberga', sv: 'Nürnberg', zh: '纽伦堡', ja: 'ニュルンベルク', pl: 'Norymberga' }, country: 'DE' },
  { code: 'LEJ', names: { en: 'Leipzig', de: 'Leipzig', fr: 'Leipzig', it: 'Lipsia', es: 'Leipzig', nl: 'Leipzig', pt: 'Leipzig', sv: 'Leipzig', zh: '莱比锡', ja: 'ライプツィヒ', pl: 'Lipsk' }, country: 'DE' },
  { code: 'DRS', names: { en: 'Dresden', de: 'Dresden', fr: 'Dresde', it: 'Dresda', es: 'Dresde', nl: 'Dresden', pt: 'Dresda', sv: 'Dresden', zh: '德累斯顿', ja: 'ドレスデン', pl: 'Drezno' }, country: 'DE' },
  { code: 'DTM', names: { en: 'Dortmund', de: 'Dortmund', fr: 'Dortmund', it: 'Dortmund', es: 'Dortmund', nl: 'Dortmund', pt: 'Dortmund', sv: 'Dortmund', zh: '多特蒙德', ja: 'ドルトムント', pl: 'Dortmund' }, country: 'DE' },

  // France
  { code: 'CDG', names: { en: 'Paris CDG', fr: 'Paris CDG', de: 'Paris CDG', es: 'París CDG', it: 'Parigi CDG', nl: 'Parijs CDG', pt: 'Paris CDG', sv: 'Paris CDG', zh: '巴黎戴高乐', ja: 'パリ・シャルル・ド・ゴール', pl: 'Paryż CDG' }, country: 'FR' },
  { code: 'ORY', names: { en: 'Paris Orly', fr: 'Paris Orly', de: 'Paris Orly', es: 'París Orly', it: 'Parigi Orly', nl: 'Parijs Orly', pt: 'Paris Orly', sv: 'Paris Orly', zh: '巴黎奥利', ja: 'パリ・オルリー', pl: 'Paryż Orly' }, country: 'FR' },
  { code: 'NCE', names: { en: 'Nice', fr: 'Nice', it: 'Nizza', de: 'Nizza', es: 'Niza', nl: 'Nice', pt: 'Nice', sv: 'Nice', zh: '尼斯', ja: 'ニース', pl: 'Nicea' }, country: 'FR' },
  { code: 'LYS', names: { en: 'Lyon', fr: 'Lyon', de: 'Lyon', es: 'Lyon', it: 'Lione', nl: 'Lyon', pt: 'Lyon', sv: 'Lyon', zh: '里昂', ja: 'リヨン', pl: 'Lyon' }, country: 'FR' },
  { code: 'MRS', names: { en: 'Marseille', fr: 'Marseille', de: 'Marseille', es: 'Marsella', it: 'Marsiglia', nl: 'Marseille', pt: 'Marselha', sv: 'Marseille', zh: '马赛', ja: 'マルセイユ', pl: 'Marsylia' }, country: 'FR' },
  { code: 'TLS', names: { en: 'Toulouse', fr: 'Toulouse', de: 'Toulouse', es: 'Toulouse', it: 'Tolosa', nl: 'Toulouse', pt: 'Toulouse', sv: 'Toulouse', zh: '图卢兹', ja: 'トゥールーズ', pl: 'Tuluza' }, country: 'FR' },
  { code: 'BOD', names: { en: 'Bordeaux', fr: 'Bordeaux', de: 'Bordeaux', es: 'Burdeos', it: 'Bordeaux', nl: 'Bordeaux', pt: 'Bordéus', sv: 'Bordeaux', zh: '波尔多', ja: 'ボルドー', pl: 'Bordeaux' }, country: 'FR' },
  { code: 'NTE', names: { en: 'Nantes', fr: 'Nantes', de: 'Nantes', es: 'Nantes', it: 'Nantes', nl: 'Nantes', pt: 'Nantes', sv: 'Nantes', zh: '南特', ja: 'ナント', pl: 'Nantes' }, country: 'FR' },
  { code: 'SXB', names: { en: 'Strasbourg', fr: 'Strasbourg', de: 'Straßburg', es: 'Estrasburgo', it: 'Strasburgo', nl: 'Straatsburg', pt: 'Estrasburgo', sv: 'Strasbourg', zh: '斯特拉斯堡', ja: 'ストラスブール', pl: 'Strasburg' }, country: 'FR' },

  // Italy
  { code: 'FCO', names: { en: 'Rome', it: 'Roma', fr: 'Rome', de: 'Rom', es: 'Roma', nl: 'Rome', pt: 'Roma', sv: 'Rom', zh: '罗马', ja: 'ローマ', pl: 'Rzym' }, country: 'IT' },
  { code: 'MXP', names: { en: 'Milan Malpensa', it: 'Milano Malpensa', fr: 'Milan Malpensa', de: 'Mailand Malpensa', es: 'Milán Malpensa', nl: 'Milaan Malpensa', pt: 'Milão Malpensa', sv: 'Milano Malpensa', zh: '米兰马尔彭萨', ja: 'ミラノ・マルペンサ', pl: 'Mediolan Malpensa' }, country: 'IT' },
  { code: 'LIN', names: { en: 'Milan Linate', it: 'Milano Linate', fr: 'Milan Linate', de: 'Mailand Linate', es: 'Milán Linate', nl: 'Milaan Linate', pt: 'Milão Linate', sv: 'Milano Linate', zh: '米兰利纳泰', ja: 'ミラノ・リナーテ', pl: 'Mediolan Linate' }, country: 'IT' },
  { code: 'VCE', names: { en: 'Venice', it: 'Venezia', de: 'Venedig', fr: 'Venise', es: 'Venecia', nl: 'Venetië', pt: 'Veneza', sv: 'Venedig', zh: '威尼斯', ja: 'ヴェネツィア', pl: 'Wenecja' }, country: 'IT' },
  { code: 'NAP', names: { en: 'Naples', it: 'Napoli', fr: 'Naples', de: 'Neapel', es: 'Nápoles', nl: 'Napels', pt: 'Nápoles', sv: 'Neapel', zh: '那不勒斯', ja: 'ナポリ', pl: 'Neapol' }, country: 'IT' },
  { code: 'FLR', names: { en: 'Florence', it: 'Firenze', de: 'Florenz', fr: 'Florence', es: 'Florencia', nl: 'Florence', pt: 'Florença', sv: 'Florens', zh: '佛罗伦萨', ja: 'フィレンツェ', pl: 'Florencja' }, country: 'IT' },
  { code: 'BLQ', names: { en: 'Bologna', it: 'Bologna', fr: 'Bologne', de: 'Bologna', es: 'Bolonia', nl: 'Bologna', pt: 'Bolonha', sv: 'Bologna', zh: '博洛尼亚', ja: 'ボローニャ', pl: 'Bolonia' }, country: 'IT' },
  { code: 'PSA', names: { en: 'Pisa', it: 'Pisa', fr: 'Pise', de: 'Pisa', es: 'Pisa', nl: 'Pisa', pt: 'Pisa', sv: 'Pisa', zh: '比萨', ja: 'ピサ', pl: 'Piza' }, country: 'IT' },
  { code: 'CTA', names: { en: 'Catania', it: 'Catania', fr: 'Catane', de: 'Catania', es: 'Catania', nl: 'Catania', pt: 'Catânia', sv: 'Catania', zh: '卡塔尼亚', ja: 'カターニア', pl: 'Katania' }, country: 'IT' },
  { code: 'PMO', names: { en: 'Palermo', it: 'Palermo', fr: 'Palerme', de: 'Palermo', es: 'Palermo', nl: 'Palermo', pt: 'Palermo', sv: 'Palermo', zh: '巴勒莫', ja: 'パレルモ', pl: 'Palermo' }, country: 'IT' },
  { code: 'BGY', names: { en: 'Milan Bergamo', it: 'Milano Bergamo', fr: 'Milan Bergame', de: 'Mailand Bergamo', es: 'Milán Bérgamo', nl: 'Milaan Bergamo', pt: 'Milão Bergamo', sv: 'Milano Bergamo', zh: '米兰贝尔加莫', ja: 'ミラノ・ベルガモ', pl: 'Mediolan Bergamo' }, country: 'IT' },
  { code: 'TRN', names: { en: 'Turin', it: 'Torino', fr: 'Turin', de: 'Turin', es: 'Turín', nl: 'Turijn', pt: 'Turim', sv: 'Turin', zh: '都灵', ja: 'トリノ', pl: 'Turyn' }, country: 'IT' },

  // Netherlands
  { code: 'AMS', names: { en: 'Amsterdam', nl: 'Amsterdam', de: 'Amsterdam', fr: 'Amsterdam', es: 'Ámsterdam', it: 'Amsterdam', pt: 'Amsterdão', sv: 'Amsterdam', zh: '阿姆斯特丹', ja: 'アムステルダム', pl: 'Amsterdam' }, country: 'NL' },
  { code: 'EIN', names: { en: 'Eindhoven', nl: 'Eindhoven', de: 'Eindhoven', fr: 'Eindhoven', es: 'Eindhoven', it: 'Eindhoven', pt: 'Eindhoven', sv: 'Eindhoven', zh: '埃因霍温', ja: 'アイントホーフェン', pl: 'Eindhoven' }, country: 'NL' },
  { code: 'RTM', names: { en: 'Rotterdam', nl: 'Rotterdam', de: 'Rotterdam', fr: 'Rotterdam', es: 'Róterdam', it: 'Rotterdam', pt: 'Roterdão', sv: 'Rotterdam', zh: '鹿特丹', ja: 'ロッテルダム', pl: 'Rotterdam' }, country: 'NL' },

  // Portugal
  { code: 'LIS', names: { en: 'Lisbon', pt: 'Lisboa', es: 'Lisboa', fr: 'Lisbonne', de: 'Lissabon', it: 'Lisbona', nl: 'Lissabon', sv: 'Lissabon', zh: '里斯本', ja: 'リスボン', pl: 'Lizbona' }, country: 'PT' },
  { code: 'OPO', names: { en: 'Porto', pt: 'Porto', es: 'Oporto', fr: 'Porto', de: 'Porto', it: 'Porto', nl: 'Porto', sv: 'Porto', zh: '波尔图', ja: 'ポルト', pl: 'Porto' }, country: 'PT' },
  { code: 'FAO', names: { en: 'Faro', pt: 'Faro', es: 'Faro', fr: 'Faro', de: 'Faro', it: 'Faro', nl: 'Faro', sv: 'Faro', zh: '法罗', ja: 'ファロ', pl: 'Faro' }, country: 'PT' },
  { code: 'FNC', names: { en: 'Funchal Madeira', pt: 'Funchal', es: 'Funchal', fr: 'Funchal', de: 'Funchal', it: 'Funchal', nl: 'Funchal', sv: 'Funchal', zh: '丰沙尔马德拉', ja: 'フンシャル', pl: 'Funchal' }, country: 'PT' },

  // Croatia
  { code: 'ZAG', names: { en: 'Zagreb', hr: 'Zagreb', de: 'Zagreb', fr: 'Zagreb', es: 'Zagreb', it: 'Zagabria', nl: 'Zagreb', pt: 'Zagreb', sv: 'Zagreb', zh: '萨格勒布', ja: 'ザグレブ', pl: 'Zagrzeb' }, country: 'HR' },
  { code: 'SPU', names: { en: 'Split', hr: 'Split', de: 'Split', fr: 'Split', es: 'Split', it: 'Spalato', nl: 'Split', pt: 'Split', sv: 'Split', zh: '斯普利特', ja: 'スプリト', pl: 'Split' }, country: 'HR' },
  { code: 'DBV', names: { en: 'Dubrovnik', hr: 'Dubrovnik', de: 'Dubrovnik', fr: 'Dubrovnik', es: 'Dubrovnik', it: 'Dubrovnik', nl: 'Dubrovnik', pt: 'Dubrovnik', sv: 'Dubrovnik', zh: '杜布罗夫尼克', ja: 'ドゥブロヴニク', pl: 'Dubrownik' }, country: 'HR' },
  { code: 'ZAD', names: { en: 'Zadar', hr: 'Zadar', de: 'Zadar', fr: 'Zadar', es: 'Zadar', it: 'Zara', nl: 'Zadar', pt: 'Zadar', sv: 'Zadar', zh: '扎达尔', ja: 'ザダル', pl: 'Zadar' }, country: 'HR' },
  { code: 'PUY', names: { en: 'Pula', hr: 'Pula', de: 'Pula', fr: 'Pula', es: 'Pula', it: 'Pola', nl: 'Pula', pt: 'Pula', sv: 'Pula', zh: '普拉', ja: 'プーラ', pl: 'Pula' }, country: 'HR' },

  // Sweden
  { code: 'ARN', names: { en: 'Stockholm Arlanda', sv: 'Stockholm Arlanda', de: 'Stockholm Arlanda', fr: 'Stockholm Arlanda', es: 'Estocolmo Arlanda', it: 'Stoccolma Arlanda', nl: 'Stockholm Arlanda', pt: 'Estocolmo Arlanda', zh: '斯德哥尔摩阿兰达', ja: 'ストックホルム・アーランダ', pl: 'Sztokholm Arlanda' }, country: 'SE' },
  { code: 'GOT', names: { en: 'Gothenburg', sv: 'Göteborg', de: 'Göteborg', fr: 'Göteborg', es: 'Gotemburgo', it: 'Göteborg', nl: 'Göteborg', pt: 'Gotemburgo', zh: '哥德堡', ja: 'イェーテボリ', pl: 'Göteborg' }, country: 'SE' },
  { code: 'MMX', names: { en: 'Malmo', sv: 'Malmö', de: 'Malmö', fr: 'Malmö', es: 'Malmö', it: 'Malmö', nl: 'Malmö', pt: 'Malmö', zh: '马尔默', ja: 'マルメ', pl: 'Malmö' }, country: 'SE' },

  // Albania
  { code: 'TIA', names: { en: 'Tirana', sq: 'Tiranë', de: 'Tirana', fr: 'Tirana', es: 'Tirana', it: 'Tirana', nl: 'Tirana', pt: 'Tirana', sv: 'Tirana', zh: '地拉那', ja: 'ティラナ', pl: 'Tirana', hr: 'Tirana' }, country: 'AL' },

  // Greece
  { code: 'ATH', names: { en: 'Athens', de: 'Athen', fr: 'Athènes', it: 'Atene', es: 'Atenas', nl: 'Athene', pt: 'Atenas', sv: 'Aten', zh: '雅典', ja: 'アテネ', pl: 'Ateny', hr: 'Atena' }, country: 'GR' },
  { code: 'SKG', names: { en: 'Thessaloniki', de: 'Thessaloniki', fr: 'Thessalonique', it: 'Salonicco', es: 'Salónica', nl: 'Thessaloniki', pt: 'Tessalónica', sv: 'Thessaloniki', zh: '塞萨洛尼基', ja: 'テッサロニキ', pl: 'Saloniki' }, country: 'GR' },
  { code: 'HER', names: { en: 'Heraklion', de: 'Heraklion', fr: 'Héraklion', it: 'Heraklion', es: 'Heraclión', nl: 'Heraklion', pt: 'Heraclião', sv: 'Heraklion', zh: '伊拉克利翁', ja: 'イラクリオン', pl: 'Heraklion' }, country: 'GR' },
  { code: 'RHO', names: { en: 'Rhodes', de: 'Rhodos', it: 'Rodi', fr: 'Rhodes', es: 'Rodas', nl: 'Rhodos', pt: 'Rodes', sv: 'Rhodos', zh: '罗得岛', ja: 'ロードス島', pl: 'Rodos' }, country: 'GR' },
  { code: 'CFU', names: { en: 'Corfu', de: 'Korfu', it: 'Corfù', fr: 'Corfou', es: 'Corfú', nl: 'Corfu', pt: 'Corfu', sv: 'Korfu', zh: '科孚岛', ja: 'コルフ島', pl: 'Korfu' }, country: 'GR' },
  { code: 'JTR', names: { en: 'Santorini', de: 'Santorin', fr: 'Santorin', it: 'Santorini', es: 'Santorini', nl: 'Santorini', pt: 'Santorini', sv: 'Santorini', zh: '圣托里尼', ja: 'サントリーニ島', pl: 'Santoryn' }, country: 'GR' },
  { code: 'JMK', names: { en: 'Mykonos', de: 'Mykonos', fr: 'Mykonos', it: 'Mykonos', es: 'Mikonos', nl: 'Mykonos', pt: 'Mykonos', sv: 'Mykonos', zh: '米科诺斯岛', ja: 'ミコノス島', pl: 'Mykonos' }, country: 'GR' },

  // Turkey
  { code: 'IST', names: { en: 'Istanbul', de: 'Istanbul', fr: 'Istanbul', it: 'Istanbul', es: 'Estambul', nl: 'Istanbul', pt: 'Istambul', sv: 'Istanbul', zh: '伊斯坦布尔', ja: 'イスタンブール', pl: 'Stambuł', hr: 'Istanbul' }, country: 'TR' },
  { code: 'SAW', names: { en: 'Istanbul Sabiha', de: 'Istanbul Sabiha', fr: 'Istanbul Sabiha', it: 'Istanbul Sabiha', es: 'Estambul Sabiha', nl: 'Istanbul Sabiha', pt: 'Istambul Sabiha', sv: 'Istanbul Sabiha', zh: '伊斯坦布尔萨比哈', ja: 'イスタンブール・サビハ', pl: 'Stambuł Sabiha' }, country: 'TR' },
  { code: 'AYT', names: { en: 'Antalya', de: 'Antalya', fr: 'Antalya', it: 'Antalya', es: 'Antalya', nl: 'Antalya', pt: 'Antalya', sv: 'Antalya', zh: '安塔利亚', ja: 'アンタルヤ', pl: 'Antalya' }, country: 'TR' },
  { code: 'ADB', names: { en: 'Izmir', de: 'Izmir', fr: 'Izmir', it: 'Smirne', es: 'Esmirna', nl: 'Izmir', pt: 'Esmirna', sv: 'Izmir', zh: '伊兹密尔', ja: 'イズミル', pl: 'Izmir' }, country: 'TR' },
  { code: 'BJV', names: { en: 'Bodrum', de: 'Bodrum', fr: 'Bodrum', it: 'Bodrum', es: 'Bodrum', nl: 'Bodrum', pt: 'Bodrum', sv: 'Bodrum', zh: '博德鲁姆', ja: 'ボドルム', pl: 'Bodrum' }, country: 'TR' },
  { code: 'DLM', names: { en: 'Dalaman', de: 'Dalaman', fr: 'Dalaman', it: 'Dalaman', es: 'Dalaman', nl: 'Dalaman', pt: 'Dalaman', sv: 'Dalaman', zh: '达拉曼', ja: 'ダラマン', pl: 'Dalaman' }, country: 'TR' },

  // USA
  { code: 'JFK', names: { en: 'New York JFK', es: 'Nueva York', fr: 'New York', de: 'New York', it: 'New York', nl: 'New York', pt: 'Nova Iorque', sv: 'New York', zh: '纽约肯尼迪', ja: 'ニューヨーク JFK', pl: 'Nowy Jork JFK' }, country: 'US' },
  { code: 'EWR', names: { en: 'New York Newark', es: 'Nueva York Newark', fr: 'New York Newark', de: 'New York Newark', it: 'New York Newark', nl: 'New York Newark', pt: 'Nova Iorque Newark', sv: 'New York Newark', zh: '纽约纽瓦克', ja: 'ニューヨーク・ニューアーク', pl: 'Nowy Jork Newark' }, country: 'US' },
  { code: 'LGA', names: { en: 'New York LaGuardia', es: 'Nueva York LaGuardia', fr: 'New York LaGuardia', de: 'New York LaGuardia', it: 'New York LaGuardia', nl: 'New York LaGuardia', pt: 'Nova Iorque LaGuardia', sv: 'New York LaGuardia', zh: '纽约拉瓜迪亚', ja: 'ニューヨーク・ラガーディア', pl: 'Nowy Jork LaGuardia' }, country: 'US' },
  { code: 'LAX', names: { en: 'Los Angeles', es: 'Los Ángeles', fr: 'Los Angeles', de: 'Los Angeles', it: 'Los Angeles', nl: 'Los Angeles', pt: 'Los Angeles', sv: 'Los Angeles', zh: '洛杉矶', ja: 'ロサンゼルス', pl: 'Los Angeles' }, country: 'US' },
  { code: 'SFO', names: { en: 'San Francisco', es: 'San Francisco', fr: 'San Francisco', de: 'San Francisco', it: 'San Francisco', nl: 'San Francisco', pt: 'São Francisco', sv: 'San Francisco', zh: '旧金山', ja: 'サンフランシスコ', pl: 'San Francisco' }, country: 'US' },
  { code: 'ORD', names: { en: 'Chicago', es: 'Chicago', fr: 'Chicago', de: 'Chicago', it: 'Chicago', nl: 'Chicago', pt: 'Chicago', sv: 'Chicago', zh: '芝加哥', ja: 'シカゴ', pl: 'Chicago' }, country: 'US' },
  { code: 'MIA', names: { en: 'Miami', es: 'Miami', fr: 'Miami', de: 'Miami', it: 'Miami', nl: 'Miami', pt: 'Miami', sv: 'Miami', zh: '迈阿密', ja: 'マイアミ', pl: 'Miami' }, country: 'US' },
  { code: 'BOS', names: { en: 'Boston', es: 'Boston', fr: 'Boston', de: 'Boston', it: 'Boston', nl: 'Boston', pt: 'Boston', sv: 'Boston', zh: '波士顿', ja: 'ボストン', pl: 'Boston' }, country: 'US' },
  { code: 'ATL', names: { en: 'Atlanta', es: 'Atlanta', fr: 'Atlanta', de: 'Atlanta', it: 'Atlanta', nl: 'Atlanta', pt: 'Atlanta', sv: 'Atlanta', zh: '亚特兰大', ja: 'アトランタ', pl: 'Atlanta' }, country: 'US' },
  { code: 'DFW', names: { en: 'Dallas', es: 'Dallas', fr: 'Dallas', de: 'Dallas', it: 'Dallas', nl: 'Dallas', pt: 'Dallas', sv: 'Dallas', zh: '达拉斯', ja: 'ダラス', pl: 'Dallas' }, country: 'US' },
  { code: 'DEN', names: { en: 'Denver', es: 'Denver', fr: 'Denver', de: 'Denver', it: 'Denver', nl: 'Denver', pt: 'Denver', sv: 'Denver', zh: '丹佛', ja: 'デンバー', pl: 'Denver' }, country: 'US' },
  { code: 'SEA', names: { en: 'Seattle', es: 'Seattle', fr: 'Seattle', de: 'Seattle', it: 'Seattle', nl: 'Seattle', pt: 'Seattle', sv: 'Seattle', zh: '西雅图', ja: 'シアトル', pl: 'Seattle' }, country: 'US' },
  { code: 'LAS', names: { en: 'Las Vegas', es: 'Las Vegas', fr: 'Las Vegas', de: 'Las Vegas', it: 'Las Vegas', nl: 'Las Vegas', pt: 'Las Vegas', sv: 'Las Vegas', zh: '拉斯维加斯', ja: 'ラスベガス', pl: 'Las Vegas' }, country: 'US' },
  { code: 'PHX', names: { en: 'Phoenix', es: 'Phoenix', fr: 'Phoenix', de: 'Phoenix', it: 'Phoenix', nl: 'Phoenix', pt: 'Phoenix', sv: 'Phoenix', zh: '凤凰城', ja: 'フェニックス', pl: 'Phoenix' }, country: 'US' },
  { code: 'IAH', names: { en: 'Houston', es: 'Houston', fr: 'Houston', de: 'Houston', it: 'Houston', nl: 'Houston', pt: 'Houston', sv: 'Houston', zh: '休斯顿', ja: 'ヒューストン', pl: 'Houston' }, country: 'US' },
  { code: 'MCO', names: { en: 'Orlando', es: 'Orlando', fr: 'Orlando', de: 'Orlando', it: 'Orlando', nl: 'Orlando', pt: 'Orlando', sv: 'Orlando', zh: '奥兰多', ja: 'オーランド', pl: 'Orlando' }, country: 'US' },
  { code: 'FLL', names: { en: 'Fort Lauderdale', es: 'Fort Lauderdale', fr: 'Fort Lauderdale', de: 'Fort Lauderdale', it: 'Fort Lauderdale', nl: 'Fort Lauderdale', pt: 'Fort Lauderdale', sv: 'Fort Lauderdale', zh: '劳德代尔堡', ja: 'フォートローダーデール', pl: 'Fort Lauderdale' }, country: 'US' },
  { code: 'SAN', names: { en: 'San Diego', es: 'San Diego', fr: 'San Diego', de: 'San Diego', it: 'San Diego', nl: 'San Diego', pt: 'San Diego', sv: 'San Diego', zh: '圣地亚哥', ja: 'サンディエゴ', pl: 'San Diego' }, country: 'US' },
  { code: 'HNL', names: { en: 'Honolulu', es: 'Honolulu', fr: 'Honolulu', de: 'Honolulu', it: 'Honolulu', nl: 'Honolulu', pt: 'Honolulu', sv: 'Honolulu', zh: '檀香山', ja: 'ホノルル', pl: 'Honolulu' }, country: 'US' },

  // Canada
  { code: 'YYZ', names: { en: 'Toronto', fr: 'Toronto', de: 'Toronto', es: 'Toronto', it: 'Toronto', nl: 'Toronto', pt: 'Toronto', sv: 'Toronto', zh: '多伦多', ja: 'トロント', pl: 'Toronto' }, country: 'CA' },
  { code: 'YVR', names: { en: 'Vancouver', fr: 'Vancouver', de: 'Vancouver', es: 'Vancouver', it: 'Vancouver', nl: 'Vancouver', pt: 'Vancouver', sv: 'Vancouver', zh: '温哥华', ja: 'バンクーバー', pl: 'Vancouver' }, country: 'CA' },
  { code: 'YUL', names: { en: 'Montreal', fr: 'Montréal', de: 'Montreal', es: 'Montreal', it: 'Montréal', nl: 'Montreal', pt: 'Montreal', sv: 'Montreal', zh: '蒙特利尔', ja: 'モントリオール', pl: 'Montreal' }, country: 'CA' },
  { code: 'YYC', names: { en: 'Calgary', fr: 'Calgary', de: 'Calgary', es: 'Calgary', it: 'Calgary', nl: 'Calgary', pt: 'Calgary', sv: 'Calgary', zh: '卡尔加里', ja: 'カルガリー', pl: 'Calgary' }, country: 'CA' },

  // UAE
  { code: 'DXB', names: { en: 'Dubai', de: 'Dubai', fr: 'Dubaï', es: 'Dubái', it: 'Dubai', nl: 'Dubai', pt: 'Dubai', sv: 'Dubai', zh: '迪拜', ja: 'ドバイ', pl: 'Dubaj', hr: 'Dubai', sq: 'Dubai' }, country: 'AE' },
  { code: 'AUH', names: { en: 'Abu Dhabi', de: 'Abu Dhabi', fr: 'Abou Dabi', es: 'Abu Dabi', it: 'Abu Dhabi', nl: 'Abu Dhabi', pt: 'Abu Dhabi', sv: 'Abu Dhabi', zh: '阿布扎比', ja: 'アブダビ', pl: 'Abu Dhabi' }, country: 'AE' },

  // Japan
  { code: 'NRT', names: { en: 'Tokyo Narita', de: 'Tokio Narita', fr: 'Tokyo Narita', es: 'Tokio Narita', it: 'Tokyo Narita', nl: 'Tokio Narita', pt: 'Tóquio Narita', sv: 'Tokyo Narita', zh: '东京成田', ja: '東京成田', pl: 'Tokio Narita' }, country: 'JP' },
  { code: 'HND', names: { en: 'Tokyo Haneda', de: 'Tokio Haneda', fr: 'Tokyo Haneda', es: 'Tokio Haneda', it: 'Tokyo Haneda', nl: 'Tokio Haneda', pt: 'Tóquio Haneda', sv: 'Tokyo Haneda', zh: '东京羽田', ja: '東京羽田', pl: 'Tokio Haneda' }, country: 'JP' },
  { code: 'KIX', names: { en: 'Osaka', de: 'Osaka', fr: 'Osaka', es: 'Osaka', it: 'Osaka', nl: 'Osaka', pt: 'Osaka', sv: 'Osaka', zh: '大阪', ja: '大阪', pl: 'Osaka' }, country: 'JP' },

  // Thailand
  { code: 'BKK', names: { en: 'Bangkok', de: 'Bangkok', fr: 'Bangkok', es: 'Bangkok', it: 'Bangkok', nl: 'Bangkok', pt: 'Banguecoque', sv: 'Bangkok', zh: '曼谷', ja: 'バンコク', pl: 'Bangkok' }, country: 'TH' },
  { code: 'HKT', names: { en: 'Phuket', de: 'Phuket', fr: 'Phuket', es: 'Phuket', it: 'Phuket', nl: 'Phuket', pt: 'Phuket', sv: 'Phuket', zh: '普吉岛', ja: 'プーケット', pl: 'Phuket' }, country: 'TH' },

  // Singapore
  { code: 'SIN', names: { en: 'Singapore', de: 'Singapur', fr: 'Singapour', es: 'Singapur', it: 'Singapore', nl: 'Singapore', pt: 'Singapura', sv: 'Singapore', zh: '新加坡', ja: 'シンガポール', pl: 'Singapur' }, country: 'SG' },

  // Indonesia
  { code: 'DPS', names: { en: 'Bali', de: 'Bali', fr: 'Bali', es: 'Bali', it: 'Bali', nl: 'Bali', pt: 'Bali', sv: 'Bali', zh: '巴厘岛', ja: 'バリ島', pl: 'Bali' }, country: 'ID' },
  { code: 'CGK', names: { en: 'Jakarta', de: 'Jakarta', fr: 'Jakarta', es: 'Yakarta', it: 'Giacarta', nl: 'Jakarta', pt: 'Jacarta', sv: 'Jakarta', zh: '雅加达', ja: 'ジャカルタ', pl: 'Dżakarta' }, country: 'ID' },

  // Australia
  { code: 'SYD', names: { en: 'Sydney', de: 'Sydney', fr: 'Sydney', es: 'Sídney', it: 'Sydney', nl: 'Sydney', pt: 'Sydney', sv: 'Sydney', zh: '悉尼', ja: 'シドニー', pl: 'Sydney' }, country: 'AU' },
  { code: 'MEL', names: { en: 'Melbourne', de: 'Melbourne', fr: 'Melbourne', es: 'Melbourne', it: 'Melbourne', nl: 'Melbourne', pt: 'Melbourne', sv: 'Melbourne', zh: '墨尔本', ja: 'メルボルン', pl: 'Melbourne' }, country: 'AU' },
  { code: 'BNE', names: { en: 'Brisbane', de: 'Brisbane', fr: 'Brisbane', es: 'Brisbane', it: 'Brisbane', nl: 'Brisbane', pt: 'Brisbane', sv: 'Brisbane', zh: '布里斯班', ja: 'ブリスベン', pl: 'Brisbane' }, country: 'AU' },
  { code: 'PER', names: { en: 'Perth', de: 'Perth', fr: 'Perth', es: 'Perth', it: 'Perth', nl: 'Perth', pt: 'Perth', sv: 'Perth', zh: '珀斯', ja: 'パース', pl: 'Perth' }, country: 'AU' },

  // New Zealand
  { code: 'AKL', names: { en: 'Auckland', de: 'Auckland', fr: 'Auckland', es: 'Auckland', it: 'Auckland', nl: 'Auckland', pt: 'Auckland', sv: 'Auckland', zh: '奥克兰', ja: 'オークランド', pl: 'Auckland' }, country: 'NZ' },

  // Austria
  { code: 'VIE', names: { en: 'Vienna', de: 'Wien', fr: 'Vienne', it: 'Vienna', es: 'Viena', nl: 'Wenen', pt: 'Viena', sv: 'Wien', zh: '维也纳', ja: 'ウィーン', pl: 'Wiedeń' }, country: 'AT' },
  { code: 'SZG', names: { en: 'Salzburg', de: 'Salzburg', fr: 'Salzbourg', it: 'Salisburgo', es: 'Salzburgo', nl: 'Salzburg', pt: 'Salzburgo', sv: 'Salzburg', zh: '萨尔茨堡', ja: 'ザルツブルク', pl: 'Salzburg' }, country: 'AT' },
  { code: 'INN', names: { en: 'Innsbruck', de: 'Innsbruck', fr: 'Innsbruck', it: 'Innsbruck', es: 'Innsbruck', nl: 'Innsbruck', pt: 'Innsbruck', sv: 'Innsbruck', zh: '因斯布鲁克', ja: 'インスブルック', pl: 'Innsbruck' }, country: 'AT' },

  // Switzerland
  { code: 'ZRH', names: { en: 'Zurich', de: 'Zürich', fr: 'Zurich', it: 'Zurigo', es: 'Zúrich', nl: 'Zürich', pt: 'Zurique', sv: 'Zürich', zh: '苏黎世', ja: 'チューリッヒ', pl: 'Zurych' }, country: 'CH' },
  { code: 'GVA', names: { en: 'Geneva', de: 'Genf', fr: 'Genève', it: 'Ginevra', es: 'Ginebra', nl: 'Genève', pt: 'Genebra', sv: 'Genève', zh: '日内瓦', ja: 'ジュネーブ', pl: 'Genewa' }, country: 'CH' },
  { code: 'BSL', names: { en: 'Basel', de: 'Basel', fr: 'Bâle', it: 'Basilea', es: 'Basilea', nl: 'Bazel', pt: 'Basileia', sv: 'Basel', zh: '巴塞尔', ja: 'バーゼル', pl: 'Bazylea' }, country: 'CH' },

  // Belgium
  { code: 'BRU', names: { en: 'Brussels', de: 'Brüssel', fr: 'Bruxelles', nl: 'Brussel', es: 'Bruselas', it: 'Bruxelles', pt: 'Bruxelas', sv: 'Bryssel', zh: '布鲁塞尔', ja: 'ブリュッセル', pl: 'Bruksela' }, country: 'BE' },
  { code: 'CRL', names: { en: 'Brussels Charleroi', fr: 'Charleroi', de: 'Brüssel Charleroi', es: 'Bruselas Charleroi', it: 'Bruxelles Charleroi', nl: 'Brussel Charleroi', pt: 'Bruxelas Charleroi', sv: 'Bryssel Charleroi', zh: '布鲁塞尔沙勒罗瓦', ja: 'ブリュッセル・シャルルロワ', pl: 'Bruksela Charleroi' }, country: 'BE' },

  // Ireland
  { code: 'DUB', names: { en: 'Dublin', de: 'Dublin', fr: 'Dublin', es: 'Dublín', it: 'Dublino', nl: 'Dublin', pt: 'Dublim', sv: 'Dublin', zh: '都柏林', ja: 'ダブリン', pl: 'Dublin' }, country: 'IE' },
  { code: 'SNN', names: { en: 'Shannon', de: 'Shannon', fr: 'Shannon', es: 'Shannon', it: 'Shannon', nl: 'Shannon', pt: 'Shannon', sv: 'Shannon', zh: '香农', ja: 'シャノン', pl: 'Shannon' }, country: 'IE' },
  { code: 'ORK', names: { en: 'Cork', de: 'Cork', fr: 'Cork', es: 'Cork', it: 'Cork', nl: 'Cork', pt: 'Cork', sv: 'Cork', zh: '科克', ja: 'コーク', pl: 'Cork' }, country: 'IE' },

  // Czech Republic
  { code: 'PRG', names: { en: 'Prague', de: 'Prag', fr: 'Prague', it: 'Praga', es: 'Praga', nl: 'Praag', pt: 'Praga', sv: 'Prag', zh: '布拉格', ja: 'プラハ', pl: 'Praga' }, country: 'CZ' },

  // Hungary
  { code: 'BUD', names: { en: 'Budapest', de: 'Budapest', fr: 'Budapest', it: 'Budapest', es: 'Budapest', nl: 'Boedapest', pt: 'Budapeste', sv: 'Budapest', zh: '布达佩斯', ja: 'ブダペスト', pl: 'Budapeszt' }, country: 'HU' },

  // Denmark
  { code: 'CPH', names: { en: 'Copenhagen', de: 'Kopenhagen', sv: 'Köpenhamn', fr: 'Copenhague', es: 'Copenhague', it: 'Copenaghen', nl: 'Kopenhagen', pt: 'Copenhaga', zh: '哥本哈根', ja: 'コペンハーゲン', pl: 'Kopenhaga' }, country: 'DK' },

  // Norway
  { code: 'OSL', names: { en: 'Oslo', de: 'Oslo', fr: 'Oslo', es: 'Oslo', it: 'Oslo', nl: 'Oslo', pt: 'Oslo', sv: 'Oslo', zh: '奥斯陆', ja: 'オスロ', pl: 'Oslo' }, country: 'NO' },
  { code: 'BGO', names: { en: 'Bergen', de: 'Bergen', fr: 'Bergen', es: 'Bergen', it: 'Bergen', nl: 'Bergen', pt: 'Bergen', sv: 'Bergen', zh: '卑尔根', ja: 'ベルゲン', pl: 'Bergen' }, country: 'NO' },

  // Finland
  { code: 'HEL', names: { en: 'Helsinki', sv: 'Helsingfors', de: 'Helsinki', fr: 'Helsinki', es: 'Helsinki', it: 'Helsinki', nl: 'Helsinki', pt: 'Helsínquia', zh: '赫尔辛基', ja: 'ヘルシンキ', pl: 'Helsinki' }, country: 'FI' },

  // Russia
  { code: 'SVO', names: { en: 'Moscow', de: 'Moskau', fr: 'Moscou', es: 'Moscú', it: 'Mosca', nl: 'Moskou', pt: 'Moscovo', sv: 'Moskva', zh: '莫斯科', ja: 'モスクワ', pl: 'Moskwa' }, country: 'RU' },
  { code: 'LED', names: { en: 'St Petersburg', de: 'Sankt Petersburg', fr: 'Saint-Pétersbourg', es: 'San Petersburgo', it: 'San Pietroburgo', nl: 'Sint-Petersburg', pt: 'São Petersburgo', sv: 'Sankt Petersburg', zh: '圣彼得堡', ja: 'サンクトペテルブルク', pl: 'Petersburg' }, country: 'RU' },

  // Romania
  { code: 'OTP', names: { en: 'Bucharest', de: 'Bukarest', fr: 'Bucarest', es: 'Bucarest', it: 'Bucarest', nl: 'Boekarest', pt: 'Bucareste', sv: 'Bukarest', zh: '布加勒斯特', ja: 'ブカレスト', pl: 'Bukareszt' }, country: 'RO' },
  { code: 'CLJ', names: { en: 'Cluj-Napoca', de: 'Klausenburg', fr: 'Cluj-Napoca', es: 'Cluj-Napoca', it: 'Cluj-Napoca', nl: 'Cluj-Napoca', pt: 'Cluj-Napoca', sv: 'Cluj-Napoca', zh: '克卢日-纳波卡', ja: 'クルジュ＝ナポカ', pl: 'Kluż-Napoka' }, country: 'RO' },

  // Bulgaria
  { code: 'SOF', names: { en: 'Sofia', de: 'Sofia', fr: 'Sofia', es: 'Sofía', it: 'Sofia', nl: 'Sofia', pt: 'Sófia', sv: 'Sofia', zh: '索非亚', ja: 'ソフィア', pl: 'Sofia' }, country: 'BG' },
  { code: 'VAR', names: { en: 'Varna', de: 'Varna', fr: 'Varna', es: 'Varna', it: 'Varna', nl: 'Varna', pt: 'Varna', sv: 'Varna', zh: '瓦尔纳', ja: 'ヴァルナ', pl: 'Warna' }, country: 'BG' },
  { code: 'BOJ', names: { en: 'Burgas', de: 'Burgas', fr: 'Bourgas', es: 'Burgas', it: 'Burgas', nl: 'Burgas', pt: 'Burgas', sv: 'Burgas', zh: '布尔加斯', ja: 'ブルガス', pl: 'Burgas' }, country: 'BG' },

  // Morocco
  { code: 'CMN', names: { en: 'Casablanca', fr: 'Casablanca', de: 'Casablanca', es: 'Casablanca', it: 'Casablanca', nl: 'Casablanca', pt: 'Casablanca', sv: 'Casablanca', zh: '卡萨布兰卡', ja: 'カサブランカ', pl: 'Casablanca' }, country: 'MA' },
  { code: 'RAK', names: { en: 'Marrakech', fr: 'Marrakech', de: 'Marrakesch', es: 'Marrakech', it: 'Marrakech', nl: 'Marrakesh', pt: 'Marraquexe', sv: 'Marrakech', zh: '马拉喀什', ja: 'マラケシュ', pl: 'Marrakesz' }, country: 'MA' },

  // Egypt
  { code: 'CAI', names: { en: 'Cairo', de: 'Kairo', fr: 'Le Caire', es: 'El Cairo', it: 'Il Cairo', nl: 'Caïro', pt: 'Cairo', sv: 'Kairo', zh: '开罗', ja: 'カイロ', pl: 'Kair' }, country: 'EG' },
  { code: 'SSH', names: { en: 'Sharm El Sheikh', de: 'Sharm el-Scheich', fr: 'Charm el-Cheikh', es: 'Sharm el-Sheij', it: 'Sharm el-Sheikh', nl: 'Sharm-el-Sheikh', pt: 'Sharm el-Sheikh', sv: 'Sharm el-Sheikh', zh: '沙姆沙伊赫', ja: 'シャルム・エル・シェイク', pl: 'Szarm el-Szejk' }, country: 'EG' },
  { code: 'HRG', names: { en: 'Hurghada', de: 'Hurghada', fr: 'Hurghada', es: 'Hurghada', it: 'Hurghada', nl: 'Hurghada', pt: 'Hurghada', sv: 'Hurghada', zh: '赫尔格达', ja: 'フルガダ', pl: 'Hurghada' }, country: 'EG' },

  // South Africa
  { code: 'JNB', names: { en: 'Johannesburg', de: 'Johannesburg', fr: 'Johannesbourg', es: 'Johannesburgo', it: 'Johannesburg', nl: 'Johannesburg', pt: 'Joanesburgo', sv: 'Johannesburg', zh: '约翰内斯堡', ja: 'ヨハネスブルク', pl: 'Johannesburg' }, country: 'ZA' },
  { code: 'CPT', names: { en: 'Cape Town', de: 'Kapstadt', fr: 'Le Cap', es: 'Ciudad del Cabo', it: 'Città del Capo', nl: 'Kaapstad', pt: 'Cidade do Cabo', sv: 'Kapstaden', zh: '开普敦', ja: 'ケープタウン', pl: 'Kapsztad' }, country: 'ZA' },

  // Israel
  { code: 'TLV', names: { en: 'Tel Aviv', de: 'Tel Aviv', fr: 'Tel Aviv', es: 'Tel Aviv', it: 'Tel Aviv', nl: 'Tel Aviv', pt: 'Tel Aviv', sv: 'Tel Aviv', zh: '特拉维夫', ja: 'テルアビブ', pl: 'Tel Awiw' }, country: 'IL' },

  // India
  { code: 'DEL', names: { en: 'Delhi', de: 'Delhi', fr: 'Delhi', es: 'Delhi', it: 'Delhi', nl: 'Delhi', pt: 'Deli', sv: 'Delhi', zh: '德里', ja: 'デリー', pl: 'Delhi' }, country: 'IN' },
  { code: 'BOM', names: { en: 'Mumbai', de: 'Mumbai', fr: 'Mumbai', es: 'Bombay', it: 'Mumbai', nl: 'Mumbai', pt: 'Mumbai', sv: 'Mumbai', zh: '孟买', ja: 'ムンバイ', pl: 'Mumbaj' }, country: 'IN' },
  { code: 'BLR', names: { en: 'Bangalore', de: 'Bangalore', fr: 'Bangalore', es: 'Bangalore', it: 'Bangalore', nl: 'Bangalore', pt: 'Bangalore', sv: 'Bangalore', zh: '班加罗尔', ja: 'バンガロール', pl: 'Bangalore' }, country: 'IN' },
  { code: 'GOI', names: { en: 'Goa', de: 'Goa', fr: 'Goa', es: 'Goa', it: 'Goa', nl: 'Goa', pt: 'Goa', sv: 'Goa', zh: '果阿', ja: 'ゴア', pl: 'Goa' }, country: 'IN' },

  // China
  { code: 'PEK', names: { en: 'Beijing', de: 'Peking', fr: 'Pékin', es: 'Pekín', it: 'Pechino', nl: 'Peking', pt: 'Pequim', sv: 'Peking', zh: '北京', ja: '北京', pl: 'Pekin' }, country: 'CN' },
  { code: 'PVG', names: { en: 'Shanghai', de: 'Shanghai', fr: 'Shanghai', es: 'Shanghái', it: 'Shanghai', nl: 'Shanghai', pt: 'Xangai', sv: 'Shanghai', zh: '上海', ja: '上海', pl: 'Szanghaj' }, country: 'CN' },
  { code: 'HKG', names: { en: 'Hong Kong', de: 'Hongkong', fr: 'Hong Kong', es: 'Hong Kong', it: 'Hong Kong', nl: 'Hongkong', pt: 'Hong Kong', sv: 'Hongkong', zh: '香港', ja: '香港', pl: 'Hongkong' }, country: 'HK' },

  // South Korea
  { code: 'ICN', names: { en: 'Seoul', de: 'Seoul', fr: 'Séoul', es: 'Seúl', it: 'Seul', nl: 'Seoul', pt: 'Seul', sv: 'Seoul', zh: '首尔', ja: 'ソウル', pl: 'Seul' }, country: 'KR' },

  // Brazil
  { code: 'GRU', names: { en: 'Sao Paulo', pt: 'São Paulo', es: 'São Paulo', fr: 'São Paulo', de: 'São Paulo', it: 'San Paolo', nl: 'São Paulo', sv: 'São Paulo', zh: '圣保罗', ja: 'サンパウロ', pl: 'São Paulo' }, country: 'BR' },
  { code: 'GIG', names: { en: 'Rio de Janeiro', pt: 'Rio de Janeiro', es: 'Río de Janeiro', fr: 'Rio de Janeiro', de: 'Rio de Janeiro', it: 'Rio de Janeiro', nl: 'Rio de Janeiro', sv: 'Rio de Janeiro', zh: '里约热内卢', ja: 'リオデジャネイロ', pl: 'Rio de Janeiro' }, country: 'BR' },

  // Argentina
  { code: 'EZE', names: { en: 'Buenos Aires', es: 'Buenos Aires', fr: 'Buenos Aires', de: 'Buenos Aires', it: 'Buenos Aires', nl: 'Buenos Aires', pt: 'Buenos Aires', sv: 'Buenos Aires', zh: '布宜诺斯艾利斯', ja: 'ブエノスアイレス', pl: 'Buenos Aires' }, country: 'AR' },

  // Mexico
  { code: 'MEX', names: { en: 'Mexico City', es: 'Ciudad de México', fr: 'Mexico', de: 'Mexiko-Stadt', it: 'Città del Messico', nl: 'Mexico-Stad', pt: 'Cidade do México', sv: 'Mexico City', zh: '墨西哥城', ja: 'メキシコシティ', pl: 'Meksyk' }, country: 'MX' },
  { code: 'CUN', names: { en: 'Cancun', es: 'Cancún', fr: 'Cancún', de: 'Cancún', it: 'Cancún', nl: 'Cancún', pt: 'Cancún', sv: 'Cancún', zh: '坎昆', ja: 'カンクン', pl: 'Cancún' }, country: 'MX' },

  // Malta
  { code: 'MLA', names: { en: 'Malta', de: 'Malta', fr: 'Malte', es: 'Malta', it: 'Malta', nl: 'Malta', pt: 'Malta', sv: 'Malta', zh: '马耳他', ja: 'マルタ', pl: 'Malta' }, country: 'MT' },

  // Cyprus
  { code: 'LCA', names: { en: 'Larnaca', de: 'Larnaka', fr: 'Larnaca', es: 'Larnaca', it: 'Larnaca', nl: 'Larnaca', pt: 'Larnaca', sv: 'Larnaca', zh: '拉纳卡', ja: 'ラルナカ', pl: 'Larnaka' }, country: 'CY' },
  { code: 'PFO', names: { en: 'Paphos', de: 'Paphos', fr: 'Paphos', es: 'Pafos', it: 'Pafo', nl: 'Paphos', pt: 'Pafos', sv: 'Paphos', zh: '帕福斯', ja: 'パフォス', pl: 'Pafos' }, country: 'CY' },

  // Iceland
  { code: 'KEF', names: { en: 'Reykjavik', de: 'Reykjavik', fr: 'Reykjavik', es: 'Reikiavik', it: 'Reykjavik', nl: 'Reykjavik', pt: 'Reiquiavique', sv: 'Reykjavik', zh: '雷克雅未克', ja: 'レイキャビク', pl: 'Reykjavík' }, country: 'IS' },

  // Serbia
  { code: 'BEG', names: { en: 'Belgrade', de: 'Belgrad', hr: 'Beograd', fr: 'Belgrade', es: 'Belgrado', it: 'Belgrado', nl: 'Belgrado', pt: 'Belgrado', sv: 'Belgrad', zh: '贝尔格莱德', ja: 'ベオグラード', pl: 'Belgrad', sq: 'Beogradi' }, country: 'RS' },

  // Slovenia
  { code: 'LJU', names: { en: 'Ljubljana', de: 'Ljubljana', fr: 'Ljubljana', es: 'Liubliana', it: 'Lubiana', nl: 'Ljubljana', pt: 'Liubliana', sv: 'Ljubljana', zh: '卢布尔雅那', ja: 'リュブリャナ', pl: 'Lublana', hr: 'Ljubljana' }, country: 'SI' },

  // Slovakia
  { code: 'BTS', names: { en: 'Bratislava', de: 'Bratislava', fr: 'Bratislava', es: 'Bratislava', it: 'Bratislava', nl: 'Bratislava', pt: 'Bratislava', sv: 'Bratislava', zh: '布拉迪斯拉发', ja: 'ブラチスラバ', pl: 'Bratysława' }, country: 'SK' },

  // Lithuania
  { code: 'VNO', names: { en: 'Vilnius', pl: 'Wilno', de: 'Wilna', fr: 'Vilnius', es: 'Vilna', it: 'Vilnius', nl: 'Vilnius', pt: 'Vilnius', sv: 'Vilnius', zh: '维尔纽斯', ja: 'ヴィリニュス' }, country: 'LT' },
  { code: 'KUN', names: { en: 'Kaunas', pl: 'Kowno', de: 'Kaunas', fr: 'Kaunas', es: 'Kaunas', it: 'Kaunas', nl: 'Kaunas', pt: 'Kaunas', sv: 'Kaunas', zh: '考纳斯', ja: 'カウナス' }, country: 'LT' },

  // Latvia
  { code: 'RIX', names: { en: 'Riga', de: 'Riga', pl: 'Ryga', fr: 'Riga', es: 'Riga', it: 'Riga', nl: 'Riga', pt: 'Riga', sv: 'Riga', zh: '里加', ja: 'リガ' }, country: 'LV' },

  // Estonia
  { code: 'TLL', names: { en: 'Tallinn', de: 'Tallinn', fr: 'Tallinn', es: 'Tallin', it: 'Tallinn', nl: 'Tallinn', pt: 'Tallinn', sv: 'Tallinn', zh: '塔林', ja: 'タリン', pl: 'Tallinn' }, country: 'EE' },

  // Ukraine
  { code: 'KBP', names: { en: 'Kyiv', pl: 'Kijów', de: 'Kiew', fr: 'Kiev', es: 'Kiev', it: 'Kiev', nl: 'Kiev', pt: 'Kiev', sv: 'Kiev', zh: '基辅', ja: 'キーウ' }, country: 'UA' },
  { code: 'LWO', names: { en: 'Lviv', pl: 'Lwów', de: 'Lemberg', fr: 'Lviv', es: 'Leópolis', it: 'Leopoli', nl: 'Lviv', pt: 'Lviv', sv: 'Lviv', zh: '利沃夫', ja: 'リヴィウ' }, country: 'UA' },

  // Montenegro
  { code: 'TGD', names: { en: 'Podgorica', de: 'Podgorica', fr: 'Podgorica', es: 'Podgorica', it: 'Podgorica', nl: 'Podgorica', pt: 'Podgorica', sv: 'Podgorica', zh: '波德戈里察', ja: 'ポドゴリツァ', pl: 'Podgorica', hr: 'Podgorica' }, country: 'ME' },
  { code: 'TIV', names: { en: 'Tivat', de: 'Tivat', fr: 'Tivat', es: 'Tivat', it: 'Tivat', nl: 'Tivat', pt: 'Tivat', sv: 'Tivat', zh: '蒂瓦特', ja: 'ティヴァト', pl: 'Tivat', hr: 'Tivat' }, country: 'ME' },

  // North Macedonia
  { code: 'SKP', names: { en: 'Skopje', de: 'Skopje', fr: 'Skopje', es: 'Skopie', it: 'Skopje', nl: 'Skopje', pt: 'Skopje', sv: 'Skopje', zh: '斯科普里', ja: 'スコピエ', pl: 'Skopje' }, country: 'MK' },

  // Bosnia
  { code: 'SJJ', names: { en: 'Sarajevo', hr: 'Sarajevo', de: 'Sarajevo', fr: 'Sarajevo', es: 'Sarajevo', it: 'Sarajevo', nl: 'Sarajevo', pt: 'Sarajevo', sv: 'Sarajevo', zh: '萨拉热窝', ja: 'サラエボ', pl: 'Sarajewo' }, country: 'BA' },

  // Kosovo
  { code: 'PRN', names: { en: 'Pristina', sq: 'Prishtinë', de: 'Pristina', fr: 'Pristina', es: 'Prístina', it: 'Pristina', nl: 'Pristina', pt: 'Pristina', sv: 'Pristina', zh: '普里什蒂纳', ja: 'プリシュティナ', pl: 'Prisztina', hr: 'Priština' }, country: 'XK' },

  // Luxembourg
  { code: 'LUX', names: { en: 'Luxembourg', de: 'Luxemburg', fr: 'Luxembourg', es: 'Luxemburgo', it: 'Lussemburgo', nl: 'Luxemburg', pt: 'Luxemburgo', sv: 'Luxemburg', zh: '卢森堡', ja: 'ルクセンブルク', pl: 'Luksemburg' }, country: 'LU' },

  // Maldives
  { code: 'MLE', names: { en: 'Male Maldives', de: 'Malediven', fr: 'Maldives', es: 'Maldivas', it: 'Maldive', nl: 'Malediven', pt: 'Maldivas', sv: 'Maldiverna', zh: '马尔代夫', ja: 'モルディブ', pl: 'Malediwy' }, country: 'MV' },

  // Mauritius
  { code: 'MRU', names: { en: 'Mauritius', de: 'Mauritius', fr: 'Maurice', es: 'Mauricio', it: 'Mauritius', nl: 'Mauritius', pt: 'Maurícia', sv: 'Mauritius', zh: '毛里求斯', ja: 'モーリシャス', pl: 'Mauritius' }, country: 'MU' },

  // Seychelles
  { code: 'SEZ', names: { en: 'Seychelles', de: 'Seychellen', fr: 'Seychelles', es: 'Seychelles', it: 'Seychelles', nl: 'Seychellen', pt: 'Seicheles', sv: 'Seychellerna', zh: '塞舌尔', ja: 'セーシェル', pl: 'Seszele' }, country: 'SC' },
]

/**
 * Get the best name for an airport in the given locale
 */
export function getAirportName(airport: Airport, locale: string): string {
  return airport.names[locale] || airport.names.en
}

/**
 * Normalize string for matching (remove diacritics, lowercase)
 */
export function normalizeForSearch(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
}

export interface LocationMatch {
  code: string
  name: string
  type: 'airport' | 'city'
  country: string
}

function dedupeAirports(airports: Airport[]): Airport[] {
  const byCode = new Map<string, Airport>()

  for (const airport of airports) {
    const existing = byCode.get(airport.code)
    if (!existing) {
      byCode.set(airport.code, airport)
      continue
    }

    byCode.set(airport.code, {
      ...existing,
      names: {
        ...airport.names,
        ...existing.names,
      },
    })
  }

  return Array.from(byCode.values())
}

function dedupeGeneratedLocations(entries: GeneratedLocationEntry[]): GeneratedLocationEntry[] {
  const byCode = new Map<string, GeneratedLocationEntry>()

  for (const entry of entries) {
    const existing = byCode.get(entry.code)
    if (!existing) {
      byCode.set(entry.code, entry)
      continue
    }

    byCode.set(entry.code, {
      ...existing,
      ...entry,
      type: existing.type === 'city' ? existing.type : entry.type,
      name: existing.name || entry.name,
      country: existing.country || entry.country,
      city: existing.city || entry.city,
      airports: existing.airports || entry.airports,
      aliases: Array.from(new Set([...(existing.aliases || []), ...(entry.aliases || [])])),
    })
  }

  return Array.from(byCode.values())
}

function toGeneratedAirport(entry: GeneratedLocationEntry): Airport {
  const normalizedName = normalizeForSearch(entry.name)
  const normalizedCity = entry.city ? normalizeForSearch(entry.city) : ''
  const label = entry.city && normalizedCity && !normalizedName.startsWith(normalizedCity)
    ? `${entry.city} ${entry.name}`
    : entry.name

  return {
    code: entry.code,
    names: { en: label },
    country: entry.country,
  }
}

const EXTRA_LOCATION_ALIASES: Record<string, string[]> = {
  BDL: ['hartford', 'hartford connecticut', 'connecticut'],
  HNL: ['hawaii', 'honolulu hawaii', 'oahu'],
  KOA: ['kona', 'kona big island', 'big island kona'],
  OGG: ['maui', 'maui island', 'kahului maui'],
  ITO: ['hilo', 'big island hilo'],
  LIH: ['kauai', 'lihue kauai'],
}

const ALL_GENERATED_LOCATIONS = dedupeGeneratedLocations([
  ...GENERATED_LOCATIONS,
  ...GENERATED_AIRPORT_SUPPLEMENT,
])

const GENERATED_LOCATION_BY_CODE = new Map(
  ALL_GENERATED_LOCATIONS.map((entry) => [entry.code, entry]),
)

const ALL_AIRPORTS = dedupeAirports([
  ...AIRPORTS,
  ...ALL_GENERATED_LOCATIONS
    .filter((entry) => entry.type === 'airport')
    .map((entry) => toGeneratedAirport(entry)),
])

function getLocationAliases(entry: GeneratedLocationEntry): string[] {
  const extraAliases = EXTRA_LOCATION_ALIASES[entry.code] || []
  return Array.from(
    new Set([...entry.aliases, ...extraAliases].map((alias) => normalizeForSearch(alias)).filter(Boolean)),
  )
}

function resolveLocationDisplayName(entry: GeneratedLocationEntry): string {
  if (entry.type !== 'city' || !entry.airports?.length) return entry.name

  const normalizedAliases = new Set(getLocationAliases(entry))
  const candidateCities = new Map<string, { label: string; count: number; aliasMatch: boolean }>()

  for (const airportCode of entry.airports) {
    const airportEntry = GENERATED_LOCATION_BY_CODE.get(airportCode)
    const label = airportEntry?.city?.trim()
    if (!label) continue

    const normalizedLabel = normalizeForSearch(label)
    if (!normalizedLabel) continue

    const existing = candidateCities.get(normalizedLabel)
    if (existing) {
      existing.count += 1
      continue
    }

    candidateCities.set(normalizedLabel, {
      label,
      count: 1,
      aliasMatch: normalizedAliases.has(normalizedLabel),
    })
  }

  let bestCandidate: { label: string; count: number; aliasMatch: boolean } | null = null
  for (const candidate of candidateCities.values()) {
    if (
      !bestCandidate ||
      candidate.count > bestCandidate.count ||
      (candidate.count === bestCandidate.count && Number(candidate.aliasMatch) > Number(bestCandidate.aliasMatch)) ||
      (candidate.count === bestCandidate.count && candidate.aliasMatch === bestCandidate.aliasMatch && candidate.label.length < bestCandidate.label.length)
    ) {
      bestCandidate = candidate
    }
  }

  return bestCandidate?.label || entry.name
}

function getAirportSearchTerms(airport: Airport): string[] {
  const localizedNames = Object.values(airport.names)
    .map((name) => normalizeForSearch(name))
    .filter(Boolean)

  const generatedEntry = GENERATED_LOCATION_BY_CODE.get(airport.code)
  const generatedAliases = generatedEntry?.type === 'airport' ? getLocationAliases(generatedEntry) : []

  return Array.from(new Set([
    airport.code.toLowerCase(),
    ...localizedNames,
    ...generatedAliases,
  ]))
}

function toLocationMatch(entry: GeneratedLocationEntry): LocationMatch {
  return {
    code: entry.code,
    name: resolveLocationDisplayName(entry),
    type: entry.type,
    country: entry.country,
  }
}

export function findExactLocationMatch(query: string): LocationMatch | null {
  if (!query || query.length < 2) return null

  const normalizedQuery = normalizeForSearch(query)
  const exactCode = GENERATED_LOCATION_BY_CODE.get(normalizedQuery.toUpperCase())
  if (exactCode) return toLocationMatch(exactCode)

  const exactAliasMatches = ALL_GENERATED_LOCATIONS.filter((entry) => getLocationAliases(entry).includes(normalizedQuery))
  if (exactAliasMatches.length > 0) {
    const cityMatch = exactAliasMatches.find((entry) => entry.type === 'city')
    return toLocationMatch(cityMatch || exactAliasMatches[0])
  }

  return null
}

function scoreLocationEntry(entry: GeneratedLocationEntry, normalizedQuery: string): number {
  let score = 0

  for (const alias of getLocationAliases(entry)) {
    if (alias === normalizedQuery) {
      score = Math.max(score, entry.type === 'city' ? 1000 : 900)
      continue
    }

    if (alias.startsWith(normalizedQuery)) {
      score = Math.max(score, entry.type === 'city' ? 650 : 600)
      continue
    }

    if (alias.length >= 3 && new RegExp(`(?:^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`).test(normalizedQuery)) {
      // Explicit IATA code present as a word in the query → stronger signal than a general alias
      const isCodeAlias = alias === entry.code.toLowerCase()
      score = Math.max(score, isCodeAlias ? 700 : (entry.type === 'airport' ? 575 : 550))
      continue
    }

    if (alias.includes(normalizedQuery)) {
      score = Math.max(score, entry.type === 'airport' ? 425 : 400)
    }
  }

  return score
}

export function findBestLocationMatch(query: string): LocationMatch | null {
  if (!query || query.length < 2) return null

  const exactMatch = findExactLocationMatch(query)
  if (exactMatch) return exactMatch

  const normalizedQuery = normalizeForSearch(query)

  let bestMatch: { entry: GeneratedLocationEntry; score: number } | null = null
  for (const entry of ALL_GENERATED_LOCATIONS) {
    const score = scoreLocationEntry(entry, normalizedQuery)
    if (score <= 0) continue

    if (
      !bestMatch ||
      score > bestMatch.score ||
      (score === bestMatch.score && entry.type === 'city' && bestMatch.entry.type !== 'city')
    ) {
      bestMatch = { entry, score }
    }
  }

  return bestMatch ? toLocationMatch(bestMatch.entry) : null
}

// Set of curated high-importance airport codes (the hand-picked list in AIRPORTS above)
const CURATED_AIRPORT_CODES = new Set(AIRPORTS.map(a => a.code))

// Pre-compute search terms for every airport once at module load.
// getAirportSearchTerms touches Object.values + Set + aliases — too expensive to call per keystroke.
const AIRPORT_TERMS_CACHE = new Map<string, string[]>()
for (const airport of ALL_AIRPORTS) {
  AIRPORT_TERMS_CACHE.set(airport.code, getAirportSearchTerms(airport))
}

// Prefix index: first 1–4 chars of any search term → airports that have a term starting with that prefix.
// searchAirports uses this to skip the full 8k+ scan — typical bucket is 50–300 entries.
const AIRPORT_PREFIX_INDEX = new Map<string, Airport[]>()
for (const airport of ALL_AIRPORTS) {
  const terms = AIRPORT_TERMS_CACHE.get(airport.code)!
  const seen = new Set<string>()
  for (const term of terms) {
    for (let len = 1; len <= Math.min(4, term.length); len++) {
      const prefix = term.slice(0, len)
      if (!seen.has(prefix)) {
        seen.add(prefix)
        if (!AIRPORT_PREFIX_INDEX.has(prefix)) AIRPORT_PREFIX_INDEX.set(prefix, [])
        AIRPORT_PREFIX_INDEX.get(prefix)!.push(airport)
      }
    }
  }
}

// City-level prefix index (multi-airport cities: LON, NYC, PAR, …)
// Built once at module load, used by searchAirports to prepend the city option.
const CITY_PREFIX_INDEX = new Map<string, Array<Airport & { isCity: true }>>()
for (const entry of ALL_GENERATED_LOCATIONS) {
  if (entry.type !== 'city' || !entry.airports || entry.airports.length <= 1) continue
  const cityAirport: Airport & { isCity: true } = {
    code: entry.code,
    names: { en: resolveLocationDisplayName(entry) },
    country: entry.country,
    isCity: true,
  }
  const seen = new Set<string>()
  for (const alias of getLocationAliases(entry)) {
    for (let len = 1; len <= Math.min(4, alias.length); len++) {
      const prefix = alias.slice(0, len)
      if (!seen.has(prefix)) {
        seen.add(prefix)
        if (!CITY_PREFIX_INDEX.has(prefix)) CITY_PREFIX_INDEX.set(prefix, [])
        CITY_PREFIX_INDEX.get(prefix)!.push(cityAirport)
      }
    }
  }
}

/**
 * Find airports matching a query string
 */
export function searchAirports(query: string, locale: string, limit = 10): Airport[] {
  if (!query || query.length < 2) return []

  const normalizedQuery = normalizeForSearch(query)
  const prefix = normalizedQuery.slice(0, Math.min(4, normalizedQuery.length))

  // Check city-level entries first (LON, NYC, PAR …)
  const cityCandidates = CITY_PREFIX_INDEX.get(prefix) ?? []
  const cityResults: Array<Airport & { isCity: true }> = []
  const seenCityCodes = new Set<string>()
  for (const cityAirport of cityCandidates) {
    if (seenCityCodes.has(cityAirport.code)) continue
    const entry = GENERATED_LOCATION_BY_CODE.get(cityAirport.code)
    if (!entry) continue
    const aliases = getLocationAliases(entry)
    if (aliases.some(a => a === normalizedQuery || a.startsWith(normalizedQuery))) {
      cityResults.push(cityAirport)
      seenCityCodes.add(cityAirport.code)
    }
  }

  // Use prefix index: only score airports with a matching term prefix
  const candidates = AIRPORT_PREFIX_INDEX.get(prefix) ?? []

  const scored = candidates.map(airport => {
    const searchTerms = AIRPORT_TERMS_CACHE.get(airport.code)!
    const codeMatch = airport.code.toLowerCase() === normalizedQuery
    const codeStartsWith = airport.code.toLowerCase().startsWith(normalizedQuery)
    const nameStartsWith = searchTerms.some(term => term.startsWith(normalizedQuery))
    const nameContains = searchTerms.some(term => term.includes(normalizedQuery))

    let score = 0
    if (codeMatch) score += 120
    if (codeStartsWith) score += 100
    if (nameStartsWith) score += 50
    if (nameContains) score += 10

    // Importance bonus for major curated airports so they beat obscure matches
    if (score > 0 && CURATED_AIRPORT_CODES.has(airport.code)) score += 30

    return { airport, score }
  })
  .filter(({ score }) => score > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, limit)

  const airports = scored.map(({ airport }) => airport)

  // City entries go first (at most 1), then individual airports up to limit
  return [...cityResults.slice(0, 1), ...airports].slice(0, limit)
}

/**
 * Find the best single airport match for autocomplete
 */
export function findBestMatch(query: string, locale: string): Airport | null {
  if (!query || query.length < 2) return null
  
  const normalizedQuery = normalizeForSearch(query)
  
  // Exact IATA code match
  const codeMatch = ALL_AIRPORTS.find(a => a.code.toLowerCase() === normalizedQuery)
  if (codeMatch) return codeMatch

  // Exact alias/name match
  for (const airport of ALL_AIRPORTS) {
    const searchTerms = getAirportSearchTerms(airport)
    if (searchTerms.some(term => term === normalizedQuery)) {
      return airport
    }
  }

  // Use scored best-location algorithm (handles aliases, word-boundary, importance)
  const bestLocation = findBestLocationMatch(query)
  if (bestLocation) {
    const airport = ALL_AIRPORTS.find(a => a.code === bestLocation.code)
    if (airport) return airport
    // City code (e.g. LON) — not in ALL_AIRPORTS; return as a city Airport so ghost text says "London to …"
    if (bestLocation.type === 'city') {
      return { code: bestLocation.code, names: { en: bestLocation.name }, country: bestLocation.country, isCity: true }
    }
  }

  // Fallback: locale-aware prefix match (handles localized names not in generated data, e.g. "München" → MUC)
  for (const airport of ALL_AIRPORTS) {
    const searchTerms = getAirportSearchTerms(airport)
    if (searchTerms.some(term => term.startsWith(normalizedQuery))) {
      return airport
    }
  }

  // Code prefix
  for (const airport of ALL_AIRPORTS) {
    if (airport.code.toLowerCase().startsWith(normalizedQuery)) return airport
  }
  
  return null
}

export function resolveShareLocationName(
  query: string,
  options?: { preferCity?: boolean },
): string | null {
  if (!query || query.length < 2) return null

  const match = findBestMatch(query, 'en')
  if (!match) return null

  if (options?.preferCity) {
    const generatedEntry = GENERATED_LOCATION_BY_CODE.get(match.code)
    const city = generatedEntry?.city?.trim()
    if (city) {
      return city
    }
  }

  const displayName = match.names.en?.trim()
  return displayName || null
}
