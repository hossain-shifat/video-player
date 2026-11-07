// web/src/Auth/accountRouting.js
// Single source of truth for "where does this account belong right now?".
// Used by the route guards AND by the login / register / verify pages so they never disagree
// (which is what causes redirect loops).
//
//   not signed in               → /login
//   e-mail NOT verified         → /verify-email           (restricted to the verification flow)
//   blocked / rejected          → /access-denied
//   temporary access expired    → /access-expired
//   verified + pending/approved → browse the app (null)   (pending cannot PLAY — see PlaybackGate)

export function isAccessExpired(user) {
    return user?.accessType === "temporary" && !!user?.accessExpiresAt && Date.now() > new Date(user.accessExpiresAt).getTime();
}

/** Returns the path the account must be on, or null when normal app browsing is allowed. */
export function requiredPathFor(user) {
    if (!user) return "/login";
    if (!user.emailVerified) return "/verify-email";
    if (user.status === "blocked" || user.status === "rejected") return "/access-denied";
    if (isAccessExpired(user)) return "/access-expired";
    return null;
}

/** Where to go right after a successful sign-in / verification. */
export function postAuthPath(user, from) {
    return requiredPathFor(user) || from || "/";
}
