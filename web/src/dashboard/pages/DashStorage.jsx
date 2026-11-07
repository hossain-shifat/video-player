// web/src/Dashboard/Pages/DashStorage.jsx
// Phase 4 — Storage Provider management page.
// Connect Google Drive / GoFile, browse their folders, import a folder as a Library.
// Local libraries are untouched — still managed from the existing Libraries page.

import { useState, useEffect, useCallback } from "react";
import {
    Cloud,
    HardDrive,
    FolderOpen,
    Trash2,
    Plug,
    Loader2,
    FolderPlus,
    Info,
    Settings2,
    Search,
    Unlink,
    Layers,
    RefreshCw,
    Check,
    Folder,
} from "lucide-react";
import { storageApi } from "../Api/storageApi";
import { StorageBrowseModal, useAppModal } from "../Components/DashModal";

// ─── Small presentational helpers ───────────────────────────────────────────

const PROVIDER_META = {
    local: { name: "Local", tint: "bg-base-content/10 text-base-content/85" },
    gdrive: { name: "Google Drive", tint: "bg-primary/10 text-primary" },
    gofile: { name: "GoFile", tint: "bg-accent/15 text-accent" },
};

function ProviderIcon({ type, size = 18 }) {
    if (type === "local") return <HardDrive size={size} />;
    return <Cloud size={size} />;
}

// Dot + label pattern, matching the rest of the dashboard's status styling.
function StatusPill({ connected }) {
    return connected ? (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-success/10 text-success text-xs font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-success" />
            Connected
        </span>
    ) : (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-base-content/8 text-base-content/70 text-xs font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-base-content/30" />
            Not connected
        </span>
    );
}

function EmptyState({ icon: Icon, title, hint }) {
    return (
        <div className="flex flex-col items-center justify-center gap-2 py-12 px-6 text-center">
            <div className="w-11 h-11 rounded-full bg-base-content/5 flex items-center justify-center">
                <Icon size={18} className="text-base-content/58" />
            </div>
            <p className="text-sm font-medium text-base-content/78">{title}</p>
            {hint && <p className="text-xs text-base-content/62 max-w-xs">{hint}</p>}
        </div>
    );
}

