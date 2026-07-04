import { useMemo, useState } from "react";
import {
    Scale,
    User,
    Building2,
    Globe,
    BookOpen,
    GitBranch,
    Bug,
    Tag,
    Layers,
    Briefcase,
    Home,
    Wrench,
    Share2,
    Server,
    FileCheck2,
    Cpu,
    Code2,
    Copyright,
    FileText,
    History,
    ShieldOff,
    AlertTriangle,
    LifeBuoy,
    Gavel,
    Image,
    Palette,
    Clapperboard,
    Database,
    Mail,
    BadgeCheck,
    Check,
    X,
    ChevronDown,
    ExternalLink,
    Copy,
    Download,
    Printer,
    Search,
    Info,
    Clock,
    CheckCircle2,
    XCircle,
    Ban,
    GitPullRequest,
} from "lucide-react";

// ---- icon lookup -----------------------------------------------------
const ICONS = {
    Scale, User, Building2, Globe, BookOpen, GitBranch, Bug, Tag, Layers,
    Briefcase, Home, Wrench, Share2, Server, FileCheck2, Cpu, Code2,
    Copyright, FileText, History, ShieldOff, AlertTriangle, LifeBuoy, Gavel,
    Image, Palette, Clapperboard, Database, Mail, BadgeCheck, Check, X,
    Info, Clock, Ban, GitPullRequest,
};

export function Icon({ name, className = "w-4 h-4" }) {
    const Cmp = ICONS[name] || Info;
    return <Cmp className={className} strokeWidth={1.75} />;
}

// ---- status badge ------------------------------------------------------
const STATUS_MAP = {
    allowed: { label: "Allowed", icon: CheckCircle2, cls: "text-success bg-success/10" },
    limited: { label: "Limited", icon: AlertTriangle, cls: "text-warning bg-warning/10" },
    "not-allowed": { label: "Not Allowed", icon: XCircle, cls: "text-error bg-error/10" },
};

