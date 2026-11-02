// web/src/dashboard/pages/DashStorage.jsx
// Phase 4 — Storage Provider management page.
// Connect Google Drive / GoFile, browse their folders, import a folder as a Library.
// Local libraries are untouched — still managed from the existing Libraries page.

import { useState, useEffect, useCallback } from "react";
import { Cloud, HardDrive, FolderOpen, ChevronRight, Trash2, Plug, Loader2, FolderPlus, AlertTriangle, CheckCircle, Info, Settings2, Inbox, Search, Unlink, Layers, RefreshCw, Check, Folder } from "lucide-react";
import { storageApi } from "../api/storageApi";
import ConfirmModal, { ModalShell, ModalHeader, ModalContent, ModalSection, ModalRows, ModalKV, ModalCallout, ModalBullets, PANEL, ModalFooter, ModalBadge, ModalButton, MODAL_INPUT } from "../components/ConfirmModal";

// ─── Inline modal (replaces native alert()/confirm()) ──────────────────────

// Copy for the three notice tones. `steps` can be overridden per call through ctx.steps.
const NOTICE = {
    error: {
        icon: AlertTriangle,
        tone: "error",
        text: "text-error",
        title: "Something went wrong",
        badge: "Error",
        rowsLabel: "What you were doing",
        msgLabel: "What happened",
        stepsLabel: "What you can do",
        steps: ["Close this notice and try the action again.", "If it keeps failing, check the provider connection on this page."],
    },
    success: {
        icon: CheckCircle,
        tone: "success",
        text: "text-success",
        title: "Done",
        badge: "Success",
        rowsLabel: "What you did",
        msgLabel: "Result",
        stepsLabel: "What you can do next",
        steps: ["Close this notice to carry on.", "Open the Libraries page to see the result."],
    },
    info: {
        icon: Info,
        tone: "info",
        text: "text-info",
        title: "Heads up",
        badge: "Info",
        rowsLabel: "Where this came from",
        msgLabel: "Information",
        stepsLabel: "What you can do",
        steps: ["Read the information, then close this notice.", "Nothing is needed unless the message says so."],
    },
};

