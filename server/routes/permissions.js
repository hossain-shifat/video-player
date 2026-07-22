"use strict";

const express = require("express");
const router = express.Router();
const { getAllPermissions, getOnePermission, setMediaPermission } = require("../controllers/permissionController");

const { authenticateJWT } = require("../auth/middleware/authenticateJWT");
const { requireApprovedUser } = require("../auth/middleware/requireApprovedUser");
const { requireRole } = require("../auth/middleware/requireRole");

// Every route below requires a logged-in, approved user whose role is admin —
// permission data controls access to restricted media, so it must not be
// readable or writable by anyone else.
router.use(authenticateJWT, requireApprovedUser, requireRole("admin"));

router.get("/", getAllPermissions); // GET  /api/permissions
router.get("/:id", getOnePermission); // GET  /api/permissions/:id
router.post("/:id", setMediaPermission); // POST /api/permissions/:id  { permission: boolean }

module.exports = router;
