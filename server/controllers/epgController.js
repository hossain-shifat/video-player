"use strict";

/**
 * epgController.js — EPG API Handlers
 *
 * Routes handled (see epg.js for mounting):
 *
 *   GET  /api/epg/now                    — now/next for all indexed channels
 *   GET  /api/epg/channel/:id            — now/next/upcoming for one channel
 *   GET  /api/epg/schedule/:id           — full schedule for one channel (optional ?from=&to=)
 *   GET  /api/epg/events                 — live event list
 *   GET  /api/epg/recommendations        — recommendation payload
 *   GET  /api/epg/status                 — scheduler + meta status
 *   GET  /api/epg/keywords               — current event keyword config
 *   PUT  /api/epg/keywords               — replace keyword config
 *   GET  /api/epg/sources                — list EPG sources
 *   POST /api/epg/sources                — add EPG source
 *   DELETE /api/epg/sources/:id          — remove EPG source
 *   PATCH /api/epg/sources/:id           — edit source (priority/enabled/name)
 *   POST /api/epg/sources/:id/refresh    — trigger refresh of one source
 *   POST /api/epg/ingest                 — trigger full ingest (admin)
 *   GET  /api/epg/aliases                — channel alias map
 *   POST /api/epg/aliases                — set alias { xmltvId, liveId }
 *   DELETE /api/epg/aliases/:xmltvId     — remove alias
 */

const crypto = require("crypto");
const epgStore = require("../utils/epgStore");
const epgScheduler = require("../utils/epgScheduler");
const { loadKeywords, saveKeywords } = require("../utils/epgEventDetector");
const { createProvider } = require("../utils/epgProvider");
const { ChannelMatcher } = require("../utils/epgMatcher");

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
const fail = (res, msg, status = 500) => res.status(status).json({ success: false, message: msg });

// Lazy live-rows helper (avoids circular dep)
function getLiveRows() {
    try {
        const { getPublicLiveRich } = require("../utils/iptvStore");
        const rich = getPublicLiveRich();
        const rows = [];
        for (const [group, list] of Object.entries(rich.channels || {})) {
            for (const ch of list) {
                rows.push({
                    id: Buffer.from(ch.url).toString("base64url"),
                    name: ch.name,
                    cleanName: ch.cleanName || ch.name,
                    tvgId: ch.tvgId || null,
                    tvgName: ch.tvgName || null,
                    streamStatus: ch.streamStatus || "unknown",
                    logo: ch.logo || null,
                    url: ch.url,
                    resolution: ch.resolution || null,
                    isHD: ch.isHD || false,
                });
            }
        }
        return rows;
    } catch {
        return [];
    }
}

// ─── Now / Next ───────────────────────────────────────────────────────────────

function getNow(req, res) {
    try {
        const cache = epgScheduler.getNowCache();
        const result = {};
        for (const [id, data] of cache.entries()) {
            result[id] = { now: data.now, next: data.next };
        }
        return ok(res, { channels: result, total: cache.size, updatedAt: new Date().toISOString() });
    } catch (err) {
        return fail(res, err.message);
    }
}

function getChannelNow(req, res) {
    try {
        const { id } = req.params;
        const data = epgScheduler.getNowForChannel(id);
        return ok(res, data);
    } catch (err) {
        return fail(res, err.message);
    }
}

// ─── Schedule ─────────────────────────────────────────────────────────────────

function getSchedule(req, res) {
    try {
        const { id } = req.params;
        const now = Date.now();
        const from = parseInt(req.query.from, 10) || now - 3 * 60 * 60 * 1000; // default: 3h ago
        const to = parseInt(req.query.to, 10) || now + 24 * 60 * 60 * 1000; // default: next 24h
        const progs = epgStore.getSchedule(id, from, to);
        return ok(res, { channelId: id, from, to, programmes: progs, total: progs.length });
    } catch (err) {
        return fail(res, err.message);
    }
}

// ─── Events ───────────────────────────────────────────────────────────────────

function getEvents(req, res) {
    try {
        const cache = epgScheduler.getEventsCache();
        const type = (req.query.type || "").toLowerCase();
        if (type && type in cache) {
            return ok(res, { type, events: cache[type], updatedAt: cache.updatedAt });
        }
        return ok(res, cache);
    } catch (err) {
        return fail(res, err.message);
    }
}

