"use strict";

// ISO-3166 code → canonical country name (common IPTV-list countries).
// Not exhaustive of all 249 territories — covers what actually shows up in
// public IPTV playlists. Extend as needed.
const CODE_TO_COUNTRY = {
    US: "United States", UK: "United Kingdom", GB: "United Kingdom", CA: "Canada", AU: "Australia",
    NZ: "New Zealand", IN: "India", PK: "Pakistan", BD: "Bangladesh", LK: "Sri Lanka", NP: "Nepal",
    FR: "France", DE: "Germany", IT: "Italy", ES: "Spain", PT: "Portugal", NL: "Netherlands",
    BE: "Belgium", CH: "Switzerland", AT: "Austria", SE: "Sweden", NO: "Norway", DK: "Denmark",
    FI: "Finland", IE: "Ireland", PL: "Poland", RU: "Russia", UA: "Ukraine", TR: "Turkey",
    GR: "Greece", RO: "Romania", BG: "Bulgaria", HU: "Hungary", CZ: "Czech Republic", SK: "Slovakia",
    HR: "Croatia", RS: "Serbia", AL: "Albania", SA: "Saudi Arabia", AE: "United Arab Emirates",
    QA: "Qatar", KW: "Kuwait", BH: "Bahrain", OM: "Oman", IQ: "Iraq", IR: "Iran", IL: "Israel",
    JO: "Jordan", LB: "Lebanon", EG: "Egypt", MA: "Morocco", DZ: "Algeria", TN: "Tunisia",
    NG: "Nigeria", KE: "Kenya", ZA: "South Africa", GH: "Ghana", ET: "Ethiopia", CN: "China",
    JP: "Japan", KR: "South Korea", KP: "North Korea", TH: "Thailand", VN: "Vietnam", PH: "Philippines",
    MY: "Malaysia", SG: "Singapore", ID: "Indonesia", MM: "Myanmar", KH: "Cambodia", LA: "Laos",
    MN: "Mongolia", TW: "Taiwan", HK: "Hong Kong", BR: "Brazil", MX: "Mexico", AR: "Argentina",
    CO: "Colombia", CL: "Chile", PE: "Peru", VE: "Venezuela", EC: "Ecuador", BO: "Bolivia",
    PY: "Paraguay", UY: "Uruguay", CU: "Cuba", DO: "Dominican Republic", PR: "Puerto Rico",
    AF: "Afghanistan", UZ: "Uzbekistan", KZ: "Kazakhstan", AZ: "Azerbaijan", GE: "Georgia", AM: "Armenia",
    CY: "Cyprus", IS: "Iceland", LU: "Luxembourg", MT: "Malta", AL_2: undefined, INT: "International",
};
delete CODE_TO_COUNTRY.AL_2;

// Reverse map + common alias spellings → canonical country name
const NAME_ALIASES = {};
for (const [code, name] of Object.entries(CODE_TO_COUNTRY)) {
    if (!name) continue;
    NAME_ALIASES[name.toLowerCase()] = name;
    NAME_ALIASES[code.toLowerCase()] = name;
}
// Hand-picked extra aliases seen in the wild on group-titles / channel names
Object.assign(NAME_ALIASES, {
    usa: "United States", "u.s.a": "United States", "u.s": "United States", america: "United States",
    uae: "United Arab Emirates", "great britain": "United Kingdom", britain: "United Kingdom", england: "United Kingdom",
    bangla: "Bangladesh", desi: "India", bharat: "India", hindustan: "India", deutschland: "Germany",
    espana: "Spain", italia: "Italy", brasil: "Brazil", "south korea": "South Korea", korea: "South Korea",
    holland: "Netherlands", arabia: "Saudi Arabia", emirates: "United Arab Emirates",
});

// Spoken-language → most-likely originating country, used only as a last
// resort when nothing else matched (weak signal, language ≠ country).
const LANGUAGE_TO_COUNTRY = {
    bengali: "Bangladesh", bangla: "Bangladesh", hindi: "India", urdu: "Pakistan", tamil: "India",
    telugu: "India", malayalam: "India", sinhala: "Sri Lanka", nepali: "Nepal", arabic: "Saudi Arabia",
    farsi: "Iran", persian: "Iran", turkish: "Turkey", russian: "Russia", ukrainian: "Ukraine",
    french: "France", german: "Germany", italian: "Italy", spanish: "Spain", portuguese: "Portugal",
    dutch: "Netherlands", swedish: "Sweden", norwegian: "Norway", danish: "Denmark", finnish: "Finland",
    polish: "Poland", greek: "Greece", hebrew: "Israel", chinese: "China", mandarin: "China",
    cantonese: "Hong Kong", japanese: "Japan", korean: "South Korea", thai: "Thailand", vietnamese: "Vietnam",
    indonesian: "Indonesia", malay: "Malaysia", filipino: "Philippines", tagalog: "Philippines",
};

// Looks for a known country name/code/alias anywhere inside a string.
function findCountryInText(text) {
    if (!text) return null;
    const lower = text.toLowerCase();

    // Try exact alias match first (whole-word-ish via simple boundary check)
    for (const [alias, canonical] of Object.entries(NAME_ALIASES)) {
        if (alias.length < 2) continue;
        const re = new RegExp(`(^|[^a-z])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i");
        if (re.test(lower)) return canonical;
    }
    return null;
}

// Bracketed/suffixed country codes commonly appended to channel names or
// tvg-id, e.g. "BBC One [UK]", "CNN (US)", "ESPN.us", "RTP1.pt"
function findCountryCodeSuffix(text) {
    if (!text) return null;
    const m = text.match(/[\[(.]([A-Za-z]{2})[\])]?\s*$/);
    if (m) {
        const code = m[1].toUpperCase();
        if (CODE_TO_COUNTRY[code]) return CODE_TO_COUNTRY[code];
    }
    return null;
}

/**
 * Multi-strategy country detection. Tries, in order:
 *  1. explicit tvg-country attribute (code or name)
 *  2. group-title (many playlists group BY country)
 *  3. tvg-id suffix (e.g. "ESPN.us")
 *  4. channel name suffix/bracket (e.g. "CNN (US)")
 *  5. channel name / group-title free-text match against known country names
 *  6. tvg-language → weak country inference
 *  7. "Unknown"
 */
function detectCountry({ tvgCountry, group, tvgId, name, language }) {
    if (tvgCountry) {
        const code = tvgCountry.trim().toUpperCase();
        if (CODE_TO_COUNTRY[code]) return CODE_TO_COUNTRY[code];
        const byName = findCountryInText(tvgCountry);
        if (byName) return byName;
    }

    if (group) {
        const byName = findCountryInText(group);
        if (byName) return byName;
    }

    if (tvgId) {
        const byCode = findCountryCodeSuffix(tvgId);
        if (byCode) return byCode;
    }

    if (name) {
        const byCode = findCountryCodeSuffix(name);
        if (byCode) return byCode;
        const byName = findCountryInText(name);
        if (byName) return byName;
    }

    if (language) {
        const lower = language.trim().toLowerCase();
        if (LANGUAGE_TO_COUNTRY[lower]) return LANGUAGE_TO_COUNTRY[lower];
    }

    return "Unknown";
}

module.exports = { detectCountry, CODE_TO_COUNTRY };
