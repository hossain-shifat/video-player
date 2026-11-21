"use strict";

const express = require("express");
const { requireLoginAccess, requireMediaAccess } = require("../../auth/middleware/requirePlaybackAccess");
const { createShare, listShares, revokeShare, servePublic, resolveGroupParam } = require("../../controllers/streaming/shareController");

// /stream/share — logged-in users manage their links
const authed = express.Router();
// Managing links needs a verified Bearer LOGIN. Share codes / stream tokens / the stream cookie are ignored here:
// a share code resolves to the owner's user, so accepting it would let one recipient link list, revoke and re-mint
// every other link of the owner. (Recipients still play through the public router below, where the code IS the credential.)
authed.use(requireLoginAccess);
authed.get("/", listShares);
authed.post("/:id", resolveGroupParam, requireMediaAccess, createShare); // series/season ids → first episode, checked as that file
authed.delete("/:code", revokeShare);

// /s/:code[/...] — the links themselves; no login, the code is the credential
const pub = express.Router();
pub.get(["/:code", "/:code/*rest"], servePublic);
pub.head(["/:code", "/:code/*rest"], servePublic);

module.exports = { authed, public: pub };
