// GENERATED -- do not edit. Rebuild with: python tools/build-ranking.py
//
// letsfg.co's ranking engine, compiled from LetsFG/sdk/js/src/
// (trip-purpose.ts + offer-details.ts + ranking.ts) so the plugin orders
// offers exactly as the website does. Showing them in the order
// /api/search returns is NOT the same thing and was visibly wrong.
//
// Loaded from QML as:  import "assets/ranking.js" as Ranking

var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __values = (this && this.__values) || function(o) {
    var s = typeof Symbol === "function" && Symbol.iterator, m = s && o[s], i = 0;
    if (m) return m.call(o);
    if (o && typeof o.length === "number") return {
        next: function () {
            if (o && i >= o.length) o = void 0;
            return { value: o && o[i++], done: !o };
        }
    };
    throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
};
var __read = (this && this.__read) || function (o, n) {
    var m = typeof Symbol === "function" && o[Symbol.iterator];
    if (!m) return o;
    var i = m.call(o), r, ar = [], e;
    try {
        while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
    }
    catch (error) { e = { error: error }; }
    finally {
        try {
            if (r && !r.done && (m = i["return"])) m.call(i);
        }
        finally { if (e) throw e.error; }
    }
    return ar;
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
var TRIP_PURPOSES = [
    'honeymoon',
    'special_occasion',
    'business',
    'ski',
    'beach',
    'city_break',
    'family_holiday',
    'graduation',
    'concert_festival',
    'sports_event',
    'spring_break',
];
function normalizeTripPurposes(_a) {
    var e_1, _b;
    var tripPurpose = _a.tripPurpose, tripPurposes = _a.tripPurposes;
    var normalized = [];
    var seen = new Set();
    try {
        for (var _c = __values(tripPurposes !== null && tripPurposes !== void 0 ? tripPurposes : []), _d = _c.next(); !_d.done; _d = _c.next()) {
            var purpose = _d.value;
            if (!purpose || seen.has(purpose))
                continue;
            seen.add(purpose);
            normalized.push(purpose);
        }
    }
    catch (e_1_1) { e_1 = { error: e_1_1 }; }
    finally {
        try {
            if (_d && !_d.done && (_b = _c.return)) _b.call(_c);
        }
        finally { if (e_1) throw e_1.error; }
    }
    if (tripPurpose && !seen.has(tripPurpose)) {
        normalized.push(tripPurpose);
    }
    return normalized;
}
function getPrimaryTripPurpose(options) {
    return normalizeTripPurposes(options)[0];
}
var MEAL_RE = /\b(meal|meals|meal service|hot meal|catering|breakfast|lunch|dinner|santan)\b/i;
var REFRESHMENT_RE = /\b(refreshment|refreshments|drink|drinks|beverage|beverages|snack|snacks|food and drink)\b/i;
var INSURANCE_RE = /\b(insurance|coverage|protection|travel insurance|disruption cover)\b/i;
var LOUNGE_RE = /\b(lounge|vip lounge|priority pass|airport lounge)\b/i;
var WIFI_RE = /\b(wi[ -]?fi|wifi|internet access|onboard internet|wireless internet)\b/i;
var POWER_RE = /\b(in[- ]?seat power|usb outlets?|usb ports?|usb power|power outlets?|power sockets?|ac power|seat power|charging ports?|charging outlets?)\b/i;
var ENTERTAINMENT_RE = /\b(in[- ]?flight entertainment|ife|seatback screen|entertainment screen|personal entertainment|stream(?:ing)? media(?: to your device)?|stream to your device|watch on your device)\b/i;
var WIFI_BARE_RE = /\b(wi[ -]?fi|wifi|internet access|onboard internet|wireless internet)\b/i;
var POWER_BARE_RE = /\b(in[- ]?seat power|usb outlets?|usb ports?|usb power|power outlets?|power sockets?|ac power|seat power|charging ports?|charging outlets?)\b/i;
var ENTERTAINMENT_BARE_RE = /\b(in[- ]?flight entertainment|ife|seatback screen|entertainment screen|personal entertainment|stream(?:ing)? media(?: to your device)?|stream to your device|watch on your device)\b/i;
var SERVICE_INCLUDED_RE = /\b(included?|incl\.?|includes?|including|with|complimentary|provided|free of charge|free)\b/i;
var SERVICE_AVAILABLE_RE = /\b(available|optional|option|add[- ]?on|extra|for a fee|with a fee|fee|charges may apply|buy[- ]?on[- ]?board|sold separately|upgrade)\b/i;
var SERVICE_UNAVAILABLE_RE = /\b(not available|unavailable|not offered|not included|not possible|sold[- ]?out)\b/i;
var REFUND_TEXT_RE = /\b(refund|refundable|cancell|cancel)\b/i;
var REFUND_NOT_ALLOWED_RE = /\b(non[- ]?refundable|not refundable|no refunds?|refunds? not allowed|cancellations? not allowed)\b/i;
var REFUND_WITH_FEE_RE = /\b(refund|refundable|cancell|cancel)\b.*\b(with fee|fee|penalty|charges may apply)\b/i;
var REFUND_ALLOWED_RE = /\b(refundable|refunds? allowed|cancellations? allowed|cancel(?:lation)? allowed|free of charge)\b/i;
var CHANGE_TEXT_RE = /\b(change|changes|changeable|rebook|rebooking)\b/i;
var CHANGE_NOT_ALLOWED_RE = /\b(no changes?|changes? not allowed|not changeable|not possible)\b/i;
var CHANGE_WITH_FEE_RE = /\b(change|changes|rebook|rebooking)\b.*\b(with fee|fee|penalty|charges may apply)\b/i;
var CHANGE_ALLOWED_RE = /\b(changes? allowed|changeable|rebook(?:ing)? allowed|free of charge)\b/i;
var SEAT_SELECTION_RE = /\b(seat selection|select your seat|choose your seat|choose seats?|seat choice|standard seat|extra legroom|preferred seat)\b/i;
var LEGROOM_RE = /\b(?:average\s+legroom|extra legroom|legroom|pitch)\b/i;
function normalizeDetailText(value) {
    var withoutKey = value.replace(/^[a-z][a-z_ ]{0,40}:\s*/i, '');
    return withoutKey.replace(/\s+/g, ' ').trim();
}
function truncateDetailText(value, maxLength) {
    if (maxLength === void 0) { maxLength = 96; }
    if (value.length <= maxLength) {
        return value;
    }
    return "".concat(value.slice(0, maxLength - 3).trimEnd(), "...");
}
function pushUniqueNote(notes, note) {
    if (!note || notes.includes(note)) {
        return;
    }
    notes.push(note);
}
function getConditionValue(offer) {
    var e_2, _a;
    var _b;
    var keys = [];
    for (var _i = 1; _i < arguments.length; _i++) {
        keys[_i - 1] = arguments[_i];
    }
    try {
        for (var keys_1 = __values(keys), keys_1_1 = keys_1.next(); !keys_1_1.done; keys_1_1 = keys_1.next()) {
            var key = keys_1_1.value;
            var value = (_b = offer.conditions) === null || _b === void 0 ? void 0 : _b[key];
            if (typeof value === 'string' && value.trim().length > 0) {
                return value.trim();
            }
        }
    }
    catch (e_2_1) { e_2 = { error: e_2_1 }; }
    finally {
        try {
            if (keys_1_1 && !keys_1_1.done && (_a = keys_1.return)) _a.call(keys_1);
        }
        finally { if (e_2) throw e_2.error; }
    }
    return null;
}
function summarizeConditionList(value, maxItems) {
    if (maxItems === void 0) { maxItems = 3; }
    if (!value) {
        return null;
    }
    var parts = splitDetailText(value)
        .map(function (part) { return normalizeDetailText(part); })
        .filter(function (part) { return part.length > 0; });
    if (parts.length === 0) {
        return null;
    }
    return truncateDetailText(parts.slice(0, maxItems).join('; '));
}
function collectOfferSegments(offer) {
    var _a, _b, _c;
    return __spreadArray(__spreadArray([], __read(((_a = offer.segments) !== null && _a !== void 0 ? _a : [])), false), __read(((_c = (_b = offer.inbound) === null || _b === void 0 ? void 0 : _b.segments) !== null && _c !== void 0 ? _c : [])), false);
}
function collectUniqueDetailValues(values) {
    var e_3, _a;
    var seen = new Set();
    var output = [];
    try {
        for (var values_1 = __values(values), values_1_1 = values_1.next(); !values_1_1.done; values_1_1 = values_1.next()) {
            var value = values_1_1.value;
            var normalized = typeof value === 'string' ? value.trim() : '';
            if (!normalized) {
                continue;
            }
            var key = normalized.toLowerCase();
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            output.push(normalized);
        }
    }
    catch (e_3_1) { e_3 = { error: e_3_1 }; }
    finally {
        try {
            if (values_1_1 && !values_1_1.done && (_a = values_1.return)) _a.call(values_1);
        }
        finally { if (e_3) throw e_3.error; }
    }
    return output;
}
function collectFlightNumbers(offer) {
    var segmentFlightNumbers = collectOfferSegments(offer).map(function (segment) { return segment.flight_number; });
    return collectUniqueDetailValues(__spreadArray(__spreadArray([], __read(segmentFlightNumbers), false), [
        offer.flight_number,
    ], false));
}
/** Names the legs that carry Starlink, rather than asserting it about the trip.
 *  On a connecting itinerary "this flight has Starlink" is the wrong sentence
 *  when only one hop does - the detail panel is exactly where that distinction
 *  belongs, so the note lists routes and keeps the confirmed/likely wording. */
function buildStarlinkNote(offer) {
    var segments = collectOfferSegments(offer);
    var label = function (s) {
        return s.origin && s.destination ? "".concat(s.origin, "\u2192").concat(s.destination) : (s.flight_number || '').trim();
    };
    var confirmed = segments.filter(function (s) { return s.starlink === 'confirmed'; });
    var likely = segments.filter(function (s) { return s.starlink === 'likely'; });
    if (confirmed.length === 0 && likely.length === 0)
        return undefined;
    var parts = [];
    if (confirmed.length > 0) {
        var where = confirmed.length === segments.length
            ? 'every leg'
            : confirmed.map(label).filter(Boolean).join(', ');
        parts.push("Starlink Wi-Fi on ".concat(where));
    }
    if (likely.length > 0) {
        var where = likely.map(label).filter(Boolean).join(', ');
        parts.push("Starlink being installed on this aircraft type".concat(where ? " (".concat(where, ")") : '', ", not guaranteed"));
    }
    return parts.join('; ');
}
function collectAircraftTypes(offer) {
    return collectUniqueDetailValues(collectOfferSegments(offer).map(function (segment) { var _a; return (_a = segment.aircraft) === null || _a === void 0 ? void 0 : _a.replace(/\s*\([^)]*\)/g, '').trim(); }));
}
function collectOperatingCarriers(offer) {
    return collectUniqueDetailValues(collectOfferSegments(offer).map(function (segment) { return segment.airline; }));
}
function findMatchingSourceText(sources, pattern) {
    var e_4, _a;
    try {
        for (var sources_1 = __values(sources), sources_1_1 = sources_1.next(); !sources_1_1.done; sources_1_1 = sources_1.next()) {
            var source = sources_1_1.value;
            if (!pattern.test(source.text)) {
                continue;
            }
            var cleaned = normalizeDetailText(source.text);
            if (cleaned.length > 0) {
                return truncateDetailText(cleaned);
            }
        }
    }
    catch (e_4_1) { e_4 = { error: e_4_1 }; }
    finally {
        try {
            if (sources_1_1 && !sources_1_1.done && (_a = sources_1.return)) _a.call(sources_1);
        }
        finally { if (e_4) throw e_4.error; }
    }
    return null;
}
function formatFareFamilyBadgeLabel(value, t) {
    var label = t ? t('fareFamilyPrefix', { value: value }) : "Fare: ".concat(value);
    return truncateDetailText(label, 28);
}
function splitDetailText(value) {
    return value
        .split(/(?:\r?\n|;|\u2022|\|)+/)
        .map(function (part) { return part.trim(); })
        .filter(function (part) { return part.length > 0; });
}
function collectTextSources(offer) {
    var e_5, _a, e_6, _b, e_7, _c, e_8, _d;
    var _e;
    var sources = [];
    var ancillaries = offer.ancillaries;
    try {
        for (var _f = __values([ancillaries === null || ancillaries === void 0 ? void 0 : ancillaries.cabin_bag, ancillaries === null || ancillaries === void 0 ? void 0 : ancillaries.checked_bag, ancillaries === null || ancillaries === void 0 ? void 0 : ancillaries.seat_selection]), _g = _f.next(); !_g.done; _g = _f.next()) {
            var ancillary = _g.value;
            if (typeof (ancillary === null || ancillary === void 0 ? void 0 : ancillary.description) === 'string' && ancillary.description.trim().length > 0) {
                try {
                    for (var _h = (e_6 = void 0, __values(splitDetailText(ancillary.description.trim()))), _j = _h.next(); !_j.done; _j = _h.next()) {
                        var fragment = _j.value;
                        sources.push({
                            text: fragment,
                            included: ancillary.included,
                            source: 'ancillary',
                        });
                    }
                }
                catch (e_6_1) { e_6 = { error: e_6_1 }; }
                finally {
                    try {
                        if (_j && !_j.done && (_b = _h.return)) _b.call(_h);
                    }
                    finally { if (e_6) throw e_6.error; }
                }
            }
        }
    }
    catch (e_5_1) { e_5 = { error: e_5_1 }; }
    finally {
        try {
            if (_g && !_g.done && (_a = _f.return)) _a.call(_f);
        }
        finally { if (e_5) throw e_5.error; }
    }
    try {
        for (var _k = __values(Object.entries((_e = offer.conditions) !== null && _e !== void 0 ? _e : {})), _l = _k.next(); !_l.done; _l = _k.next()) {
            var _m = __read(_l.value, 2), key = _m[0], value = _m[1];
            if (key === 'refund_before_departure' || key === 'change_before_departure') {
                continue;
            }
            if (typeof value === 'string' && value.trim().length > 0) {
                try {
                    for (var _o = (e_8 = void 0, __values(splitDetailText(value.trim()))), _p = _o.next(); !_p.done; _p = _o.next()) {
                        var fragment = _p.value;
                        sources.push({
                            text: "".concat(key.replace(/_/g, ' '), ": ").concat(fragment),
                            source: 'condition',
                        });
                    }
                }
                catch (e_8_1) { e_8 = { error: e_8_1 }; }
                finally {
                    try {
                        if (_p && !_p.done && (_d = _o.return)) _d.call(_o);
                    }
                    finally { if (e_8) throw e_8.error; }
                }
            }
        }
    }
    catch (e_7_1) { e_7 = { error: e_7_1 }; }
    finally {
        try {
            if (_l && !_l.done && (_c = _k.return)) _c.call(_k);
        }
        finally { if (e_7) throw e_7.error; }
    }
    return sources;
}
function buildUnknownAmenityAssessment() {
    return {
        state: 'unknown',
        confidence: 'unknown',
        source: 'unknown',
    };
}
function scoreAmenityAssessment(assessment) {
    var confidenceScore = assessment.confidence === 'verified'
        ? 20
        : assessment.confidence === 'inferred'
            ? 10
            : 0;
    var stateScore = assessment.state === 'included'
        ? 3
        : assessment.state === 'available'
            ? 2
            : assessment.state === 'unavailable'
                ? 1
                : 0;
    return confidenceScore + stateScore;
}
function chooseAmenityAssessment(current, next) {
    return scoreAmenityAssessment(next) > scoreAmenityAssessment(current) ? next : current;
}
function normalizeAmenitySignal(assessment) {
    if (assessment.confidence !== 'verified') {
        return null;
    }
    if (assessment.state === 'included' || assessment.state === 'available') {
        return assessment.state;
    }
    return null;
}
function assessServiceSignal(pattern, sources, options) {
    var e_9, _a;
    var _b, _c;
    var best = buildUnknownAmenityAssessment();
    try {
        for (var sources_2 = __values(sources), sources_2_1 = sources_2.next(); !sources_2_1.done; sources_2_1 = sources_2.next()) {
            var source = sources_2_1.value;
            if (!pattern.test(source.text)) {
                continue;
            }
            var normalized = source.text.toLowerCase();
            var candidate = void 0;
            if (SERVICE_UNAVAILABLE_RE.test(normalized)) {
                candidate = {
                    state: 'unavailable',
                    confidence: 'verified',
                    source: source.source,
                    evidence: source.text,
                };
            }
            else if (SERVICE_AVAILABLE_RE.test(normalized) || source.included === false) {
                candidate = {
                    state: 'available',
                    confidence: 'verified',
                    source: source.source,
                    evidence: source.text,
                };
            }
            else if (SERVICE_INCLUDED_RE.test(normalized)) {
                candidate = {
                    state: 'included',
                    confidence: 'verified',
                    source: source.source,
                    evidence: source.text,
                };
            }
            else if ((_b = options === null || options === void 0 ? void 0 : options.barePattern) === null || _b === void 0 ? void 0 : _b.test(normalized)) {
                candidate = {
                    state: (_c = options.bareState) !== null && _c !== void 0 ? _c : 'included',
                    confidence: 'verified',
                    source: source.source,
                    evidence: source.text,
                };
            }
            else if (source.included === true) {
                candidate = {
                    state: 'included',
                    confidence: 'inferred',
                    source: source.source,
                    evidence: source.text,
                };
            }
            else {
                candidate = {
                    state: 'available',
                    confidence: 'inferred',
                    source: source.source,
                    evidence: source.text,
                };
            }
            best = chooseAmenityAssessment(best, candidate);
        }
    }
    catch (e_9_1) { e_9 = { error: e_9_1 }; }
    finally {
        try {
            if (sources_2_1 && !sources_2_1.done && (_a = sources_2.return)) _a.call(sources_2);
        }
        finally { if (e_9) throw e_9.error; }
    }
    return best;
}
function classifyConditionStateFromText(sources, textRe, notAllowedRe, withFeeRe, allowedRe) {
    var e_10, _a;
    try {
        for (var sources_3 = __values(sources), sources_3_1 = sources_3.next(); !sources_3_1.done; sources_3_1 = sources_3.next()) {
            var source = sources_3_1.value;
            var normalized = source.text.toLowerCase();
            if (!textRe.test(normalized)) {
                continue;
            }
            if (notAllowedRe.test(normalized)) {
                return 'not_allowed';
            }
            if (withFeeRe.test(normalized)) {
                return 'allowed_with_fee';
            }
            if (allowedRe.test(normalized)) {
                return 'allowed';
            }
        }
    }
    catch (e_10_1) { e_10 = { error: e_10_1 }; }
    finally {
        try {
            if (sources_3_1 && !sources_3_1.done && (_a = sources_3.return)) _a.call(sources_3);
        }
        finally { if (e_10) throw e_10.error; }
    }
    return null;
}
function extractOfferDetailSignals(offer) {
    var _a, _b, _c, _d;
    var textSources = collectTextSources(offer);
    var mealAssessment = assessServiceSignal(MEAL_RE, textSources);
    var refreshmentAssessment = assessServiceSignal(REFRESHMENT_RE, textSources);
    var insuranceAssessment = assessServiceSignal(INSURANCE_RE, textSources);
    var loungeAssessment = assessServiceSignal(LOUNGE_RE, textSources);
    var wifiAssessment = assessServiceSignal(WIFI_RE, textSources, {
        barePattern: WIFI_BARE_RE,
        bareState: 'available',
    });
    var powerAssessment = assessServiceSignal(POWER_RE, textSources, {
        barePattern: POWER_BARE_RE,
        bareState: 'included',
    });
    var entertainmentAssessment = assessServiceSignal(ENTERTAINMENT_RE, textSources, {
        barePattern: ENTERTAINMENT_BARE_RE,
        bareState: 'included',
    });
    return {
        refundability: (_b = (_a = offer.conditions) === null || _a === void 0 ? void 0 : _a.refund_before_departure) !== null && _b !== void 0 ? _b : classifyConditionStateFromText(textSources, REFUND_TEXT_RE, REFUND_NOT_ALLOWED_RE, REFUND_WITH_FEE_RE, REFUND_ALLOWED_RE),
        changeability: (_d = (_c = offer.conditions) === null || _c === void 0 ? void 0 : _c.change_before_departure) !== null && _d !== void 0 ? _d : classifyConditionStateFromText(textSources, CHANGE_TEXT_RE, CHANGE_NOT_ALLOWED_RE, CHANGE_WITH_FEE_RE, CHANGE_ALLOWED_RE),
        meals: normalizeAmenitySignal(mealAssessment),
        refreshments: normalizeAmenitySignal(refreshmentAssessment),
        insurance: normalizeAmenitySignal(insuranceAssessment),
        lounge: normalizeAmenitySignal(loungeAssessment),
        wifi: normalizeAmenitySignal(wifiAssessment),
        power: normalizeAmenitySignal(powerAssessment),
        entertainment: normalizeAmenitySignal(entertainmentAssessment),
        amenities: {
            meals: mealAssessment,
            refreshments: refreshmentAssessment,
            insurance: insuranceAssessment,
            lounge: loungeAssessment,
            wifi: wifiAssessment,
            power: powerAssessment,
            entertainment: entertainmentAssessment,
        },
    };
}
// label/labelKey pairs: labelKey is looked up via t() when a translator is
// passed, label is the English fallback (used when it isn't -- see the `T`
// type's own comment on why that path exists and must keep working).
var AMENITY_BADGE_META = [
    {
        key: 'meals',
        included: { key: 'meal_included', label: 'Meal included', labelKey: 'mealIncluded', tone: 'positive' },
        available: { key: 'meal_option', label: 'Meal option', labelKey: 'mealOption', tone: 'neutral' },
        includedNote: 'Meal included in the fare data',
        availableNote: 'Meal option shown in the fare data',
    },
    {
        key: 'refreshments',
        included: { key: 'refreshments_included', label: 'Refreshments included', labelKey: 'refreshmentsIncluded', tone: 'positive' },
        available: { key: 'refreshments_option', label: 'Refreshments available', labelKey: 'refreshmentsAvailable', tone: 'neutral' },
        includedNote: 'Refreshments included in the fare data',
        availableNote: 'Refreshments shown in the fare data',
    },
    {
        key: 'wifi',
        included: { key: 'wifi_included', label: 'Wi-Fi included', labelKey: 'wifiIncluded', tone: 'positive' },
        available: { key: 'wifi_available', label: 'Wi-Fi available', labelKey: 'wifiAvailable', tone: 'neutral' },
        includedNote: 'Wi-Fi included in the fare data',
        availableNote: 'Wi-Fi availability shown in the fare data',
    },
    {
        key: 'power',
        included: { key: 'power_included', label: 'USB / power at seat', labelKey: 'usbPowerIncluded', tone: 'positive' },
        available: { key: 'power_available', label: 'USB / power available', labelKey: 'usbPowerAvailable', tone: 'neutral' },
        includedNote: 'USB or power outlet shown in the fare data',
        availableNote: 'USB or power availability shown in the fare data',
    },
    {
        key: 'entertainment',
        included: { key: 'ife_included', label: 'In-flight entertainment', labelKey: 'ifeIncluded', tone: 'positive' },
        available: { key: 'ife_available', label: 'Entertainment available', labelKey: 'ifeAvailable', tone: 'neutral' },
        includedNote: 'In-flight entertainment shown in the fare data',
        availableNote: 'Entertainment availability shown in the fare data',
    },
    {
        key: 'insurance',
        included: { key: 'insurance_included', label: 'Insurance included', labelKey: 'insuranceIncluded', tone: 'positive' },
        available: { key: 'insurance_option', label: 'Insurance option', labelKey: 'insuranceOption', tone: 'neutral' },
        includedNote: 'Insurance included in the fare data',
        availableNote: 'Insurance option shown in the fare data',
    },
    {
        key: 'lounge',
        included: { key: 'lounge_included', label: 'Lounge included', labelKey: 'loungeIncluded', tone: 'positive' },
        available: { key: 'lounge_option', label: 'Lounge option', labelKey: 'loungeOption', tone: 'neutral' },
        includedNote: 'Lounge access included in the fare data',
        availableNote: 'Lounge access option shown in the fare data',
    },
];
/** Real label for a badge: translated when `t` is passed, the same English
 *  fallback as before when it isn't. */
