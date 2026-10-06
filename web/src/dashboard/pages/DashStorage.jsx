// web/src/dashboard/pages/DashStorage.jsx
// Phase 4 — Storage Provider management page.
// Connect Google Drive / GoFile, browse their folders, import a folder as a Library.
// Local libraries are untouched — still managed from the existing Libraries page.

import { useState, useEffect, useCallback } from "react";
import { Cloud, HardDrive, X, FolderOpen, ChevronRight, Trash2, Plug, Loader2, FolderPlus, AlertTriangle, CheckCircle, Info, Settings2, Inbox, Search } from "lucide-react";
import { storageApi } from "../api/storageApi";

// ─── Inline modal (replaces native alert()/confirm()) ──────────────────────
function useAppModal() {
    const [modal, setModal] = useState(null); // { type: 'confirm' | 'notice' | 'prompt', message, tone, resolve, inputValue }

    const confirm = useCallback((message) => {
        return new Promise((resolve) => setModal({ type: "confirm", message, resolve }));
    }, []);

    // tone: 'error' (default) | 'success' | 'info'
    const notify = useCallback((message, tone = "error") => {
        return new Promise((resolve) => setModal({ type: "notice", message, tone, resolve }));
    }, []);

    // Resolves to the entered string, or null if cancelled — text-input
    // replacement for native window.prompt().
    const promptText = useCallback((message, defaultValue = "") => {
        return new Promise((resolve) => setModal({ type: "prompt", message, resolve, inputValue: defaultValue }));
    }, []);

    function close(result) {
        if (modal?.resolve) modal.resolve(result);
        setModal(null);
    }

    function updateInputValue(value) {
        setModal((m) => (m ? { ...m, inputValue: value } : m));
    }

    const ToneIcon = modal?.tone === "success" ? CheckCircle : modal?.tone === "info" ? Info : AlertTriangle;
    const toneClass = modal?.tone === "success" ? "text-success" : modal?.tone === "info" ? "text-primary" : "text-error";

    const modalElement = modal ? (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 p-4" onClick={() => close(modal.type === "prompt" ? null : false)}>
            <div className="bg-base-200 rounded-md shadow-xl w-full max-w-sm border border-base-content/10" onClick={(e) => e.stopPropagation()}>
                <div className="p-5 space-y-4">
                    <div className="flex items-start gap-3">
                        {modal.type === "notice" && <ToneIcon size={20} className={`${toneClass} shrink-0 mt-0.5`} />}
                        <p className="text-sm text-base-content/100 leading-relaxed">{modal.message}</p>
                    </div>
                    {modal.type === "prompt" && (
                        <input
                            autoFocus
                            type="text"
                            value={modal.inputValue}
                            onChange={(e) => updateInputValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && modal.inputValue.trim()) close(modal.inputValue.trim());
                                if (e.key === "Escape") close(null);
                            }}
                            className="input input-sm input-bordered bg-base-300 w-full rounded-md"
                        />
                    )}
                    <div className="flex justify-end gap-2">
                        {(modal.type === "confirm" || modal.type === "prompt") && (
                            <button onClick={() => close(modal.type === "prompt" ? null : false)} className="btn btn-sm btn-ghost rounded-md border-none outline-none focus:outline-none">
                                Cancel
                            </button>
                        )}
                        <button
                            onClick={() => close(modal.type === "prompt" ? modal.inputValue.trim() || null : true)}
                            disabled={modal.type === "prompt" && !modal.inputValue.trim()}
                            className={`btn btn-sm rounded-md border-none outline-none focus:outline-none disabled:opacity-40 ${modal.type === "notice" ? "btn-neutral" : "btn-primary"}`}>
                            {modal.type === "notice" ? "OK" : "Confirm"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    ) : null;

    return { modalElement, confirm, notify, promptText };
}

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

// Root-level Google Drive browse items carry a `section` tag (see
// GoogleDriveProvider.js listLibraries()) so this page can group them under
// three headers without changing the flat-array contract every other
// provider (GoFile, and gdrive itself below the root) already relies on.
const GDRIVE_SECTIONS = [
    { key: "my_drive", label: "My Drive" },
    { key: "shared_with_me", label: "Shared with me" },
    { key: "shared_drive", label: "Shared drives" },
];

