"use strict";

const { getRecommendationsForUser } = require("../utils/recommendationEngine");

// Recommendations need TWO identities: the authenticated account (req.user —
// WHOSE profile/JSON this is, always the storage key) and the client/device
// id (X-Flux-Client — the only identity FLUX's existing watch-history store,
// server/utils/userStore.js, currently understands). Both are read here;
// nothing is ever persisted keyed by clientId.
function clientIdFromReq(req) {
    return req.headers["x-flux-client"] || req.query.clientId || null;
}

// GET /api/recommendations
async function getRecommendations(req, res) {
    try {
        const clientId = clientIdFromReq(req);
        const result = await getRecommendationsForUser(req.user, req.permissions, clientId, { force: false });
        return res.json(result);
    } catch (err) {
        console.error("[Recommendations] getRecommendations error:", err);
        return res.status(500).json({ error: "Failed to get recommendations" });
    }
}

// POST /api/recommendations/refresh — manual forced regeneration
async function refreshRecommendations(req, res) {
    try {
        const clientId = clientIdFromReq(req);
        const result = await getRecommendationsForUser(req.user, req.permissions, clientId, { force: true });
        return res.json(result);
    } catch (err) {
        console.error("[Recommendations] refreshRecommendations error:", err);
        return res.status(500).json({ error: "Failed to refresh recommendations" });
    }
}

module.exports = { getRecommendations, refreshRecommendations };