function badgeLabel(entry, t) {
    return t ? t(entry.labelKey) : entry.label;
}
function getOfferDetailBadges(offer, t) {
    var e_11, _a;
    var signals = extractOfferDetailSignals(offer);
    var badges = [];
    var fareFamily = getConditionValue(offer, 'fare_family', 'fare_bundle');
    if (signals.refundability === 'allowed' && signals.changeability === 'allowed') {
        badges.push({ key: 'flexible', label: t ? t('flexibleFare') : 'Flexible fare', tone: 'positive' });
    }
    else {
        if (signals.refundability === 'allowed') {
            badges.push({ key: 'refund_allowed', label: t ? t('refundable') : 'Refundable', tone: 'positive' });
        }
        else if (signals.refundability === 'allowed_with_fee') {
            badges.push({ key: 'refund_fee', label: t ? t('refundWithFee') : 'Refund with fee', tone: 'neutral' });
        }
        else if (signals.refundability === 'not_allowed') {
            badges.push({ key: 'refund_none', label: t ? t('noRefund') : 'No refund', tone: 'negative' });
        }
        if (signals.changeability === 'allowed') {
            badges.push({ key: 'change_allowed', label: t ? t('changesAllowed') : 'Changes allowed', tone: 'positive' });
        }
        else if (signals.changeability === 'allowed_with_fee') {
            badges.push({ key: 'change_fee', label: t ? t('changesWithFee') : 'Changes with fee', tone: 'neutral' });
        }
        else if (signals.changeability === 'not_allowed') {
            badges.push({ key: 'change_none', label: t ? t('noChanges') : 'No changes', tone: 'negative' });
        }
    }
    if (fareFamily) {
        badges.push({ key: 'fare_family', label: formatFareFamilyBadgeLabel(fareFamily, t), tone: 'neutral' });
    }
    try {
        for (var AMENITY_BADGE_META_1 = __values(AMENITY_BADGE_META), AMENITY_BADGE_META_1_1 = AMENITY_BADGE_META_1.next(); !AMENITY_BADGE_META_1_1.done; AMENITY_BADGE_META_1_1 = AMENITY_BADGE_META_1.next()) {
            var amenity = AMENITY_BADGE_META_1_1.value;
            var signal = signals[amenity.key];
            if (signal === 'included') {
                badges.push({ key: amenity.included.key, label: badgeLabel(amenity.included, t), tone: amenity.included.tone });
            }
            else if (signal === 'available') {
                badges.push({ key: amenity.available.key, label: badgeLabel(amenity.available, t), tone: amenity.available.tone });
            }
        }
    }
    catch (e_11_1) { e_11 = { error: e_11_1 }; }
    finally {
        try {
            if (AMENITY_BADGE_META_1_1 && !AMENITY_BADGE_META_1_1.done && (_a = AMENITY_BADGE_META_1.return)) _a.call(AMENITY_BADGE_META_1);
        }
        finally { if (e_11) throw e_11.error; }
    }
    return badges.slice(0, 4);
}
function getOfferDetailPromptNotes(offer) {
    var e_12, _a;
    var signals = extractOfferDetailSignals(offer);
    var textSources = collectTextSources(offer);
    var notes = [];
    var fareFamily = getConditionValue(offer, 'fare_family', 'fare_bundle');
    var fareBenefits = summarizeConditionList(getConditionValue(offer, 'fare_bundle_benefits', 'fare_bundle_description'));
    if (fareFamily) {
        notes.push("Fare family shown: ".concat(fareFamily));
    }
    if (fareBenefits) {
        notes.push("Fare bundle benefits shown: ".concat(fareBenefits));
    }
    if (signals.refundability === 'allowed') {
        notes.push('Refunds allowed before departure');
    }
    else if (signals.refundability === 'allowed_with_fee') {
        notes.push('Refunds allowed before departure with a fee');
    }
    else if (signals.refundability === 'not_allowed') {
        notes.push('No refunds shown before departure');
    }
    if (signals.changeability === 'allowed') {
        notes.push('Changes allowed before departure');
    }
    else if (signals.changeability === 'allowed_with_fee') {
        notes.push('Changes allowed before departure with a fee');
    }
    else if (signals.changeability === 'not_allowed') {
        notes.push('No changes shown before departure');
    }
    try {
        for (var AMENITY_BADGE_META_2 = __values(AMENITY_BADGE_META), AMENITY_BADGE_META_2_1 = AMENITY_BADGE_META_2.next(); !AMENITY_BADGE_META_2_1.done; AMENITY_BADGE_META_2_1 = AMENITY_BADGE_META_2.next()) {
            var amenity = AMENITY_BADGE_META_2_1.value;
            var signal = signals[amenity.key];
            if (signal === 'included') {
                notes.push(amenity.includedNote);
            }
            else if (signal === 'available') {
                notes.push(amenity.availableNote);
            }
        }
    }
    catch (e_12_1) { e_12 = { error: e_12_1 }; }
    finally {
        try {
            if (AMENITY_BADGE_META_2_1 && !AMENITY_BADGE_META_2_1.done && (_a = AMENITY_BADGE_META_2.return)) _a.call(AMENITY_BADGE_META_2);
        }
        finally { if (e_12) throw e_12.error; }
    }
    var seatSelectionEvidence = findMatchingSourceText(textSources, SEAT_SELECTION_RE);
    if (seatSelectionEvidence && !(fareBenefits && fareBenefits.toLowerCase().includes(seatSelectionEvidence.toLowerCase()))) {
        pushUniqueNote(notes, "Seat selection shown in fare data: ".concat(seatSelectionEvidence));
    }
    var legroomEvidence = findMatchingSourceText(textSources, LEGROOM_RE);
    if (legroomEvidence) {
        pushUniqueNote(notes, "Legroom shown in fare data: ".concat(legroomEvidence));
    }
    var flightNumbers = collectFlightNumbers(offer);
    if (flightNumbers.length > 0) {
        pushUniqueNote(notes, "Flight numbers shown: ".concat(flightNumbers.join(', ')));
    }
    var aircraftTypes = collectAircraftTypes(offer);
    if (aircraftTypes.length > 0) {
        pushUniqueNote(notes, "Aircraft shown: ".concat(aircraftTypes.join(', ')));
    }
    var starlinkNote = buildStarlinkNote(offer);
    if (starlinkNote) {
        pushUniqueNote(notes, starlinkNote);
    }
    var operatingCarriers = collectOperatingCarriers(offer);
    var normalizedOfferAirline = typeof offer.airline === 'string' ? offer.airline.trim().toLowerCase() : '';
    if (operatingCarriers.length === 1 && operatingCarriers[0].toLowerCase() !== normalizedOfferAirline) {
        pushUniqueNote(notes, "Operating carrier shown: ".concat(operatingCarriers[0]));
    }
    else if (operatingCarriers.length > 1) {
        pushUniqueNote(notes, "Operating carriers shown: ".concat(operatingCarriers.join(', ')));
    }
    return notes;
}
// ---- from sdk/js/src/ranking.ts ----------------------------------
/**
 * SYNCED FROM PRODUCTION -- do not hand-edit divergently.
 *
 * This file is a faithful copy of the website's app/lib/rankOffers.ts, the
 * ranker letsfg.co actually runs. It had drifted, and the drift was not
 * cosmetic: this package was missing the trip-purpose persona weight profiles
 * entirely, and hardcoded GF_SAVINGS_COMPARISON_ENABLED = false while
 * production runs it true. A differential on 120 offers across 8 contexts had
 * 6 of 8 orderings disagree, diverging as early as position 4.
 *
 * That matters beyond this SDK: the package is published as "the scoring
 * algorithm that powers letsfg.co", and until this sync it was not.
 */
