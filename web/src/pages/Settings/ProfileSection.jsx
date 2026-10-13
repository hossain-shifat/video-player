import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router";
import {
    ArrowRight,
    BadgeCheck,
    Bookmark,
    Camera,
    Captions,
    Check,
    CheckCircle2,
    Copy,
    Eye,
    EyeOff,
    Hourglass,
    AlertTriangle,
    KeyRound,
    Lock,
    LogIn,
    LogOut,
    Monitor,
    Palette,
    Play,
    PlayCircle,
    RefreshCw,
    Search,
    ShieldAlert,
    ShieldCheck,
    Smartphone,
    Tablet,
    Timer,
    Unlock,
    User,
} from "lucide-react";
import { Input, Card, Field, Chip, Notice, StatGrid, StatTile, PrimaryButton, GhostButton, DangerButton, ConfirmModal, FOCUS, copyText, loadPrefs, RATING_LIMITS, hasPin } from "./shared";
import { api } from "../../api";
import { useAuth } from "../../auth/AuthContext";
import { useApi } from "../../Context/apiContext";
import { useTheme } from "../../Context/themeContext";

// Device-session endpoints. Change these if your server uses other paths.
//   GET    SESSIONS_URL        -> { sessions: [{ id, current, userAgent|browser+os, ip, createdAt, lastActiveAt }] }
//   DELETE SESSIONS_URL/:id    -> sign one device out
//   DELETE SESSIONS_URL        -> sign out every device except the current one
const SESSIONS_URL = "/api/auth/sessions";

// ─── Utils ────────────────────────────────────────────────────────────────────
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const fmtDate = (iso, withTime = false) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }) : null;
const daysLeft = (iso) => (iso ? Math.ceil((new Date(iso) - new Date()) / 86400000) : null);

const initials = (name, email) => {
    const src = (name || email || "?").trim();
    const w = src.split(/\s+/);
    return (w.length >= 2 ? w[0][0] + w[1][0] : src[0]).toUpperCase();
};

function fmtDuration(sec) {
    if (!sec || sec < 60) return "0 min";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h ? `${h} h ${m} min` : `${m} min`;
}

function timeAgo(iso) {
    if (!iso) return "";
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 2) return "Active now";
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
    return fmtDate(iso);
}

// Browser, OS and device kind from a user-agent string (no personal data)
function parseUA(ua = "") {
    const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
    const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iOS/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Unknown OS";
    const kind = /iPad|Tablet/.test(ua) ? "tablet" : /Mobi|iPhone|Android/.test(ua) ? "mobile" : "desktop";
    return { browser, os, kind };
}

function normSession(s) {
    const p = parseUA(s.userAgent || s.user_agent || "");
    return {
        id: s.id ?? s.sessionId,
        current: !!(s.current ?? s.isCurrent),
        browser: s.browser || p.browser,
        os: s.os || p.os,
        kind: s.deviceType || s.kind || p.kind,
        ip: s.ip || s.ipAddress || null,
        location: s.location || null,
        createdAt: s.createdAt || null,
        lastActiveAt: s.lastActiveAt || s.lastSeenAt || s.updatedAt || s.createdAt || null,
    };
}

// 0 to 4, advisory only
function passwordScore(p) {
    if (!p) return 0;
    let s = 0;
    if (p.length >= 8) s++;
    if (p.length >= 12) s++;
    if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
    if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
    return Math.min(s, 4);
}
const STRENGTH = [
    { label: "Too short", bar: "bg-error" },
    { label: "Weak", bar: "bg-error" },
    { label: "Fair", bar: "bg-warning" },
    { label: "Good", bar: "bg-success" },
    { label: "Strong", bar: "bg-success" },
];

const ROLE_TONE = { admin: "primary", moderator: "warning" };
const STATUS_TONE = { approved: "success", pending: "warning", blocked: "error", rejected: "error" };
const STATUS_DOT = { approved: "bg-success", pending: "bg-warning animate-pulse", blocked: "bg-error", rejected: "bg-error" };

const NAV = [
    ["pf-profile", "Profile"],
    ["pf-account", "Account"],
    ["pf-password", "Password"],
    ["pf-activity", "Activity"],
    ["pf-prefs", "Your setup"],
    ["pf-permissions", "Permissions"],
    ["pf-sessions", "Sessions"],
];

const DEVICE_ICON = { mobile: Smartphone, tablet: Tablet, desktop: Monitor };

// ─── Layout primitives ────────────────────────────────────────────────────────
// Title + description on the left, the controls on the right
function Section({ id, title, desc, children }) {
    return (
        <section id={id} className="grid scroll-mt-32 gap-4 border-b border-base-content/10 py-7 last:border-b-0 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
            <div>
                <h3 className="text-sm font-semibold text-base-content">{title}</h3>
                {desc && <p className="mt-1 text-[13px] leading-relaxed text-base-content/60">{desc}</p>}
            </div>
            <div className="min-w-0">{children}</div>
        </section>
    );
}

// Footer bar of a form card: hint on the left, actions on the right
function CardFooter({ children, hint }) {
    return (
        <div className="flex flex-col gap-3 border-t border-base-content/10 bg-base-300/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="min-w-0 text-xs text-base-content/60">{hint}</div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>
        </div>
    );
}

