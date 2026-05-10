"use strict";

const {
    getHistory, getHistoryEntry, saveProgress,
    deleteHistoryEntry, clearHistory,
} = require("../utils/userStore");

// GET /api/history — full watch history sorted by most recent
function getAllHistory(req, res) {
    const history = getHistory();
    const items = Object.values(history).sort(
        (a, b) => new Date(b.watchedAt) - new Date(a.watchedAt)
    );
    return res.json({ total: items.length, history: items });
}

// GET /api/history/:id — get one entry (used to get resume position before playback)
function getOne(req, res) {
    const entry = getHistoryEntry(req.params.id);
    if (!entry) return res.status(404).json({ error: "No history for this item" });
    return res.json(entry);
}

// POST /api/history/:id — save/update watch progress
// Body: { name, type, poster, streamUrl, position, duration, countView? }
function logProgress(req, res) {
    try {
        const entry = saveProgress(req.params.id, req.body);
        return res.json(entry);
    } catch (err) {
        console.error("[History] logProgress error:", err);
        return res.status(500).json({ error: "Failed to save progress" });
    }
}

// DELETE /api/history/:id — remove one entry
function deleteOne(req, res) {
    const deleted = deleteHistoryEntry(req.params.id);
    if (!deleted) return res.status(404).json({ error: "History entry not found" });
    return res.json({ message: "Removed from history", id: req.params.id });
}

// DELETE /api/history — clear all history
function clearAll(req, res) {
    clearHistory();
    return res.json({ message: "History cleared" });
}

module.exports = { getAllHistory, getOne, logProgress, deleteOne, clearAll };
