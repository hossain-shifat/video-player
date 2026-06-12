"use strict";

const express = require("express");
const router = express.Router();
const { getAllHistory, getOne, logProgress, deleteOne, clearAll } = require("../controllers/historyController");

// FIX (Report-29): navigator.sendBeacon sends body as text/plain (to avoid CORS
// preflight). Express json() middleware won't parse it. Add text() middleware
// before logProgress so req.body arrives as a string, then re-parse to object.
// Also read clientId + token from query params (sendBeacon can't set headers).
function beaconBodyParser(req, res, next) {
    const ct = req.headers["content-type"] || "";
    if (ct.startsWith("text/plain")) {
        let raw = "";
        req.setEncoding("utf8");
        req.on("data", (chunk) => {
            raw += chunk;
        });
        req.on("end", () => {
            try {
                req.body = JSON.parse(raw);
            } catch {
                req.body = {};
            }
            // Promote query params to headers so controller can read them normally
            if (req.query.clientId && !req.headers["x-flux-client"]) {
                req.headers["x-flux-client"] = req.query.clientId;
            }
            next();
        });
        return;
    }
    next();
}

// No auth guard — single-user LAN install, auth blocks all history saves
router.get("/", getAllHistory); // GET    /api/history
router.get("/:id", getOne); // GET    /api/history/:id
router.post("/:id", beaconBodyParser, logProgress); // POST   /api/history/:id
router.delete("/", clearAll); // DELETE /api/history
router.delete("/:id", deleteOne); // DELETE /api/history/:id

module.exports = router;