function fmtRelativeDate(iso) {
    const d = new Date(iso);
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 30) return `${days}d ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function DashStorage() {
    const { modalElement, confirm: confirmModal, notify, promptText } = useAppModal("storage");
    const [providers, setProviders] = useState([]);
    const [loadingProviders, setLoadingProviders] = useState(true);
    const [cloudLibraries, setCloudLibraries] = useState([]);

    // Connect forms
    const [gofileToken, setGofileToken] = useState("");
    const [connecting, setConnecting] = useState(null); // 'gofile' | 'gdrive' | null

    // Browse/import state
    const [browseProvider, setBrowseProvider] = useState(null); // 'gdrive' | 'gofile'
    const [breadcrumbs, setBreadcrumbs] = useState([]); // [{name, ref}]
    const [browseItems, setBrowseItems] = useState([]);
    const [browsing, setBrowsing] = useState(false);
    const [importLabel, setImportLabel] = useState("");

    // Context shown inside notice / confirm / prompt dialogs.
    const providerName = (type) => (PROVIDER_META[type] || {}).name || type || "Storage";
    const hereText = (crumbs = breadcrumbs) => (crumbs.length ? crumbs.map((b) => b.name).join(" › ") : "Root");
    const hereCtx = (action, extra = {}) => ({ action, provider: providerName(browseProvider), location: hereText(), ...extra });

    // GoFile free-tier fallback — /contents/{id} (listFolders/browse) is
    // Premium-gated on GoFile's side ("error-notPremium"). Free accounts can
    // still upload into a known folder id, so this bypasses browse entirely:
    // paste the folder id from the GoFile web UI and import it directly.
    const [manualRef, setManualRef] = useState("");
    const [manualLabel, setManualLabel] = useState("");
    const [manualImporting, setManualImporting] = useState(false);

    const loadAll = useCallback(async () => {
        setLoadingProviders(true);
        try {
            const [p, l] = await Promise.all([storageApi.providers(), storageApi.cloudLibraries()]);
            setProviders(p.providers || []);
            setCloudLibraries(l.libraries || []);
        } catch (err) {
            console.error("Failed to load storage state", err);
        }
        setLoadingProviders(false);
    }, []);

    useEffect(() => {
        loadAll();
        // If redirected back from Google OAuth callback
        if (new URLSearchParams(window.location.search).get("gdrive") === "connected") {
            window.history.replaceState({}, "", window.location.pathname);
        }
    }, [loadAll]);

    async function connectGoFile() {
        if (!gofileToken.trim()) return;
        setConnecting("gofile");
        try {
            await storageApi.connectGoFile(gofileToken.trim());
            setGofileToken("");
            await loadAll();
        } catch (err) {
            await notify(`GoFile connect failed: ${err.message || err}`, "error", { action: "Connect GoFile", provider: "GoFile", location: "Storage page", steps: ["Check the API token and paste it again.", "Copy the token from your GoFile profile page."] });
        }
        setConnecting(null);
    }

    async function connectGoogleDrive() {
        setConnecting("gdrive");
        try {
            const { authUrl } = await storageApi.getGoogleDriveAuthUrl();
            window.location.href = authUrl; // hand off to Google's consent screen
        } catch (err) {
            await notify(`Google Drive isn't configured yet: ${err.message || err}`, "error", { action: "Connect Google Drive", provider: "Google Drive", location: "Storage page", steps: ["Add the Google Drive client id, secret and redirect URI to server/.env.", "Restart the server, then press Connect again."] });
            setConnecting(null);
        }
    }

    async function disconnect(type) {
        const imported = cloudLibraries.filter((l) => l.provider === type).length;
        const ok = await confirmModal(`Disconnect ${type}? Imported libraries from it will stop working until reconnected.`, "warning", {
            subtitle: "Disconnect a provider",
            factsLabel: "You are about to disconnect",
            messageIcon: Unlink,
            facts: [
                { label: "Provider", icon: Cloud, tone: "text-info", value: type },
                { label: "Status", value: "Connected", tone: "text-success" },
                { label: "Libraries", value: `${imported} imported from it` },
            ],
            timeline: [
                { icon: Layers, tone: "text-warning", title: "Libraries stop working", text: "Libraries imported from this provider are unavailable." },
                { icon: RefreshCw, tone: "text-success", title: "Reconnect any time", text: "They work again once you reconnect." },
            ],
        });
        if (!ok) return;
        await storageApi.disconnectProvider(type);
        await loadAll();
    }

    async function startBrowse(type) {
        setBrowseProvider(type);
        setBreadcrumbs([]);
        setImportLabel("");
        setBrowsing(true);
        try {
            const { items } = await storageApi.browse(type);
            setBrowseItems(items);
        } catch (err) {
            await notify(`Browse failed: ${err.message || err}`, "error", { action: "Browse folder", provider: providerName(type), location: "Root" });
        }
        setBrowsing(false);
    }

    async function openFolder(item) {
        setBrowsing(true);
        try {
            const { items } = await storageApi.browse(browseProvider, item.ref);
            setBreadcrumbs((b) => [...b, item]);
            setBrowseItems(items);
            setImportLabel(item.name);
        } catch (err) {
            await notify(`Browse failed: ${err.message || err}`, "error", hereCtx("Browse folder", { location: hereText([...breadcrumbs, item]) }));
        }
        setBrowsing(false);
    }

    async function jumpTo(index) {
        setBrowsing(true);
        try {
            if (index < 0) {
                const { items } = await storageApi.browse(browseProvider);
                setBreadcrumbs([]);
                setBrowseItems(items);
                setImportLabel("");
            } else {
                const target = breadcrumbs[index];
                const { items } = await storageApi.browse(browseProvider, target.ref);
                setBreadcrumbs(breadcrumbs.slice(0, index + 1));
                setBrowseItems(items);
                setImportLabel(target.name);
            }
        } catch (err) {
            await notify(`Browse failed: ${err.message || err}`, "error", hereCtx("Browse folder"));
        }
        setBrowsing(false);
    }

    function currentBrowseRef() {
        return breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1].ref : null;
    }

    async function refreshBrowse() {
        setBrowsing(true);
        try {
            const ref = currentBrowseRef();
            const { items } = await storageApi.browse(browseProvider, ref || undefined);
            setBrowseItems(items);
        } catch (err) {
            await notify(`Browse failed: ${err.message || err}`, "error", hereCtx("Refresh folder"));
        }
        setBrowsing(false);
    }

    async function createFolderHere() {
        const parentRef = currentBrowseRef();
        if (!parentRef) {
            await notify("Open a folder first — new folders need somewhere to go, they can't be created at this top level.", "error", hereCtx("Create folder", { steps: ["Close this notice and open a folder from the list.", "Choose New folder again."] }));
            return;
        }
        const name = await promptText("New folder name:", "", { provider: providerName(browseProvider), location: hereText() });
        if (!name) return;
        try {
            await storageApi.createCloudFolder(browseProvider, parentRef, name);
            await refreshBrowse();
        } catch (err) {
            await notify(`Create folder failed: ${err.message || err}`, "error", hereCtx("Create folder"));
        }
    }

    async function deleteBrowseFolder(item) {
        const ok = await confirmModal(`Delete folder "${item.name}"? This deletes everything inside it too — permanently.`, "danger", {
            subtitle: "Delete a folder",
            factsLabel: "You are about to delete",
            confirmIcon: Trash2,
            facts: [
                { label: "Folder", icon: Folder, tone: "text-info", value: item.name },
                { label: "Provider", value: providerName(browseProvider) },
                { label: "Location", value: hereText() },
            ],
            timeline: [
                { icon: FolderOpen, tone: "text-error", title: "Contents go too", text: `Everything inside “${item.name}” is deleted with it.` },
                { icon: Trash2, tone: "text-error", title: "No way back", text: "The deletion is permanent." },
            ],
            note: "This action cannot be undone.",
            noteTone: "error",
        });
        if (!ok) return;
        try {
            await storageApi.deleteCloudFile(browseProvider, item.ref);
            await refreshBrowse();
        } catch (err) {
            await notify(`Delete failed: ${err.message || err}`, "error", hereCtx("Delete folder"));
        }
    }

    async function importCurrentFolder() {
        const current = breadcrumbs[breadcrumbs.length - 1];
        if (!current) {
            await notify("Open a folder first — the root itself can't be imported.", "error", hereCtx("Import folder", { steps: ["Close this notice and open the folder you want.", "Press Import this folder again."] }));
            return;
        }
        try {
            await storageApi.importLibrary(browseProvider, current.ref, importLabel || current.name);
            setBrowseProvider(null);
            await loadAll();
        } catch (err) {
            await notify(`Import failed: ${err.message || err}`, "error", hereCtx("Import folder"));
        }
    }

    // Manual import — used when browse/listFolders is unavailable (GoFile free tier).
    async function importManualFolder(provider) {
        if (!manualRef.trim()) return;
        setManualImporting(true);
        try {
            await storageApi.importLibrary(provider, manualRef.trim(), manualLabel.trim() || manualRef.trim());
            setManualRef("");
            setManualLabel("");
            await loadAll();
        } catch (err) {
            await notify(`Import failed: ${err.message || err}`, "error", { action: "Import folder by ID", provider: providerName(provider), location: manualRef.trim() });
        }
        setManualImporting(false);
    }

    async function removeCloudLibrary(id) {
        const lib = cloudLibraries.find((l) => l.id === id);
        const ok = await confirmModal("Remove this cloud library? Files stay on the provider, only the Library link is removed.", "warning", {
            subtitle: "Remove a cloud library",
            factsLabel: "You are about to remove",
            messageIcon: Cloud,
            facts: [
                { label: "Library", value: lib?.label || "Cloud library" },
                { label: "Provider", icon: Cloud, tone: "text-info", value: providerName(lib?.provider) },
                { label: "Type", value: "Cloud library" },
            ],
            timeline: [
                { icon: Layers, tone: "text-warning", title: "Link removed", text: "The library link is removed from FLUX." },
                { icon: Check, tone: "text-success", title: "Files stay put", text: `Files stay on ${providerName(lib?.provider)}.` },
            ],
            note: "Nothing on the provider is deleted.",
            noteTone: "success",
        });
        if (!ok) return;
        await storageApi.removeLibrary(id);
        await loadAll();
    }

    return (
        <div className="space-y-6 [&_button]:outline-none [&_button]:focus:outline-none [&_button]:focus-visible:outline-none [&_button]:active:outline-none [&_button]:border-none">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <Settings2 size={19} className="text-primary" />
                </div>
                <div>
                    <h1 className="text-xl font-bold text-base-content tracking-tight">Storage</h1>
                    <p className="text-sm text-base-content/78">Connect cloud storage and import folders as libraries</p>
                </div>
            </div>

            {/* Provider cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {loadingProviders && (
                    <div className="col-span-full flex justify-center py-10">
                        <Loader2 className="animate-spin text-base-content/62" size={22} />
                    </div>
                )}

                {!loadingProviders &&
                    providers.map((p) => {
                        const meta = PROVIDER_META[p.type] || PROVIDER_META.local;
                        return (
                            <div key={p.type} className="card bg-base-200 shadow-sm border border-base-content/5 overflow-hidden">
                                <div className="card-body py-4 gap-3.5">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-center gap-2.5">
                                            <div className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 ${meta.tint}`}>
                                                <ProviderIcon type={p.type} size={17} />
                                            </div>
                                            <span className="font-semibold text-base-content/96 text-[15px]">{p.label}</span>
                                        </div>
                                        <StatusPill connected={p.connected} />
                                    </div>

                                    {p.type === "local" && <p className="text-xs text-base-content/70 leading-relaxed">Always available — managed on the Libraries page.</p>}

                                    {p.type === "gofile" && !p.connected && (
                                        <div className="flex gap-2">
                                            <input
                                                type="password"
                                                placeholder="GoFile API token"
                                                className="input input-sm input-bordered bg-base-300 rounded-md flex-1 focus:outline-none"
                                                value={gofileToken}
                                                onChange={(e) => setGofileToken(e.target.value)}
                                            />
                                            <button className="btn btn-sm btn-primary rounded-md" disabled={connecting === "gofile"} onClick={connectGoFile}>
                                                {connecting === "gofile" ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />}
                                            </button>
                                        </div>
                                    )}

                                    {p.type === "gdrive" && !p.connected && (
                                        <div className="space-y-2.5">
                                            <div className="flex gap-2 px-2.5 py-2 rounded-md bg-base-300/70 border border-base-content/5">
                                                <Info size={13} className="text-base-content/62 shrink-0 mt-0.5" />
                                                <p className="text-[11px] text-base-content/74 leading-relaxed">
                                                    Set <code className="font-mono text-base-content/85">GOOGLE_DRIVE_CLIENT_ID</code>, <code className="font-mono text-base-content/85">GOOGLE_DRIVE_CLIENT_SECRET</code>, and{" "}
                                                    <code className="font-mono text-base-content/85">GOOGLE_DRIVE_REDIRECT_URI</code> in <code className="font-mono text-base-content/85">server/.env</code>, restart the server, then connect below.
                                                </p>
                                            </div>
                                            <button className="btn btn-sm btn-primary w-full gap-1.5 rounded-md" disabled={connecting === "gdrive"} onClick={connectGoogleDrive}>
                                                {connecting === "gdrive" ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />}
                                                Connect Google Drive
                                            </button>
                                        </div>
                                    )}

                                    {p.connected && p.type !== "local" && (
                                        <div className="space-y-2.5">
                                            <div className="flex gap-2">
                                                <button className="btn btn-sm btn-outline flex-1 gap-1.5 rounded-md" onClick={() => startBrowse(p.type)}>
                                                    <FolderPlus size={13} /> Browse &amp; Import
                                                </button>
                                                <button className="btn btn-sm btn-ghost text-base-content/62 hover:text-error hover:bg-error/10 rounded-md" onClick={() => disconnect(p.type)} title="Disconnect">
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>

                                            {p.type === "gofile" && (
                                                <div className="pt-2.5 border-t border-base-content/8 space-y-1.5">
                                                    <p className="text-[11px] text-base-content/70 leading-relaxed">Free GoFile accounts can't browse folders (Premium-only). Paste a folder ID from the GoFile web UI instead.</p>
                                                    <input
                                                        type="text"
                                                        placeholder="Folder ID"
                                                        className="input input-xs input-bordered bg-base-300 rounded-md w-full font-mono focus:outline-none"
                                                        value={manualRef}
                                                        onChange={(e) => setManualRef(e.target.value)}
                                                    />
                                                    <div className="flex gap-2">
                                                        <input
                                                            type="text"
                                                            placeholder="Library label (optional)"
                                                            className="input input-xs input-bordered bg-base-300 rounded-md flex-1 focus:outline-none"
                                                            value={manualLabel}
                                                            onChange={(e) => setManualLabel(e.target.value)}
                                                        />
                                                        <button className="btn btn-xs btn-primary gap-1 rounded-md" disabled={manualImporting || !manualRef.trim()} onClick={() => importManualFolder(p.type)}>
                                                            {manualImporting ? <Loader2 size={12} className="animate-spin" /> : <FolderPlus size={12} />}
                                                            Import
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
            </div>

            {/* Browse/import modal */}
            {browseProvider && (
                <StorageBrowseModal
                    setBrowseProvider={setBrowseProvider}
                    browseProvider={browseProvider}
                    providerName={providerName}
                    breadcrumbs={breadcrumbs}
                    jumpTo={jumpTo}
                    createFolderHere={createFolderHere}
                    browsing={browsing}
                    browseItems={browseItems}
                    openFolder={openFolder}
                    deleteBrowseFolder={deleteBrowseFolder}
                    importLabel={importLabel}
                    setImportLabel={setImportLabel}
                    importCurrentFolder={importCurrentFolder}
                />
            )}

            {/* Imported cloud libraries */}
            <div className="card bg-base-200 shadow-sm border border-base-content/5">
                <div className="px-5 py-3.5 border-b border-base-content/5 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-base-content/88">Cloud Libraries</h3>
                    <span className="px-1.5 py-0.5 rounded-md bg-base-content/8 text-base-content/70 text-[10px] font-black tabular-nums">{cloudLibraries.length}</span>
                </div>
                {cloudLibraries.length === 0 ? (
                    <EmptyState icon={Search} title="No cloud libraries imported yet" hint="Connect a provider above, then Browse & Import a folder to add one." />
                ) : (
                    <ul className="divide-y divide-base-content/5">
                        {cloudLibraries.map((lib) => {
                            const meta = PROVIDER_META[lib.provider] || PROVIDER_META.local;
                            return (
                                <li key={lib.id} className="flex items-center gap-3 px-5 py-3 hover:bg-base-content/[0.02] transition-colors">
                                    <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${meta.tint}`}>
                                        <ProviderIcon type={lib.provider} size={14} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm text-base-content/92 truncate font-medium flex items-center gap-1.5">
                                            {lib.label}
                                            {lib.shared && <span className="shrink-0 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-semibold">Shared</span>}
                                        </p>
                                        <p className="text-xs text-base-content/66">
                                            {meta.name} · added {fmtRelativeDate(lib.addedAt)}
                                        </p>
                                    </div>
                                    <button className="btn btn-ghost btn-xs btn-square text-base-content/58 hover:text-error hover:bg-error/10 rounded-md" onClick={() => removeCloudLibrary(lib.id)} title="Remove library">
                                        <Trash2 size={14} />
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
            {modalElement}
        </div>
    );
}
