import { useState, useRef } from "react";
import { Trash2, Download, Upload, Check } from "lucide-react";
import { Card, Row, Toggle, SectionLabel, DangerButton, ConfirmModal, GhostButton, PinModal, PREFS_KEY, PIN_KEY, hasPin } from "./shared";
import { clearHistory } from "../../api";
import { useApi } from "../../Context/apiContext";

const isFluxKey = (k) => !!k && k.startsWith("flux-") && k !== PIN_KEY; // PIN hash is never exported or wiped here

function localKeys(test) {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && test(k)) out.push(k);
    }
    return out;
}

export default function PrivacySection({ prefs, setPref, setPrefs }) {
    const { watchlist, favourites, removeWatchlistItem, removeFavouriteItem } = useApi();

    const [confirm, setConfirm] = useState(null); // "all" | "watchlist" | "favourites" | "searches" | null
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(null); // { ok, text }
    const [pinGate, setPinGate] = useState(null); // fn to run after PIN ok
    const fileRef = useRef(null);

    // PIN-protect actions that could wipe or overwrite restrictions
    const guard = (fn) => (hasPin() ? setPinGate(() => fn) : fn());

    function say(ok, text) {
        setMsg({ ok, text });
    }

    async function doClearAll() {
        setBusy(true);
        try {
            await clearHistory().catch(() => {});
            localKeys((k) => isFluxKey(k) || k.startsWith("progress-") || k.startsWith("search-")).forEach((k) => localStorage.removeItem(k));
            setPrefs({});
            say(true, "Local data cleared.");
        } finally {
            setBusy(false);
            setConfirm(null);
        }
    }

    function doClearSearches() {
        const keys = localKeys((k) => k.startsWith("search-") || k.startsWith("flux-search"));
        keys.forEach((k) => localStorage.removeItem(k));
        setConfirm(null);
        say(true, keys.length ? "Search history cleared." : "No saved searches found.");
    }

    async function clearList(items, remove, label) {
        setBusy(true);
        try {
            const results = await Promise.allSettled(items.map((i) => remove(i.id)));
            const failed = results.filter((r) => r.status === "rejected").length;
            if (failed === 0) say(true, `${label} cleared.`);
            else say(false, `${failed} of ${items.length} item${items.length === 1 ? "" : "s"} could not be removed from ${label.toLowerCase()}. Try again.`);
        } finally {
            setBusy(false);
            setConfirm(null);
        }
    }

    function doExport() {
        const out = {};
        localKeys(isFluxKey).forEach((k) => {
            try {
                out[k] = JSON.parse(localStorage.getItem(k));
            } catch {
                out[k] = localStorage.getItem(k);
            }
        });
        const blob = new Blob([JSON.stringify({ app: "flux", exportedAt: new Date().toISOString(), data: out }, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `flux-export-${new Date().toISOString().split("T")[0]}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        say(true, `Exported ${Object.keys(out).length} item${Object.keys(out).length === 1 ? "" : "s"}.`);
    }

    async function doImport(e) {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        try {
            const json = JSON.parse(await file.text());
            const data = json?.data;
            if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("bad file");
            let n = 0;
            for (const [k, v] of Object.entries(data)) {
                if (!isFluxKey(k)) continue;
                if (k === PREFS_KEY) {
                    if (v && typeof v === "object" && !Array.isArray(v)) {
                        setPrefs({ ...v });
                        n++;
                    }
                    continue;
                }
                localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
                n++;
            }
            say(n > 0, n > 0 ? `Imported ${n} item${n === 1 ? "" : "s"}.` : "Nothing to import in that file.");
        } catch {
            say(false, "That file isn't a Flux export.");
        }
    }

    const wl = watchlist?.length ?? 0;
    const fav = favourites?.length ?? 0;

    return (
        <div className="w-full space-y-6">
            {msg && (
                <p
                    role={msg.ok ? "status" : "alert"}
                    className={`flex items-center gap-2 rounded-md border px-3 py-2.5 text-[13px] ${msg.ok ? "border-success/35 bg-success/10 text-success" : "border-error/35 bg-error/10 text-error"}`}>
                    {msg.ok && <Check size={14} strokeWidth={3} />} {msg.text}
                </p>
            )}

            <div>
                <SectionLabel hint="Off by default. Nothing leaves your network unless you turn these on.">Diagnostics</SectionLabel>
                <Card>
                    <Row id="pv-crash" label="Crash reports" desc="Send anonymous crash data to help fix bugs">
                        <Toggle label="Crash reports" value={prefs.crashReports ?? false} onChange={(v) => setPref("crashReports", v)} />
                    </Row>
                    <Row id="pv-telemetry" label="Usage analytics" desc="Share non-identifying interaction data">
                        <Toggle label="Usage analytics" value={prefs.telemetry ?? false} onChange={(v) => setPref("telemetry", v)} />
                    </Row>
                </Card>
            </div>

            <div>
                <SectionLabel hint="What other people on your server can see about you.">Visibility</SectionLabel>
                <Card>
                    <Row id="pv-activity" label="Activity status" desc="Show when you're online and what you're watching">
                        <Toggle label="Activity status" value={prefs.activityStatus ?? true} onChange={(v) => setPref("activityStatus", v)} />
                    </Row>
                    <Row id="pv-watchlist" label="Public watchlist" desc="Show your watchlist on your profile">
                        <Toggle label="Public watchlist" value={prefs.publicWatchlist ?? false} onChange={(v) => setPref("publicWatchlist", v)} />
                    </Row>
                    <Row id="pv-progress" label="Show playback progress" desc="Show progress on your public profile card">
                        <Toggle label="Show playback progress" value={prefs.publicProgress ?? false} onChange={(v) => setPref("publicProgress", v)} />
                    </Row>
                </Card>
            </div>

            <div>
                <SectionLabel hint="Stored in this browser and on your server.">History and lists</SectionLabel>
                <Card>
                    <Row id="pv-history" label="Keep watch history" desc="Track progress and resume points">
                        <Toggle label="Keep watch history" value={prefs.watchHistory ?? true} onChange={(v) => setPref("watchHistory", v)} />
                    </Row>
                    <Row id="pv-search" label="Keep search history" desc="Remember recent searches for suggestions">
                        <Toggle label="Keep search history" value={prefs.searchHistory ?? true} onChange={(v) => setPref("searchHistory", v)} />
                    </Row>
                    <Row label="Clear search history" desc="Forget recent searches on this browser">
                        <GhostButton onClick={() => setConfirm("searches")}>Clear</GhostButton>
                    </Row>
                    <Row label="Clear watchlist" desc={`${wl} title${wl === 1 ? "" : "s"} saved`}>
                        <GhostButton onClick={() => setConfirm("watchlist")} disabled={wl === 0}>
                            Clear
                        </GhostButton>
                    </Row>
                    <Row label="Clear favourites" desc={`${fav} title${fav === 1 ? "" : "s"} saved`}>
                        <GhostButton onClick={() => setConfirm("favourites")} disabled={fav === 0}>
                            Clear
                        </GhostButton>
                    </Row>
                </Card>
            </div>

            <div>
                <SectionLabel hint="Back up or move your settings. The restriction PIN is never exported.">Your data</SectionLabel>
                <Card>
                    <Row id="pv-export" label="Export data" desc="Download your preferences as a JSON file">
                        <GhostButton onClick={doExport}>
                            <Download size={13} /> Export JSON
                        </GhostButton>
                    </Row>
                    <Row id="pv-import" label="Import data" desc="Restore preferences from a Flux export file">
                        <GhostButton onClick={() => guard(() => fileRef.current?.click())}>
                            <Upload size={13} /> Import JSON
                        </GhostButton>
                        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={doImport} />
                    </Row>
                    <Row id="pv-clear" label="Clear all local data" desc="Remove history, progress and cached preferences" danger>
                        <DangerButton onClick={() => guard(() => setConfirm("all"))}>
                            <Trash2 size={13} /> Clear
                        </DangerButton>
                    </Row>
                </Card>
            </div>

            <ConfirmModal
                open={confirm === "all"}
                onClose={() => setConfirm(null)}
                title="Clear all local data?"
                subtitle="This removes watch history, search history and saved preferences. It can't be undone."
                confirmLabel="Clear everything"
                loading={busy}
                onConfirm={doClearAll}
            />
            <ConfirmModal
                open={confirm === "searches"}
                onClose={() => setConfirm(null)}
                title="Clear search history?"
                subtitle="Recent searches on this browser will be forgotten."
                confirmLabel="Clear searches"
                onConfirm={doClearSearches}
            />
            <ConfirmModal
                open={confirm === "watchlist"}
                onClose={() => setConfirm(null)}
                title="Clear your watchlist?"
                subtitle={`${wl} title${wl === 1 ? "" : "s"} will be removed from your watchlist.`}
                confirmLabel="Clear watchlist"
                loading={busy}
                onConfirm={() => clearList(watchlist || [], removeWatchlistItem, "Watchlist")}
            />
            <ConfirmModal
                open={confirm === "favourites"}
                onClose={() => setConfirm(null)}
                title="Clear your favourites?"
                subtitle={`${fav} title${fav === 1 ? "" : "s"} will be removed from your favourites.`}
                confirmLabel="Clear favourites"
                loading={busy}
                onConfirm={() => clearList(favourites || [], removeFavouriteItem, "Favourites")}
            />

            <PinModal
                open={!!pinGate}
                onClose={() => setPinGate(null)}
                onVerified={() => {
                    const fn = pinGate;
                    setPinGate(null);
                    fn?.();
                }}
            />
        </div>
    );
}
