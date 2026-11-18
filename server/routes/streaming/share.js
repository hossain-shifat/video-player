"use strict";

const express = require("express");
const { requirePlaybackAccess, requireMediaAccess } = require("../../auth/middleware/requirePlaybackAccess");
const { createShare, listShares, revokeShare, servePublic, resolveGroupParam } = require("../../controllers/streaming/shareController");

// /stream/share — logged-in users manage their links
const authed = express.Router();
authed.use(requirePlaybackAccess);
// A share code is a media-bound stream token (?st= / x-flux-stream-token). It must never manage links:
// otherwise one recipient link would list / revoke / re-mint the owner's other links.
authed.use((req, res, next) =>
    req.explicitStreamTokenMediaId
        ? res.status(403).json({ error: "Share links cannot manage share links", code: "SHARE_TOKEN_FORBIDDEN" })
        : next(),
);
authed.get("/", listShares);
authed.post("/:id", resolveGroupParam, requireMediaAccess, createShare); // series/season ids → first episode, checked as that file
authed.delete("/:code", revokeShare);

// /s/:code[/...] — the links themselves; no login, the code is the credential
const pub = express.Router();
pub.get(["/:code", "/:code/*rest"], servePublic);
pub.head(["/:code", "/:code/*rest"], servePublic);

module.exports = { authed, public: pub };
