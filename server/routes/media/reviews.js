"use strict";

// ============================================================================
// routes/media/reviews.js — mounted at /api/reviews (see server.js)
// The review system: reviews, reactions and discussions. Storage: server/data/media/reviews.json.
// Reading is public (optionalJWT attaches req.user when a token is sent, so "my reaction" / "can edit" are right);
// anything that writes needs a signed-in, verified AND approved account and is rate-limited per account.
// ============================================================================

const express = require("express");
const router = express.Router();

const { optionalJWT, authenticateJWT } = require("../../auth/middleware/authenticateJWT");
const { requireApprovedUser } = require("../../auth/middleware/requireApprovedUser");
const { rateLimit } = require("../../auth/middleware/rateLimit");
const c = require("../../controllers/media/reviewController");

const byAccount = (req) => req.user?.id || req.ip;
const write = [authenticateJWT, requireApprovedUser];
const limitReview = rateLimit({ name: "review-write", max: 12, windowMs: 10 * 60_000, keyFn: byAccount, message: "You are posting too fast. Please wait a moment." });
const limitReply = rateLimit({ name: "review-reply", max: 40, windowMs: 10 * 60_000, keyFn: byAccount, message: "You are posting too fast. Please wait a moment." });
const limitReact = rateLimit({ name: "review-react", max: 200, windowMs: 10 * 60_000, keyFn: byAccount, message: "Slow down a little." });

// Home page rows (must stay above the /:id routes)
router.get("/popular", optionalJWT, c.getPopular); //            GET    /api/reviews/popular
router.get("/discussions", optionalJWT, c.getDiscussions); //    GET    /api/reviews/discussions

// A title's reviews
router.get("/title/:kind/:tmdbId", optionalJWT, c.listTitleReviews); //                    GET    /api/reviews/title/movie/603?sort=top|new|rating&limit=&offset=
router.post("/title/:kind/:tmdbId", ...write, limitReview, c.createReview); //             POST   { rating: 1-10, content }

// Admin: import from TMDB now
router.post("/sync-all", authenticateJWT, c.syncAll); //                                   POST   /api/reviews/sync-all
router.post("/sync/:kind/:tmdbId", authenticateJWT, c.syncOne); //                         POST   /api/reviews/sync/movie/603

// Comments / replies (must stay above /:id)
router.patch("/replies/:rid", ...write, limitReply, c.updateReplyCtl); //                  PATCH  { content }
router.delete("/replies/:rid", authenticateJWT, c.deleteReplyCtl); //                      DELETE (owner or admin)
router.post("/replies/:rid/react", ...write, limitReact, c.reactReply); //                 POST   { type | null }

// One review + its discussion
router.get("/:id/thread", optionalJWT, c.getThread); //                                    GET    review + replies
router.post("/:id/replies", ...write, limitReply, c.addReply); //                          POST   { content, parentId? }
router.post("/:id/react", ...write, limitReact, c.reactReview); //                         POST   { type | null }
router.patch("/:id", ...write, limitReview, c.updateReview); //                            PATCH  { rating?, content? }
router.delete("/:id", authenticateJWT, c.deleteReview); //                                 DELETE (owner or admin)

module.exports = router;