/**
 * Personalized flight ranking engine.
 *
 * Scores each offer across 9 dimensions with personalization weights
 * that shift based on trip context and purpose. Pure TypeScript — no
 * external imports, safe to run in both Node and browser.
 *
 * Usage:
 *   import { rankOffers, type RankingContext } from '../../lib/rankOffers'
 *   const ranked = rankOffers(offers, { tripContext: 'family', requireBag: true, ... })
 *   // ranked[0].offer is the best pick, ranked[0].heroFacts explains why
 */
// Inlined from the website's lib/google-flights-savings.ts, which is not part
// of this package. These two symbols are the only things the ranker needs from
// it, and the VALUE MATTERS: the savings dimension is scored differently when
// this flag is off. It is `true` in production, so it is `true` here.
var GF_SAVINGS_COMPARISON_ENABLED = true;
function normalizeGoogleFlightsComparisonPrice(googleFlightsPrice, _travelerCount) {
    if (_travelerCount === void 0) { _travelerCount = 1; }
    if (!Number.isFinite(googleFlightsPrice)) {
        return null;
    }
    // google_flights_price is sourced from a like-for-like Google itinerary match,
    // so it is already on the same per-traveler basis as offer.price.
    var normalized = Math.round(googleFlightsPrice * 100) / 100;
    return normalized > 0 ? normalized : null;
}
/** Higher wins when merging same-price duplicates of the same physical flight.
 *  A disagreement between duplicates only ever means one row had an aircraft
 *  type and the other didn't, so the stronger verdict is the better-informed
 *  one - an uninformed row can never out-rank an informed one here, because
 *  without an aircraft string the resolver either says nothing or falls back to
 *  a fleet-wide rule that yields the same answer either way. */
var STARLINK_STRENGTH = {
    likely_some: 1,
    likely_all: 2,
    confirmed_some: 3,
    confirmed_all: 4,
};
/** True when a stored/derived parse indicates the user wants direct flights.
 *  Reads every producer's field: ai_direct_only (server mirror in the results
 *  route), direct_only (Vertex parse), prefer_direct, and stops===0 (local
 *  parseNLQuery). Used to set RankingContext.preferDirect on EVERY ranking path
 *  — the user-facing client ranker previously derived preferDirect only from the
 *  r_priority URL param, which is never set when "direct" is baked into the query
 *  (the priority refine question is then suppressed), so the direct gate silently
 *  never fired and long 1-stops won the hero slot. */
function parsedWantsDirect(parsed) {
    if (!parsed)
        return false;
    return parsed.ai_direct_only === true
        || parsed.direct_only === true
        || parsed.prefer_direct === true
        || parsed.stops === 0;
}
/** Build a RankingContext from a stored/derived `parsed` object alone.
 *
 *  This is the subset of ResultsClient's `rankingContext` that does NOT depend
 *  on the browser — no `r_*` URL answers, no sessionStorage, no display-currency
 *  conversion. It exists so a SERVER-side ranking pass can order offers close to
 *  the way the user's own page will.
 *
 *  Why that matters: /api/results caps the durably-cached offer array at
 *  DURABLE_MAX_BYTES and keeps the top-ranked prefix. Until 2026-08-20 that cap
 *  ranked with `{ preferDirect }` and nothing else, while the client ranked with
 *  the full context — so on a reload or a second tab, offers the client would
 *  have put at the TOP could fall outside the stored prefix and simply vanish.
 *  Measured that day: 246 offers found, 108 stored; 235 → 132; 169 → 82. Adam
 *  reported it as "the ones I saw at the top previously as best were now gone".
 *
 *  Deliberately NOT used for the client's own ranking — the client has strictly
 *  more signal (refine answers, bag/seat prefs, FX-converted prices) and should
 *  keep using it. This only has to make the SURVIVING set contain the client's
 *  winners, not reproduce its exact order.
 */
