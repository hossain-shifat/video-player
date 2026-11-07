import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Send, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { getAnnouncements, getAnnouncementRoutes, sendAnnouncement, getPushStatus, runPushDiagnostics } from "../Shared";

// Admin → Announcements. Broadcasts a notification to users (always saved to
// their history; pushed to their devices when they've enabled push).

const KEYS = { list: ["admin", "announcements"], status: ["admin", "push-status"] };

function PushHealth() {
    const qc = useQueryClient();
    const status = useQuery({ queryKey: KEYS.status, queryFn: getPushStatus, staleTime: 30_000 });
    const recheck = useMutation({
        mutationFn: runPushDiagnostics,
        onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.status }),
    });

    const s = status.data;
    const ok = s?.pushConfigured;

    return (
        <div className="rounded-xl border border-base-content/10 bg-base-200 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    {status.isLoading ? (
                        <span className="loading loading-spinner loading-sm" />
                    ) : ok ? (
                        <CheckCircle2 className="shrink-0 text-success" size={20} />
                    ) : (
                        <AlertTriangle className="shrink-0 text-warning" size={20} />
                    )}
                    <div className="min-w-0">
                        <p className="text-sm font-semibold">{status.isLoading ? "Checking push service…" : ok ? "Push delivery is working" : "Push delivery is not available"}</p>
                        {!ok && s && <p className="text-[13px] text-base-content/65">{s.message || s.reason}</p>}
                        {status.isError && <p className="text-[13px] text-error">{status.error?.message}</p>}
                        {ok && <p className="text-[13px] text-base-content/65">Server can reach Google FCM. Announcements will also be pushed to enabled devices.</p>}
                    </div>
                </div>
                <button className="btn btn-sm btn-ghost gap-1.5" onClick={() => recheck.mutate()} disabled={recheck.isPending}>
                    <RefreshCw size={14} className={recheck.isPending ? "animate-spin" : ""} /> Re-check
                </button>
            </div>
        </div>
    );
}

function Composer({ onSent }) {
    const [title, setTitle] = useState("");
    const [body, setBody] = useState("");
    const [url, setUrl] = useState("");
    const [audience, setAudience] = useState("all");

    // Only pages that really exist (the server owns this list and re-validates it on send).
    const routes = useQuery({ queryKey: ["admin", "announcement-routes"], queryFn: getAnnouncementRoutes, staleTime: 10 * 60_000 });

    const send = useMutation({
        mutationFn: () => sendAnnouncement({ title: title.trim(), body: body.trim(), url: url || undefined, audience }),
        onSuccess: () => {
            setTitle("");
            setBody("");
            setUrl("");
            onSent();
        },
    });

    const canSend = title.trim() && !send.isPending;

    return (
        <div className="rounded-xl border border-base-content/10 bg-base-200 p-4 sm:p-5 space-y-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Megaphone size={16} className="text-primary" /> New announcement
            </h2>

            <div className="grid gap-4 sm:grid-cols-2">
                <label className="form-control sm:col-span-2">
                    <span className="mb-1 block text-[13px] font-medium">
                        Title <span className="text-error">*</span>
                    </span>
                    <input className="input input-bordered input-sm h-9 w-full" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Server maintenance tonight" />
                </label>

                <label className="form-control sm:col-span-2">
                    <span className="mb-1 block text-[13px] font-medium">Message</span>
                    <textarea className="textarea textarea-bordered w-full text-[13px]" rows={3} value={body} maxLength={300} onChange={(e) => setBody(e.target.value)} placeholder="Optional details (max 300 characters)" />
                    <span className="mt-1 block text-right text-xs text-base-content/50">{body.length}/300</span>
                </label>

                <label className="form-control">
                    <span className="mb-1 block text-[13px] font-medium">Send to</span>
                    <select className="select select-bordered select-sm h-9 w-full" value={audience} onChange={(e) => setAudience(e.target.value)}>
                        <option value="all">All approved users</option>
                        <option value="admins">Admins only</option>
                    </select>
                </label>

                <label className="form-control">
                    <span className="mb-1 block text-[13px] font-medium">Button in the details window (optional)</span>
                    <select className="select select-bordered select-sm h-9 w-full" value={url} onChange={(e) => setUrl(e.target.value)}>
                        <option value="">None — just show the message</option>
                        {(routes.data?.routes ?? []).map((r) => (
                            <option key={r.path} value={r.path}>
                                Open {r.label}
                            </option>
                        ))}
                    </select>
                </label>
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <button className="btn btn-primary btn-sm gap-1.5" disabled={!canSend} onClick={() => send.mutate()}>
                    {send.isPending ? <span className="loading loading-spinner loading-xs" /> : <Send size={14} />}
                    Send
                </button>
                {send.isSuccess && (
                    <span className="text-[13px] text-success">
                        Delivered to {send.data.delivered} user{send.data.delivered === 1 ? "" : "s"}
                        {send.data.pushConfigured ? "" : " (history only — push isn't configured)"}.
                    </span>
                )}
                {send.isError && <span className="text-[13px] text-error">{send.error?.message || "Failed to send."}</span>}
            </div>
        </div>
    );
}

function History() {
    const { data, isLoading, isError, error } = useQuery({ queryKey: KEYS.list, queryFn: getAnnouncements, refetchInterval: 30_000 });
    const items = data?.announcements ?? [];

    return (
        <div className="rounded-xl border border-base-content/10 bg-base-200">
            <h2 className="border-b border-base-content/10 px-4 py-3 text-sm font-semibold sm:px-5">Recent announcements</h2>
            {isLoading ? (
                <p className="px-4 py-6 text-[13px] text-base-content/60 sm:px-5">Loading…</p>
            ) : isError ? (
                <p className="px-4 py-6 text-[13px] text-error sm:px-5">{error?.message || "Failed to load."}</p>
            ) : items.length === 0 ? (
                <p className="px-4 py-6 text-[13px] text-base-content/60 sm:px-5">Nothing sent yet.</p>
            ) : (
                <ul className="divide-y divide-base-content/10">
                    {items.map((a) => (
                        <li key={a.id} className="px-4 py-3 sm:px-5">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <p className="text-sm font-medium">{a.title}</p>
                                <span className="text-xs text-base-content/50">{new Date(a.createdAt).toLocaleString()}</span>
                            </div>
                            {a.body && <p className="mt-0.5 text-[13px] text-base-content/70">{a.body}</p>}
                            <p className="mt-1 text-xs text-base-content/55">
                                {a.audience === "admins" ? "Admins only" : "All approved users"} · delivered to {a.delivered} · read by {a.read}
                            </p>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

export default function DashAnnouncements() {
    const qc = useQueryClient();

    return (
        <div className="mx-auto max-w-3xl space-y-5">
            <div>
                <h1 className="text-xl font-semibold">Announcements</h1>
                <p className="text-[13px] text-base-content/65">Broadcast a message to your users. It always appears in their notification bell, and as a push notification on devices where they've enabled it.</p>
            </div>

            <PushHealth />
            <Composer onSent={() => qc.invalidateQueries({ queryKey: KEYS.list })} />
            <History />
        </div>
    );
}
