// web/scripts/shortlinks.mjs
//
// Re-applies the SHORT-LINK edits to whatever component files you have right now.
// Run it from the web/ folder any time you overwrite components with a newer version
// (a new Banner.jsx, Modal.jsx, MediaCard.jsx …) — it is idempotent, so running it twice is harmless.
//
//   node scripts/shortlinks.mjs           fix every file in src/
//   node scripts/shortlinks.mjs --check   only list what would change (exit code 1 if anything would)
//
// What it does
//   1. /media/${encodeURIComponent(x)}  and  /player/${encodeURIComponent(x)}   →   …${routeId(x)}
//      (9-character address-bar ids; non-library ids like tmdb-… fall back to encodeURIComponent)
//      + adds   import { routeId } from ".../Utils/shortId.js"   when the file has no such import.
//      Dashboard/ is never touched (it keeps using long ids, which still work).
//   2. The pages mounted on /media/:id and /player/:id read the id through useMediaRouteId()
//      instead of useParams(), so a short link resolves to the real id first.

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const check = args.includes("--check");
const SRC = path.resolve(args.find((a) => !a.startsWith("--")) || "src");
if (!fs.existsSync(SRC)) {
    console.error(`Folder not found: ${SRC}\nRun this from the web/ folder (the one that contains src/).`);
    process.exit(2);
}

const SKIP_DIRS = new Set(["node_modules", "Dashboard", "dist"]);
const LINK = /(?<![\w.])(\/(?:media|player)\/)\$\{encodeURIComponent\(((?:[^()]|\([^()]*\))*)\)\}/g;
// navigate(`/player/${id}`)  — a bare id inside a template that starts at the path
const LINK_BARE = /(`\/(?:media|player)\/)\$\{(id|mediaId)\}(?=[`?#])/g;
const CONSUMERS = {
    "Pages/Media/Details/MediaDetails.jsx": true,
    "Pages/Player/PlayerPage.jsx": true,
    "Components/Media/CastAndCrew.jsx": true,
};

const files = [];
(function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
            if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name));
        } else if (/\.(jsx?|mjs)$/.test(e.name)) files.push(path.join(dir, e.name));
    }
})(SRC);

const rel = (from, to) => {
    let r = path.relative(path.dirname(from), to).split(path.sep).join("/");
    return r.startsWith(".") ? r : "./" + r;
};
const posix = (p) => path.relative(SRC, p).split(path.sep).join("/");

function addImport(text, file, name, target) {
    if (new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from`).test(text)) return text;
    const line = `import { ${name} } from "${rel(file, path.join(SRC, target))}";`;
    const lines = text.split("\n");
    let last = -1;
    lines.forEach((l, i) => {
        if (/^import\b.*(?:["'];?|from\s*["'][^"']+["'];?)\s*$/.test(l) || /^\}\s*from\s*["'][^"']+["'];?\s*$/.test(l)) last = i;
    });
    if (last < 0) return line + "\n" + text;
    lines.splice(last + 1, 0, line);
    return lines.join("\n");
}

let changed = 0;
for (const file of files) {
    const id = posix(file);
    if (id === "Utils/shortId.js" || id.startsWith("Hooks/Query/useMediaRouteId")) continue;
    const raw = fs.readFileSync(file, "utf8");
    const crlf = raw.includes("\r\n");
    let text = raw.replace(/\r\n/g, "\n");
    const notes = [];

    let n = 0;
    text = text.replace(LINK, (_, prefix, expr) => (n++, `${prefix}\${routeId(${expr})}`));
    text = text.replace(LINK_BARE, (_, prefix, expr) => (n++, `${prefix}\${routeId(${expr})}`));
    if (n) {
        text = addImport(text, file, "routeId", "Utils/shortId.js");
        notes.push(`${n} link${n > 1 ? "s" : ""} → routeId`);
    }

    if (CONSUMERS[id] && /const\s*\{\s*id\s*\}\s*=\s*useParams\(\)\s*;/.test(text)) {
        text = text.replace(/const\s*\{\s*id\s*\}\s*=\s*useParams\(\)\s*;/, "const id = useMediaRouteId();");
        if (!/useParams\(/.test(text)) {
            text = text.replace(/(import\s*\{[^}]*?)\buseParams\s*,\s*/, "$1").replace(/(import\s*\{[^}]*?),\s*useParams\b/, "$1");
        }
        text = addImport(text, file, "useMediaRouteId", "Hooks/Query/useMediaRouteId.js");
        notes.push("route id → useMediaRouteId()");
    }

    if (notes.length) {
        changed++;
        console.log(`${check ? "would fix" : "fixed"}  ${id}   (${notes.join(", ")})`);
        if (!check) fs.writeFileSync(file, crlf ? text.replace(/\n/g, "\r\n") : text);
    }
}
console.log(changed ? `\n${changed} file(s) ${check ? "need" : "were"} updated.` : "\nNothing to do — every link already uses short ids.");
process.exit(check && changed ? 1 : 0);