function rankingContextFromParsed(parsed) {
    var _a, _b, _c, _d, _e, _f;
    if (!parsed)
        return {};
    var num = function (k) {
        return typeof parsed[k] === 'number' ? parsed[k] : undefined;
    };
    var str = function (k) {
        return typeof parsed[k] === 'string' ? parsed[k] : undefined;
    };
    var sortField = (_a = str('sort_by')) !== null && _a !== void 0 ? _a : str('preferred_sort');
    var preferDirect = parsedWantsDirect(parsed);
    var maxStopsRaw = num('max_stops');
    var minLayoverHours = num('min_layover_hours');
    return {
        travelerCount: (_b = num('passengers')) !== null && _b !== void 0 ? _b : num('adults'),
        preferDirect: preferDirect,
        preferCheapest: sortField === 'price',
        preferQuickFlight: sortField === 'duration' || parsed.prefer_quick_flight === true,
        // preferDirect is the stricter cap; don't double-apply (mirrors ResultsClient).
        maxStops: !preferDirect && typeof maxStopsRaw === 'number' ? maxStopsRaw : undefined,
        preferLongLayover: (minLayoverHours !== null && minLayoverHours !== void 0 ? minLayoverHours : 0) >= 6,
        depTimePref: ((_c = str('ai_dep_time_pref')) !== null && _c !== void 0 ? _c : str('depart_time_pref')),
        retTimePref: ((_d = str('ai_ret_time_pref')) !== null && _d !== void 0 ? _d : str('return_depart_time_pref')),
        arrivalTimePref: ((_e = str('ai_arrival_time_pref')) !== null && _e !== void 0 ? _e : str('arrive_time_pref')),
        departAfterMins: num('depart_after_mins'),
        departBeforeMins: num('depart_before_mins'),
        requireBag: parsed.require_checked_baggage === true,
        requireCancellation: parsed.require_cancellation === true,
        tripPurpose: str('trip_purpose'),
        tripContext: ((_f = str('passenger_context')) !== null && _f !== void 0 ? _f : str('ai_passenger_context')),
    };
}
function getOfferInstanceKey(offer) {
    var _a, _b, _c, _d, _e, _f;
    return [
        offer.id,
        offer.departure_time,
        offer.arrival_time,
        offer.stops,
        (_b = (_a = offer.inbound) === null || _a === void 0 ? void 0 : _a.departure_time) !== null && _b !== void 0 ? _b : '',
        (_d = (_c = offer.inbound) === null || _c === void 0 ? void 0 : _c.arrival_time) !== null && _d !== void 0 ? _d : '',
        (_f = (_e = offer.inbound) === null || _e === void 0 ? void 0 : _e.stops) !== null && _f !== void 0 ? _f : '',
    ].join('|');
}
var W = {
    // Generic solo / default — price-driven
    default: {
        price: 0.34, stops: 0.22, duration: 0.12, depTime: 0.08,
        arrivalTime: 0.04, baggage: 0.02, savings: 0.06, comfortHours: 0.04, layover: 0.08,
    },
    // Business — time and directness > price; long layovers are unacceptable
    business_traveler: {
        price: 0.10, stops: 0.26, duration: 0.20, depTime: 0.18,
        arrivalTime: 0.04, baggage: 0.06, savings: 0.00, comfortHours: 0.06, layover: 0.10,
    },
    // Family — directness + baggage practicality; kids + 8h layover = nightmare
    family: {
        price: 0.12, stops: 0.20, duration: 0.16, depTime: 0.08,
        arrivalTime: 0.04, baggage: 0.20, savings: 0.04, comfortHours: 0.08, layover: 0.08,
    },
    // Couple — balance of price, comfort, arrival time, savings
    couple: {
        price: 0.22, stops: 0.20, duration: 0.12, depTime: 0.10,
        arrivalTime: 0.14, baggage: 0.02, savings: 0.10, comfortHours: 0.04, layover: 0.06,
    },
    // Honeymoon — direct > everything; no one wants a 10h layover on their honeymoon
    honeymoon: {
        price: 0.08, stops: 0.28, duration: 0.10, depTime: 0.14,
        arrivalTime: 0.18, baggage: 0.02, savings: 0.02, comfortHours: 0.08, layover: 0.10,
    },
    // Special occasion — still prioritize smooth timing/directness, but keep price meaningful.
    special_occasion: {
        price: 0.14, stops: 0.24, duration: 0.10, depTime: 0.12,
        arrivalTime: 0.16, baggage: 0.02, savings: 0.06, comfortHours: 0.08, layover: 0.08,
    },
    // Ski — bag essential (equipment); early arrival to maximize slopes
    ski: {
        price: 0.12, stops: 0.16, duration: 0.10, depTime: 0.16,
        arrivalTime: 0.08, baggage: 0.24, savings: 0.04, comfortHours: 0.02, layover: 0.08,
    },
    // Beach — arrive early to enjoy the day; price matters
    beach: {
        price: 0.24, stops: 0.16, duration: 0.10, depTime: 0.10,
        arrivalTime: 0.14, baggage: 0.10, savings: 0.06, comfortHours: 0.04, layover: 0.06,
    },
    // City break — maximize time on the ground; 2-day trip loses half a day to a 6h layover
    city_break: {
        price: 0.26, stops: 0.20, duration: 0.08, depTime: 0.12,
        arrivalTime: 0.16, baggage: 0.02, savings: 0.04, comfortHours: 0.04, layover: 0.08,
    },
    // Quick flight — user explicitly wants shortest possible total duration
    quick_flight: {
        price: 0.14, stops: 0.20, duration: 0.40, depTime: 0.06,
        arrivalTime: 0.04, baggage: 0.02, savings: 0.04, comfortHours: 0.04, layover: 0.06,
    },
    // Cheapest — user explicitly asked for lowest price; price overwhelms all other factors
    cheapest: {
        price: 0.88, stops: 0.06, duration: 0.03, depTime: 0.01,
        arrivalTime: 0.01, baggage: 0.01, savings: 0.00, comfortHours: 0.00, layover: 0.00,
    },
    // Cheapest direct — user asked for BOTH cheapest AND direct/nonstop.
    // Stops must dominate enough that a direct flight wins even if it costs more;
    // price wins within the same stop tier (all directs sorted by price, all 1-stops sorted
    // by price below them, etc.). The scoreStops delta between 0-stop (1.00) and 1-stop (0.40)
    // is 0.60; with stops weight 0.38 that gap is worth 0.228, which means a 1-stop would
    // need an enormous price advantage to beat a direct — effectively "direct first".
    cheapest_direct: {
        price: 0.52, stops: 0.38, duration: 0.04, depTime: 0.02,
        arrivalTime: 0.01, baggage: 0.01, savings: 0.00, comfortHours: 0.00, layover: 0.02,
    },
};
var PURPOSE_WEIGHT_PROFILES = {
    honeymoon: W.honeymoon,
    special_occasion: W.special_occasion,
    business: W.business_traveler,
    ski: W.ski,
    beach: W.beach,
    city_break: W.city_break,
    family_holiday: W.family,
    graduation: W.city_break,
    concert_festival: W.city_break,
    sports_event: W.city_break,
    spring_break: W.beach,
};
var EARLY_ARRIVAL_PURPOSES = new Set([
    'city_break',
    'beach',
    'special_occasion',
    'graduation',
    'concert_festival',
    'sports_event',
    'spring_break',
]);
function blendWeights(profiles) {
    var e_13, _a;
    if (profiles.length === 0)
        return __assign({}, W.default);
    var blended = {
        price: 0,
        stops: 0,
        duration: 0,
        depTime: 0,
        arrivalTime: 0,
        baggage: 0,
        savings: 0,
        comfortHours: 0,
        layover: 0,
    };
    try {
        for (var profiles_1 = __values(profiles), profiles_1_1 = profiles_1.next(); !profiles_1_1.done; profiles_1_1 = profiles_1.next()) {
            var profile = profiles_1_1.value;
            blended.price += profile.price;
            blended.stops += profile.stops;
            blended.duration += profile.duration;
            blended.depTime += profile.depTime;
            blended.arrivalTime += profile.arrivalTime;
            blended.baggage += profile.baggage;
            blended.savings += profile.savings;
            blended.comfortHours += profile.comfortHours;
            blended.layover += profile.layover;
        }
    }
    catch (e_13_1) { e_13 = { error: e_13_1 }; }
    finally {
        try {
            if (profiles_1_1 && !profiles_1_1.done && (_a = profiles_1.return)) _a.call(profiles_1);
        }
        finally { if (e_13) throw e_13.error; }
    }
    return {
        price: blended.price / profiles.length,
        stops: blended.stops / profiles.length,
        duration: blended.duration / profiles.length,
        depTime: blended.depTime / profiles.length,
        arrivalTime: blended.arrivalTime / profiles.length,
        baggage: blended.baggage / profiles.length,
        savings: blended.savings / profiles.length,
        comfortHours: blended.comfortHours / profiles.length,
        layover: blended.layover / profiles.length,
    };
}
function resolveWeights(ctx) {
    // When the user asked for BOTH cheapest AND direct, use the combined profile so stops
    // still dominate (direct first) while price rules within the same stop tier.
    if (ctx.preferCheapest && ctx.preferDirect)
        return __assign({}, W.cheapest_direct);
    // preferCheapest alone — user just wants the lowest price, stops don't matter much
    if (ctx.preferCheapest)
        return __assign({}, W.cheapest);
    var tripPurposes = normalizeTripPurposes({
        tripPurpose: ctx.tripPurpose,
        tripPurposes: ctx.tripPurposes,
    });
    var purposeProfiles = tripPurposes.map(function (purpose) { return PURPOSE_WEIGHT_PROFILES[purpose]; });
    // tripPurpose takes precedence for specific categories
    var w = ctx.preferQuickFlight ? __assign({}, W.quick_flight) : purposeProfiles.length > 0 ? blendWeights(purposeProfiles)
        : ctx.tripContext === 'business_traveler' ? __assign({}, W.business_traveler) : ctx.tripContext === 'family' ? __assign({}, W.family) : ctx.tripContext === 'couple' ? __assign({}, W.couple) : __assign({}, W.default);
    // When user explicitly asked for direct/nonstop flights, heavily boost stops weight.
    // We don't filter — if no directs exist, 1-stop naturally beats 3-stop via this weight.
    if (ctx.preferDirect) {
        var boost = 0.20;
        w.stops = Math.min(0.50, w.stops + boost);
        // Absorb from price first, then duration
        var fromPrice = Math.min(boost * 0.60, Math.max(0.04, w.price) - 0.04);
        var fromDuration = Math.min(boost - fromPrice, Math.max(0.02, w.duration) - 0.02);
        w.price -= fromPrice;
        w.duration -= fromDuration;
    }
    // Soft stop-cap ("1 stop", "max 2 stops"): boost the stops weight so within-cap
    // offers float up, mirroring preferDirect but milder — the cap is ≥1, so the user
    // tolerates a connection, they just don't want a 3-leg odyssey. Skipped when
    // preferDirect already owns the stops dimension (an implicit cap of 0).
    if (ctx.maxStops !== undefined && !ctx.preferDirect) {
        var boost = 0.12;
        w.stops = Math.min(0.44, w.stops + boost);
        var fromPrice = Math.min(boost * 0.60, Math.max(0.04, w.price) - 0.04);
        var fromDuration = Math.min(boost - fromPrice, Math.max(0.02, w.duration) - 0.02);
        w.price -= fromPrice;
        w.duration -= fromDuration;
    }
    // "Long layover" wanted — make the layover dimension actually count, otherwise the
    // inverted scoreLayover curve barely moves the needle at the default 0.08 weight.
    if (ctx.preferLongLayover) {
        var boost = 0.12;
        w.layover = Math.min(0.24, w.layover + boost);
        var fromPrice = Math.min(boost * 0.60, Math.max(0.04, w.price) - 0.04);
        var fromDuration = Math.min(boost - fromPrice, Math.max(0.02, w.duration) - 0.02);
        w.price -= fromPrice;
        w.duration -= fromDuration;
    }
    // When the user explicitly stated a departure time preference ("evening", "morning",
    // etc.), honour it strongly — base profiles treat it as a soft preference but a
    // stated pref is a hard preference and must dominate arrivalTime.
    if (ctx.depTimePref) {
        var boost = 0.13;
        w.depTime = Math.min(0.36, w.depTime + boost);
        // Absorb cost from arrivalTime first, then duration
        var fromArrival = Math.min(boost * 0.65, Math.max(0, w.arrivalTime - 0.03));
        var fromDuration = Math.min(boost - fromArrival, Math.max(0, w.duration - 0.03));
        w.arrivalTime -= fromArrival;
        w.duration -= fromDuration;
    }
    // If user needs checked bag and the profile doesn't already weight it highly,
    // boost baggage importance at the cost of price and duration.
    if (ctx.requireBag && w.baggage < 0.15) {
        var boost = 0.12;
        w.baggage += boost;
        w.price = Math.max(0.04, w.price - boost * 0.60);
        w.duration = Math.max(0.02, w.duration - boost * 0.40);
    }
    return w;
}
/** Heavy penalty applied when a flight violates a hard departure time constraint
 *  ("departure after 10am", "departure before 9am"). Score multiplier → 0.05,
 *  so these flights sink to the bottom without completely vanishing from results. */
function timeConstraintPenalty(depMins, afterMins, beforeMins) {
    if (afterMins !== undefined && depMins < afterMins)
        return 0.05;
    if (beforeMins !== undefined && depMins > beforeMins)
        return 0.05;
    return 1.0;
}
/** Soft multiplier for departure time mismatch when the user explicitly stated
 *  a time preference ("evening", "morning", etc.). Acts as a strong nudge rather
 *  than a filter — flights at the clearly wrong time are significantly demoted
 *  but still appear in results so the user can see what's available. */
function depTimeMismatchMultiplier(depMins, depTimePref) {
    if (!depTimePref)
        return 1.0;
    var s = scoreDepTime(depMins, depTimePref);
    if (s >= 0.55)
        return 1.0; // ok or good match — no penalty
    if (s >= 0.30)
        return 0.80; // slightly off — gentle nudge
    return 0.55; // clearly wrong time window (e.g. 7:35am when user asked for evening)
}
/** Same multiplier logic as depTimeMismatchMultiplier but applied to the return
 *  departure time vs retTimePref. Penalty is softer than outbound because return
 *  availability is more constrained — we don't want to bury an otherwise ideal
 *  flight just because the Sunday return is at 10am instead of evening. */
function retDepTimeMismatchMultiplier(offer, retTimePref) {
    var _a;
    if (!retTimePref)
        return 1.0;
    var retDep = (_a = offer.inbound) === null || _a === void 0 ? void 0 : _a.departure_time;
    if (!retDep)
        return 1.0; // one-way or no return info — can't penalize
    var retDepMins = isoToMins(retDep);
    var s = scoreDepTime(retDepMins, retTimePref);
    if (s >= 0.55)
        return 1.0; // ok or good match — no penalty
    if (s >= 0.15)
        return 0.88; // near-miss (e.g. 16:40 for evening) — gentle nudge
    return 0.70; // clearly wrong time window (softer than outbound 0.55)
}
/** Remove near-duplicate offers: when multiple connectors return the same physical
 *  flight (e.g. Ryanair FR1234 from both the direct connector and Kiwi/Skyscanner),
 *  keep only the cheapest. Two offers are considered identical only when they share
 *  the same calendar date, route, airline, outbound timing buckets, inbound timing
 *  buckets (for round-trips), stop counts, and core fare conditions. Including the
 *  inbound leg prevents collapsing distinct return options for the same outbound. */
