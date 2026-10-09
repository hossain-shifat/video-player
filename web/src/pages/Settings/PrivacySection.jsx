import { useState } from "react";
import { Trash2, Download } from "lucide-react";
import { Card, Row, Toggle, SectionLabel, DangerButton, ConfirmModal, GhostButton } from "./shared";
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
        <div className="space-y-6 w-full">
            <div>
                <SectionLabel hint="Off by default. Nothing leaves your network unless you turn these on.">Diagnostics</SectionLabel>
                <Card>
                    <Row label="Crash reports" desc="Send anonymous crash data to help fix bugs">
                        <Toggle label="Crash reports" value={prefs.crashReports ?? false} onChange={(v) => setPref("crashReports", v)} />
                    </Row>
                    <Row label="Usage analytics" desc="Share non-identifying interaction data">
                        <Toggle label="Usage analytics" value={prefs.telemetry ?? false} onChange={(v) => setPref("telemetry", v)} />
                    </Row>
                </Card>
            </div>

            <div>
                <SectionLabel hint="What other people on your server can see about you.">Visibility</SectionLabel>
                <Card>
                    <Row label="Activity status" desc="Show when you're online and what you're watching">
                        <Toggle label="Activity status" value={prefs.activityStatus ?? true} onChange={(v) => setPref("activityStatus", v)} />
                    </Row>
                    <Row label="Public watchlist" desc="Show your watchlist on your profile">
                        <Toggle label="Public watchlist" value={prefs.publicWatchlist ?? false} onChange={(v) => setPref("publicWatchlist", v)} />
                    </Row>
                    <Row label="Show playback progress" desc="Show progress on your public profile card">
                        <Toggle label="Show playback progress" value={prefs.publicProgress ?? false} onChange={(v) => setPref("publicProgress", v)} />
                    </Row>
                </Card>
            </div>

            <div>
                <SectionLabel hint="Stored in this browser and on your server.">Your data</SectionLabel>
                <Card>
                    <Row label="Keep watch history" desc="Track progress and resume points">
                        <Toggle label="Keep watch history" value={prefs.watchHistory ?? true} onChange={(v) => setPref("watchHistory", v)} />
                    </Row>
                    <Row label="Keep search history" desc="Remember recent searches for suggestions">
                        <Toggle label="Keep search history" value={prefs.searchHistory ?? true} onChange={(v) => setPref("searchHistory", v)} />
                    </Row>
                    <Row label="Export data" desc="Download your preferences as a JSON file">
                        <GhostButton onClick={doExport} disabled={exporting}>
                            <Download size={13} /> {exporting ? "Exporting…" : "Export JSON"}
                        </GhostButton>
                    </Row>
                    <Row label={cleared ? "Local data cleared" : "Clear all local data"} desc="Remove history, progress and cached preferences" danger>
                        <DangerButton onClick={() => setConfirmOpen(true)}>
                            <Trash2 size={13} /> {cleared ? "Cleared" : "Clear"}
                        </DangerButton>
                    </Row>
                </Card>
            </div>

            <ConfirmModal
                open={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                title="Clear all local data?"
                subtitle="This removes watch history, search history and saved preferences. It can't be undone."
                confirmLabel={clearing ? "Clearing…" : "Clear everything"}
                loading={clearing}
                onConfirm={doClear}
            />
        </div>
    );
}
