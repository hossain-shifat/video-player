"use strict";

/**
 * auth/services/playbackRevocation.js
 * Call after ANY change to an account's status / role / access window / permissions.
 *  - clears the short in-process caches so the change applies immediately;
 *  - if the account may no longer watch, deletes its stream tokens so a previously issued token
 *    (and the flux_st cookie carrying it) stops working at once. Every /stream/* request is also
 *    re-checked against the live account, so this is belt-and-braces, not the only control.
 */

const prisma = require("../prismaClient");
const { playbackDenial, invalidatePlaybackCache } = require("../middleware/requirePlaybackAccess");
const { clearVerifiedCache } = require("../middleware/enforceEmailVerified");

async function syncPlaybackAccess(user) {
    invalidatePlaybackCache();
    clearVerifiedCache(user.id);
    if (playbackDenial(user)) {
        await prisma.streamToken.deleteMany({ where: { userId: user.id } }).catch((e) => console.error("[Auth] stream token revoke failed:", e.message));
    }
}

module.exports = { syncPlaybackAccess };