export function StatusBadge({ status }) {
    const s = STATUS_MAP[status] || STATUS_MAP.limited;
    const S = s.icon;
    return (
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-md shrink-0 ${s.cls}`}>
            <S className="w-3.5 h-3.5" strokeWidth={2} />
            {s.label}
        </span>
    );
}

// ---- hero: license status card ----------------------------------------
export function LicenseStatusCard({ status }) {
    const rows = [
        { label: "License Type", value: status.licenseType },
        { label: "Current Version", value: status.version },
        { label: "Build Version", value: status.buildVersion },
        { label: "Release Date", value: status.releaseDate },
        { label: "Copyright", value: status.copyright },
    ];
    return (
        <div className="bg-base-200 rounded-xl border border-base-content/8 p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Scale className="w-4.5 h-4.5 text-primary" strokeWidth={1.75} />
                    </div>
                    <p className="text-sm font-medium text-base-content/95">License Status</p>
                </div>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md text-success bg-success/10 shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-success" />
                    {status.status === "active" ? "Active" : status.status}
                </span>
            </div>
            <dl className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                {rows.map((r) => (
                    <div key={r.label} className="min-w-0">
                        <dt className="text-[11px] text-base-content/60 mb-1">{r.label}</dt>
                        <dd className="text-sm text-base-content/95 font-medium truncate" title={r.value}>{r.value}</dd>
                    </div>
                ))}
            </dl>
        </div>
    );
}

// ---- quick overview grid ----------------------------------------------
export function QuickOverviewGrid({ items }) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map((item) => (
                <div key={item.label} className="flex items-start gap-3 bg-base-200 rounded-lg px-4 py-3.5 border border-base-content/6">
                    <div className="w-8 h-8 rounded-md bg-base-300 flex items-center justify-center shrink-0 mt-0.5">
                        <Icon name={item.icon} className="w-4 h-4 text-base-content/80" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-[11px] text-base-content/60">{item.label}</p>
                        <p className="text-sm text-base-content/95 font-medium truncate">{item.value}</p>
                    </div>
                </div>
            ))}
        </div>
    );
}

// ---- permission / condition / limitation cards -------------------------
export function PermissionCard({ icon, title, status, description }) {
    return (
        <div className="bg-base-200 rounded-lg border border-base-content/6 p-4 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
                <div className="w-8 h-8 rounded-md bg-base-300 flex items-center justify-center shrink-0">
                    <Icon name={icon} className="w-4 h-4 text-base-content/80" />
                </div>
                <StatusBadge status={status} />
            </div>
            <div>
                <p className="text-sm font-medium text-base-content/95">{title}</p>
                <p className="text-xs text-base-content/70 mt-1 leading-relaxed">{description}</p>
            </div>
        </div>
    );
}

export function ConditionCard({ icon, title, description }) {
    return (
        <div className="bg-base-200 rounded-lg border border-base-content/6 p-4 flex gap-3">
            <div className="w-8 h-8 rounded-md bg-info/10 flex items-center justify-center shrink-0">
                <Icon name={icon} className="w-4 h-4 text-info" />
            </div>
            <div className="min-w-0">
                <p className="text-sm font-medium text-base-content/95">{title}</p>
                <p className="text-xs text-base-content/70 mt-1 leading-relaxed">{description}</p>
            </div>
        </div>
    );
}

export function LimitationCard({ icon, title, description }) {
    return (
        <div className="bg-base-200 rounded-lg border border-warning/20 p-4 flex gap-3">
            <div className="w-8 h-8 rounded-md bg-warning/10 flex items-center justify-center shrink-0">
                <Icon name={icon} className="w-4 h-4 text-warning" />
            </div>
            <div className="min-w-0">
                <p className="text-sm font-medium text-base-content/95">{title}</p>
                <p className="text-xs text-base-content/70 mt-1 leading-relaxed">{description}</p>
            </div>
        </div>
    );
}

// ---- dependency card ----------------------------------------------------
export function DependencyCard({ name, version, author, license = "MIT", url, description }) {
    return (
        <div className="flex items-start justify-between gap-4 py-3 border-b border-base-content/6 last:border-0">
            <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-base-content/95 hover:text-primary transition-colors duration-150 inline-flex items-center gap-1">
                        {name}
                        <ExternalLink className="w-3 h-3 text-base-content/55" strokeWidth={1.75} />
                    </a>
                    <span className="text-[10px] font-mono text-base-content/55">{version}</span>
                </div>
                <p className="text-xs text-base-content/60 mt-0.5">{author}</p>
                {description ? <p className="text-xs text-base-content/60 mt-0.5">{description}</p> : null}
            </div>
            <span className="shrink-0 text-[10px] font-mono text-primary/60 bg-primary/8 px-2 py-0.5 rounded h-fit">{license}</span>
        </div>
    );
}

// ---- info banner ----------------------------------------------------------
export function InfoBanner({ icon = "Info", tone = "info", children }) {
    const tones = {
        info: "border-info/20 bg-info/8 text-info",
        warning: "border-warning/20 bg-warning/8 text-warning",
        neutral: "border-base-content/10 bg-base-200 text-base-content/80",
    };
    return (
        <div className={`flex items-start gap-3 rounded-lg border p-4 ${tones[tone] || tones.info}`}>
            <Icon name={icon} className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="text-sm leading-relaxed text-base-content/85">{children}</div>
        </div>
    );
}

// ---- collapsible full license text viewer ---------------------------------
export function LicenseTextViewer({ text, fileName = "LICENSE.txt" }) {
    const [expanded, setExpanded] = useState(false);
    const [query, setQuery] = useState("");
    const [copied, setCopied] = useState(false);

    const lines = useMemo(() => text.split("\n"), [text]);
    const matchCount = useMemo(() => {
        if (!query.trim()) return 0;
        const q = query.toLowerCase();
        return lines.filter((l) => l.toLowerCase().includes(q)).length;
    }, [lines, query]);

    async function handleCopy() {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // clipboard unavailable, ignore silently
        }
    }

    function handleDownload() {
        const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    function handlePrint() {
        const w = window.open("", "_blank", "noopener,noreferrer");
        if (!w) return;
        w.document.write(`<pre style="font-family:monospace;white-space:pre-wrap;padding:24px;">${text.replace(/</g, "&lt;")}</pre>`);
        w.document.close();
        w.focus();
        w.print();
    }

    return (
        <div className="bg-base-200 rounded-lg border border-base-content/8 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 border-b border-base-content/8">
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    aria-expanded={expanded}
                    className="btn btn-ghost btn-sm rounded-md border-none inline-flex items-center gap-1.5 text-base-content/85"
                >
                    <ChevronDown className={`w-4 h-4 transition-transform duration-150 ${expanded ? "rotate-180" : ""}`} strokeWidth={1.75} />
                    {expanded ? "Collapse" : "Expand"} license text
                </button>
                <div className="flex items-center gap-1.5">
                    <button type="button" onClick={handleCopy} aria-label="Copy license text" className="btn btn-ghost btn-sm rounded-md border-none">
                        <Copy className="w-4 h-4" strokeWidth={1.75} />
                        {copied ? "Copied" : "Copy"}
                    </button>
                    <button type="button" onClick={handleDownload} aria-label="Download license text" className="btn btn-ghost btn-sm rounded-md border-none">
                        <Download className="w-4 h-4" strokeWidth={1.75} />
                        Download
                    </button>
                    <button type="button" onClick={handlePrint} aria-label="Print license text" className="btn btn-ghost btn-sm rounded-md border-none">
                        <Printer className="w-4 h-4" strokeWidth={1.75} />
                        Print
                    </button>
                </div>
            </div>

            {expanded && (
                <div className="p-3 border-b border-base-content/8">
                    <label className="relative block">
                        <Search className="w-3.5 h-3.5 text-base-content/55 absolute left-3 top-1/2 -translate-y-1/2" strokeWidth={1.75} />
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search inside license text"
                            aria-label="Search inside license text"
                            className="input input-sm w-full rounded-md pl-9 bg-base-100"
                        />
                    </label>
                    {query.trim() ? <p className="text-[11px] text-base-content/60 mt-1.5">{matchCount} line{matchCount === 1 ? "" : "s"} match</p> : null}
                </div>
            )}

            {expanded && (
                <pre className="hs max-h-96 overflow-y-auto p-4 text-xs font-mono text-base-content/70 leading-relaxed whitespace-pre-wrap">
                    {lines.map((line, i) => {
                        const isMatch = query.trim() && line.toLowerCase().includes(query.toLowerCase());
                        return (
                            <div key={i} className={`flex gap-3 ${isMatch ? "bg-primary/10 -mx-4 px-4" : ""}`}>
                                <span className="text-base-content/45 select-none w-6 text-right shrink-0">{i + 1}</span>
                                <span>{line || "\u00A0"}</span>
                            </div>
                        );
                    })}
                </pre>
            )}
        </div>
    );
}

// ---- changelog timeline -----------------------------------------------
export function ChangelogTimeline({ entries }) {
    return (
        <ol className="relative border-l border-base-content/10 ml-2">
            {entries.map((entry, i) => (
                <li key={entry.version} className={`relative pl-6 ${i === entries.length - 1 ? "" : "pb-6"}`}>
                    <span className="absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full bg-primary" />
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-sm font-medium text-base-content/95">{entry.title}</span>
                        <span className="text-[10px] font-mono text-primary/60 bg-primary/8 px-2 py-0.5 rounded">v{entry.version}</span>
                        <span className="inline-flex items-center gap-1 text-[11px] text-base-content/60">
                            <Clock className="w-3 h-3" strokeWidth={1.75} />
                            {entry.date}
                        </span>
                    </div>
                    <ul className="space-y-1">
                        {entry.changes.map((c, ci) => (
                            <li key={ci} className="text-xs text-base-content/70 leading-relaxed">— {c}</li>
                        ))}
                    </ul>
                </li>
            ))}
        </ol>
    );
}

// ---- FAQ accordion -------------------------------------------------------
export function FAQAccordion({ items }) {
    const [openIndex, setOpenIndex] = useState(null);
    return (
        <div className="bg-base-200 rounded-lg border border-base-content/6 divide-y divide-base-content/6">
            {items.map((item, i) => {
                const open = openIndex === i;
                return (
                    <div key={item.q}>
                        <button
                            type="button"
                            onClick={() => setOpenIndex(open ? null : i)}
                            aria-expanded={open}
                            aria-controls={`faq-panel-${i}`}
                            className="w-full flex items-center justify-between gap-3 text-left px-4 py-3.5"
                        >
                            <span className="text-sm text-base-content/95 font-medium">{item.q}</span>
                            <ChevronDown className={`w-4 h-4 text-base-content/60 shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`} strokeWidth={1.75} />
                        </button>
                        {open && (
                            <div id={`faq-panel-${i}`} className="px-4 pb-4 text-sm text-base-content/70 leading-relaxed">
                                {item.a}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// ---- back to top button ---------------------------------------------------
export function BackToTopButton() {
    return (
        <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            aria-label="Back to top"
            className="btn btn-primary btn-sm rounded-md border-none fixed bottom-6 right-6 z-20 shadow-lg"
        >
            <ChevronDown className="w-4 h-4 rotate-180" strokeWidth={2} />
            Top
        </button>
    );
}
