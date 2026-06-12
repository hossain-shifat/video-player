"use strict";

const express = require("express");
const router = express.Router();
const { getCategories, getByCategory } = require("../controllers/categoryController");

// Fully public — no auth required to browse categories
router.get("/", getCategories);        // GET /api/categories
router.get("/:name", getByCategory);   // GET /api/categories/Action

module.exports = router;
