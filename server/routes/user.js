"use strict";

const express = require("express");
const router  = express.Router();
const {
    getWatchlist, addWatchlist, removeWatchlist,
    getFavourites, addFavourite, removeFavourite,
} = require("../controllers/userController");

router.get("/watchlist",          getWatchlist);    // GET    /api/user/watchlist
router.post("/watchlist/:id",     addWatchlist);    // POST   /api/user/watchlist/:id
router.delete("/watchlist/:id",   removeWatchlist); // DELETE /api/user/watchlist/:id

router.get("/favourites",         getFavourites);   // GET    /api/user/favourites
router.post("/favourites/:id",    addFavourite);    // POST   /api/user/favourites/:id
router.delete("/favourites/:id",  removeFavourite); // DELETE /api/user/favourites/:id

module.exports = router;
