import { useState } from "react";
import { Bell, BellOff, Smartphone, Send, Trash2, Info } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { useNotificationPreferences, usePushDevices, usePushState, usePushStatus } from "../../Hooks/useNotifications";
import { enablePush, disablePush } from "../../utils/push";
import { sendTestNotification } from "../../api/notifications";
import { Card, Row, SectionLabel, Toggle, Notice, GhostButton, Chip } from "./shared";

// [preference column, label, description]
const TYPES = [
    ["newMedia", "New titles", "When movies, series or anime are added to a library you can access."],
    ["uploads", "Uploads", "When one of your uploads finishes."],
    ["account", "Account", "Approval and access changes to your account."],
    ["security", "Sign-ins", "When your account signs in on a new device."],
    ["announcements", "Announcements", "Messages from the server admin."],
];
const ADMIN_TYPES = [["storage", "Storage alerts", "When a library disk is almost full."]];

// Server-side push problems, in plain language (reason codes come from GET /api/notifications/status).
const SERVER_REASONS = {
    "no-credentials": "The server has no Firebase service-account credentials yet (set FIREBASE_SERVICE_ACCOUNT_PATH in server/.env and restart).",
    "file-missing": "The service-account file path in server/.env doesn't exist.",
    "init-failed": "The server couldn't load the Firebase credentials — check the server console.",
    "not-installed": "firebase-admin isn't installed on the server (npm i firebase-admin).",
    unreachable: "The server couldn't reach Google's push service.",
};

export default function NotificationsSection() {
    const { isAdmin } = useAuth();
    const push = usePushState();
    const status = usePushStatus();
    const { preferences, isLoading: prefsLoading, update } = useNotificationPreferences();
    const { devices, remove: removeDevice, refetch: refetchDevices } = usePushDevices();

    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [testMsg, setTestMsg] = useState("");

    const serverReady = status.data?.pushConfigured;
    const serverReason = status.data?.reason;
    const serverMessage = status.data?.message || SERVER_REASONS[serverReason] || "Push isn't available on the server.";
    const canUsePush = push.support.supported && push.configured;

    const toggleThisDevice = async () => {
        setBusy(true);
        setError("");
        try {
            if (push.enabledHere) await disablePush();
            else await enablePush();
            await refetchDevices();
        } catch (err) {
            setError(err.message || "Something went wrong.");
        } finally {
            push.refresh();
            setBusy(false);
        }
    };

    const sendTest = async () => {
        setTestMsg("");
        try {
            await sendTestNotification();
            setTestMsg("Sent. It also appears in the bell.");
        } catch (err) {
            setTestMsg(err.message || "Couldn't send the test.");
        }
    };

    const prefOn = (key) => (preferences ? !!preferences[key] : true);
    const typeRows = [...TYPES, ...(isAdmin ? ADMIN_TYPES : [])];

    return (
        <div className="space-y-7">
            {/* ── Capability notices ── */}
            {!push.support.supported && (
                <Notice tone="warn" icon={Info} title="Push isn't available in this browser">
                    {push.support.message} The notification bell still works while FLUX is open.
                </Notice>
            )}
            {push.support.supported && !push.configured && (
                <Notice tone="warn" icon={Info} title="Firebase isn't configured for the web app">
                    Set the <code>VITE_FIREBASE_*</code> variables (including the VAPID key) and rebuild the web app.
                </Notice>
            )}
            {status.isSuccess && !serverReady && (
                <Notice tone="warn" icon={Info} title="The server can't send push yet">
                    {serverMessage} Your notification history still works.
                </Notice>
            )}
            {status.isError && (
                <Notice tone="error" icon={Info} title="Notifications aren't available">
                    {status.error?.message || "The notifications API returned an error."} If the message mentions a migration, run it on the server and restart.
                </Notice>
            )}
            {push.permission === "denied" && (
                <Notice tone="error" icon={BellOff} title="Notifications are blocked">
                    Allow notifications for this site in your browser or Android site settings, then come back.
                </Notice>
            )}

            {/* ── This device ── */}
            <section>
                <SectionLabel icon={Bell} hint="Alerts that appear outside the browser, even when FLUX is closed.">
                    This device
                </SectionLabel>
                <Card>
                    <Row id="n-device" label="Push notifications on this device" desc={push.enabledHere ? "Enabled — alerts arrive even when FLUX isn't open." : "Off — you'll only see notifications inside FLUX."}>
                        <Toggle value={push.enabledHere} onChange={toggleThisDevice} disabled={busy || !canUsePush || push.permission === "denied"} label="Push notifications on this device" />
                    </Row>
                    {push.enabledHere && (
                        <Row id="n-test" label="Send a test notification" desc={testMsg || "Close or minimise FLUX first to see it as a system notification."}>
                            <GhostButton onClick={sendTest}>
                                <Send size={13} /> Send test
                            </GhostButton>
                        </Row>
                    )}
                </Card>
                {error && <p className="mt-2 px-1 text-[13px] text-error">{error}</p>}
            </section>

            {/* ── What to be notified about ── */}
            <section>
                <SectionLabel hint="These only control push. Everything is always saved to your notification history.">What to push</SectionLabel>
                <Card>
                    <Row id="n-master" label="Push notifications" desc="Master switch for every device on your account.">
                        <Toggle value={prefOn("pushEnabled")} onChange={(v) => update({ pushEnabled: v })} disabled={prefsLoading} label="Push notifications" />
                    </Row>
                    {typeRows.map(([key, label, desc]) => (
                        <Row key={key} id={`n-${key}`} label={label} desc={desc}>
                            <Toggle value={prefOn(key)} onChange={(v) => update({ [key]: v })} disabled={prefsLoading || !prefOn("pushEnabled")} label={label} />
                        </Row>
                    ))}
                </Card>
            </section>

            {/* ── Registered devices ── */}
            <section>
                <SectionLabel icon={Smartphone} hint="Browsers and installed apps with push turned on. To see or log out signed-in devices, use Settings → Privacy → Devices and sessions.">
                    Browsers receiving push
                </SectionLabel>
                <Card>
                    {devices.length === 0 ? (
                        <p className="px-4 py-4 text-[13px] text-base-content/60 sm:px-5">No devices registered yet.</p>
                    ) : (
                        devices.map((d) => (
                            <Row key={d.id} label={d.deviceName || "Unnamed device"} desc={`Last active ${new Date(d.lastSeenAt).toLocaleString()}`}>
                                <div className="flex items-center gap-2">
                                    {d.isCurrentSession && <Chip tone="primary">This session</Chip>}
                                    <GhostButton onClick={() => removeDevice(d.id).then(() => d.isCurrentSession && push.enabledHere && disablePush().then(push.refresh))}>
                                        <Trash2 size={13} /> Remove
                                    </GhostButton>
                                </div>
                            </Row>
                        ))
                    )}
                </Card>
            </section>

        </div>
    );
}
