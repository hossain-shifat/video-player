import { useState } from "react";
import { Trash2, History, Download, Globe, Activity } from "lucide-react";
import { Card, Row, Toggle, Modal } from "./shared";
import { clearHistory } from "../../api";

function SubSection({ title, icon: Icon, children }) {
    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2.5">
                <span className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/[0.06] text-primary shrink-0">
                    <Icon size={14} />
                </span>
                <span className="text-sm font-semibold text-white">{title}</span>
            </div>
            <div>{children}</div>
        </div>
    );
}

export default function PrivacySection({ prefs, setPref }) {
    const [clearModalOpen, setClearModalOpen] = useState(false);
    const [clearing, setClearing] = useState(false);
    const [cleared, setCleared] = useState(false);
    const [exportLoading, setExportLoading] = useState(false);

    async function handleClearLocalData() {
        setClearing(true);
        try {
            // Clear server watch history
            await clearHistory().catch(() => {});

            // Clear all local flux-related keys
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && (key.startsWith("flux-") || key.startsWith("progress-") || key.startsWith("search-"))) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach((k) => localStorage.removeItem(k));
            setCleared(true);
        } catch (e) {
            console.error("[Privacy] clearLocalData failed:", e);
        } finally {
            setClearing(false);
            setClearModalOpen(false);
        }
    }

    function handleExportData() {
        setExportLoading(true);
        try {
            // Gather all flux-related localStorage data
            const exported = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith("flux-")) {
                    try {
                        exported[key] = JSON.parse(localStorage.getItem(key));
                    } catch {
                        exported[key] = localStorage.getItem(key);
                    }
                }
            }
            const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), data: exported }, null, 2)], {
                type: "application/json",
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `flux-data-${new Date().toISOString().split("T")[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error("[Privacy] exportData failed:", e);
        } finally {
            setExportLoading(false);
        }
    }

    return (
        <div className="space-y-8">

            {/* ── Tracking ── */}
            <SubSection title="Tracking & Telemetry" icon={Activity}>
                <Card>
                    <Row
                        label="Send Crash Reports"
                        desc="Automatically send anonymous crash data to help improve stability">
                        <Toggle value={prefs.crashReports ?? false} onChange={(v) => setPref("crashReports", v)} />
                    </Row>
                    <Row
                        label="Feature Usage Analytics"
                        desc="Share non-identifying interaction data to help build better features">
                        <Toggle value={prefs.telemetry ?? false} onChange={(v) => setPref("telemetry", v)} />
                    </Row>
                </Card>
            </SubSection>

            {/* ── Social ── */}
            <SubSection title="Social & Visibility" icon={Globe}>
                <Card>
                    <Row
                        label="Activity Status"
                        desc="Allow others to see when you are online and what you are watching">
                        <Toggle value={prefs.activityStatus ?? true} onChange={(v) => setPref("activityStatus", v)} />
                    </Row>
                    <Row
                        label="Public Watchlist"
                        desc="Make your watchlist visible on your public profile">
                        <Toggle value={prefs.publicWatchlist ?? false} onChange={(v) => setPref("publicWatchlist", v)} />
                    </Row>
                    <Row
                        label="Show Media Progress"
                        desc="Display playback position on your public profile card">
                        <Toggle value={prefs.publicProgress ?? false} onChange={(v) => setPref("publicProgress", v)} />
                    </Row>
                </Card>
            </SubSection>

            {/* ── Local Data ── */}
            <SubSection title="Local Data" icon={History}>
                <Card>
                    <Row
                        label="Keep Watch History"
                        desc="Track completed media, resume points, and playback progress locally">
                        <Toggle value={prefs.watchHistory ?? true} onChange={(v) => setPref("watchHistory", v)} />
                    </Row>
                    <Row
                        label="Keep Search History"
                        desc="Remember recent searches to improve future autocomplete">
                        <Toggle value={prefs.searchHistory ?? true} onChange={(v) => setPref("searchHistory", v)} />
                    </Row>
                    <Row
                        label={cleared ? "Local Data Cleared" : "Clear Local Data"}
                        desc="Permanently delete all watch history, search history, and cached metadata"
                        danger>
                        <button
                            onClick={() => setClearModalOpen(true)}
                            style={{ outline: "none" }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-error/25 text-error hover:bg-error/10 transition-colors text-xs font-semibold cursor-pointer">
                            <Trash2 size={12} />
                            {cleared ? "Cleared" : "Clear Data"}
                        </button>
                    </Row>
                </Card>
            </SubSection>

            {/* ── Export ── */}
            <SubSection title="Data Export" icon={Download}>
                <Card>
                    <Row
                        label="Export Account Data"
                        desc="Download a JSON archive of your preferences, history, and library state">
                        <button
                            onClick={handleExportData}
                            disabled={exportLoading}
                            style={{ outline: "none" }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-content hover:bg-primary/90 transition-colors text-xs font-semibold cursor-pointer border-none disabled:opacity-50">
                            <Download size={12} />
                            {exportLoading ? "Exporting…" : "Export JSON"}
                        </button>
                    </Row>
                </Card>
            </SubSection>

            {/* ── Clear confirm modal ── */}
            <Modal
                open={clearModalOpen}
                onClose={() => setClearModalOpen(false)}
                title="Clear All Local Data?"
                subtitle="This will remove all watch history, search history, and cached preferences.">
                <p className="text-sm text-white/55 mt-2 leading-relaxed">
                    Your server-side watch history and account data will also be cleared. This cannot be undone.
                </p>
                <div className="flex gap-2 mt-6">
                    <button
                        onClick={() => setClearModalOpen(false)}
                        style={{ outline: "none" }}
                        className="btn btn-sm btn-ghost rounded flex-1 text-white/70">
                        Cancel
                    </button>
                    <button
                        onClick={handleClearLocalData}
                        disabled={clearing}
                        style={{ outline: "none" }}
                        className="btn btn-sm btn-error rounded flex-1 border-none gap-1.5">
                        {clearing ? <span className="loading loading-spinner loading-xs" /> : <Trash2 size={12} />}
                        {clearing ? "Clearing…" : "Clear Everything"}
                    </button>
                </div>
            </Modal>
        </div>
    );
}