function deduplicateOffers(offers) {
    var mergeAncillary = function (current, next) {
        if (!current)
            return next ? __assign({}, next) : undefined;
        if (!next)
            return current;
        return {
            included: typeof current.included === 'boolean' ? current.included : next.included,
            price: typeof current.price === 'number' ? current.price : next.price,
            currency: current.currency || next.currency,
            description: current.description || next.description,
        };
    };
    var mergeOfferDetails = function (representative, bucketOffers, representativePrice) {
        var e_14, _a, e_15, _b;
        var _c, _d;
        var samePriceMatches = bucketOffers.filter(function (candidate) { var _a; return Math.abs(((_a = candidate.displayPrice) !== null && _a !== void 0 ? _a : candidate.price) - representativePrice) < 0.01; });
        if (samePriceMatches.length <= 1) {
            return representative;
        }
        var mergedAncillaries = representative.ancillaries
            ? {
                cabin_bag: representative.ancillaries.cabin_bag,
                checked_bag: representative.ancillaries.checked_bag,
                seat_selection: representative.ancillaries.seat_selection,
            }
            : undefined;
        var mergedConditions = representative.conditions ? __assign({}, representative.conditions) : undefined;
        // Carry the Starlink verdict across duplicates for the same reason the bag
        // prices are merged: the cheapest listing is often the one with the thinnest
        // data. Without this, a Kiwi row that wins on price silently drops a badge
        // the Google row for the identical flight had earned.
        var mergedStarlink = representative.starlink;
        try {
            for (var samePriceMatches_1 = __values(samePriceMatches), samePriceMatches_1_1 = samePriceMatches_1.next(); !samePriceMatches_1_1.done; samePriceMatches_1_1 = samePriceMatches_1.next()) {
                var candidate = samePriceMatches_1_1.value;
                if (candidate.starlink
                    && ((_c = STARLINK_STRENGTH[candidate.starlink]) !== null && _c !== void 0 ? _c : 0) > (mergedStarlink ? (_d = STARLINK_STRENGTH[mergedStarlink]) !== null && _d !== void 0 ? _d : 0 : 0)) {
                    mergedStarlink = candidate.starlink;
                }
                if (candidate.ancillaries) {
                    mergedAncillaries = {
                        cabin_bag: mergeAncillary(mergedAncillaries === null || mergedAncillaries === void 0 ? void 0 : mergedAncillaries.cabin_bag, candidate.ancillaries.cabin_bag),
                        checked_bag: mergeAncillary(mergedAncillaries === null || mergedAncillaries === void 0 ? void 0 : mergedAncillaries.checked_bag, candidate.ancillaries.checked_bag),
                        seat_selection: mergeAncillary(mergedAncillaries === null || mergedAncillaries === void 0 ? void 0 : mergedAncillaries.seat_selection, candidate.ancillaries.seat_selection),
                    };
                }
                if (candidate.conditions) {
                    var nextConditions = __assign({}, (mergedConditions !== null && mergedConditions !== void 0 ? mergedConditions : {}));
                    try {
                        for (var _e = (e_15 = void 0, __values(Object.entries(candidate.conditions))), _f = _e.next(); !_f.done; _f = _e.next()) {
                            var _g = __read(_f.value, 2), conditionKey = _g[0], conditionValue = _g[1];
                            if (!conditionValue)
                                continue;
                            var currentValue = nextConditions[conditionKey];
                            if (!currentValue || currentValue === 'unknown') {
                                nextConditions[conditionKey] = conditionValue;
                            }
                        }
                    }
                    catch (e_15_1) { e_15 = { error: e_15_1 }; }
                    finally {
                        try {
                            if (_f && !_f.done && (_b = _e.return)) _b.call(_e);
                        }
                        finally { if (e_15) throw e_15.error; }
                    }
                    mergedConditions = nextConditions;
                }
            }
        }
        catch (e_14_1) { e_14 = { error: e_14_1 }; }
        finally {
            try {
                if (samePriceMatches_1_1 && !samePriceMatches_1_1.done && (_a = samePriceMatches_1.return)) _a.call(samePriceMatches_1);
            }
            finally { if (e_14) throw e_14.error; }
        }
        return __assign(__assign({}, representative), { ancillaries: mergedAncillaries, conditions: mergedConditions, starlink: mergedStarlink });
    };
    var bucket = function (iso) { return Math.round(isoToMins(iso) / 30); };
    var dayKey = function (iso) {
        if (!iso)
            return '';
        var d = new Date(iso);
        return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
    };
    var legKey = function (departureTime, arrivalTime, origin, destination, stops, segments) {
        // For itineraries with >1 segment, include sorted intermediate airport codes
        // so that LHR→FRA→JFK and LHR→CDG→JFK with the same dep/arr slot are not
        // collapsed into the same dedup bucket.
        var intermediate = segments && segments.length > 1
            ? segments
                .slice(0, -1)
                .map(function (s) { var _a; return ((_a = s.destination) !== null && _a !== void 0 ? _a : '').toUpperCase(); })
                .filter(Boolean)
                .sort()
                .join(',')
            : '';
        return [
            dayKey(departureTime),
            (origin !== null && origin !== void 0 ? origin : '').toUpperCase(),
            (destination !== null && destination !== void 0 ? destination : '').toUpperCase(),
            departureTime ? bucket(departureTime) : '',
            arrivalTime ? bucket(arrivalTime) : '',
            stops !== null && stops !== void 0 ? stops : '',
            intermediate,
        ].join('_');
    };
    // Normalize the refund condition so that 'unknown' and 'not_allowed' land in the
    // same dedup bucket. Different connectors report the same non-refundable fare as
    // either value — without normalization, the same physical flight shows up many times.
    // 'allowed' and 'allowed_with_fee' stay distinct so that a refundable fare variant
    // is never silently collapsed with a non-refundable one.
    var normRefund = function (c) {
        return (c === 'allowed' || c === 'allowed_with_fee') ? c : 'nonrefundable';
    };
    var key = function (o) {
        var _a, _b;
        return [
            ((_a = o.airline) !== null && _a !== void 0 ? _a : '').toUpperCase(),
            legKey(o.departure_time, o.arrival_time, o.origin, o.destination, o.stops, o.segments),
            o.inbound
                ? legKey(o.inbound.departure_time, o.inbound.arrival_time, o.inbound.origin, o.inbound.destination, o.inbound.stops, o.inbound.segments)
                : 'oneway',
            normRefund((_b = o.conditions) === null || _b === void 0 ? void 0 : _b.refund_before_departure),
        ].join('_');
    };
    var buckets = new Map();
    offers.forEach(function (offer, index) {
        var _a;
        var offerKey = key(offer);
        var effectivePrice = (_a = offer.displayPrice) !== null && _a !== void 0 ? _a : offer.price;
        var bucketState = buckets.get(offerKey);
        if (!bucketState) {
            buckets.set(offerKey, {
                minPrice: effectivePrice,
                representative: offer,
                representativeIndex: index,
                offers: [offer],
            });
            return;
        }
        bucketState.offers.push(offer);
        if (effectivePrice < bucketState.minPrice - 0.01) {
            bucketState.minPrice = effectivePrice;
            bucketState.representative = offer;
            bucketState.representativeIndex = index;
        }
    });
    return __spreadArray([], __read(buckets.values()), false).sort(function (left, right) { return left.representativeIndex - right.representativeIndex; })
        .map(function (bucketState) { return mergeOfferDetails(bucketState.representative, bucketState.offers, bucketState.minPrice); });
}
// ── Helpers ────────────────────────────────────────────────────────────────
function isoToMins(iso) {
    if (!iso)
        return 0;
    // Extract local airport time directly from the ISO string literal.
    // "2026-06-01T10:15:00+02:00" → 615 (10h15m local, not 495 UTC).
    // Timestamps without timezone info are by convention the local airport time,
    // so the T-prefixed HH:MM in the string is always what we want.
    var match = /T(\d{2}):(\d{2})/.exec(iso);
    if (match)
        return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
    var d = new Date(iso);
    if (isNaN(d.getTime()))
        return 0;
    return d.getUTCHours() * 60 + d.getUTCMinutes();
}
/** Number of calendar days between departure and arrival (UTC). 0 = same day, 1 = next day, etc. */
function daysBetween(depIso, arrIso) {
    if (!depIso || !arrIso)
        return 0;
    var dep = new Date(depIso);
    var arr = new Date(arrIso);
    if (isNaN(dep.getTime()) || isNaN(arr.getTime()))
        return 0;
    var depDay = Math.floor(dep.getTime() / 86400000);
    var arrDay = Math.floor(arr.getTime() / 86400000);
    return Math.max(0, arrDay - depDay);
}
function formatMins(mins) {
    var h = Math.floor(mins / 60) % 24;
    var m = mins % 60;
    var ampm = h >= 12 ? 'pm' : 'am';
    var h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return "".concat(h12, ":").concat(m.toString().padStart(2, '0')).concat(ampm);
}
/** 5th and 95th percentile — clips outliers from distorting normalization */
function p5p95(arr) {
    var _a;
    if (arr.length === 0)
        return [0, 0];
    var s = __spreadArray([], __read(arr), false).sort(function (a, b) { return a - b; });
    var lo = (_a = s[Math.floor(s.length * 0.05)]) !== null && _a !== void 0 ? _a : s[0];
    var hi = s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)];
    return [lo, hi];
}
// ── Dimension scorers (all return 0–1, higher = better) ───────────────────
function scorePrice(price, lo, hi) {
    if (hi <= lo)
        return 1.0;
    return 1.0 - Math.max(0, Math.min(1, (price - lo) / (hi - lo)));
}
function scoreDuration(mins, lo, hi) {
    if (hi <= lo)
        return 0.8;
    return 1.0 - Math.max(0, Math.min(1, (mins - lo) / (hi - lo)));
}
function scoreStops(stops) {
    if (stops === 0)
        return 1.00;
    if (stops === 1)
        return 0.40;
    if (stops === 2)
        return 0.14;
    return 0.04;
}
var TIME_RANGES = {
    // [perfectLo, perfectHi, okLo, okHi] — all in minutes from midnight
    early_morning: [0, 330, 330, 420],
    morning: [360, 660, 300, 750],
    afternoon: [720, 1020, 660, 1140],
    evening: [1080, 1320, 1020, 1380],
    // "night" is later/stricter than "evening" — when a user says "Sunday night
    // back" they mean ~21:00+, not 18:00. Perfect 21:00–23:30, ok 20:00–23:59.
    // A 18:20 return fails this gate while still passing the evening gate.
    night: [1260, 1410, 1200, 1439],
    red_eye: [1320, 1439, 0, 420],
};
function scoreDepTime(depMins, pref) {
    if (!pref) {
        // No preference: score by general reasonableness (avoid very early/late)
        if (depMins >= 360 && depMins <= 1260)
            return 0.80; // 6am–9pm: great
        if (depMins >= 270 && depMins <= 1380)
            return 0.50; // 4:30am–11pm: ok
        return 0.20; // middle of night
    }
    var r = TIME_RANGES[pref];
    if (!r)
        return 0.5;
    var _a = __read(r, 4), pLo = _a[0], pHi = _a[1], oLo = _a[2], oHi = _a[3];
    if (depMins >= pLo && depMins <= pHi)
        return 1.00;
    if (depMins >= oLo && depMins <= oHi)
        return 0.60;
    // Outside ok range: graduated falloff proportional to distance from the nearest ok/perfect
    // boundary. Closer = higher score; farther = lower. Floor at 0.05.
    // This means 16:40 BCN scores meaningfully higher than 07:30 BCN when the user wants
    // an evening return — both are outside the range, but one is near-miss, not totally wrong.
    var distBelowOk = Math.max(0, oLo - depMins); // minutes before ok window
    var distAboveOk = Math.max(0, depMins - oHi); // minutes after ok window
    var dist = distBelowOk > 0 ? distBelowOk : distAboveOk;
    var span = oHi - oLo; // ok window size in minutes
    return Math.max(0.05, 0.20 * Math.exp(-dist / Math.max(span * 1.5, 60)));
}
function scoreArrivalTime(arrMins, pref, tripPurposes, dayOffset) {
    if (dayOffset === void 0) { dayOffset = 0; }
    var isExploring = (tripPurposes !== null && tripPurposes !== void 0 ? tripPurposes : []).some(function (purpose) { return EARLY_ARRIVAL_PURPOSES.has(purpose); });
    if (!pref && !isExploring)
        return 0.50; // neutral when no preference & not time-sensitive
    var base;
    if (pref === 'morning') {
        if (arrMins < 720)
            base = 1.00;
        else if (arrMins < 900)
            base = 0.65;
        else
            base = 0.25;
    }
    else if (pref === 'afternoon') {
        if (arrMins >= 720 && arrMins < 1020)
            base = 1.00;
        else if (arrMins < 1140)
            base = 0.65;
        else
            base = 0.25;
    }
    else if (pref === 'evening') {
        if (arrMins >= 1020 && arrMins < 1320)
            base = 1.00;
        else if (arrMins >= 900)
            base = 0.65;
        else
            base = 0.25;
    }
    else {
        // Exploring/tourism trips: earlier arrival = more day to enjoy.
        // IMPORTANT: arriving before 6am is a red-eye — you go to sleep and lose your first
        // morning. Don't score 02:40am as "amazing" just because it's before 10am. Reserve
        // the top score for genuine morning arrivals (6am+) when you can actually start the day.
        if (arrMins < 360) {
            // Red-eye / wee-hours arrival: you can't do anything until morning.
            // Next-day red-eye (e.g. 02:40+1) is especially bad — you've already lost
            // a full calendar day compared to a same-day afternoon arrival.
            base = dayOffset >= 1 ? 0.15 : 0.30;
        }
        else if (arrMins < 600)
            base = 1.00; // 6am–10am: genuinely great morning arrival
        else if (arrMins < 720)
            base = 0.85; // 10am–noon
        else if (arrMins < 900)
            base = 0.70; // noon–3pm
        else if (arrMins < 1080)
            base = 0.55; // 3pm–6pm
        else if (arrMins < 1260)
            base = 0.35; // 6pm–9pm
        else
            base = 0.15; // after 9pm: barely any evening left
    }
    // Penalise flights arriving a full day later than the earliest possible.
    // day+0 and day+1 are both treated as baseline (long-haul routinely arrives
    // the next day). day+2 means a full extra day of travel compared to the
    // fastest options, which matters a lot for city breaks and beach trips.
    if (dayOffset >= 2) {
        var extraDays = dayOffset - 1; // how many days beyond "next day"
        var penalty = isExploring
            ? Math.min(base, extraDays * 0.45) // steeper for tourism trips
            : Math.min(base, extraDays * 0.25);
        base = Math.max(0, base - penalty);
    }
    return base;
}
function scoreBaggage(offer, requireBag) {
    var _a, _b;
    var bag = (_a = offer.ancillaries) === null || _a === void 0 ? void 0 : _a.checked_bag;
    var isIncluded = (bag === null || bag === void 0 ? void 0 : bag.included) === true;
    var fee = (bag === null || bag === void 0 ? void 0 : bag.included) === false ? ((_b = bag === null || bag === void 0 ? void 0 : bag.price) !== null && _b !== void 0 ? _b : null) : null;
    if (!requireBag) {
        // Slight preference for included bag even when not required
        return isIncluded ? 0.80 : 0.50;
    }
    // User explicitly needs checked bag — reward it heavily
    if (isIncluded)
        return 1.0;
    if (fee === null)
        return 0.30; // unknown fee is a risk
    // Score relative to ticket price — cheaper bag = better
    var ratio = fee / Math.max(offer.price, 1);
    if (ratio < 0.05)
        return 0.72;
    if (ratio < 0.12)
        return 0.52;
    if (ratio < 0.22)
        return 0.32;
    return 0.12;
}
function scoreSavings(offer, travelerCount) {
    var gfp = normalizeGoogleFlightsComparisonPrice(offer.google_flights_price, travelerCount);
    if (!gfp || gfp <= 0)
        return 0.50; // neutral — no comparison available
    var pct = (gfp - offer.price) / gfp;
    if (pct >= 0.20)
        return 1.00; // 20%+ cheaper than GF: excellent
    if (pct >= 0.12)
        return 0.85;
    if (pct >= 0.06)
        return 0.72;
    if (pct >= 0.01)
        return 0.60; // slightly cheaper
    if (pct >= -0.05)
        return 0.48; // roughly same as GF
    return 0.22; // more expensive than GF
}
function scoreComfortHours(depMins) {
    if (depMins >= 360 && depMins <= 1320)
        return 1.00; // 6am–10pm: no alarm clock required
    if (depMins >= 270 && depMins <= 1380)
        return 0.60; // 4:30am or 11pm: early/late
    if (depMins >= 180)
        return 0.30; // 3am ish: very early
    return 0.10; // dead of night
}
function scoreLayover(offer, preferLong) {
    var _a, _b, _c, _d, _e, _f;
    if (preferLong === void 0) { preferLong = false; }
    // Round-trip aware: consider layovers across BOTH legs. A 20h layover on the
    // return leg is just as bad as one on the outbound — historically the inbound
    // segments were ignored entirely, masking 28h-return offers behind a clean
    // direct outbound.
    var outStops = (_a = offer.stops) !== null && _a !== void 0 ? _a : 0;
    var inStops = (_c = (_b = offer.inbound) === null || _b === void 0 ? void 0 : _b.stops) !== null && _c !== void 0 ? _c : 0;
    // A direct flight has no layover at all. When the user is fine with — or wants —
    // a connection, a direct still isn't a *bad* outcome, so we keep it neutral-high
    // rather than rewarding it as the layover ideal (we don't bury directs, but we
    // also don't pretend a non-stop satisfies a "long layover" wish).
    if (outStops === 0 && inStops === 0)
        return preferLong ? 0.70 : 1.0;
    var layoverMins = __spreadArray(__spreadArray([], __read(((_d = offer.segments) !== null && _d !== void 0 ? _d : [])), false), __read(((_f = (_e = offer.inbound) === null || _e === void 0 ? void 0 : _e.segments) !== null && _f !== void 0 ? _f : [])), false).filter(function (s) { var _a; return ((_a = s.layover_minutes) !== null && _a !== void 0 ? _a : 0) > 0; })
        .map(function (s) { return s.layover_minutes; });
    // If we have at least one stop but no segment detail at all, stay neutral.
    if (layoverMins.length === 0)
        return 0.50;
    var worst = Math.max.apply(Math, __spreadArray([], __read(layoverMins), false));
    if (preferLong) {
        // User explicitly wants a long layover (stopover to explore / break the trip).
        // INVERT the default curve: a quick connection is the *bad* outcome here, and
        // a generous layover is the goal. A tight (<40m) connection is still risky.
        if (worst < 40)
            return 0.10; // dangerously tight — still a miss-risk
        if (worst < 120)
            return 0.30; // <2h: too short to do anything
        if (worst < 240)
            return 0.55; // 2–4h: getting there
        if (worst < 480)
            return 0.78; // 4–8h: a real stopover
        if (worst <= 900)
            return 1.00; // 8–15h: ideal long layover
        if (worst <= 1440)
            return 0.92; // 15–24h: a day in the city — great for a stopover
        return 0.75; // 24h+: long, but they asked for it
    }
    if (worst < 40)
        return 0.10; // dangerously tight connection
    if (worst < 60)
        return 0.35; // risky
    if (worst <= 180)
        return 1.00; // ideal 1–3h: sweet spot
    if (worst <= 240)
        return 0.82; // 3–4h: fine
    if (worst <= 360)
        return 0.55; // 4–6h: starts to drag
    if (worst <= 480)
        return 0.28; // 6–8h: genuinely bad
    if (worst <= 660)
        return 0.12; // 8–11h: awful
    return 0.04; // 11h+ layover: borderline unusable
}
/** Round-trip stops signal: take the worse leg. A direct outbound paired with
 *  a 1-stop return is, for ranking purposes, a 1-stop trip. */