// ─── Recommendations ─────────────────────────────────────────────────────────

function getRecommendations(req, res) {
    try {
        return ok(res, epgScheduler.getRecoCache());
    } catch (err) {
        return fail(res, err.message);
    }
}

// ─── Status ───────────────────────────────────────────────────────────────────

function getStatus(req, res) {
    try {
        return ok(res, epgScheduler.getStatus());
    } catch (err) {
        return fail(res, err.message);
    }
}

// ─── Keywords ────────────────────────────────────────────────────────────────

function getKeywords(req, res) {
    try {
        return ok(res, loadKeywords());
    } catch (err) {
        return fail(res, err.message);
    }
}

function putKeywords(req, res) {
    try {
        const kw = req.body;
        if (typeof kw !== "object" || Array.isArray(kw)) return fail(res, "Body must be keyword config object", 400);
        saveKeywords(kw);
        return ok(res, { message: "Keywords updated" });
    } catch (err) {
        return fail(res, err.message);
    }
}

// ─── Sources CRUD ─────────────────────────────────────────────────────────────

function listSources(req, res) {
    try {
        return ok(res, epgStore.getSources());
    } catch (err) {
        return fail(res, err.message);
    }
}

function addSource(req, res) {
    try {
        const { name, type, location, priority, enabled } = req.body;
        if (!type || !location) return fail(res, "type and location are required", 400);

        // Validate type
        const VALID_TYPES = ["xmltv_url", "xmltv_file", "xmltv_gz_url", "xmltv_gz_file"];
        if (!VALID_TYPES.includes(type)) return fail(res, `type must be one of: ${VALID_TYPES.join(", ")}`, 400);

        const src = {
            id: crypto.randomUUID(),
            name: (name || "").trim() || type,
            type,
            location: location.trim(),
            priority: parseInt(priority, 10) || 50,
            enabled: enabled !== false,
            addedAt: new Date().toISOString(),
        };
        epgStore.saveSource(src);
        return ok(res, src, 201);
    } catch (err) {
        return fail(res, err.message);
    }
}

function deleteSource(req, res) {
    try {
        epgStore.deleteSource(req.params.id);
        return ok(res, { message: "EPG source deleted", id: req.params.id });
    } catch (err) {
        return fail(res, err.message);
    }
}

function editSource(req, res) {
    try {
        const src = epgStore.updateSource(req.params.id, req.body);
        if (!src) return fail(res, "Source not found", 404);
        return ok(res, src);
    } catch (err) {
        return fail(res, err.message);
    }
}

async function refreshSource(req, res) {
    try {
        const src = epgStore.getSources().find((s) => s.id === req.params.id);
        if (!src) return fail(res, "Source not found", 404);

        // Fire and forget — respond immediately
        (async () => {
            const liveRows = getLiveRows();
            const matcher = new ChannelMatcher(liveRows);
            try {
                const provider = createProvider(src);
                const { channels, programmes } = await provider.run();

                const matchMap = matcher.matchAll(channels);
                let total = 0;
                for (const [xmltvId, progList] of programmes.entries()) {
                    const hit = matchMap.get(xmltvId);
                    if (!hit) continue;
                    const normalized = progList.map((p) => provider.normalizeProgram(p, hit.row.id, src.id));
                    await epgStore.mergeChannelProgrammes(hit.row.id, normalized, src.priority ?? 50);
                    total += normalized.length;
                }
                epgStore.updateSource(src.id, { lastIngest: new Date().toISOString(), lastError: null });
                epgScheduler.refreshNowCache();
                console.log(`[EPG] Source ${src.name} refreshed — ${total} programmes`);
            } catch (err) {
                epgStore.updateSource(src.id, { lastError: err.message });
                console.error(`[EPG] Source refresh failed ${src.name}:`, err.message);
            }
        })();

        return ok(res, { message: "Source refresh started", id: src.id }, 202);
    } catch (err) {
        return fail(res, err.message);
    }
}

// ─── Full ingest trigger ──────────────────────────────────────────────────────

async function triggerIngest(req, res) {
    try {
        if (epgScheduler.getStatus().ingestRunning) {
            return ok(res, { message: "Ingest already in progress" });
        }
        epgScheduler.ingestAll().catch((e) => console.error("[EPG] Manual ingest failed:", e.message));
        return ok(res, { message: "EPG ingest started" }, 202);
    } catch (err) {
        return fail(res, err.message);
    }
}

