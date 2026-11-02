"use strict";

/**
 * server/scripts/notify-doctor.js — checks the WHOLE notification chain in one go.
 *
 *   cd server
 *   node scripts/notify-doctor.js                 # read-only checks
 *   node scripts/notify-doctor.js --send          # + create a real test notification for every admin
 *   node scripts/notify-doctor.js --simulate      # + fake a "new media" alert for each library (who WOULD be notified)
 *
 * Stop the dev server first if you use --send/--simulate? Not needed — SQLite handles two processes fine.
 */

try {
    require("dotenv").config({ quiet: true });
} catch {
    /* dotenv optional */
}

const fs = require("fs");
const args = new Set(process.argv.slice(2));
let failed = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m, fix) => {
    failed++;
    console.log(`  ✖ ${m}${fix ? `\n      → ${fix}` : ""}`);
};
const warn = (m) => console.log(`  ! ${m}`);
const head = (m) => console.log(`\n${m}`);

(async () => {
    const prisma = require("../auth/prismaClient");
    const notificationService = require("../services/notificationService");
    const pushService = require("../services/pushService");

    head("1. Database / Prisma client");
    for (const d of ["notification", "pushDevice", "notificationPreference"]) {
        prisma[d] ? ok(`prisma.${d} exists`) : bad(`prisma.${d} is missing (client is out of date)`, "npx prisma db push  &&  npx prisma generate  — then restart the server");
    }
    let schemaOk = !!(prisma.notification && prisma.pushDevice && prisma.notificationPreference);
    try {
        const cols = (await prisma.$queryRawUnsafe("PRAGMA table_info(notifications)")).map((c) => c.name);
        if (!cols.length) {
            bad("table `notifications` does not exist in the database", "npx prisma db push");
            schemaOk = false;
        } else {
            for (const c of ["id", "userId", "type", "title", "body", "dedupeKey", "metaJson", "readAt", "createdAt"]) {
                cols.includes(c) ? null : bad(`column notifications.${c} is missing`, "npx prisma db push  &&  npx prisma generate");
            }
            if (["metaJson", "dedupeKey"].every((c) => cols.includes(c))) ok("notifications table has all columns");
        }
    } catch (err) {
        bad(`could not read table info: ${err.message}`);
    }

    if (schemaOk) {
        try {
            await prisma.notification.findFirst({ select: { id: true, metaJson: true } });
            ok("Prisma client knows Notification.metaJson (details are saved)");
        } catch (err) {
            bad("Prisma client does NOT know Notification.metaJson — every new notification is saved WITHOUT details (no titles, devices, disk info…)", "npx prisma db push  &&  npx prisma generate  — then restart the server");
        }
    }

    head("2. Users");
    const admins = await prisma.user.findMany({ where: { role: "admin", status: "approved" }, select: { id: true, name: true, email: true } });
    const approved = await prisma.user.count({ where: { status: "approved" } });
    admins.length ? ok(`${admins.length} approved admin(s), ${approved} approved user(s) total`) : bad("no approved admin exists — admin notifications have no recipient");

    if (schemaOk) {
        head("3. Stored notifications / devices");
        const total = await prisma.notification.count();
        const byType = await prisma.notification.groupBy({ by: ["type"], _count: { _all: true } });
        ok(`${total} notification(s) in history${byType.length ? ": " + byType.map((t) => `${t.type}=${t._count._all}`).join(", ") : ""}`);
        const devices = await prisma.pushDevice.count({ where: { isActive: true } });
        devices ? ok(`${devices} active push device(s)`) : warn("no push devices registered yet (Settings → Notifications → turn on push on this device). The bell/history works without it.");
    }

    head("4. Firebase push");
    const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (keyPath) {
        const abs = require("path").resolve(__dirname, "..", keyPath);
        fs.existsSync(abs) ? ok(`service-account file found (${keyPath})`) : bad(`service-account file NOT found at ${abs}`, "fix FIREBASE_SERVICE_ACCOUNT_PATH in server/.env");
    } else if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        warn("no Firebase credentials configured (push disabled; in-app notifications still work)");
    }
    pushService.init();
    const conn = await pushService.checkConnectivity();
    const st = pushService.getStatus();
    if (st.state === "ready") ok("Firebase initialised and Google FCM reachable");
    else bad(`push is not ready: ${st.reason} — ${st.message || ""}`.trim());
    if (conn && conn.ok === false) bad(`FCM connectivity: ${conn.message}`);

    head("5. Libraries & new-media recipients");
    let folders = [];
    try {
        folders = await require("../controllers/libraryController").readFolders();
    } catch (err) {
        bad(`could not read library folders: ${err.message}`);
    }
    folders.length ? ok(`${folders.length} library folder(s) configured`) : bad("no library folders configured");
    const users = await prisma.user.findMany({
        where: { status: "approved" },
        select: { id: true, name: true, role: true, status: true, accessType: true, accessExpiresAt: true, permissionsJson: true },
    });
    for (const f of folders) {
        const exists = fs.existsSync(f.path);
        const who = users.filter((u) => notificationService.userCanAccessLibrary(u, f.id));
        console.log(`    • "${f.label}" ${exists ? "" : "(PATH MISSING!) "}→ would notify: ${who.map((u) => `${u.name}${u.role === "admin" ? " [admin]" : ""}`).join(", ") || "nobody"}`);
        if (!exists) bad(`path missing for "${f.label}": ${f.path}`, "fix the folder path or the drive/share mount");
        if (!who.length) bad(`nobody would be notified about "${f.label}"`);
    }
    if (folders.some((f) => f.path.startsWith("\\\\") || f.path.startsWith("//")) && process.env.WATCH_USE_POLLING !== "true") {
        warn("a library looks like a network share — file-system events don't fire on shares. Set WATCH_USE_POLLING=true in server/.env.");
    }

    if (schemaOk && args.has("--send")) {
        head("6. Sending a real test notification to every admin");
        const rows = await notificationService.notifyAdmins({ type: notificationService.TYPES.SYSTEM, title: "Doctor test", body: "If you can see this in the bell, storing + reading notifications works." });
        rows.length ? ok(`created ${rows.length} notification(s) — open the bell in FLUX`) : bad("nothing was created — see the [Notify] error above");
    }

    if (schemaOk && args.has("--simulate") && folders.length) {
        head("7. Simulating a NEW MEDIA alert");
        const { getAllCached } = require("../utils/mediaCache");
        const { parseFilename } = require("../utils/nameParser");
        for (const f of folders) {
            // Use a REAL file so the modal shows a real title/poster, exactly like a genuine new-media alert.
            let file = null;
            try {
                file = (await getAllCached([f])).allMedia[0] || null;
            } catch {
                /* fall through */
            }
            if (!file) {
                bad(`"${f.label}": no media files found to simulate with`);
                continue;
            }
            let title = file.name;
            try {
                title = parseFilename(file.name)?.title || file.name;
            } catch {
                /* keep file name */
            }
            const rows = await notificationService.notifyLibraryUsers(f.id, {
                type: notificationService.TYPES.NEW_MEDIA,
                title: `New in ${f.label}`,
                body: "1 new title was added",
                meta: { libraryId: f.id, libraryLabel: f.label, count: 1, ids: [file.id], titles: [title] },
            });
            rows.length ? ok(`"${f.label}": stored for ${rows.length} user(s)`) : bad(`"${f.label}": nothing stored`);
        }
    }

    console.log(failed ? `\n✖ ${failed} problem(s) found — fix the lines marked ✖ and run again.\n` : "\n✓ Everything checked looks healthy.\n");
    setTimeout(() => process.exit(failed ? 1 : 0), 300);
})().catch((err) => {
    console.error("\nDoctor crashed:", err);
    process.exit(2);
});
