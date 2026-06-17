"use strict";

const { getHistory, getHistoryEntry, saveProgress, deleteHistoryEntry, clearHistory } = require("../utils/userStore");

// Extract clientId from X-Flux-Client header (set by frontend / promoted from query param by beaconBodyParser)
function getClientId(req) {
    return req.headers["x-flux-client"] || req.query.clientId || null;
}

// GET /api/history — full watch history for this client, sorted by most recent
function getAllHistory(req, res) {
    const clientId = getClientId(req);
    const history = getHistory(clientId);
    const items = Object.values(history).sort((a, b) => new Date(b.watchedAt) - new Date(a.watchedAt));
    return res.json({ total: items.length, history: items });
}

// GET /api/history/:id — get resume position for this client+media
function getOne(req, res) {
    const clientId = getClientId(req);
    const entry = getHistoryEntry(req.params.id, clientId);
    if (!entry) return res.json({ position: null, duration: null, exists: false });
    return res.json({ ...entry, exists: true });
}

// POST /api/history/:id — save/update watch progress for this client
function logProgress(req, res) {
    try {
        const clientId = getClientId(req);
        const entry = saveProgress(req.params.id, req.body, clientId);
        return res.json(entry);
    } catch (err) {
        console.error("[History] logProgress error:", err);
        return res.status(500).json({ error: "Failed to save progress" });
    }
}

// DELETE /api/history/:id — remove one entry for this client
function deleteOne(req, res) {
    const clientId = getClientId(req);
    const deleted = deleteHistoryEntry(req.params.id, clientId);
    if (!deleted) return res.status(404).json({ error: "History entry not found" });
    return res.json({ message: "Removed from history", id: req.params.id });
}

// DELETE /api/history — clear history for this client only
// clientId is required; without it, pass ?all=true for intentional full-store clear
function clearAll(req, res) {
    const clientId = getClientId(req);
    if (!clientId) {
        // No client identified — require explicit confirmation to avoid accidental wipe
        if (req.query.all !== "true") {
            return res.status(400).json({
                error: "X-Flux-Client header required. To clear all history pass ?all=true",
            });
        }
        // ?all=true — intentional admin-level clear of entire store
        clearHistory(null);
        return res.json({ message: "All history cleared" });
    }
    clearHistory(clientId);
    return res.json({ message: "History cleared" });
}

module.exports = { getAllHistory, getOne, logProgress, deleteOne, clearAll };