function KV({ label, children, action }) {
    return (
        <div className="flex min-w-0 items-center gap-3 border-b border-base-content/10 px-4 py-3 last:border-b-0 sm:px-5">
            <dt className="w-28 shrink-0 text-[13px] text-base-content/60 sm:w-36">{label}</dt>
            <dd className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium text-base-content">{children}</dd>
            {action}
        </div>
    );
}

function Avatar({ src, name, email, size = 72, approved }) {
    const [broken, setBroken] = useState(false);
    useEffect(() => setBroken(false), [src]);
    return (
        <div className="relative shrink-0" style={{ width: size, height: size }}>
            <div className="h-full w-full overflow-hidden rounded-md bg-base-300">
                {src && !broken ? (
                    <img src={src} alt={name || email || "Profile photo"} onError={() => setBroken(true)} className="h-full w-full object-cover" />
                ) : (
                    <div className="flex h-full w-full items-center justify-center bg-primary/15 font-semibold text-primary" style={{ fontSize: size * 0.36 }}>
                        {initials(name, email)}
                    </div>
                )}
            </div>
            {approved && (
                <span title="Approved account" className="absolute -bottom-1.5 -right-1.5 flex size-5 items-center justify-center rounded-md bg-primary text-primary-content ring-2 ring-base-100">
                    <BadgeCheck size={13} />
                </span>
            )}
        </div>
    );
}

function CopyButton({ text, label }) {
    const [done, setDone] = useState(false);
    return (
        <button
            type="button"
            aria-label={done ? "Copied" : label}
            title={done ? "Copied" : label}
            onClick={async () => {
                if (await copyText(text)) {
                    setDone(true);
                    setTimeout(() => setDone(false), 1600);
                }
            }}
            className={`flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-base-content/50 transition-colors hover:bg-base-content/10 hover:text-base-content ${FOCUS}`}>
            {done ? <Check size={13} strokeWidth={3} className="text-success" /> : <Copy size={13} />}
        </button>
    );
}

function TextAction({ onClick, children }) {
    return (
        <button type="button" onClick={onClick} className={`shrink-0 cursor-pointer rounded-md px-2 py-1 text-[13px] font-medium text-primary transition-colors hover:bg-primary/10 ${FOCUS}`}>
            {children}
        </button>
    );
}

function Msg({ m }) {
    if (!m) return null;
    return (
        <span role={m.ok ? "status" : "alert"} className={`inline-flex items-center gap-1.5 font-medium ${m.ok ? "text-success" : "text-error"}`}>
            {m.ok && <Check size={13} strokeWidth={3} />} {m.text}
        </span>
    );
}

function StatusBanner({ isPending, isBlocked, isExpired }) {
    if (isBlocked)
        return (
            <Notice tone="error" icon={ShieldAlert} title="Account blocked">
                An administrator revoked your access. Contact them if you think this is a mistake.
            </Notice>
        );
    if (isExpired)
        return (
            <Notice tone="error" icon={Hourglass} title="Access expired">
                Your temporary access has ended. Ask for renewed access to keep using Flux.
            </Notice>
        );
    if (isPending)
        return (
            <Notice tone="warn" icon={AlertTriangle} title="Approval pending">
                An administrator needs to approve your account before you can stream media.
            </Notice>
        );
    return null;
}

function PrefRow({ icon: Icon, label, value, tab, onGo }) {
    return (
        <div className="flex items-center gap-3 border-b border-base-content/10 px-4 py-3 last:border-b-0 sm:px-5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-base-300 text-base-content/65">
                <Icon size={16} />
            </span>
            <div className="min-w-0 flex-1">
                <p className="text-xs text-base-content/55">{label}</p>
                <p className="mt-0.5 truncate text-sm font-medium text-base-content">{value}</p>
            </div>
            <TextAction onClick={() => onGo(tab)}>Change</TextAction>
        </div>
    );
}

// One signed-in device
function SessionRow({ s, onRevoke }) {
    const Icon = DEVICE_ICON[s.kind] || Monitor;
    const meta = [s.location, s.ip, s.current ? "Active now" : timeAgo(s.lastActiveAt)].filter(Boolean).join(" · ");
    return (
        <li className="flex items-center gap-3 border-b border-base-content/10 px-4 py-3.5 last:border-b-0 sm:px-5">
            <span className={`flex size-10 shrink-0 items-center justify-center rounded-md ${s.current ? "bg-success/15 text-success" : "bg-base-300 text-base-content/65"}`}>
                <Icon size={18} />
            </span>
            <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-base-content">
                    <span className="truncate">
                        {s.browser} on {s.os}
                    </span>
                    {s.current && <Chip tone="success">This device</Chip>}
                </p>
                <p className="mt-0.5 truncate text-xs text-base-content/55">{meta || "No details"}</p>
                {s.createdAt && <p className="mt-0.5 hidden text-xs text-base-content/40 sm:block">Signed in {fmtDate(s.createdAt, true)}</p>}
            </div>
            {!s.current && <GhostButton onClick={() => onRevoke(s)}>Sign out</GhostButton>}
        </li>
    );
}

