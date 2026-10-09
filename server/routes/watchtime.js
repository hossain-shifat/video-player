"use strict";

const express = require("express");
const router = express.Router();
const { beat, stats } = require("../controllers/watchTimeController");
const { resolveAccount, beaconBodyParser } = require("../auth/middleware/resolveAccount");

router.use(resolveAccount);

router.get("/", stats); // GET  /api/watchtime
router.post("/:id", beaconBodyParser, beat); // POST /api/watchtime/:id  (player beat; sendBeacon-safe)

module.exports = router;
