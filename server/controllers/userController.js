"use strict";

const {
    getUserdata,
    addToWatchlist, removeFromWatchlist,
    addToFavourites, removeFromFavourites,
} = require("../utils/userStore");

// GET /api/user/watchlist
function getWatchlist(req, res) {
    const { watchlist } = getUserdata();
    const items = Object.values(watchlist).sort(
        (a, b) => new Date(b.addedAt) - new Date(a.addedAt)
    );
    return res.json({ total: items.length, watchlist: items });
}

// POST /api/user/watchlist/:id — body: { name, poster?, type? }
function addWatchlist(req, res) {
    if (!req.body.name) return res.status(400).json({ error: "name is required" });
    const item = addToWatchlist(req.params.id, req.body);
    return res.status(201).json(item);
}

// DELETE /api/user/watchlist/:id
function removeWatchlist(req, res) {
    const removed = removeFromWatchlist(req.params.id);
    if (!removed) return res.status(404).json({ error: "Not in watchlist" });
    return res.json({ message: "Removed from watchlist", id: req.params.id });
}

// GET /api/user/favourites
function getFavourites(req, res) {
    const { favourites } = getUserdata();
    const items = Object.values(favourites).sort(
        (a, b) => new Date(b.addedAt) - new Date(a.addedAt)
    );
    return res.json({ total: items.length, favourites: items });
}

// POST /api/user/favourites/:id — body: { name, poster?, type? }
function addFavourite(req, res) {
    if (!req.body.name) return res.status(400).json({ error: "name is required" });
    const item = addToFavourites(req.params.id, req.body);
    return res.status(201).json(item);
}

// DELETE /api/user/favourites/:id
function removeFavourite(req, res) {
    const removed = removeFromFavourites(req.params.id);
    if (!removed) return res.status(404).json({ error: "Not in favourites" });
    return res.json({ message: "Removed from favourites", id: req.params.id });
}

module.exports = {
    getWatchlist, addWatchlist, removeWatchlist,
    getFavourites, addFavourite, removeFavourite,
};
