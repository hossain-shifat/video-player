"use strict";

const fs = require("fs");
const path = require("path");

const PERMISSIONS_FILE = path.join(__dirname, "../data/permissions.json");

function ensureFile() {
    if (!fs.existsSync(PERMISSIONS_FILE)) {
        fs.writeFileSync(PERMISSIONS_FILE, "{}", "utf-8");
    }
}

function load() {
    ensureFile();
    try {
        const raw = fs.readFileSync(PERMISSIONS_FILE, "utf-8");
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

function save(data) {
    ensureFile();
    const tmp = `${PERMISSIONS_FILE}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, PERMISSIONS_FILE);
}

function getPermission(mediaId) {
    const data = load();
    if (Object.prototype.hasOwnProperty.call(data, mediaId)) {
        return data[mediaId].permission === true;
    }
    return true;
}

function setPermission(mediaId, value) {
    const data = load();
    data[mediaId] = { permission: value === true };
    save(data);
}

module.exports = { getPermission, setPermission, load };