function useAppModal() {
    // { type: 'confirm' | 'notice' | 'prompt', message, tone, ctx, resolve, inputValue }
    // ctx is optional context shown in the dialog: { action, provider, location, steps, subtitle, facts, timeline, note, confirmIcon }
    const [modal, setModal] = useState(null);

    // variant: 'warning' (default) | 'danger' — colours the dialog and its confirm button.
    const confirm = useCallback((message, variant = "warning", ctx = {}) => {
        return new Promise((resolve) => setModal({ type: "confirm", message, variant, ctx, resolve }));
    }, []);

    // tone: 'error' (default) | 'success' | 'info'
    const notify = useCallback((message, tone = "error", ctx = {}) => {
        return new Promise((resolve) => setModal({ type: "notice", message, tone, ctx, resolve }));
    }, []);

    // Resolves to the entered string, or null if cancelled — text-input
    // replacement for native window.prompt().
    const promptText = useCallback((message, defaultValue = "", ctx = {}) => {
        return new Promise((resolve) => setModal({ type: "prompt", message, ctx, resolve, inputValue: defaultValue }));
    }, []);

    function close(result) {
        if (modal?.resolve) modal.resolve(result);
        setModal(null);
    }

    function updateInputValue(value) {
        setModal((m) => (m ? { ...m, inputValue: value } : m));
    }

    let modalElement = null;
    if (modal?.type === "confirm") {
        const c = modal.ctx || {};
        modalElement = (
            <ConfirmModal
                open
                onClose={() => close(false)}
                onConfirm={() => close(true)}
                variant={modal.variant || "warning"}
                title="Please confirm"
                subtitle={c.subtitle}
                factsLabel={c.factsLabel}
                facts={c.facts}
                message={modal.message}
                messageIcon={c.messageIcon}
                timeline={c.timeline}
                note={c.note}
                noteTone={c.noteTone}
                confirmIcon={c.confirmIcon}
                confirmText="Confirm"
            />
        );
    } else if (modal?.type === "notice") {
        const n = NOTICE[modal.tone] || NOTICE.error;
        const c = modal.ctx || {};
        const rows = [
            ["Action", c.action],
            ["Provider", c.provider],
            ["Location", c.location],
        ].filter(([, v]) => v);
        const steps = (c.steps || n.steps).map((text) => ({ text }));
        modalElement = (
            <ModalShell onClose={() => close(false)} labelledBy="storage-app-modal-t">
                <ModalHeader id="storage-app-modal-t" icon={n.icon} tone={n.text} title={n.title} subtitle="Notice" badges={<ModalBadge tone={n.tone}>{n.badge}</ModalBadge>} onClose={() => close(false)} />
                <ModalContent>
                    {rows.length > 0 && (
                        <ModalSection label={n.rowsLabel}>
                            <ModalRows>
                                {rows.map(([k, v]) => (
                                    <ModalKV key={k} label={k}>
                                        {v}
                                    </ModalKV>
                                ))}
                            </ModalRows>
                        </ModalSection>
                    )}
                    <ModalSection label={n.msgLabel}>
                        <ModalCallout tone={n.tone} icon={n.icon}>
                            {modal.message}
                        </ModalCallout>
                    </ModalSection>
                    <ModalSection label={n.stepsLabel} grow>
                        <ModalBullets items={steps} fill />
                    </ModalSection>
                </ModalContent>
                <ModalFooter note="Press Esc or OK to dismiss">
                    <ModalButton data-autofocus onClick={() => close(true)}>
                        OK
                    </ModalButton>
                </ModalFooter>
            </ModalShell>
        );
    } else if (modal?.type === "prompt") {
        const c = modal.ctx || {};
        const name = modal.inputValue.trim();
        modalElement = (
            <ModalShell onClose={() => close(null)} labelledBy="storage-app-modal-t">
                <ModalHeader id="storage-app-modal-t" icon={FolderPlus} tone="text-primary" title="New folder" subtitle="Created in the folder you have open" onClose={() => close(null)} />
                <ModalContent>
                    <ModalSection label="Where it will be created">
                        <ModalRows>
                            <ModalKV label="Provider" icon={Cloud} tone="text-info">
                                {c.provider || "Cloud storage"}
                            </ModalKV>
                            <ModalKV label="Inside">{c.location || "Root"}</ModalKV>
                        </ModalRows>
                    </ModalSection>
                    <ModalSection label={modal.message}>
                        <input
                            id="storage-prompt-input"
                            data-autofocus
                            type="text"
                            placeholder="Folder name"
                            value={modal.inputValue}
                            onChange={(e) => updateInputValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && name) close(name);
                            }}
                            className={`${MODAL_INPUT} !h-11 !border-primary/60`}
                        />
                    </ModalSection>
                    <ModalSection label="How it will look in the list">
                        <div className={`${PANEL} flex h-12 items-center gap-3 px-4`}>
                            <Folder size={16} className="shrink-0 text-info" />
                            <span className={`min-w-0 truncate text-[13px] ${name ? "text-base-content" : "text-base-content/40"}`}>{name || "Folder name"}</span>
                        </div>
                    </ModalSection>
                    <ModalCallout tone="info" compact className="mt-auto">
                        Press Enter to create. Create becomes available once a name is typed.
                    </ModalCallout>
                </ModalContent>
                <ModalFooter note={name ? `Creating “${name}” in ${c.location || "Root"}` : "Type a name to continue"}>
                    <ModalButton onClick={() => close(null)}>Cancel</ModalButton>
                    <ModalButton variant="primary" className="gap-1.5" onClick={() => close(name || null)} disabled={!name}>
                        <FolderPlus size={14} /> Create folder
                    </ModalButton>
                </ModalFooter>
            </ModalShell>
        );
    }

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
        <li className="group flex items-center">
            <button className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-4 py-3 text-left text-[13px] transition-colors hover:bg-base-content/5" onClick={() => onOpen(item)}>
                <Folder size={16} className="shrink-0 text-info" />
                <span className="truncate text-base-content">{item.name}</span>
                {item.shared && <ModalBadge tone="primary">Shared</ModalBadge>}
                {item.writable === false && <ModalBadge>Read-only</ModalBadge>}
                <ChevronRight size={14} className="ml-auto shrink-0 text-base-content/35" />
            </button>
            <button
                onClick={() => onDelete(item)}
                title="Delete folder"
                aria-label={`Delete folder ${item.name}`}
                className="mr-3 grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-base-content/50 transition-colors hover:bg-error/10 hover:text-error">
                <Trash2 size={14} />
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
                <ModalShell onClose={() => setBrowseProvider(null)} labelledBy="storage-browse-t">
                    <ModalHeader
                        id="storage-browse-t"
                        icon={browseProvider === "local" ? HardDrive : Cloud}
                        tone={browseProvider === "gofile" ? "text-accent" : "text-info"}
                        title={`Browse ${providerName(browseProvider)}`}
                        subtitle="Pick a folder to import as a library"
                        onClose={() => setBrowseProvider(null)}
                    />
                    <ModalContent>
                        {/* Breadcrumbs + new folder */}
                        <div className="flex shrink-0 items-stretch gap-3">
                            <nav aria-label="Folder path" className={`${PANEL} flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-1 px-2 text-[13px]`}>
                                <button
                                    className={`cursor-pointer rounded-md px-2.5 py-1.5 transition-colors ${breadcrumbs.length === 0 ? "bg-base-200 text-base-content" : "text-base-content/65 hover:bg-base-content/10 hover:text-base-content"}`}
                                    onClick={() => jumpTo(-1)}>
                                    Root
                                </button>
                                {breadcrumbs.map((b, i) => (
                                    <span key={b.ref} className="flex items-center gap-1">
                                        <ChevronRight size={12} className="text-base-content/40" />
                                        <button
                                            className={`cursor-pointer rounded-md px-2.5 py-1.5 transition-colors ${i === breadcrumbs.length - 1 ? "bg-base-200 text-base-content" : "text-base-content/65 hover:bg-base-content/10 hover:text-base-content"}`}
                                            onClick={() => jumpTo(i)}>
                                            {b.name}
                                        </button>
                                    </span>
                                ))}
                            </nav>
                            <ModalButton className="h-auto min-h-11 gap-2 px-4" onClick={createFolderHere} title={breadcrumbs.length === 0 ? "Open a folder first" : "New folder"}>
                                <FolderPlus size={14} /> {breadcrumbs.length === 0 ? "Open a folder first" : "New folder"}
                            </ModalButton>
                        </div>

                        <ModalSection label="Folders" hint={browsing ? "loading" : `${browseItems.length} here`} grow>
                            <div className={`${PANEL} min-h-0 flex-1 overflow-y-auto`}>
                                {browsing ? (
                                    <div className="space-y-1 p-2">
                                        {[0, 1, 2, 3].map((i) => (
                                            <div key={i} className="h-11 animate-pulse rounded-md bg-base-content/5" style={{ animationDelay: `${i * 100}ms` }} />
                                        ))}
                                    </div>
                                ) : browseItems.length === 0 ? (
                                    <EmptyState icon={Inbox} title="No subfolders here" hint="Use New folder to make one, or import this folder as it is." />
                                ) : browseProvider === "gdrive" && breadcrumbs.length === 0 ? (
                                    // Root of a Google Drive browse — group into My Drive / Shared with
                                    // me / Shared drives per GDRIVE_SECTIONS. Any deeper level is a
                                    // normal single folder listing and falls through to the flat branch.
                                    (() => {
                                        const groups = groupBySection(browseItems);
                                        return (
                                            <div className="divide-y divide-base-content/10">
                                                {GDRIVE_SECTIONS.map(({ key, label }) => (
                                                    <div key={key}>
                                                        <p className="bg-base-content/5 px-4 py-2 text-xs text-base-content/65">{label}</p>
                                                        {groups[key].length === 0 ? (
                                                            <p className="px-4 py-3.5 text-[13px] text-base-content/50">
                                                                {key === "shared_drive" ? "No Shared Drives available." : key === "shared_with_me" ? "No folders shared with you." : "Empty."}
                                                            </p>
                                                        ) : (
                                                            <ul className="divide-y divide-base-content/10">
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
                                    <ul className="divide-y divide-base-content/10">
                                        {browseItems.map((item) => (
                                            <FolderRow key={item.ref} item={item} onOpen={openFolder} onDelete={deleteBrowseFolder} />
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </ModalSection>

                        {breadcrumbs.length > 0 && breadcrumbs[breadcrumbs.length - 1]?.writable === false && (
                            <ModalCallout tone="warning" icon={AlertTriangle} compact>
                                Read-only — you can import this folder, but FLUX won't be able to upload into it.
                            </ModalCallout>
                        )}

                        <ModalSection label="Library label">
                            <input
                                id="storage-import-label"
                                type="text"
                                placeholder="Library label"
                                className={`${MODAL_INPUT} !h-11 ${importLabel ? "!border-primary/60" : ""}`}
                                value={importLabel}
                                onChange={(e) => setImportLabel(e.target.value)}
                            />
                        </ModalSection>
                    </ModalContent>
                    <ModalFooter note={breadcrumbs.length > 0 ? `Importing “${breadcrumbs[breadcrumbs.length - 1].name}”` : "Open a folder to enable import"}>
                        <ModalButton onClick={() => setBrowseProvider(null)}>Cancel</ModalButton>
                        <ModalButton variant="primary" className="gap-1.5" disabled={breadcrumbs.length === 0} onClick={importCurrentFolder}>
                            <FolderPlus size={14} /> Import this folder
                        </ModalButton>
                    </ModalFooter>
                </ModalShell>
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
