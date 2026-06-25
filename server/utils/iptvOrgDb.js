"use strict";

const fs = require("fs");
const path = require("path");
const { CODE_TO_COUNTRY } = require("./countryDetector");

const CACHE_FILE = path.join(__dirname, "..", "data", "iptvorg-cache.json");
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — iptv-org/database doesn't churn daily

const CHANNELS_URL = "https://raw.githubusercontent.com/iptv-org/api/gh-pages/channels.json";
const LOGOS_URL = "https://raw.githubusercontent.com/iptv-org/api/gh-pages/logos.json";
const CATEGORIES_URL = "https://raw.githubusercontent.com/iptv-org/api/gh-pages/categories.json";

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let byId = new Map(); // channel id -> channel object
let byKey = new Map(); // "CC|normalizedname" -> channel id
let logosById = new Map(); // channel id -> best logo url
let categoryNames = new Map(); // category id -> display name
let loaded = false;
let loadingPromise = null;

const COUNTRY_NAME_TO_CODE = {};
for (const [code, name] of Object.entries(CODE_TO_COUNTRY)) {
    if (name) COUNTRY_NAME_TO_CODE[name.toLowerCase()] = code;
}

function normalizeName(s) {
    return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Looser variant for fallback matching — strips generic noise words that
// often differ between our parsed name and iptv-org's canonical name
// (e.g. our "SOMOY TV" vs their "Somoy News").
function looseName(s) {
    return normalizeName(s).replace(/(tv|channel|hd|plus|the|bangla|network|news)/g, "");
}

async function fetchJson(url) {
    const res = await fetch(url, { headers: { "User-Agent": BROWSER_UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    return res.json();
}

function buildIndices(channels, logos, categories) {
    byId = new Map();
    byKey = new Map();
    logosById = new Map();
    categoryNames = new Map();

    for (const cat of categories) categoryNames.set(cat.id, cat.name);

    // logos.json: array of { channel, url, width, height, ... } — one channel
    // can have several; keep the first one we see (good enough, avoids
    // needing to rank by resolution).
    for (const l of logos) {
        if (!l.channel || logosById.has(l.channel)) continue;
        logosById.set(l.channel, l.url);
    }

    for (const ch of channels) {
        if (ch.closed) continue; // skip channels iptv-org has marked defunct
        byId.set(ch.id, ch);
        const country = (ch.country || "").toUpperCase();
        if (!country) continue;
        const names = [ch.name, ...(ch.alt_names || [])].filter(Boolean);
        for (const n of names) {
            const exactKey = `${country}|${normalizeName(n)}`;
            if (!byKey.has(exactKey)) byKey.set(exactKey, ch.id);
            const looseKey = `${country}|${looseName(n)}`;
            if (!byKey.has(looseKey)) byKey.set(looseKey, ch.id);
        }
    }
}

/**
 * Loads (or reuses a cached copy of) the iptv-org database into memory.
 * Must be awaited before lookupSync() will return anything useful.
 * Disk-cached for 7 days to avoid re-downloading ~10k-channel JSON on every
 * server restart; pass force:true to bypass the cache (manual admin refresh).
 */
async function ensureLoaded(force = false) {
    if (loaded && !force) return;
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
        if (!force) {
            try {
                const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
                if (Date.now() - raw.cachedAt < TTL_MS) {
                    buildIndices(raw.channels, raw.logos, raw.categories);
                    loaded = true;
                    console.log(`[IPTV-ORG] Loaded ${byId.size} channels from disk cache`);
                    return;
                }
            } catch {
                // no cache yet, or it's corrupt — fall through to fresh fetch
            }
        }

        console.log("[IPTV-ORG] Fetching fresh database from iptv-org/api...");
        const [channels, logos, categories] = await Promise.all([fetchJson(CHANNELS_URL), fetchJson(LOGOS_URL), fetchJson(CATEGORIES_URL)]);
        buildIndices(channels, logos, categories);
        loaded = true;

        try {
            fs.writeFileSync(CACHE_FILE, JSON.stringify({ cachedAt: Date.now(), channels, logos, categories }));
        } catch (err) {
            console.warn("[IPTV-ORG] Failed to write disk cache:", err.message);
        }
        console.log(`[IPTV-ORG] Loaded ${byId.size} channels (fresh fetch)`);
    })();

    try {
        await loadingPromise;
    } finally {
        loadingPromise = null;
    }
}

/**
 * Synchronous lookup — only useful after ensureLoaded() has resolved.
 * Scoped to a country (iptv-org IDs collide across countries, e.g. many
 * countries have a channel literally named "NTV" or "TV1") — without a
 * country match we refuse to guess.
 */
function lookupSync(name, countryName) {
    if (!loaded || !countryName) return null;
    const code = COUNTRY_NAME_TO_CODE[countryName.toLowerCase()];
    if (!code) return null;

    const id = byKey.get(`${code}|${normalizeName(name)}`) || byKey.get(`${code}|${looseName(name)}`);
    if (!id) return null;

    const ch = byId.get(id);
    if (!ch) return null;

    return {
        id: ch.id,
        officialName: ch.name,
        logo: logosById.get(ch.id) || null,
        categories: (ch.categories || []).map((c) => categoryNames.get(c) || c),
        countryCode: ch.country,
    };
}

function isLoaded() {
    return loaded;
}

module.exports = { ensureLoaded, lookupSync, isLoaded };