// ─── Aliases ─────────────────────────────────────────────────────────────────

let _matcher = null; // singleton for alias operations

function getMatcher() {
    if (!_matcher) _matcher = new ChannelMatcher(getLiveRows());
    return _matcher;
}

function getAliases(req, res) {
    try {
        return ok(res, getMatcher().getAliases());
    } catch (err) {
        return fail(res, err.message);
    }
}

function setAlias(req, res) {
    try {
        const { xmltvId, liveId } = req.body;
        if (!xmltvId || !liveId) return fail(res, "xmltvId and liveId are required", 400);
        getMatcher().setAlias(xmltvId, liveId);
        return ok(res, { message: "Alias set", xmltvId, liveId });
    } catch (err) {
        return fail(res, err.message);
    }
}

function removeAlias(req, res) {
    try {
        getMatcher().removeAlias(req.params.xmltvId);
        return ok(res, { message: "Alias removed", xmltvId: req.params.xmltvId });
    } catch (err) {
        return fail(res, err.message);
    }
}

module.exports = {
    getNow,
    getChannelNow,
    getSchedule,
    getEvents,
    getRecommendations,
    getStatus,
    getKeywords,
    putKeywords,
    listSources,
    addSource,
    deleteSource,
    editSource,
    refreshSource,
    triggerIngest,
    getAliases,
    setAlias,
    removeAlias,
};

// ─── Sports Event Handlers ────────────────────────────────────────────────────
// Added here (not a separate controller) to reuse the same ok/fail helpers
// and getLiveRows(). Mounted via existing live.js route under /api/live/events/*.

const sportsService   = require("../utils/sportsService");
const sportsScheduler = require("../utils/sportsScheduler");
const sportsStore     = require("../utils/sportsStore");

async function getSportsLive(req, res) {
    try {
        return ok(res, { events: await sportsService.getLiveEvents(), updatedAt: new Date().toISOString() });
    } catch (err) { return fail(res, err.message); }
}

async function getSportsToday(req, res) {
    try {
        return ok(res, { events: await sportsService.getTodayEvents(), updatedAt: new Date().toISOString() });
    } catch (err) { return fail(res, err.message); }
}

async function getSportsUpcoming(req, res) {
    try {
        return ok(res, { events: await sportsService.getUpcomingEvents(), updatedAt: new Date().toISOString() });
    } catch (err) { return fail(res, err.message); }
}

async function getSportsEventById(req, res) {
    try {
        const event = await sportsService.getEventById(req.params.id);
        if (!event) return fail(res, "Event not found", 404);
        return ok(res, event);
    } catch (err) { return fail(res, err.message); }
}

function getSportsEventChannels(req, res) {
    try {
        const channels = sportsService.getEventChannels(req.params.id);
        if (!channels) return fail(res, "Event not found", 404);
        return ok(res, { channels, total: channels.length });
    } catch (err) { return fail(res, err.message); }
}

async function getFeaturedEvents(req, res) {
    try {
        return ok(res, await sportsService.getFeaturedEvents());
    } catch (err) { return fail(res, err.message); }
}

function getSportsStatus(req, res) {
    try {
        return ok(res, sportsScheduler.getStatus());
    } catch (err) { return fail(res, err.message); }
}

async function triggerSportsRefresh(req, res) {
    try {
        const bucket = req.query.bucket || "all"; // all | live | today | upcoming
        if (bucket === "live")     sportsScheduler.refreshLive().catch(()     => {});
        else if (bucket === "today")    sportsScheduler.refreshToday().catch(()    => {});
        else if (bucket === "upcoming") sportsScheduler.refreshUpcoming().catch(() => {});
        else                            sportsScheduler.refreshAll().catch(()     => {});
        return ok(res, { message: `Sports refresh started (${bucket})` }, 202);
    } catch (err) { return fail(res, err.message); }
}

Object.assign(module.exports, {
    getSportsLive,
    getSportsToday,
    getSportsUpcoming,
    getSportsEventById,
    getSportsEventChannels,
    getFeaturedEvents,
    getSportsStatus,
    triggerSportsRefresh,
});
