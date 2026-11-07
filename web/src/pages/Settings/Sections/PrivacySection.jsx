import { useState, useRef, useEffect, useCallback } from "react";
import { Trash2, Download, Upload, Check, Monitor, Smartphone, Globe, Pencil, Info } from "lucide-react";
import { Card, Row, Toggle, SectionLabel, DangerButton, GhostButton, PREFS_KEY, PIN_KEY, hasPin } from "../Components/shared";
import { clearHistory } from "../../../Api";
import { useApi } from "../../../Context/apiContext";
import { useAuth } from "../../../Hooks/Auth/useAuth";
import { SettingsConfirm, PinModal } from "../../../Components/Layout/Modal";
import { getDevices, renameDevice, logoutDevices, logoutOtherDevices } from "../../../Api/user";

const isFluxKey = (k) => !!k && k.startsWith("flux-") && k !== PIN_KEY; // PIN hash is never exported or wiped here

function localKeys(test) {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && test(k)) out.push(k);
    }
    return out;
}

function relTime(iso) {
    if (!iso) return "—";
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 90) return "Active now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
}

const deviceGlyph = (t) => (t === "mobile" ? <Smartphone size={16} /> : t === "tablet" ? <Monitor size={16} /> : <Globe size={16} />);

const IP_NOTE = "If the IP is the same, it may be the same device signed in with a different browser.";

function DeviceRow({ glyph, name, current, meta, ip, active, tag, children }) {
    const [tip, setTip] = useState(false);
    return (
        <li className="flex flex-col gap-3 border-b border-base-content/10 px-4 py-3.5 last:border-b-0 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
            <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-base-300 text-primary">{glyph}</span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium leading-tight text-base-content">{name}</p>
                        {current && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
                                <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
                                This device
                            </span>
                        )}
                        {tag && <span className="rounded-full bg-base-300 px-2 py-0.5 text-[11px] font-medium text-base-content/60">{tag}</span>}
                    </div>
                    {meta && <p className="mt-0.5 text-[13px] leading-snug text-base-content/60">{meta}</p>}
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] leading-snug text-base-content/55">
                        <span>IP</span>
                        <span className="font-mono text-base-content/80">{ip || "not recorded"}</span>
                        <button
                            type="button"
                            onClick={() => setTip((v) => !v)}
                            aria-expanded={tip}
                            aria-label="About IP addresses"
                            title={IP_NOTE}
                            className="grid h-5 w-5 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-base-content/40 transition-colors hover:bg-base-300 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary">
                            <Info size={13} />
                        </button>
                        <span aria-hidden="true">·</span>
                        <span className={active ? "text-success" : ""}>{relTime(active)}</span>
                    </p>
                    {tip && (
                        <p role="note" className="mt-1.5 rounded-md bg-base-300 px-2.5 py-1.5 text-xs leading-relaxed text-base-content/70">
                            {IP_NOTE}
                        </p>
                    )}
                </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{children}</div>
        </li>
    );
}

