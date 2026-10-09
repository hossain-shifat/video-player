"use strict";

const express = require("express");
const router = express.Router();
const { getAllHistory, getOne, logProgress, deleteOne, clearAll, sseHandler } = require("../controllers/historyController");
const { resolveAccount, beaconBodyParser } = require("../auth/middleware/resolveAccount");

// History is stored per ACCOUNT (JWT `sub` = user id), not per device.
// Same login on phone + PC → same history.
router.use(resolveAccount);

router.get("/events", sseHandler); // GET    /api/history/events  (SSE push — must stay ABOVE /:id)
router.get("/", getAllHistory); // GET    /api/history
router.get("/:id", getOne); // GET    /api/history/:id
router.post("/:id", beaconBodyParser, logProgress); // POST   /api/history/:id
router.delete("/", clearAll); // DELETE /api/history
router.delete("/:id", deleteOne); // DELETE /api/history/:id

module.exports = router;
