"use strict";

const express = require("express");
const router = express.Router();
const { getOne, refreshOne, refreshAll, parseDebug, getAllEnriched } = require("../controllers/metadataController");

router.get("/parse", parseDebug); // GET  /api/metadata/parse?filename=xxx
router.get("/enriched", getAllEnriched); // GET  /api/metadata/enriched
router.post("/refresh-all", refreshAll); // POST /api/metadata/refresh-all
router.get("/:id", getOne); // GET  /api/metadata/:id
router.post("/refresh/:id", refreshOne); // POST /api/metadata/refresh/:id

module.exports = router;