function combinedStops(offer) {
    var _a, _b, _c;
    var out = (_a = offer.stops) !== null && _a !== void 0 ? _a : 0;
    var inb = (_c = (_b = offer.inbound) === null || _b === void 0 ? void 0 : _b.stops) !== null && _c !== void 0 ? _c : 0;
    return Math.max(out, inb);
}
/** Round-trip total duration in minutes. Falls back to outbound-only when no
 *  inbound is present (one-way) or when inbound duration is missing. */
function totalRoundTripDuration(offer) {
    var _a, _b;
    var out = (_a = offer.duration_minutes) !== null && _a !== void 0 ? _a : 0;
    if (!offer.inbound)
        return out;
    var inb = (_b = offer.inbound.duration_minutes) !== null && _b !== void 0 ? _b : 0;
    return out + inb;
}
function refundabilityMultiplier(offer, requireCancellation) {
    var _a;
    if (!requireCancellation)
        return 1.0;
    var refundability = (_a = offer.conditions) === null || _a === void 0 ? void 0 : _a.refund_before_departure;
    if (refundability === 'allowed')
        return 1.0;
    if (refundability === 'allowed_with_fee')
        return 0.82;
    if (refundability === 'unknown' || refundability === undefined)
        return 0.58;
    return 0.08;
}
function mealPreferenceMultiplier(offer, requireMeals) {
    if (!requireMeals)
        return 1.0;
    var mealSignal = extractOfferDetailSignals(offer).meals;
    if (mealSignal === 'included')
        return 1.0;
    if (mealSignal === 'available')
        return 0.84;
    return 0.56;
}
// ── Fact generation ────────────────────────────────────────────────────────
function generateFacts(offer, bd, refPrice, fastestMins, ctx, travelerCount, isHero) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    var heroFacts = [];
    var tradeoffs = [];
    var cur = offer.currency;
    // ── Price ─────────────────────────────────────────────────────────────────
    var priceDiff = Math.round(offer.price - refPrice);
    if (isHero) {
        // Hero: compare vs cheapest in the full set
        if (priceDiff <= 5) {
            heroFacts.push("cheapest available (".concat(Math.round(offer.price), " ").concat(cur, ")"));
        }
        else {
            // Hero won despite not being cheapest — note the small premium is worth it
            tradeoffs.push("".concat(priceDiff, " ").concat(cur, " above the cheapest option"));
        }
    }
    else {
        // Runner: compare vs the hero
        if (priceDiff < -5) {
            heroFacts.push("".concat(Math.abs(priceDiff), " ").concat(cur, " cheaper than the top pick"));
        }
        else if (priceDiff > 5) {
            tradeoffs.push("".concat(priceDiff, " ").concat(cur, " more expensive than the top pick"));
        }
        // within ±5: skip the price note (essentially the same price)
    }
    // ── Stops ────────────────────────────────────────────────────────────────
    if (offer.stops === 0) {
        heroFacts.push('direct flight — no layovers or connections');
    }
    else if (offer.stops === 1) {
        tradeoffs.push('1 stop');
    }
    else {
        tradeoffs.push("".concat(offer.stops, " stops"));
    }
    // ── Google Flights savings ───────────────────────────────────────────────
    // GF comparison copy gated off while the baseline is untrustworthy (see
    // GF_SAVINGS_COMPARISON_ENABLED). Ranking still consumes google_flights_price
    // via scoreSavings — only this user-facing hero/tradeoff line is suppressed.
    var normalizedGooglePrice = normalizeGoogleFlightsComparisonPrice(offer.google_flights_price, travelerCount);
    if (GF_SAVINGS_COMPARISON_ENABLED && normalizedGooglePrice && normalizedGooglePrice > offer.price + 8) {
        var saving = Math.round(normalizedGooglePrice - offer.price);
        heroFacts.push("".concat(saving, " ").concat(cur, " cheaper than Google Flights (Google shows ").concat(Math.round(normalizedGooglePrice), " ").concat(cur, ")"));
    }
    else if (GF_SAVINGS_COMPARISON_ENABLED && normalizedGooglePrice && offer.price > normalizedGooglePrice + 8) {
        var extra = Math.round(offer.price - normalizedGooglePrice);
        tradeoffs.push("".concat(extra, " ").concat(cur, " more expensive than Google Flights shows"));
    }
    // ── Duration vs fastest ──────────────────────────────────────────────────
    var durDiff = offer.duration_minutes - fastestMins;
    if (durDiff === 0) {
        heroFacts.push("fastest flight on this route (".concat(Math.floor(offer.duration_minutes / 60), "h ").concat(offer.duration_minutes % 60, "m)"));
    }
    else if (durDiff > 90) {
        tradeoffs.push("".concat(Math.floor(durDiff / 60), "h ").concat(durDiff % 60, "m longer than the fastest option"));
    }
    // ── Departure time ───────────────────────────────────────────────────────
    var depMins = isoToMins(offer.departure_time);
    if (bd.depTime >= 0.88 && ctx.depTimePref) {
        heroFacts.push("departs ".concat(formatMins(depMins), " \u2014 matches your ").concat(ctx.depTimePref.replace('_', ' '), " preference"));
    }
    else if (bd.depTime <= 0.25 && ctx.depTimePref) {
        tradeoffs.push("departure at ".concat(formatMins(depMins), " doesn't match your ").concat(ctx.depTimePref.replace('_', ' '), " preference"));
    }
    // ── Arrival time ─────────────────────────────────────────────────────────
    var arrMins = isoToMins(offer.arrival_time);
    var tripPurposes = normalizeTripPurposes({
        tripPurpose: ctx.tripPurpose,
        tripPurposes: ctx.tripPurposes,
    });
    var isExploring = tripPurposes.some(function (purpose) { return EARLY_ARRIVAL_PURPOSES.has(purpose); });
    if (bd.arrivalTime >= 0.88) {
        heroFacts.push("arrives ".concat(formatMins(arrMins)).concat(isExploring ? ' — full day to explore' : ''));
    }
    else if (bd.arrivalTime <= 0.25) {
        tradeoffs.push("late arrival (".concat(formatMins(arrMins), ")"));
    }
    // ── Baggage ──────────────────────────────────────────────────────────────
    var bagIncluded = ((_b = (_a = offer.ancillaries) === null || _a === void 0 ? void 0 : _a.checked_bag) === null || _b === void 0 ? void 0 : _b.included) === true;
    var bagFee = ((_d = (_c = offer.ancillaries) === null || _c === void 0 ? void 0 : _c.checked_bag) === null || _d === void 0 ? void 0 : _d.included) === false
        ? offer.ancillaries.checked_bag.price
        : null;
    if (ctx.requireBag && bagIncluded) {
        heroFacts.push('checked bag already included in the ticket price');
    }
    else if (ctx.requireBag && bagFee != null) {
        tradeoffs.push("bag costs extra (".concat(Math.round(bagFee), " ").concat((_g = (_f = (_e = offer.ancillaries) === null || _e === void 0 ? void 0 : _e.checked_bag) === null || _f === void 0 ? void 0 : _f.currency) !== null && _g !== void 0 ? _g : cur, ")"));
    }
    else if (ctx.requireBag && bagFee === null && !bagIncluded) {
        tradeoffs.push('bag fee unknown — check at booking');
    }
    // ── Refundability ───────────────────────────────────────────────────────
    var refundability = (_h = offer.conditions) === null || _h === void 0 ? void 0 : _h.refund_before_departure;
    if (ctx.requireCancellation && refundability === 'allowed') {
        heroFacts.push('refundable before departure');
    }
    else if (ctx.requireCancellation && refundability === 'allowed_with_fee') {
        tradeoffs.push('refunds allowed with a fee');
    }
    else if (ctx.requireCancellation && refundability === 'not_allowed') {
        tradeoffs.push('not refundable before departure');
    }
    else if (ctx.requireCancellation) {
        tradeoffs.push('refund policy not shown in the fare data');
    }
    // ── Meals / food ─────────────────────────────────────────────────────────
    var mealSignal = extractOfferDetailSignals(offer).meals;
    if (ctx.requireMeals && mealSignal === 'included') {
        heroFacts.push('meal included in fare');
    }
    else if (ctx.requireMeals && mealSignal === 'available') {
        heroFacts.push('meal option shown in fare data');
    }
    else if (ctx.requireMeals) {
        tradeoffs.push('meal availability not shown in the fare data');
    }
    // ── Preferred airline ────────────────────────────────────────────────────
    if (ctx.preferredAirline) {
        var airLower = offer.airline.toLowerCase();
        var prefLower = ctx.preferredAirline.toLowerCase();
        if (airLower.includes(prefLower) || prefLower.includes(airLower.split(' ')[0])) {
            heroFacts.push("with ".concat(offer.airline, " as you mentioned"));
        }
        else {
            tradeoffs.push("not ".concat(ctx.preferredAirline, " (which you mentioned)"));
        }
    }
    return { heroFacts: heroFacts, tradeoffs: tradeoffs };
}
// ── Main export ────────────────────────────────────────────────────────────
/**
 * Rank an array of flight offers by personalized score.
 * Returns a new array sorted best-first. The original array is not mutated.
 *
 * @param offers  Array of flight offers (any type extending RankOffer)
 * @param ctx     User intent context from the NL query parser
 */