/** Account-owner devices. One list; every action is a real server call and the list is re-read afterwards. */
export function DevicesSection() {
    const { logout, user, isApproved } = useAuth();
    const [data, setData] = useState(null); // { devices } — one row per browser + IP, however many times it signed in
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState(null);
    const [rename, setRename] = useState(null); // { id, value }
    const [confirm, setConfirm] = useState(null); // { kind: "device"|"others", target? }

    const load = useCallback(async () => {
        try {
            setData(await getDevices());
            setError(null);
        } catch (e) {
            setError(e?.message || "Could not load your devices.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (user && isApproved) load();
        else setLoading(false);
    }, [load, user, isApproved]);

    async function run(fn, okText) {
        setBusy(true);
        setNote(null);
        try {
            const res = await fn();
            if (res?.currentSessionRevoked) {
                await logout(); // this device was logged out → normal sign-out path
                return;
            }
            setNote({ ok: true, text: okText });
            await load();
        } catch (e) {
            setNote({ ok: false, text: e?.message || "That didn't work. Try again." });
        } finally {
            setBusy(false);
            setConfirm(null);
        }
    }

    async function saveName() {
        const { id, value } = rename;
        await run(() => renameDevice(id, value), "Device renamed.");
        setRename(null);
    }

    if (!user || !isApproved) return null; // only for a signed-in, approved account

    const devices = data?.devices ?? [];
    const total = devices.length;
    const hasOthers = devices.some((d) => !d.isCurrent);

    return (
        <div>
            <SectionLabel hint="Browsers and apps signed in to your account. Log out any you don't recognise.">Devices</SectionLabel>
            <Card>
                <div className="flex items-center justify-between gap-3 border-b border-base-content/10 px-4 py-3 sm:px-5">
                    <p className="text-[13px] text-base-content/60" aria-live="polite">
                        {loading ? "Loading…" : `${total} device${total === 1 ? "" : "s"} signed in`}
                    </p>
                    <GhostButton onClick={() => setConfirm({ kind: "others" })} disabled={busy || !hasOthers}>
                        Log out other devices
                    </GhostButton>
                </div>

                {error && (
                    <p role="alert" className="px-4 py-3 text-[13px] text-error sm:px-5">
                        {error}{" "}
                        <button type="button" onClick={load} className="cursor-pointer border-0 bg-transparent p-0 text-error underline">
                            Retry
                        </button>
                    </p>
                )}
                {note && (
                    <p role={note.ok ? "status" : "alert"} className={`px-4 py-2 text-[13px] sm:px-5 ${note.ok ? "text-success" : "text-error"}`}>
                        {note.text}
                    </p>
                )}
                {!loading && !error && total === 0 && <p className="px-4 py-4 text-[13px] text-base-content/50 sm:px-5">No signed-in devices found.</p>}

                <ul>
                    {devices.map((d) => (
                        <DeviceRow
                            key={d.id}
                            glyph={deviceGlyph(d.deviceType)}
                            name={d.name}
                            current={d.isCurrent}
                            tag={d.legacy ? "Earlier sign-in" : null}
                            meta={[d.browser, d.os].filter(Boolean).join(" · ")}
                            ip={d.ip}
                            active={d.lastActiveAt}>
                            {rename?.rowId === d.id ? (
                                <>
                                    <input
                                        data-autofocus
                                        autoFocus
                                        maxLength={60}
                                        value={rename.value}
                                        onChange={(e) => setRename({ ...rename, value: e.target.value })}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") saveName();
                                            if (e.key === "Escape") setRename(null);
                                        }}
                                        aria-label="Device name"
                                        placeholder="Device name"
                                        className="input input-sm input-bordered w-44"
                                    />
                                    <GhostButton onClick={saveName} disabled={busy}>
                                        Save
                                    </GhostButton>
                                    <GhostButton onClick={() => setRename(null)} disabled={busy}>
                                        Cancel
                                    </GhostButton>
                                </>
                            ) : (
                                <>
                                    {d.renamable && (
                                        <GhostButton onClick={() => setRename({ id: d.deviceIds[0], rowId: d.id, value: d.customName || "" })} disabled={busy}>
                                            <Pencil size={12} /> Rename
                                        </GhostButton>
                                    )}
                                    <DangerButton onClick={() => setConfirm({ kind: "device", target: d })} loading={busy}>
                                        Log out
                                    </DangerButton>
                                </>
                            )}
                        </DeviceRow>
                    ))}
                </ul>
            </Card>

            <SettingsConfirm
                kind="deviceLogout"
                data={{ device: confirm?.target }}
                open={confirm?.kind === "device"}
                onClose={() => !busy && setConfirm(null)}
                loading={busy}
                onConfirm={() => run(() => logoutDevices({ deviceIds: confirm.target.deviceIds, sessionIds: confirm.target.sessionIds }), "Device logged out.")}
            />
            <SettingsConfirm
                kind="deviceLogoutOthers"
                data={{ email: user?.email }}
                open={confirm?.kind === "others"}
                onClose={() => !busy && setConfirm(null)}
                message="Every other device will be signed out of your account. This device stays signed in."
                loading={busy}
                onConfirm={() => run(logoutOtherDevices, "Other devices logged out.")}
            />
        </div>
    );
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

            <SettingsConfirm
                kind="confirmClearAll"
                open={confirm === "all"}
                onClose={() => setConfirm(null)}
                loading={busy}
                onConfirm={doClearAll}
            />
            <SettingsConfirm
                kind="confirmClearSearches"
                open={confirm === "searches"}
                onClose={() => setConfirm(null)}
                onConfirm={doClearSearches}
            />
            <SettingsConfirm
                kind="confirmClearWatchlist"
                data={{ count: wl }}
                open={confirm === "watchlist"}
                onClose={() => setConfirm(null)}
                loading={busy}
                onConfirm={() => clearList(watchlist || [], removeWatchlistItem, "Watchlist")}
            />
            <SettingsConfirm
                kind="confirmClearFavourites"
                data={{ count: fav }}
                open={confirm === "favourites"}
                onClose={() => setConfirm(null)}
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
