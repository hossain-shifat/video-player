"use strict";

const express = require("express");
const { authenticateJWT } = require("../../auth/middleware/authenticateJWT");
const { expand, isShortId } = require("../../utils/system/shortIds");

const router = express.Router();
router.use(authenticateJWT);

// GET /api/ids/:short → { id: <long media id> }   (used by the web app when it opens a short link cold)
router.get("/:short", (req, res) => {
    const short = String(req.params.short || "");
    const id = isShortId(short) ? expand(short) : null;
    if (!id) return res.status(404).json({ error: "Unknown id" });
    res.json({ id });
});

module.exports = router;