/**
 * Price-premium penalty: clamps a score down when an offer costs
 * significantly more than the cheapest option.
 *
 * Uses RELATIVE % so it works correctly in any currency (JPY, EUR, USD, etc.).
 * A 50% premium hurts the same whether the flight is ¥40k or €300.
 */
function premiumPenalty(offerPrice, cheapestPrice) {
    if (cheapestPrice <= 0)
        return 1;
    var ratio = (offerPrice - cheapestPrice) / cheapestPrice; // 0 = cheapest, 0.5 = 50% more
    if (ratio <= 0)
        return 1.00; // cheapest (or tied)
    if (ratio <= 0.08)
        return 1.00; // within 8% — noise, no penalty
    if (ratio <= 0.18)
        return 0.96; // 8–18% more — tiny nudge
    if (ratio <= 0.30)
        return 0.88; // 18–30% more — modest
    if (ratio <= 0.50)
        return 0.76; // 30–50% more — noticeable
    if (ratio <= 0.80)
        return 0.58; // 50–80% more — strong
    if (ratio <= 1.20)
        return 0.40; // 80–120% more (2× price)
    if (ratio <= 2.00)
        return 0.26; // 2–3× cheapest
    return 0.14; // 3×+ : essentially out of contention
}
/**
 * Builds hard gates from user-stated criteria, then finds the highest-scoring
 * offer that passes all gates. When no offer passes them all, relaxes gates
 * in priority order: refund → bag → time → direct. Returns the chosen hero
 * and the list of gates relaxed to find it.
 *
 * Gates only fire when the user explicitly stated the corresponding criterion.
 * Unstated criteria do not gate the hero — the regular weighted score still
 * picks the best offer among those passing the (possibly empty) gate set.
 */
function selectHeroByGates(sorted, ctx) {
    if (sorted.length === 0)
        throw new Error('selectHeroByGates: empty input');
    // Gates ordered LOWEST priority first (= dropped first when no offer matches).
    // refund < bag < time < direct. Direct is sacred; refund is most relaxable.
    var gates = [];
    if (ctx.requireCancellation) {
        gates.push({
            name: 'refund',
            pred: function (o) { var _a; return ((_a = o.conditions) === null || _a === void 0 ? void 0 : _a.refund_before_departure) === 'allowed'; },
        });
    }
    if (ctx.requireBag) {
        gates.push({
            name: 'bag',
            pred: function (o) { var _a, _b; return ((_b = (_a = o.ancillaries) === null || _a === void 0 ? void 0 : _a.checked_bag) === null || _b === void 0 ? void 0 : _b.included) === true; },
        });
    }
    // Time gate combines all stated time prefs into a single predicate. Any one
    // failing fails the whole time gate — relaxing time drops all three at once,
    // which matches the user's mental model ("I'm flexible on time").
    var timePreds = [];
    if (ctx.depTimePref) {
        timePreds.push(function (o) { return scoreDepTime(isoToMins(o.departure_time), ctx.depTimePref) >= 0.55; });
    }
    if (ctx.retTimePref) {
        timePreds.push(function (o) {
            var _a;
            var retDep = (_a = o.inbound) === null || _a === void 0 ? void 0 : _a.departure_time;
            // One-way (no inbound) — no return time to violate; pass.
            if (!retDep)
                return true;
            return scoreDepTime(isoToMins(retDep), ctx.retTimePref) >= 0.55;
        });
    }
    if (ctx.arrivalTimePref) {
        var tripPurposes_1 = normalizeTripPurposes({
            tripPurpose: ctx.tripPurpose,
            tripPurposes: ctx.tripPurposes,
        });
        timePreds.push(function (o) {
            var arrMins = isoToMins(o.arrival_time);
            var dayOffset = daysBetween(o.departure_time, o.arrival_time);
            return scoreArrivalTime(arrMins, ctx.arrivalTimePref, tripPurposes_1, dayOffset) >= 0.55;
        });
    }
    if (timePreds.length > 0) {
        gates.push({ name: 'time', pred: function (o) { return timePreds.every(function (p) { return p(o); }); } });
    }
    // Soft stop-cap gate: the hero must respect the user's stated max ("1 stop").
    // Sits just below 'direct' in priority (relaxed before direct, after time).
    // Skipped when preferDirect is set — that's a stricter cap of 0 handled below.
    if (ctx.maxStops !== undefined && !ctx.preferDirect) {
        var cap_1 = ctx.maxStops;
        gates.push({ name: 'max_stops', pred: function (o) { return combinedStops(o) <= cap_1; } });
    }
    if (ctx.preferDirect) {
        // Both legs must be direct. A direct outbound paired with a 1-stop return
        // is NOT direct from the user's perspective.
        gates.push({ name: 'direct', pred: function (o) { return combinedStops(o) === 0; } });
    }
    // not_suspect is ALWAYS active and sits at the highest priority (last to
    // relax). The hero must come from offers whose data is trustworthy. Only
    // when every offer in the pool is suspect (e.g. all connectors returned
    // wrong-date results) does this gate drop. Rank-not-filter: suspect offers
    // still appear as runner-ups, just never as hero.
    gates.push({ name: 'not_suspect', pred: function (o) { return o.quality !== 'suspect'; } });
    // Highest-scoring offer by raw score, independent of any sort-order hard
    // partitions (e.g. preferDirect promotes all directs above all 1-stops in
    // sort order regardless of score — sorted[0] may not be the best scorer).
    var topByScore = sorted.reduce(function (best, s) { return (s.score > best.score ? s : best); }, sorted[0]);
    // Report a gate as "relaxed" ONLY when the chosen hero actually violates it.
    // The relaxation loop drops gates lowest-priority-first, so when the binding
    // constraint is a HIGH-priority gate (e.g. not_suspect in an all-suspect pool),
    // every lower gate gets dropped on the way down even though the hero still
    // satisfies them. Without this filter the hero would falsely banner "we relaxed
    // your stop limit" while actually respecting it (the sort partition keeps
    // within-cap offers on top). Only surface genuine mismatches.
    var gateByName = new Map(gates.map(function (g) { return [g.name, g.pred]; }));
    var trulyRelaxed = function (names, hero) {
        return names.filter(function (name) {
            var pred = gateByName.get(name);
            return pred ? !pred(hero.offer) : true;
        });
    };
    var relaxed = [];
    var _loop_1 = function (dropCount) {
        var active = gates.slice(dropCount);
        var candidate = sorted.find(function (s) { return active.every(function (g) { return g.pred(s.offer); }); });
        if (candidate) {
            // Bag-gate regression guard: when the bag gate is still active, check
            // whether it is the SOLE reason the overall best-scoring offer can't be
            // selected. Bag is the only ancillary a traveller can add separately
            // after booking — unlike "direct" or "morning departure", a checked bag
            // can always be purchased at the counter. If the bag-included winner
            // scores < 75% of the best-scoring alternative (i.e. the premium penalty
            // is crushing it due to a 60%+ price gap), relax the bag gate and let
            // the premium penalty already baked into the scores take over.
            if (!relaxed.includes('bag') && ctx.requireBag) {
                var otherActive_1 = active.filter(function (g) { return g.name !== 'bag'; });
                var altCandidate = sorted.find(function (s) { return otherActive_1.every(function (g) { return g.pred(s.offer); }); });
                // Only fire when the bag-excluded best offer is also the overall
                // top scorer — meaning bag is the single constraint holding back the
                // definitively best offer in the pool (not just the cheapest direct,
                // or the best time-matched flight, etc.).
                if (altCandidate && altCandidate !== candidate && altCandidate === topByScore) {
                    var ratio = candidate.score / altCandidate.score;
                    if (ratio < 0.75) {
                        relaxed.push('bag');
                        return "continue";
                    }
                }
            }
            return { value: { hero: candidate, relaxed: trulyRelaxed(relaxed, candidate) } };
        }
        // No candidate at this gate set — relax the next lowest-priority gate.
        if (dropCount < gates.length)
            relaxed.push(gates[dropCount].name);
    };
    for (var dropCount = 0; dropCount <= gates.length; dropCount++) {
        var state_1 = _loop_1(dropCount);
        if (typeof state_1 === "object")
            return state_1.value;
    }
    // Unreachable: dropping all gates leaves `active=[]`, every offer matches.
    return { hero: sorted[0], relaxed: trulyRelaxed(relaxed, sorted[0]) };
}
function rankOffers(offers, ctx, options) {
    var _a, _b;
    if (offers.length === 0)
        return [];
    // By default remove near-identical offers (same physical flight from multiple
    // sources). Pass skipDedup: true to rank all offers as-is — useful when the
    // caller wants to show every offer found rather than one per physical flight.
    var pool = (options === null || options === void 0 ? void 0 : options.skipDedup) ? offers : deduplicateOffers(offers);
    // Pre-filter obvious duration outliers that would distort normalisation and
    // produce nonsensical scores. We guard both per-leg (no single leg over 48h —
    // that's corrupt data, even ULH flights are <20h) and the round-trip total
    // (96h ceiling so a legit 14h+14h LON→TYO round-trip survives).
    var plausible = pool.filter(function (o) {
        var _a, _b;
        var out = (_a = o.duration_minutes) !== null && _a !== void 0 ? _a : 0;
        if (out < 10 || out > 2880)
            return false;
        // Only check inbound when its duration was actually populated. Some
        // upstream paths (and tests) omit inbound.duration_minutes; missing data
        // is not a corruption signal.
        var inb = (_b = o.inbound) === null || _b === void 0 ? void 0 : _b.duration_minutes;
        if (typeof inb === 'number' && (inb < 10 || inb > 2880))
            return false;
        return totalRoundTripDuration(o) <= 5760;
    });
    var weights = resolveWeights(ctx);
    // Use displayPrice when available — it reflects what the user actually pays
    // (ticket + LetsFG fee + ancillaries, in their display currency).
    var effectivePrice = function (o) { var _a; return (_a = o.displayPrice) !== null && _a !== void 0 ? _a : o.price; };
    var prices = plausible.map(effectivePrice);
    var durations = plausible.map(totalRoundTripDuration);
    var _c = __read(p5p95(prices), 2), pLo = _c[0], pHi = _c[1];
    var _d = __read(p5p95(durations), 2), dLo = _d[0], dHi = _d[1];
    var cheapestPrice = Math.min.apply(Math, __spreadArray([], __read(prices), false));
    // When preferDirect, use cheapest direct offer as penalty reference so that
    // premiumPenalty doesn't crush directs relative to cheap 1-stops — without this
    // a €35 stopover becomes the baseline and a €80 direct gets a 0.26× multiplier
    // that wipes out the stops weight advantage entirely.
    var cheapestDirectPrice = ctx.preferDirect
        ? (function () {
            var dp = plausible.filter(function (o) { var _a; return ((_a = o.stops) !== null && _a !== void 0 ? _a : 0) === 0; }).map(effectivePrice).filter(function (p) { return isFinite(p); });
            return dp.length > 0 ? Math.min.apply(Math, __spreadArray([], __read(dp), false)) : cheapestPrice;
        })()
        : cheapestPrice;
    // Fastest in the pool — used by fact generation to label the top pick as
    // "fastest on this route". Operates on round-trip totals to match scoreDuration.
    var fastestMins = Math.min.apply(Math, __spreadArray([], __read(durations), false));
    var outboundDurations = plausible.map(function (o) { return o.duration_minutes; });
    var fastestOutboundMins = outboundDurations.length > 0 ? Math.min.apply(Math, __spreadArray([], __read(outboundDurations), false)) : 0;
    // When preferQuickFlight, use cheapest "fast enough" offer as penalty ref so that
    // premiumPenalty doesn't crush a 2h direct just because a 24h 1-stop is $50 cheaper.
    // "Fast enough" = within 2.5× the fastest duration in the pool.
    var cheapestQuickPrice = ctx.preferQuickFlight
        ? (function () {
            var qp = plausible.filter(function (o) { return totalRoundTripDuration(o) <= fastestMins * 2.5; }).map(effectivePrice).filter(function (p) { return isFinite(p); });
            return qp.length > 0 ? Math.min.apply(Math, __spreadArray([], __read(qp), false)) : cheapestPrice;
        })()
        : cheapestPrice;
    var tripPurposes = normalizeTripPurposes({
        tripPurpose: ctx.tripPurpose,
        tripPurposes: ctx.tripPurposes,
    });
    // Score every offer
    var scored = plausible.map(function (offer) {
        var _a;
        var depMins = isoToMins(offer.departure_time);
        var arrMins = isoToMins(offer.arrival_time);
        var dayOffset = daysBetween(offer.departure_time, offer.arrival_time);
        var ep = effectivePrice(offer);
        var bd = {
            price: scorePrice(ep, pLo, pHi),
            stops: scoreStops(combinedStops(offer)),
            duration: scoreDuration(totalRoundTripDuration(offer), dLo, dHi),
            depTime: scoreDepTime(depMins, ctx.depTimePref),
            arrivalTime: scoreArrivalTime(arrMins, ctx.arrivalTimePref, tripPurposes, dayOffset),
            baggage: scoreBaggage(offer, ctx.requireBag),
            savings: scoreSavings(offer, ctx.travelerCount),
            comfortHours: scoreComfortHours(depMins),
            layover: scoreLayover(offer, ctx.preferLongLayover),
        };
        var rawScore = (bd.price * weights.price +
            bd.stops * weights.stops +
            bd.duration * weights.duration +
            bd.depTime * weights.depTime +
            bd.arrivalTime * weights.arrivalTime +
            bd.baggage * weights.baggage +
            bd.savings * weights.savings +
            bd.comfortHours * weights.comfortHours +
            bd.layover * weights.layover) * 100;
        // Apply price-premium penalty so no flight can leapfrog a much cheaper one
        // purely on arrival time / stops when the price gap is unreasonable.
        var penaltyRef = (ctx.preferDirect && ((_a = offer.stops) !== null && _a !== void 0 ? _a : 0) === 0) ? cheapestDirectPrice
            : (ctx.preferQuickFlight && totalRoundTripDuration(offer) <= fastestMins * 2.5) ? cheapestQuickPrice
                : cheapestPrice;
        var score = rawScore * premiumPenalty(ep, penaltyRef)
            * timeConstraintPenalty(depMins, ctx.departAfterMins, ctx.departBeforeMins)
            * depTimeMismatchMultiplier(depMins, ctx.depTimePref)
            * retDepTimeMismatchMultiplier(offer, ctx.retTimePref)
            * mealPreferenceMultiplier(offer, ctx.requireMeals)
            * refundabilityMultiplier(offer, ctx.requireCancellation);
        return { offer: offer, score: score, rank: 0, breakdown: bd, heroFacts: [], tradeoffs: [] };
    });
    // Sort best-first with deterministic tie-breakers so refreshes don't reshuffle
    // equivalent offers just because upstream sources arrived in a different order.
    scored.sort(function (a, b) {
        // Hard partition: when user explicitly asked for direct, ALL directs rank above ALL
        // non-directs regardless of score. Weight boosts alone can't guarantee this because
        // a sufficiently large price gap can always overcome a stops-weight advantage.
        if (ctx.preferDirect) {
            var aDirect = combinedStops(a.offer) === 0 ? 0 : 1;
            var bDirect = combinedStops(b.offer) === 0 ? 0 : 1;
            if (aDirect !== bDirect)
                return aDirect - bDirect;
        }
        // Soft stop-cap partition: offers within the cap rank above offers that exceed
        // it, regardless of score (rank-not-filter — over-cap offers still appear, just
        // below). Mirrors the preferDirect partition; the two are mutually exclusive.
        if (ctx.maxStops !== undefined && !ctx.preferDirect) {
            var aIn = combinedStops(a.offer) <= ctx.maxStops ? 0 : 1;
            var bIn = combinedStops(b.offer) <= ctx.maxStops ? 0 : 1;
            if (aIn !== bIn)
                return aIn - bIn;
        }
        var scoreDelta = b.score - a.score;
        if (Math.abs(scoreDelta) > 0.001)
            return scoreDelta;
        var priceDelta = effectivePrice(a.offer) - effectivePrice(b.offer);
        if (Math.abs(priceDelta) > 0.001)
            return priceDelta;
        var stopsDelta = a.offer.stops - b.offer.stops;
        if (stopsDelta !== 0)
            return stopsDelta;
        var durationDelta = a.offer.duration_minutes - b.offer.duration_minutes;
        if (durationDelta !== 0)
            return durationDelta;
        var depDelta = isoToMins(a.offer.departure_time) - isoToMins(b.offer.departure_time);
        if (depDelta !== 0)
            return depDelta;
        return a.offer.id.localeCompare(b.offer.id);
    });
    // Constraint-gate hero selection: top-1 must satisfy every user-stated
    // criterion. If no offer does, gates are relaxed in priority order. Runner-
    // ups keep their score-based positions so the user can still see the
    // cheaper-but-non-matching alternatives for context.
    if (scored.length > 0) {
        var _e = selectHeroByGates(scored, ctx), hero = _e.hero, relaxed = _e.relaxed;
        var idx = scored.indexOf(hero);
        if (idx > 0) {
            scored.splice(idx, 1);
            scored.unshift(hero);
        }
        if (relaxed.length > 0)
            scored[0].relaxedGates = relaxed;
    }
    // Assign 1-based ranks and generate human-readable facts
    // Hero compares vs cheapest in set; runners compare vs the hero price
    var heroPrice = (_b = (_a = scored[0]) === null || _a === void 0 ? void 0 : _a.offer.price) !== null && _b !== void 0 ? _b : cheapestPrice;
    for (var i = 0; i < scored.length; i++) {
        scored[i].rank = i + 1;
        var isHero = i === 0;
        var refPrice = isHero ? cheapestPrice : heroPrice;
        var _f = generateFacts(scored[i].offer, scored[i].breakdown, refPrice, fastestOutboundMins, ctx, ctx.travelerCount, isHero), heroFacts = _f.heroFacts, tradeoffs = _f.tradeoffs;
        scored[i].heroFacts = heroFacts;
        scored[i].tradeoffs = tradeoffs;
    }
    return scored;
}
/**
 * From an already-ranked list, picks the top N offers that are genuinely
 * different from each other — so runner-ups are real propositions, not just
 * the same flight at +$3 from a different booking source.
 *
 * Two offers are considered "the same" for this purpose if both their
 * departure time slot (3-hour window) AND their stop count are identical.
 * Diversity requires differing in at least one of those dimensions.
 *
 * Falls back to next-best-ranked when the pool lacks enough diverse options.
 */