// ─── Logged out / loading ─────────────────────────────────────────────────────
function LoggedOut({ setLoginOpen }) {
    return (
        <Card>
            <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
                <span className="flex size-14 items-center justify-center rounded-md border border-base-content/15 bg-base-300">
                    <User size={24} className="text-base-content/55" />
                </span>
                <div>
                    <p className="text-lg font-semibold text-base-content">You're not signed in</p>
                    <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-base-content/65">Sign in to manage your account and keep your preferences with you.</p>
                </div>
                <PrimaryButton onClick={() => setLoginOpen?.()}>
                    <LogIn size={15} /> Sign in
                </PrimaryButton>
            </div>
        </Card>
    );
}

function ProfileSkeleton() {
    return (
        <div className="w-full animate-pulse space-y-6" aria-busy="true" aria-label="Loading profile">
            <div className="flex items-center gap-4 border-b border-base-content/10 pb-6">
                <div className="size-16 rounded-md bg-base-200" />
                <div className="space-y-2">
                    <div className="h-6 w-48 rounded-md bg-base-200" />
                    <div className="h-4 w-64 rounded-md bg-base-200" />
                </div>
            </div>
            <div className="h-56 rounded-md border border-base-content/10 bg-base-200" />
            <div className="h-40 rounded-md border border-base-content/10 bg-base-200" />
        </div>
    );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ProfileSection({ handleLogout, setLoginOpen }) {
    const { user, loading, isApproved, isPending, isBlocked, isExpired, isAdmin, permissions, updateMe } = useAuth();
    const { history, watchlist, favourites } = useApi();
    const { theme, allThemes } = useTheme();
    const [, setSearchParams] = useSearchParams();

    // Profile form
    const [name, setName] = useState("");
    const [avatar, setAvatar] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [profileMsg, setProfileMsg] = useState(null);
    const fileRef = useRef(null);

    // Password form
    const [pw, setPw] = useState("");
    const [pw2, setPw2] = useState("");
    const [showPw, setShowPw] = useState(false);
    const [pwSaving, setPwSaving] = useState(false);
    const [pwMsg, setPwMsg] = useState(null);

    // Permissions
    const [permFilter, setPermFilter] = useState("all");
    const [permQuery, setPermQuery] = useState("");

    // Sessions (all devices signed in with this account)
    const [sessions, setSessions] = useState([]);
    const [sessState, setSessState] = useState("loading"); // loading | ok | unsupported | error
    const [sessMsg, setSessMsg] = useState(null);
    const [revokeTarget, setRevokeTarget] = useState(null);
    const [revokeAllOpen, setRevokeAllOpen] = useState(false);
    const [sessBusy, setSessBusy] = useState(false);
    const unsupportedRef = useRef(false);

    const [signOutOpen, setSignOutOpen] = useState(false);
    const [activeSec, setActiveSec] = useState("pf-profile");
    const device = useMemo(() => parseUA(navigator.userAgent), []);

    const hasUser = !!user;
    const uid = user?.id ?? user?.email ?? null;
    const dirty = hasUser && (name.trim() !== (user.name || "") || (avatar || null) !== (user.avatar || null));

    // Reset the form whenever the saved user changes
    useEffect(() => {
        setName(user?.name || "");
        setAvatar(user?.avatar || null);
    }, [user?.name, user?.avatar]);

    useEffect(() => {
        if (!profileMsg?.ok) return;
        const t = setTimeout(() => setProfileMsg(null), 2800);
        return () => clearTimeout(t);
    }, [profileMsg]);

    useEffect(() => {
        if (!sessMsg?.ok) return;
        const t = setTimeout(() => setSessMsg(null), 3200);
        return () => clearTimeout(t);
    }, [sessMsg]);

    // Warn before leaving with unsaved profile changes. Ctrl/Cmd+S saves.
    useEffect(() => {
        if (!dirty) return;
        const warn = (e) => {
            e.preventDefault();
            e.returnValue = "";
        };
        const onKey = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
                e.preventDefault();
                saveProfile();
            }
        };
        window.addEventListener("beforeunload", warn);
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("beforeunload", warn);
            window.removeEventListener("keydown", onKey);
        };
    }); // eslint-disable-line react-hooks/exhaustive-deps

    // Highlight the current section in the jump bar
    useEffect(() => {
        if (loading || !hasUser) return;
        const els = NAV.map(([id]) => document.getElementById(id)).filter(Boolean);
        if (!els.length) return;
        const io = new IntersectionObserver(
            (entries) => {
                const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
                if (vis[0]) setActiveSec(vis[0].target.id);
            },
            { rootMargin: "-130px 0px -60% 0px" },
        );
        els.forEach((el) => io.observe(el));
        return () => io.disconnect();
    }, [loading, hasUser]);

    // ── Sessions ──
    const loadSessions = useCallback(async (silent = false) => {
        if (!silent) setSessState("loading");
        try {
            const data = await api.get(SESSIONS_URL);
            const list = (Array.isArray(data) ? data : data?.sessions) || [];
            unsupportedRef.current = false;
            setSessions(list.map(normSession).sort((a, b) => Number(b.current) - Number(a.current) || new Date(b.lastActiveAt || 0) - new Date(a.lastActiveAt || 0)));
            setSessState("ok");
        } catch (err) {
            if ([404, 405, 501].includes(err?.status)) {
                unsupportedRef.current = true;
                setSessState("unsupported");
            } else if (!silent) setSessState("error");
        }
    }, []);

    useEffect(() => {
        if (!uid) return;
        loadSessions();
        const poll = setInterval(() => !unsupportedRef.current && !document.hidden && loadSessions(true), 60000);
        const onFocus = () => !unsupportedRef.current && loadSessions(true);
        window.addEventListener("focus", onFocus);
        return () => {
            clearInterval(poll);
            window.removeEventListener("focus", onFocus);
        };
    }, [uid, loadSessions]);

    async function revokeOne() {
        const target = revokeTarget;
        if (!target) return;
        setSessBusy(true);
        try {
            await api.delete(`${SESSIONS_URL}/${encodeURIComponent(target.id)}`);
            setSessMsg({ ok: true, text: `Signed out ${target.browser} on ${target.os}.` });
            await loadSessions(true);
        } catch (err) {
            setSessMsg({ ok: false, text: err?.message || "Could not sign that device out." });
        } finally {
            setSessBusy(false);
            setRevokeTarget(null);
        }
    }

    async function revokeOthers() {
        setSessBusy(true);
        try {
            await api.delete(SESSIONS_URL);
            setSessMsg({ ok: true, text: "Signed out all other devices." });
            await loadSessions(true);
        } catch (err) {
            setSessMsg({ ok: false, text: err?.message || "Could not sign out other devices." });
        } finally {
            setSessBusy(false);
            setRevokeAllOpen(false);
        }
    }

    // Watch activity (approximate: finished = full length, otherwise last position)
    const stats = useMemo(() => {
        const items = Array.isArray(history) ? history : [];
        let secs = 0;
        let done = 0;
        for (const h of items) {
            const d = Number(h.duration) || 0;
            const p = Number(h.position) || 0;
            if (h.completed) {
                done++;
                secs += d;
            } else secs += p;
        }
        return { titles: items.length, done, secs };
    }, [history]);

    const permEntries = useMemo(() => (permissions ? Object.entries(permissions) : []), [permissions]);
    const permShown = useMemo(() => {
        const q = permQuery.trim().toLowerCase();
        return permEntries.filter(([k, v]) => (permFilter === "all" || (permFilter === "allowed" ? v : !v)) && (!q || k.toLowerCase().includes(q)));
    }, [permEntries, permFilter, permQuery]);

    if (loading) return <ProfileSkeleton />;
    if (!user) return <LoggedOut setLoginOpen={setLoginOpen} />;

    const displayName = user.name || user.email?.split("@")[0] || "User";
    const role = user.role || "member";
    const status = user.status || (isApproved ? "approved" : isPending ? "pending" : isBlocked ? "blocked" : null);
    const isTemporary = user.accessType === "temporary";
    const expiryDays = isTemporary ? daysLeft(user.accessExpiresAt) : null;
    const memberSince = fmtDate(user.createdAt);
    const lastLogin = user.lastLoginAt ? fmtDate(user.lastLoginAt, true) : null;

    // Remaining share of a temporary access window (needs both dates)
    let accessPct = null;
    if (isTemporary && user.accessExpiresAt && user.createdAt) {
        const total = new Date(user.accessExpiresAt) - new Date(user.createdAt);
        const left = new Date(user.accessExpiresAt) - Date.now();
        if (total > 0) accessPct = Math.max(0, Math.min(100, Math.round((left / total) * 100)));
    }
    const accessBar = isExpired || (expiryDays != null && expiryDays <= 0) ? "bg-error" : expiryDays != null && expiryDays <= 3 ? "bg-warning" : "bg-primary";
    const grantedCount = permEntries.filter(([, v]) => v).length;

    // Quick view of the settings that matter most
    const prefs = loadPrefs();
    const themeLabel = (allThemes || []).find((t) => t.id === theme)?.label || "Default";
    const limit = RATING_LIMITS.find((l) => l.id === (prefs.maxRating ?? "all")) || RATING_LIMITS[0];
    const pinOn = hasPin();
    const goTab = (t) => {
        setSearchParams({ tab: t });
        window.scrollTo({ top: 0 });
    };
    const jump = (id) => {
        setActiveSec(id);
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    // Setup progress
    const accessStable = !isExpired && (!isTemporary || expiryDays == null || expiryDays > 7);
    const steps = [
        { id: "photo", label: "Add a profile photo", done: !!user.avatar, run: () => fileRef.current?.click() },
        { id: "name", label: "Set a display name", done: !!user.name, run: () => document.getElementById("pf-name")?.focus() },
        { id: "pin", label: "Set a restriction PIN", done: pinOn, run: () => goTab("restrictions") },
        { id: "approved", label: "Get your account approved", done: !!isApproved },
        { id: "access", label: "Renew your access", done: accessStable },
    ];
    const doneCount = steps.filter((s) => s.done).length;
    const next = steps.find((s) => !s.done && s.run);

    // ── Profile form ──
    async function onAvatarUpload(file) {
        const key = import.meta.env.VITE_IMGBB_API_KEY;
        if (!key) throw new Error("Photo upload isn't configured on this server.");
        const fd = new FormData();
        fd.append("image", file);
        const r = await fetch(`https://api.imgbb.com/1/upload?key=${key}`, { method: "POST", body: fd });
        if (!r.ok) throw new Error("Photo upload failed.");
        return (await r.json()).data.display_url;
    }

    async function pickFile(e) {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        if (!file.type.startsWith("image/")) return setProfileMsg({ ok: false, text: "Choose an image file." });
        if (file.size > 5 * 1024 * 1024) return setProfileMsg({ ok: false, text: "Image must be under 5 MB." });
        setProfileMsg(null);
        const before = avatar;
        const previewUrl = URL.createObjectURL(file); // sync, so it can't land after a failure restore
        setAvatar(previewUrl);
        setUploading(true);
        try {
            const url = await onAvatarUpload(file);
            setAvatar(url || before);
        } catch (err) {
            setAvatar(before);
            setProfileMsg({ ok: false, text: err.message || "Upload failed" });
        } finally {
            URL.revokeObjectURL(previewUrl);
            setUploading(false);
        }
    }

    async function saveProfile() {
        if (!user || !name.trim()) return setProfileMsg({ ok: false, text: "Display name is required." });
        setSaving(true);
        setProfileMsg(null);
        try {
            await updateMe({ name: name.trim(), avatar });
            setProfileMsg({ ok: true, text: "Profile saved." });
        } catch (err) {
            setProfileMsg({ ok: false, text: err.message || "Save failed" });
        } finally {
            setSaving(false);
        }
    }

    function resetProfile() {
        setName(user.name || "");
        setAvatar(user.avatar || null);
        setProfileMsg(null);
    }

    // ── Password form ──
    const score = passwordScore(pw);
    const mismatch = pw2.length > 0 && pw !== pw2;
    const canUpdatePw = pw.length >= 6 && pw === pw2;

    async function savePassword() {
        if (!canUpdatePw) return;
        setPwSaving(true);
        setPwMsg(null);
        try {
            await updateMe({ password: pw });
            setPw("");
            setPw2("");
            setShowPw(false);
            setPwMsg({ ok: true, text: "Password updated." });
        } catch (err) {
            setPwMsg({ ok: false, text: err.message || "Could not change password" });
        } finally {
            setPwSaving(false);
        }
    }

    // Sessions to show. When the server can't list devices, fall back to this one.
    const shownSessions =
        sessState === "unsupported"
            ? [{ id: "local", current: true, browser: device.browser, os: device.os, kind: device.kind, ip: null, location: null, createdAt: null, lastActiveAt: null }]
            : sessions;
    const others = sessions.filter((s) => !s.current).length;

    return (
        <div className="w-full">
            <StatusBanner isPending={isPending} isBlocked={isBlocked} isExpired={isExpired} />

            {/* ── Summary ── */}
            <div className="flex flex-wrap items-center gap-4 pb-6 pt-1">
                <Avatar src={user.avatar} name={user.name} email={user.email} size={68} approved={isApproved} />
                <div className="min-w-0 flex-1">
                    <h2 className="truncate text-2xl font-bold leading-tight tracking-tight text-base-content">{displayName}</h2>
                    {user.email && <p className="mt-0.5 truncate text-[13px] text-base-content/65">{user.email}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <Chip tone={ROLE_TONE[role] || "neutral"}>
                            {isAdmin && <ShieldCheck size={12} />}
                            {cap(role)}
                        </Chip>
                        {status && (
                            <Chip tone={STATUS_TONE[status] || "neutral"}>
                                <span className={`size-1.5 rounded-sm ${STATUS_DOT[status] || "bg-base-content/50"}`} />
                                {cap(status)}
                            </Chip>
                        )}
                        {memberSince && <span className="text-xs text-base-content/55">Member since {memberSince}</span>}
                    </div>
                </div>
                <GhostButton onClick={() => setSignOutOpen(true)} className="border-error/40 text-error hover:bg-error/10 hover:text-error">
                    <LogOut size={13} /> Sign out
                </GhostButton>
            </div>

            {/* ── Jump bar ── */}
            <nav aria-label="On this page" className="border-y border-base-content/10 bg-base-100/90 backdrop-blur md:sticky md:top-14 md:z-20">
                <div className="flex gap-1 overflow-x-auto py-1.5" style={{ scrollbarWidth: "none" }}>
                    {NAV.map(([id, label]) => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => jump(id)}
                            aria-current={activeSec === id ? "true" : undefined}
                            className={`shrink-0 cursor-pointer whitespace-nowrap rounded-md px-3 py-2 text-[13px] font-medium transition-colors ${FOCUS} ${
                                activeSec === id ? "bg-primary/12 text-primary" : "text-base-content/65 hover:bg-base-content/8 hover:text-base-content"
                            }`}>
                            {label}
                        </button>
                    ))}
                </div>
            </nav>

            {/* ── Setup progress ── */}
            {doneCount < steps.length && (
                <div id="pf-checklist" className="mt-6 scroll-mt-32 rounded-md border border-primary/30 bg-primary/5 p-4 sm:p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-base-content">Finish setting up your account</p>
                            <p className="mt-0.5 text-[13px] text-base-content/65">
                                {doneCount} of {steps.length} steps done
                                {next ? `. Next: ${next.label.toLowerCase()}.` : "."}
                            </p>
                        </div>
                        {next && (
                            <PrimaryButton onClick={next.run} className="shrink-0">
                                {next.label} <ArrowRight size={14} />
                            </PrimaryButton>
                        )}
                    </div>
                    <div className="mt-3.5 flex gap-1" role="progressbar" aria-valuenow={doneCount} aria-valuemin={0} aria-valuemax={steps.length} aria-label="Setup progress">
                        {steps.map((s) => (
                            <span key={s.id} title={s.label} className={`h-1.5 flex-1 rounded-md ${s.done ? "bg-primary" : "bg-base-content/15"}`} />
                        ))}
                    </div>
                </div>
            )}

            {/* ── Profile ── */}
            <Section id="pf-profile" title="Profile" desc="Your photo and name are visible to other people on this server.">
                <Card>
                    <div className="space-y-5 p-4 sm:p-5">
                        <div className="flex items-center gap-4">
                            <div className="relative">
                                <Avatar src={avatar} name={name || user.name} email={user.email} size={72} />
                                {uploading && (
                                    <span className="absolute inset-0 flex items-center justify-center rounded-md bg-black/60">
                                        <span className="loading loading-spinner loading-sm text-white" />
                                    </span>
                                )}
                            </div>
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <GhostButton onClick={() => fileRef.current?.click()} disabled={uploading}>
                                        <Camera size={13} /> {avatar ? "Change photo" : "Upload photo"}
                                    </GhostButton>
                                    {avatar && (
                                        <button
                                            type="button"
                                            onClick={() => setAvatar(null)}
                                            className={`cursor-pointer rounded-md px-2 py-2 text-[13px] text-base-content/60 hover:text-error ${FOCUS}`}>
                                            Remove
                                        </button>
                                    )}
                                </div>
                                <p className="mt-1.5 text-xs text-base-content/55">PNG or JPG, up to 5 MB.</p>
                            </div>
                            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickFile} />
                        </div>

                        <Field id="pf-name" label="Display name" required>
                            <Input
                                id="pf-name"
                                name="name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && dirty && saveProfile()}
                                placeholder="Your name"
                                maxLength={40}
                                className="sm:max-w-sm"
                            />
                        </Field>
                    </div>
                    <CardFooter hint={profileMsg ? <Msg m={profileMsg} /> : dirty ? "You have unsaved changes. Press Ctrl+S to save." : "Up to date."}>
                        {dirty && <GhostButton onClick={resetProfile}>Discard</GhostButton>}
                        <PrimaryButton onClick={saveProfile} disabled={!dirty || !name.trim() || uploading} loading={saving}>
                            {saving ? "Saving…" : "Save changes"}
                        </PrimaryButton>
                    </CardFooter>
                </Card>
            </Section>

            {/* ── Account ── */}
            <Section id="pf-account" title="Account" desc="Details managed by your administrator.">
                <Card>
                    <dl>
                        <KV label="Email" action={user.email ? <CopyButton text={user.email} label="Copy email" /> : null}>
                            <span className="truncate">{user.email || "Not set"}</span>
                        </KV>
                        <KV label="Role">
                            <Chip tone={ROLE_TONE[role] || "neutral"}>{cap(role)}</Chip>
                        </KV>
                        <KV label="Status">
                            {status ? (
                                <Chip tone={STATUS_TONE[status] || "neutral"}>
                                    <span className={`size-1.5 rounded-sm ${STATUS_DOT[status] || "bg-base-content/50"}`} />
                                    {cap(status)}
                                </Chip>
                            ) : (
                                <span className="text-base-content/45">Unknown</span>
                            )}
                        </KV>
                        <KV label="Access">
                            <span>{isTemporary ? "Temporary" : "Permanent"}</span>
                            {isTemporary && expiryDays != null && (
                                <span className={`text-xs font-normal ${expiryDays <= 3 ? "text-warning" : "text-base-content/55"}`}>
                                    {expiryDays > 0 ? `${expiryDays} day${expiryDays === 1 ? "" : "s"} left` : "Expired"}
                                </span>
                            )}
                        </KV>
                        {accessPct != null && (
                            <div className="border-b border-base-content/10 px-4 py-3 sm:px-5">
                                <div
                                    className="h-1.5 overflow-hidden rounded-md bg-base-content/15"
                                    role="progressbar"
                                    aria-valuenow={accessPct}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-label="Access time remaining">
                                    <div className={`h-full rounded-md ${accessBar}`} style={{ width: `${accessPct}%` }} />
                                </div>
                                <p className="mt-1.5 text-xs text-base-content/55">Ends {fmtDate(user.accessExpiresAt, true)}</p>
                            </div>
                        )}
                        {memberSince && <KV label="Member since">{memberSince}</KV>}
                        {lastLogin && <KV label="Last sign-in">{lastLogin}</KV>}
                        {user.id && (
                            <KV label="Account ID" action={<CopyButton text={String(user.id)} label="Copy account ID" />}>
                                <span className="truncate font-mono text-[13px]">{String(user.id)}</span>
                            </KV>
                        )}
                    </dl>
                </Card>
            </Section>

            {/* ── Password ── */}
            <Section id="pf-password" title="Password" desc="Use a long, unique password. You stay signed in on this device after changing it.">
                <Card>
                    <div className="space-y-4 p-4 sm:p-5">
                        <Field id="pf-pw" label="New password">
                            <div className="relative sm:max-w-sm">
                                <Input
                                    id="pf-pw"
                                    name="password"
                                    type={showPw ? "text" : "password"}
                                    autoComplete="new-password"
                                    value={pw}
                                    onChange={(e) => setPw(e.target.value)}
                                    className="pr-10"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPw((v) => !v)}
                                    aria-label={showPw ? "Hide password" : "Show password"}
                                    className={`absolute right-1 top-1/2 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-base-content/55 hover:text-base-content ${FOCUS}`}>
                                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                                </button>
                            </div>
                        </Field>

                        {pw && (
                            <div className="sm:max-w-sm" aria-live="polite">
                                <div className="flex gap-1">
                                    {[1, 2, 3, 4].map((i) => (
                                        <span key={i} className={`h-1 flex-1 rounded-md ${i <= score ? STRENGTH[score].bar : "bg-base-content/15"}`} />
                                    ))}
                                </div>
                                <p className="mt-1.5 text-xs text-base-content/60">Strength: {STRENGTH[score].label}</p>
                            </div>
                        )}

                        <Field id="pf-pw2" label="Confirm new password">
                            <Input
                                id="pf-pw2"
                                name="confirm"
                                type={showPw ? "text" : "password"}
                                autoComplete="new-password"
                                value={pw2}
                                onChange={(e) => setPw2(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && savePassword()}
                                className={`sm:max-w-sm ${mismatch ? "border-error" : ""}`}
                            />
                            {mismatch && <p className="text-xs text-error">Passwords don't match.</p>}
                        </Field>
                    </div>
                    <CardFooter hint={pwMsg ? <Msg m={pwMsg} /> : "At least 6 characters."}>
                        <PrimaryButton onClick={savePassword} disabled={!canUpdatePw} loading={pwSaving}>
                            <KeyRound size={14} /> Update password
                        </PrimaryButton>
                    </CardFooter>
                </Card>
            </Section>

            {/* ── Activity ── */}
            <Section id="pf-activity" title="Activity" desc="Estimated from your watch history.">
                <StatGrid cols="grid-cols-2">
                    <StatTile icon={PlayCircle} label="Titles started" value={stats.titles} />
                    <StatTile icon={CheckCircle2} label="Finished" value={stats.done} tone="ok" />
                    <StatTile icon={Timer} label="Watch time" value={fmtDuration(stats.secs)} />
                    <StatTile icon={Bookmark} label="Watchlist / favourites" value={`${watchlist?.length ?? 0} / ${favourites?.length ?? 0}`} />
                </StatGrid>
            </Section>

            {/* ── Your setup ── */}
            <Section id="pf-prefs" title="Your setup" desc="A quick view of the settings that shape how Flux looks and plays.">
                <Card>
                    <PrefRow icon={Palette} label="Theme" value={themeLabel} tab="appearance" onGo={goTab} />
                    <PrefRow
                        icon={Play}
                        label="Auto-play and speed"
                        value={`${(prefs.autoplay ?? true) ? "Auto-play on" : "Auto-play off"}, ${prefs.speed ?? "1.0"}× speed`}
                        tab="playback"
                        onGo={goTab}
                    />
                    <PrefRow icon={Captions} label="Subtitles" value={(prefs.subtitles ?? false) ? "On by default" : "Off by default"} tab="subtitles" onGo={goTab} />
                    <PrefRow icon={Lock} label="Content limit" value={`${limit.id === "all" ? "No limit" : `Up to ${limit.label}`}${pinOn ? ", PIN on" : ""}`} tab="restrictions" onGo={goTab} />
                </Card>
            </Section>

            {/* ── Permissions ── */}
            <Section id="pf-permissions" title="Permissions" desc="What your account is allowed to do.">
                {isAdmin ? (
                    <Notice tone="info" icon={ShieldCheck} title="Administrator">
                        You skip individual permission checks and can use every part of Flux.
                    </Notice>
                ) : permEntries.length === 0 ? (
                    <Card>
                        <p className="px-5 py-8 text-center text-[13px] text-base-content/60">No specific permissions are assigned to this account.</p>
                    </Card>
                ) : (
                    <Card>
                        <div className="flex flex-col gap-3 border-b border-base-content/10 p-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                            <div className="relative sm:w-56">
                                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base-content/50" />
                                <input
                                    type="text"
                                    value={permQuery}
                                    onChange={(e) => setPermQuery(e.target.value)}
                                    aria-label="Filter permissions"
                                    placeholder="Filter"
                                    className="h-9 w-full rounded-md border-0 bg-base-300 pl-9 pr-3 text-[13px] text-base-content placeholder:text-base-content/45 transition-colors hover:bg-base-content/10 focus:bg-base-100 focus:outline-none"
                                />
                            </div>
                            <div role="radiogroup" aria-label="Show" className="flex gap-1 rounded-md bg-base-300 p-1">
                                {[
                                    ["all", `All ${permEntries.length}`],
                                    ["allowed", `Allowed ${grantedCount}`],
                                    ["denied", `Blocked ${permEntries.length - grantedCount}`],
                                ].map(([id, label]) => (
                                    <button
                                        key={id}
                                        type="button"
                                        role="radio"
                                        aria-checked={permFilter === id}
                                        onClick={() => setPermFilter(id)}
                                        className={`flex-1 cursor-pointer whitespace-nowrap rounded-[4px] px-3 py-1.5 text-xs font-medium transition-colors ${FOCUS} ${
                                            permFilter === id ? "bg-primary text-primary-content" : "text-base-content/70 hover:bg-base-content/10 hover:text-base-content"
                                        }`}>
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        {permShown.length === 0 ? (
                            <p className="px-5 py-8 text-center text-[13px] text-base-content/60">No permissions match.</p>
                        ) : (
                            <ul className="grid gap-px bg-base-content/10 sm:grid-cols-2">
                                {permShown.map(([k, v]) => (
                                    <li key={k} className="flex items-center gap-3 bg-base-200 px-4 py-2.5 sm:px-5">
                                        {v ? <Unlock size={14} className="shrink-0 text-success" /> : <Lock size={14} className="shrink-0 text-base-content/40" />}
                                        <span className={`min-w-0 flex-1 truncate font-mono text-[13px] ${v ? "text-base-content" : "text-base-content/55"}`}>{k}</span>
                                        <span className={`shrink-0 text-xs ${v ? "text-success" : "text-base-content/50"}`}>{v ? "Allowed" : "Blocked"}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Card>
                )}
            </Section>

            {/* ── Sessions ── */}
            <Section id="pf-sessions" title="Sessions" desc="Every device signed in to this account. Sign out any you don't recognise.">
                <Card>
                    <div className="flex items-center justify-between gap-3 border-b border-base-content/10 px-4 py-3 sm:px-5">
                        <p className="text-sm font-semibold text-base-content">
                            Signed-in devices
                            {sessState === "ok" && <span className="ml-2 rounded-md bg-base-content/10 px-1.5 py-0.5 text-[11px] font-medium text-base-content/70">{sessions.length}</span>}
                        </p>
                        <button
                            type="button"
                            onClick={() => loadSessions()}
                            disabled={sessState === "loading" || sessState === "unsupported"}
                            aria-label="Refresh devices"
                            title="Refresh"
                            className={`flex size-8 cursor-pointer items-center justify-center rounded-md text-base-content/55 transition-colors hover:bg-base-content/10 hover:text-base-content disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS}`}>
                            <RefreshCw size={14} className={sessState === "loading" ? "animate-spin" : ""} />
                        </button>
                    </div>

                    {sessState === "loading" && (
                        <ul aria-busy="true" className="animate-pulse">
                            {[0, 1].map((i) => (
                                <li key={i} className="flex items-center gap-3 border-b border-base-content/10 px-4 py-3.5 last:border-b-0 sm:px-5">
                                    <span className="size-10 rounded-md bg-base-300" />
                                    <span className="flex-1 space-y-2">
                                        <span className="block h-3.5 w-40 rounded-md bg-base-300" />
                                        <span className="block h-3 w-28 rounded-md bg-base-300/70" />
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}

                    {sessState === "error" && (
                        <div className="flex flex-col items-start gap-3 px-4 py-5 sm:px-5">
                            <p role="alert" className="text-[13px] text-error">
                                Could not load your devices.
                            </p>
                            <GhostButton onClick={() => loadSessions()}>
                                <RefreshCw size={13} /> Try again
                            </GhostButton>
                        </div>
                    )}

                    {(sessState === "ok" || sessState === "unsupported") && (
                        <>
                            {sessState === "unsupported" && (
                                <p className="border-b border-base-content/10 bg-base-300/40 px-4 py-2.5 text-xs text-base-content/60 sm:px-5">
                                    The server doesn't report other devices yet, so only this one is shown.
                                </p>
                            )}
                            <ul>
                                {shownSessions.map((s) => (
                                    <SessionRow key={s.id} s={s} onRevoke={setRevokeTarget} />
                                ))}
                            </ul>
                        </>
                    )}

                    <CardFooter hint={sessMsg ? <Msg m={sessMsg} /> : sessState === "ok" && others === 0 ? "No other devices are signed in." : "Signing a device out ends its session immediately."}>
                        <GhostButton onClick={() => setSignOutOpen(true)}>
                            <LogOut size={13} /> Sign out here
                        </GhostButton>
                        {sessState === "ok" && (
                            <DangerButton onClick={() => setRevokeAllOpen(true)} disabled={others === 0}>
                                Sign out other devices{others > 0 ? ` (${others})` : ""}
                            </DangerButton>
                        )}
                    </CardFooter>
                </Card>
            </Section>

            <ConfirmModal
                open={signOutOpen}
                onClose={() => setSignOutOpen(false)}
                title="Sign out of Flux?"
                subtitle="You'll need to sign in again to keep watching on this device."
                confirmLabel="Sign out"
                onConfirm={() => {
                    setSignOutOpen(false);
                    handleLogout?.();
                }}
            />
            <ConfirmModal
                open={!!revokeTarget}
                onClose={() => setRevokeTarget(null)}
                title="Sign this device out?"
                subtitle={revokeTarget ? `${revokeTarget.browser} on ${revokeTarget.os} will be signed out right away.` : ""}
                confirmLabel="Sign out device"
                loading={sessBusy}
                onConfirm={revokeOne}
            />
            <ConfirmModal
                open={revokeAllOpen}
                onClose={() => setRevokeAllOpen(false)}
                title="Sign out all other devices?"
                subtitle={`${others} other device${others === 1 ? "" : "s"} will be signed out. This device stays signed in.`}
                confirmLabel="Sign out others"
                loading={sessBusy}
                onConfirm={revokeOthers}
            />
        </div>
    );
}
