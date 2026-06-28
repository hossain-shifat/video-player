"use strict";

/**
 * epgProvider.js — Provider Interface + Built-in Providers
 *
 * Every provider must implement:
 *   fetch()       → raw content (string or Buffer)
 *   parse(raw)    → { channels: Map<id, channelMeta>, programmes: Map<channelId, prog[]> }
 *   normalize()   → called internally after parse — conforming to the standard schema
 *
 * Built-in providers:
 *   XmltvProvider  — XMLTV URL or file path (plain .xml)
 *   GzipXmltvProvider — XMLTV served as .xml.gz
 */

const fs    = require("fs");
const path  = require("path");
const zlib  = require("zlib");
const { promisify } = require("util");
const gunzip = promisify(zlib.gunzip);

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 120_000; // 2 min for large XMLTV files

// ─── XMLTV Parser ─────────────────────────────────────────────────────────────
// Parses XMLTV XML string into { channels, programmes }.
// Avoids full DOM load — uses simple regex-based streaming over the string.
// Handles files up to several hundred MB this way; for multi-GB files a true
// SAX parser would be needed (future: swap in sax or expat-binding here).

function parseXmltvString(xml) {
    const channels  = new Map(); // xmltv channel id → meta
    const programmes = new Map(); // xmltv channel id → prog[]

    // ── Channel blocks ────────────────────────────────────────────────────────
    const chanRe = /<channel\s+id="([^"]*)"[^>]*>([\s\S]*?)<\/channel>/gi;
    let cm;
    while ((cm = chanRe.exec(xml)) !== null) {
        const id    = cm[1];
        const block = cm[2];
        const name  = extractText(block, "display-name") || id;
        const logo  = extractAttr(block.match(/<icon[^>]*>/)?.[0] || "", "src");
        const lang  = extractAttr(block.match(/<display-name[^>]*/)?.[0] || "", "lang") || null;
        channels.set(id, { id, name, logo, language: lang });
    }

    // ── Programme blocks ──────────────────────────────────────────────────────
    const progRe = /<programme\s([^>]*)>([\s\S]*?)<\/programme>/gi;
    let pm;
    while ((pm = progRe.exec(xml)) !== null) {
        const attrs  = pm[1];
        const block  = pm[2];

        const channelId = extractAttr(attrs, "channel");
        if (!channelId) continue;

        const startStr = extractAttr(attrs, "start");
        const endStr   = extractAttr(attrs, "stop");
        const start    = parseXmltvDate(startStr);
        const end      = parseXmltvDate(endStr);
        if (!start || !end) continue;

        const title      = extractText(block, "title")       || "";
        const subtitle   = extractText(block, "sub-title")   || null;
        const desc       = extractText(block, "desc")        || null;
        const category   = extractText(block, "category")    || null;
        const icon       = extractAttr(block.match(/<icon[^>]*>/)?.[0] || "", "src") || null;
        const rating     = extractText(block, "value")       || null; // inside <rating><value>
        const episode    = parseEpisodeNum(block);

        const prog = { title, subtitle, desc, category, start, end, icon, rating, episode };

        if (!programmes.has(channelId)) programmes.set(channelId, []);
        programmes.get(channelId).push(prog);
    }

    return { channels, programmes };
}

// ── XMLTV helpers ─────────────────────────────────────────────────────────────

function extractText(block, tag) {
    const m = block.match(new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`, "i"));
    return m ? m[1].trim().replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"') : null;
}

function extractAttr(tag, attr) {
    const m = tag.match(new RegExp(`${attr}="([^"]*)"`, "i"));
    return m ? m[1] : null;
}

/**
 * Parses XMLTV date format: "20240601183000 +0100" → Unix ms
 */
function parseXmltvDate(str) {
    if (!str) return null;
    const m = str.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([\+\-]\d{4})?/);
    if (!m) return null;
    const [, yr, mo, dy, hr, mn, sc, tz] = m;
    const iso = `${yr}-${mo}-${dy}T${hr}:${mn}:${sc}${tz ? tz.slice(0, 3) + ":" + tz.slice(3) : "Z"}`;
    const ts = Date.parse(iso);
    return isNaN(ts) ? null : ts;
}

/**
 * Parses xmltv_ns or onscreen episode numbers.
 * "1.2.0/1" → { season: 2, episode: 3 }  (xmltv_ns is 0-indexed)
 */
function parseEpisodeNum(block) {
    const m = block.match(/<episode-num\s+system="xmltv_ns">([^<]+)<\/episode-num>/i);
    if (!m) return null;
    const parts = m[1].trim().split(".");
    const season  = parts[0] ? parseInt(parts[0], 10) + 1 : null;
    const episode = parts[1] ? parseInt(parts[1].split("/")[0], 10) + 1 : null;
    return (season || episode) ? { season, episode } : null;
}

