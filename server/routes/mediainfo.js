"use strict";

const express = require("express");
const router = express.Router();
const { getAllMediaInfo, getAddedDates, triggerScan } = require("../controllers/mediaInfoController");

router.get("/", getAllMediaInfo); // GET  /api/mediainfo
router.get("/added-dates", getAddedDates); // GET  /api/mediainfo/added-dates
router.post("/scan", triggerScan); // POST /api/mediainfo/scan

module.exports = router;
