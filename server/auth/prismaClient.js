"use strict";

/**
 * auth/prismaClient.js
 * Singleton PrismaClient — import this everywhere.
 * Prisma v7 + @prisma/adapter-libsql for SQLite.
 */

const { PrismaClient } = require("@prisma/client");
const { PrismaLibSql } = require("@prisma/adapter-libsql");
const path = require("path");

function buildAbsoluteDbUrl() {
    // DATABASE_URL from .env is relative: "file:./data/flux-auth.db"
    // server.js calls dotenv.config() before this module loads in normal server run.
    // Compute absolute path from server/ dir (parent of auth/).
    const envUrl = process.env.DATABASE_URL;
    if (envUrl && !envUrl.includes("undefined")) {
        if (envUrl.startsWith("file:./") || envUrl.startsWith("file:../")) {
            const rel = envUrl.replace(/^file:/, "");           // e.g. "./data/flux-auth.db"
            const serverDir = path.resolve(__dirname, "../");    // server/auth/ → server/
            const abs = path.resolve(serverDir, rel);
            return `file:///${abs.replace(/\\/g, "/")}`;
        }
        // Already absolute or non-relative
        return envUrl;
    }
    // Fallback: compute directly
    const dbPath = path.resolve(__dirname, "../data/flux-auth.db");
    return `file:///${dbPath.replace(/\\/g, "/")}`;
}

function createPrismaClient() {
    const url = buildAbsoluteDbUrl();
    const adapter = new PrismaLibSql({ url });
    return new PrismaClient({
        adapter,
        log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    });
}

if (!global.__fluxPrisma) {
    global.__fluxPrisma = createPrismaClient();
}

module.exports = global.__fluxPrisma;