function selectDiverseTop(ranked, n) {
    var e_16, _a, e_17, _b;
    if (ranked.length === 0)
        return [];
    var result = [ranked[0]]; // hero always first
    var depSlot = function (iso) { return Math.floor(isoToMins(iso) / 180); }; // 3-hour slots
    var _loop_2 = function (candidate) {
        if (result.length >= n)
            return "break";
        // Candidate is diverse if it differs from EVERY already-selected offer
        // in departure slot OR stop count (at least one dimension must differ).
        var isDiverse = result.every(function (sel) {
            return Math.abs(depSlot(candidate.offer.departure_time) - depSlot(sel.offer.departure_time)) >= 1 ||
                Math.abs(candidate.offer.stops - sel.offer.stops) >= 1;
        });
        if (isDiverse)
            result.push(candidate);
    };
    try {
        for (var _c = __values(ranked.slice(1)), _d = _c.next(); !_d.done; _d = _c.next()) {
            var candidate = _d.value;
            var state_2 = _loop_2(candidate);
            if (state_2 === "break")
                break;
        }
    }
    catch (e_16_1) { e_16 = { error: e_16_1 }; }
    finally {
        try {
            if (_d && !_d.done && (_a = _c.return)) _a.call(_c);
        }
        finally { if (e_16) throw e_16.error; }
    }
    var _loop_3 = function (candidate) {
        if (result.length >= n)
            return "break";
        if (!result.some(function (r) { return getOfferInstanceKey(r.offer) === getOfferInstanceKey(candidate.offer); })) {
            result.push(candidate);
        }
    };
    try {
        // Not enough diverse options — fill remaining slots with next-best
        for (var _e = __values(ranked.slice(1)), _f = _e.next(); !_f.done; _f = _e.next()) {
            var candidate = _f.value;
            var state_3 = _loop_3(candidate);
            if (state_3 === "break")
                break;
        }
    }
    catch (e_17_1) { e_17 = { error: e_17_1 }; }
    finally {
        try {
            if (_f && !_f.done && (_b = _e.return)) _b.call(_e);
        }
        finally { if (e_17) throw e_17.error; }
    }
    return result;
}
/**
 * Returns a short human-readable label describing the ranking profile
 * that was applied (e.g. "City break", "Family holiday"). Returns null
 * if the default generic profile is used.
 */
function getProfileLabel(ctx) {
    var tripPurpose = getPrimaryTripPurpose({
        tripPurpose: ctx.tripPurpose,
        tripPurposes: ctx.tripPurposes,
    });
    if (tripPurpose === 'honeymoon')
        return 'profileHoneymoon';
    if (tripPurpose === 'special_occasion')
        return 'profileCouple';
    if (tripPurpose === 'business')
        return 'profileBusiness';
    if (tripPurpose === 'ski')
        return 'profileSki';
    if (tripPurpose === 'beach')
        return 'profileBeach';
    if (tripPurpose === 'city_break')
        return 'profileCityBreak';
    if (tripPurpose === 'family_holiday')
        return 'profileFamilyHoliday';
    if (tripPurpose === 'graduation')
        return 'profileGraduation';
    if (tripPurpose === 'concert_festival')
        return 'profileFestival';
    if (tripPurpose === 'sports_event')
        return 'profileSports';
    if (tripPurpose === 'spring_break')
        return 'profileSpringBreak';
    if (ctx.tripContext === 'family')
        return 'profileFamily';
    if (ctx.tripContext === 'couple')
        return 'profileCouple';
    if (ctx.tripContext === 'business_traveler')
        return 'profileBusinessLabel';
    if (ctx.requireBag)
        return 'profileBag';
    return null;
}

// QML has no module system, so the entry points are attached the same way
// Model.js does it -- guarded so the file stays valid in both engines.
function ranking_exports_shim() {
  if (typeof module === "undefined" || !module || typeof module.exports !== "object") return
  module.exports = {
    rankOffers: (typeof rankOffers !== "undefined") ? rankOffers : undefined,
    rankingContextFromParsed: (typeof rankingContextFromParsed !== "undefined") ? rankingContextFromParsed : undefined,
    deduplicateOffers: (typeof deduplicateOffers !== "undefined") ? deduplicateOffers : undefined,
    getOfferInstanceKey: (typeof getOfferInstanceKey !== "undefined") ? getOfferInstanceKey : undefined,
    parsedWantsDirect: (typeof parsedWantsDirect !== "undefined") ? parsedWantsDirect : undefined,
    normalizeTripPurposes: (typeof normalizeTripPurposes !== "undefined") ? normalizeTripPurposes : undefined,
    getPrimaryTripPurpose: (typeof getPrimaryTripPurpose !== "undefined") ? getPrimaryTripPurpose : undefined,
    extractOfferDetailSignals: (typeof extractOfferDetailSignals !== "undefined") ? extractOfferDetailSignals : undefined,
  }
}
ranking_exports_shim()
