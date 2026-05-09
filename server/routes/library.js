"use strict";

const express = require("express");
const router = express.Router();
const { getFolders, addFolder, removeFolder, updateFolder } = require("../controllers/libraryController");

router.get("/", getFolders);
router.post("/", addFolder);
router.delete("/:id", removeFolder);
router.patch("/:id", updateFolder);

module.exports = router;
