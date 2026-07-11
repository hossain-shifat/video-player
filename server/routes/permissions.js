"use strict";

const express = require("express");
const router = express.Router();
const { getAllPermissions, getOnePermission, setMediaPermission } = require("../controllers/permissionController");

router.get("/", getAllPermissions); // GET  /api/permissions
router.get("/:id", getOnePermission); // GET  /api/permissions/:id
router.post("/:id", setMediaPermission); // POST /api/permissions/:id  { permission: boolean }

module.exports = router;
