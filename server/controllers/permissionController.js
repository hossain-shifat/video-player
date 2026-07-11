"use strict";

const { getPermission, setPermission, load } = require("../utils/permissionsStore");

// GET /api/permissions — bulk read, same pattern as /api/mediainfo.
// Frontend fetches this ONCE and merges into rows locally instead of one
// request per row. Returns a flat { mediaId: boolean } map — true = allowed,
// false = restricted. Any id NOT present in the map defaults to true
// (matches permissionsStore.getPermission()'s own default-allow behaviour).
async function getAllPermissions(req, res) {
    try {
        const raw = load(); // { mediaId: { permission: bool } }
        const permissions = Object.fromEntries(Object.entries(raw).map(([id, v]) => [id, v.permission === true]));
        return res.json({ total: Object.keys(permissions).length, permissions });
    } catch (err) {
        console.error("[Permissions] getAllPermissions error:", err);
        return res.status(500).json({ error: "Failed to get permissions" });
    }
}

// GET /api/permissions/:id — single lookup (handy for a player-side gate check later)
async function getOnePermission(req, res) {
    try {
        const permission = getPermission(req.params.id);
        return res.json({ id: req.params.id, permission });
    } catch (err) {
        console.error("[Permissions] getOnePermission error:", err);
        return res.status(500).json({ error: "Failed to get permission" });
    }
}

// POST /api/permissions/:id — body: { permission: boolean }
// Works for ANY id string — movie file ids, series/anime group ids, whatever
// the frontend is currently editing. permissionsStore doesn't care what kind
// of id it is, it's just a key.
async function setMediaPermission(req, res) {
    try {
        const { id } = req.params;
        const value = req.body?.permission === true;
        await setPermission(id, value);
        return res.json({ id, permission: value });
    } catch (err) {
        console.error("[Permissions] setMediaPermission error:", err);
        return res.status(500).json({ error: "Failed to set permission" });
    }
}

module.exports = { getAllPermissions, getOnePermission, setMediaPermission };
