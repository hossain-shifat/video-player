"use strict";

const express = require("express");
const router = express.Router();
const { getAllHistory, getOne, logProgress, deleteOne, clearAll } = require("../controllers/historyController");

router.get("/", getAllHistory); // GET    /api/history
router.get("/:id", getOne); // GET    /api/history/:id  (resume point)
router.post("/:id", logProgress); // POST   /api/history/:id  (save progress)
router.delete("/", clearAll); // DELETE /api/history      (clear all)
router.delete("/:id", deleteOne); // DELETE /api/history/:id  (remove one)

module.exports = router;
