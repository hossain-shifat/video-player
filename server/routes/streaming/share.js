"use strict";

const express = require("express");
const { requirePlaybackAccess, requireMediaAccess } = require("../../auth/middleware/requirePlaybackAccess");
const { createShare, listShares, revokeShare, servePublic, resolveGroupParam } = require("../../controllers/streaming/shareController");

// /stream/share — logged-in users manage their links
const authed = express.Router();
authed.use(requirePlaybackAccess);
authed.get("/", listShares);
authed.post("/:id", resolveGroupParam, requireMediaAccess, createShare); // series/season ids → first episode, checked as that file
authed.delete("/:code", revokeShare);

// /s/:code[/...] — the links themselves; no login, the code is the credential
const pub = express.Router();
pub.get(["/:code", "/:code/*rest"], servePublic);
pub.head(["/:code", "/:code/*rest"], servePublic);

module.exports = { authed, public: pub };
