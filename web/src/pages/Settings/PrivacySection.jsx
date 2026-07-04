import { useState } from "react";
import { Trash2, Download, Globe, Activity, History, X } from "lucide-react";
import { Card, Row, Toggle, SectionLabel, DangerButton, Modal } from "./shared";
import { clearHistory } from "../../api";

export default function PrivacySection({ prefs, setPref }) {
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [clearing, setClearing] = useState(false);
    const [cleared, setCleared] = useState(false);
    const [exporting, setExporting] = useState(false);

    async function doClear() {
        setClearing(true);
        try {
            await clearHistory().catch(() => {});
            const kill = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k?.startsWith("flux-") || k?.startsWith("progress-") || k?.startsWith("search-")) kill.push(k);
            }
            kill.forEach((k) => localStorage.removeItem(k));
            setCleared(true);
        } finally {
            setClearing(false);
            setConfirmOpen(false);
        }
    }

    function doExport() {
        setExporting(true);
        try {
            const out = {};
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k?.startsWith("flux-")) {
                    try {
                        out[k] = JSON.parse(localStorage.getItem(k));
                    } catch {
                        out[k] = localStorage.getItem(k);
                    }
                }
            }
            const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), data: out }, null, 2)], { type: "application/json" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `flux-export-${new Date().toISOString().split("T")[0]}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
        } finally {
            setExporting(false);
        }
    }

    return (
        <div className="space-y-5 w-full">
            <SectionLabel>Telemetry</SectionLabel>
            <Card>
                <Row label="Crash reports" desc="Send anonymous crash data to improve stability">
                    <Toggle value={prefs.crashReports ?? false} onChange={(v) => setPref("crashReports", v)} />
                </Row>
                <Row label="Usage analytics" desc="Share non-identifying interaction data">
                    <Toggle value={prefs.telemetry ?? false} onChange={(v) => setPref("telemetry", v)} />
                </Row>
            </Card>

            <SectionLabel>Visibility</SectionLabel>
            <Card>
                <Row label="Activity status" desc="Let others see when you're online and what you're watching">
                    <Toggle value={prefs.activityStatus ?? true} onChange={(v) => setPref("activityStatus", v)} />
                </Row>
                <Row label="Public watchlist" desc="Make your watchlist visible on your profile">
                    <Toggle value={prefs.publicWatchlist ?? false} onChange={(v) => setPref("publicWatchlist", v)} />
                </Row>
                <Row label="Show playback progress" desc="Display progress on your public profile card">
                    <Toggle value={prefs.publicProgress ?? false} onChange={(v) => setPref("publicProgress", v)} />
                </Row>
            </Card>

            <SectionLabel>Local Data</SectionLabel>
            <Card>
                <Row label="Keep watch history" desc="Track progress and resume points locally">
                    <Toggle value={prefs.watchHistory ?? true} onChange={(v) => setPref("watchHistory", v)} />
                </Row>
                <Row label="Keep search history" desc="Remember recent searches for autocomplete">
                    <Toggle value={prefs.searchHistory ?? true} onChange={(v) => setPref("searchHistory", v)} />
                </Row>
                <Row label={cleared ? "Data cleared" : "Clear all local data"} desc="Remove all history, progress, and cached data" danger>
                    <DangerButton onClick={() => setConfirmOpen(true)}>
                        <Trash2 size={11} /> {cleared ? "Cleared" : "Clear"}
                    </DangerButton>
                </Row>
            </Card>

            <SectionLabel>Export</SectionLabel>
            <Card>
                <Row label="Export data" desc="Download a JSON archive of your preferences and history">
                    <button
                        onClick={doExport}
                        disabled={exporting}
                        style={{ outline: "none" }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary/70 hover:bg-primary/15 hover:text-primary transition-all text-[11px] font-semibold disabled:opacity-40">
                        <Download size={11} /> {exporting ? "Exporting…" : "Export JSON"}
                    </button>
                </Row>
            </Card>

            {/* Confirm modal */}
            <Modal
                open={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                title="Clear all local data?"
                subtitle="This removes watch history, search history, and all cached preferences. Cannot be undone.">
                <div className="flex gap-2 mt-2">
                    <button
                        onClick={() => setConfirmOpen(false)}
                        style={{ outline: "none" }}
                        className="flex-1 py-2 rounded-lg text-[12px] text-white/40 hover:text-white/70 hover:bg-white/[0.05] transition-colors border border-white/[0.07]">
                        Cancel
                    </button>
                    <button
                        onClick={doClear}
                        disabled={clearing}
                        style={{ outline: "none" }}
                        className="flex-1 py-2 rounded-lg text-[12px] font-semibold bg-error text-error-content hover:opacity-90 transition-opacity border-none disabled:opacity-40 flex items-center justify-center gap-1.5">
                        {clearing ? <span className="loading loading-spinner loading-xs" /> : <Trash2 size={11} />}
                        {clearing ? "Clearing…" : "Clear Everything"}
                    </button>
                </div>
            </Modal>
        </div>
    );
}
