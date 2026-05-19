import { Shield, EyeOff, FileText, Globe, Key, Trash2, History, MessageSquare, Activity, Download } from "lucide-react";
import { Card, Row, Toggle } from "./shared";

function SubSection({ title, icon: Icon, children }) {
    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2.5 w-full text-left">
                <span className="w-7 h-7 rounded flex items-center justify-center bg-base-300 text-primary shrink-0">
                    <Icon size={14} />
                </span>
                <span className="text-sm font-semibold text-base-content flex-1">{title}</span>
            </div>
            <div className="pl-0">{children}</div>
        </div>
    );
}

export default function PrivacySection({ prefs, setPref }) {
    return (
        <div className="space-y-8">
            <SubSection title="Tracking & Telemetry" icon={Activity}>
                <Card>
                    <Row label="Send Crash Reports" desc="Automatically send anonymous crash data to help improve stability">
                        <Toggle value={prefs.crashReports ?? false} onChange={(v) => setPref("crashReports", v)} />
                    </Row>
                    <Row label="Feature Usage Analytics" desc="Share non-identifying interaction data to help us build better features">
                        <Toggle value={prefs.telemetry ?? false} onChange={(v) => setPref("telemetry", v)} />
                    </Row>
                </Card>
            </SubSection>

            <SubSection title="Social & Visibility" icon={Globe}>
                <Card>
                    <Row label="Activity Status" desc="Allow friends to see when you are online and what you are watching">
                        <Toggle value={prefs.activityStatus ?? true} onChange={(v) => setPref("activityStatus", v)} />
                    </Row>
                    <Row label="Public Watchlist" desc="Make your watchlist visible on your public profile page">
                        <Toggle value={prefs.publicWatchlist ?? false} onChange={(v) => setPref("publicWatchlist", v)} />
                    </Row>
                    <Row label="Show Media Progress" desc="Display exact playback position on your public profile card">
                        <Toggle value={prefs.publicProgress ?? false} onChange={(v) => setPref("publicProgress", v)} />
                    </Row>
                </Card>
            </SubSection>

            <SubSection title="Local Data" icon={History}>
                <Card>
                    <Row label="Keep Watch History" desc="Track completed media, resume points, and playback progress locally">
                        <Toggle value={prefs.watchHistory ?? true} onChange={(v) => setPref("watchHistory", v)} />
                    </Row>
                    <Row label="Keep Search History" desc="Remember recent searches to improve future autocomplete results">
                        <Toggle value={prefs.searchHistory ?? true} onChange={(v) => setPref("searchHistory", v)} />
                    </Row>
                    <Row label="Clear Local Data" desc="Permanently delete all watch history, search history, and cached metadata" danger>
                        <button
                            onClick={() => {}}
                            style={{ outline: "none" }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-error/20 text-error hover:bg-error/10 transition-colors text-xs font-semibold cursor-pointer">
                            <Trash2 size={13} /> Clear Data
                        </button>
                    </Row>
                </Card>
            </SubSection>

            <SubSection title="Data Export" icon={Download}>
                <Card>
                    <Row label="Export Account Data" desc="Download a JSON archive of your personal preferences, history, and library state">
                        <button
                            onClick={() => {}}
                            style={{ outline: "none" }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-content hover:bg-primary/90 transition-colors text-xs font-semibold cursor-pointer border-none">
                            <Download size={13} /> Request Export
                        </button>
                    </Row>
                </Card>
            </SubSection>
        </div>
    );
}