// ─── Base provider class ──────────────────────────────────────────────────────

class EPGProvider {
    constructor(config) {
        this.id       = config.id;
        this.name     = config.name     || "Unnamed Provider";
        this.type     = config.type;    // "xmltv_url" | "xmltv_file" | "xmltv_gz_url" | "xmltv_gz_file"
        this.location = config.location; // URL or file path
        this.priority = config.priority ?? 50; // lower = higher priority
        this.enabled  = config.enabled  ?? true;
    }

    /** Fetch raw content — returns Buffer or string */
    async fetch() { throw new Error("fetch() not implemented"); }

    /** Parse raw content — returns { channels, programmes } */
    parse(_raw) { throw new Error("parse() not implemented"); }

    /** Normalize a programme record to our standard schema */
    normalizeProgram(prog, channelId, sourceId) {
        return {
            channelId,
            title:    prog.title   || "Unknown",
            subtitle: prog.subtitle || null,
            desc:     prog.desc    || null,
            category: prog.category || null,
            start:    prog.start,
            end:      prog.end,
            icon:     prog.icon    || null,
            episode:  prog.episode || null,
            rating:   prog.rating  || null,
            provider: sourceId,
            priority: this.priority,
        };
    }

    /** Full pipeline: fetch → parse → return normalized data */
    async run() {
        const raw     = await this.fetch();
        const parsed  = this.parse(raw);
        return parsed;
    }
}

// ─── XMLTV URL Provider ───────────────────────────────────────────────────────

class XmltvUrlProvider extends EPGProvider {
    constructor(config) { super({ ...config, type: "xmltv_url" }); }

    async fetch() {
        const ctrl  = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        try {
            const r = await fetch(this.location, {
                headers: { "User-Agent": BROWSER_UA, Accept: "text/xml,application/xml,*/*" },
                signal: ctrl.signal,
                redirect: "follow",
            });
            if (!r.ok) throw new Error(`HTTP ${r.status} fetching EPG: ${this.location}`);
            return await r.text();
        } finally { clearTimeout(timer); }
    }

    parse(raw) { return parseXmltvString(raw); }
}

// ─── XMLTV File Provider ──────────────────────────────────────────────────────

class XmltvFileProvider extends EPGProvider {
    constructor(config) { super({ ...config, type: "xmltv_file" }); }

    async fetch() { return fs.promises.readFile(this.location, "utf-8"); }
    parse(raw)    { return parseXmltvString(raw); }
}

// ─── Gzip XMLTV URL Provider ──────────────────────────────────────────────────

class GzipXmltvUrlProvider extends EPGProvider {
    constructor(config) { super({ ...config, type: "xmltv_gz_url" }); }

    async fetch() {
        const ctrl  = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        try {
            const r = await fetch(this.location, {
                headers: { "User-Agent": BROWSER_UA, Accept: "application/gzip,*/*" },
                signal: ctrl.signal,
                redirect: "follow",
            });
            if (!r.ok) throw new Error(`HTTP ${r.status} fetching gzip EPG`);
            const buf = Buffer.from(await r.arrayBuffer());
            return (await gunzip(buf)).toString("utf-8");
        } finally { clearTimeout(timer); }
    }

    parse(raw) { return parseXmltvString(raw); }
}

// ─── Gzip XMLTV File Provider ─────────────────────────────────────────────────

class GzipXmltvFileProvider extends EPGProvider {
    constructor(config) { super({ ...config, type: "xmltv_gz_file" }); }

    async fetch() {
        const buf = await fs.promises.readFile(this.location);
        return (await gunzip(buf)).toString("utf-8");
    }

    parse(raw) { return parseXmltvString(raw); }
}

// ─── Provider factory ─────────────────────────────────────────────────────────

function createProvider(config) {
    switch (config.type) {
        case "xmltv_url":      return new XmltvUrlProvider(config);
        case "xmltv_file":     return new XmltvFileProvider(config);
        case "xmltv_gz_url":   return new GzipXmltvUrlProvider(config);
        case "xmltv_gz_file":  return new GzipXmltvFileProvider(config);
        default: throw new Error(`Unknown EPG provider type: ${config.type}`);
    }
}

module.exports = {
    EPGProvider,
    XmltvUrlProvider, XmltvFileProvider,
    GzipXmltvUrlProvider, GzipXmltvFileProvider,
    createProvider,
    parseXmltvString, // exported for tests / manual use
};