function groupBySection(items) {
    const groups = { my_drive: [], shared_with_me: [], shared_drive: [] };
    for (const item of items) {
        (groups[item.section] || groups.my_drive).push(item);
    }
    return groups;
}

// Single folder row — shared by the flat list (subfolders, GoFile) and the
// grouped root-level Google Drive sections below, so both render identically.
function FolderRow({ item, onOpen, onDelete }) {
    return (
        <li className="flex items-center group">
            <button className="flex-1 flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-base-content/5 text-sm min-w-0 transition-colors" onClick={() => onOpen(item)}>
                <FolderOpen size={14} className="text-primary/85 shrink-0" />
                <span className="truncate text-base-content/92">{item.name}</span>
                {item.shared && <span className="shrink-0 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-semibold">Shared</span>}
                {item.writable === false && <span className="shrink-0 px-1.5 py-0.5 rounded bg-base-content/8 text-base-content/60 text-[10px] font-semibold">Read-only</span>}
            </button>
            <button
                onClick={() => onDelete(item)}
                title="Delete folder"
                className="w-8 h-8 shrink-0 mr-1 rounded-md flex items-center justify-center text-base-content/54 border-none outline-none hover:bg-error/15 hover:text-error transition-colors opacity-0 group-hover:opacity-100">
                <Trash2 size={13} />
            </button>
        </li>
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
    const { modalElement, confirm: confirmModal, notify, promptText } = useAppModal();
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
            await notify(`GoFile connect failed: ${err.message || err}`);
        }
        setConnecting(null);
    }

    async function connectGoogleDrive() {
        setConnecting("gdrive");
        try {
            const { authUrl } = await storageApi.getGoogleDriveAuthUrl();
            window.location.href = authUrl; // hand off to Google's consent screen
        } catch (err) {
            await notify(`Google Drive isn't configured yet: ${err.message || err}`);
            setConnecting(null);
        }
    }

    async function disconnect(type) {
        const ok = await confirmModal(`Disconnect ${type}? Imported libraries from it will stop working until reconnected.`);
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
            await notify(`Browse failed: ${err.message || err}`);
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
            await notify(`Browse failed: ${err.message || err}`);
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
            await notify(`Browse failed: ${err.message || err}`);
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
            await notify(`Browse failed: ${err.message || err}`);
        }
        setBrowsing(false);
    }

    async function createFolderHere() {
        const parentRef = currentBrowseRef();
        if (!parentRef) {
            await notify("Open a folder first — new folders need somewhere to go, they can't be created at this top level.");
            return;
        }
        const name = await promptText("New folder name:");
        if (!name) return;
        try {
            await storageApi.createCloudFolder(browseProvider, parentRef, name);
            await refreshBrowse();
        } catch (err) {
            await notify(`Create folder failed: ${err.message || err}`);
        }
    }

    async function deleteBrowseFolder(item) {
        const ok = await confirmModal(`Delete folder "${item.name}"? This deletes everything inside it too — permanently.`);
        if (!ok) return;
        try {
            await storageApi.deleteCloudFile(browseProvider, item.ref);
            await refreshBrowse();
        } catch (err) {
            await notify(`Delete failed: ${err.message || err}`);
        }
    }

    async function importCurrentFolder() {
        const current = breadcrumbs[breadcrumbs.length - 1];
        if (!current) {
            await notify("Open a folder first — the root itself can't be imported.");
            return;
        }
        try {
            await storageApi.importLibrary(browseProvider, current.ref, importLabel || current.name);
            setBrowseProvider(null);
            await loadAll();
        } catch (err) {
            await notify(`Import failed: ${err.message || err}`);
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
            await notify(`Import failed: ${err.message || err}`);
        }
        setManualImporting(false);
    }

    async function removeCloudLibrary(id) {
        const ok = await confirmModal("Remove this cloud library? Files stay on the provider, only the Library link is removed.");
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
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setBrowseProvider(null)}>
                    <div className="card bg-base-200 shadow-2xl border border-base-content/10 w-full max-w-lg max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                        <div className="card-body py-4 gap-3 overflow-hidden flex flex-col">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2.5">
                                    <div className={`w-8 h-8 rounded-md flex items-center justify-center ${(PROVIDER_META[browseProvider] || PROVIDER_META.local).tint}`}>
                                        <ProviderIcon type={browseProvider} size={15} />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-base-content/96 text-sm leading-tight">Browse {(PROVIDER_META[browseProvider] || {}).name || browseProvider}</h3>
                                        <p className="text-[11px] text-base-content/66">Pick a folder to import as a library</p>
                                    </div>
                                </div>
                                <button className="btn btn-ghost btn-xs btn-square rounded-md" onClick={() => setBrowseProvider(null)}>
                                    <X size={14} />
                                </button>
                            </div>

                            {/* Breadcrumbs */}
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex items-center gap-1 text-xs text-base-content/78 flex-wrap">
                                    <button className="px-1.5 py-0.5 rounded hover:text-primary hover:bg-primary/10 transition-colors" onClick={() => jumpTo(-1)}>
                                        Root
                                    </button>
                                    {breadcrumbs.map((b, i) => (
                                        <span key={b.ref} className="flex items-center gap-1">
                                            <ChevronRight size={11} className="text-base-content/50" />
                                            <button className="px-1.5 py-0.5 rounded hover:text-primary hover:bg-primary/10 transition-colors" onClick={() => jumpTo(i)}>
                                                {b.name}
                                            </button>
                                        </span>
                                    ))}
                                </div>
                                <button
                                    onClick={createFolderHere}
                                    title={breadcrumbs.length === 0 ? "Open a folder first" : "New folder"}
                                    className="btn btn-xs btn-ghost gap-1 rounded-md text-base-content/70 hover:text-primary">
                                    <FolderPlus size={12} /> New Folder
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto border border-base-content/10 rounded-md bg-base-300/30">
                                {browsing ? (
                                    <div className="space-y-1 p-2">
                                        {[0, 1, 2].map((i) => (
                                            <div key={i} className="h-9 rounded-md bg-base-content/5 animate-pulse" style={{ animationDelay: `${i * 100}ms` }} />
                                        ))}
                                    </div>
                                ) : browseItems.length === 0 ? (
                                    <EmptyState icon={Inbox} title="No subfolders here" />
                                ) : browseProvider === "gdrive" && breadcrumbs.length === 0 ? (
                                    // Root of a Google Drive browse — group into My Drive / Shared with
                                    // me / Shared drives per GDRIVE_SECTIONS. Any deeper level (inside
                                    // My Drive, inside a shared folder, inside a Shared Drive) is a
                                    // normal single folder listing and falls through to the flat branch
                                    // below, same as before this change.
                                    (() => {
                                        const groups = groupBySection(browseItems);
                                        return (
                                            <div className="divide-y divide-base-content/5">
                                                {GDRIVE_SECTIONS.map(({ key, label }) => (
                                                    <div key={key}>
                                                        <p className="px-3 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-wide text-base-content/50">{label}</p>
                                                        {groups[key].length === 0 ? (
                                                            <p className="px-3 pb-2.5 text-xs text-base-content/50">
                                                                {key === "shared_drive" ? "No Shared Drives available." : key === "shared_with_me" ? "No folders shared with you." : "Empty."}
                                                            </p>
                                                        ) : (
                                                            <ul className="divide-y divide-base-content/5">
                                                                {groups[key].map((item) => (
                                                                    <FolderRow key={item.ref} item={item} onOpen={openFolder} onDelete={deleteBrowseFolder} />
                                                                ))}
                                                            </ul>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    })()
                                ) : (
                                    <ul className="divide-y divide-base-content/5">
                                        {browseItems.map((item) => (
                                            <FolderRow key={item.ref} item={item} onOpen={openFolder} onDelete={deleteBrowseFolder} />
                                        ))}
                                    </ul>
                                )}
                            </div>

                            {breadcrumbs.length > 0 && breadcrumbs[breadcrumbs.length - 1]?.writable === false && (
                                <p className="text-[11px] text-warning flex items-center gap-1.5">
                                    <AlertTriangle size={12} className="shrink-0" /> Read-only — you can import this folder, but FLUX won't be able to upload into it.
                                </p>
                            )}

                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="Library label"
                                    className="input input-sm input-bordered bg-base-300 rounded-md flex-1 focus:outline-none"
                                    value={importLabel}
                                    onChange={(e) => setImportLabel(e.target.value)}
                                />
                                <button className="btn btn-sm btn-primary gap-1.5 rounded-md" disabled={breadcrumbs.length === 0} onClick={importCurrentFolder}>
                                    <FolderPlus size={13} /> Import this folder
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
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
