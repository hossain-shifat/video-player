import { NavLink } from "react-router";

// ─── Data ─────────────────────────────────────────────────────────────────────

const NAV_LINKS = [
    { label: "Home", to: "/" },
    { label: "Movies", to: "/movies" },
    { label: "Series", to: "/series" },
    { label: "Live TV", to: "/live" },
    { label: "Watchlist", to: "/watchlist" },
    { label: "Settings", to: "/settings" },
];

const SERVER_LINKS = [
    { label: "Libraries", to: "/library" },
    { label: "Dashboard", to: "/dashboard" },
    { label: "Transcoding", to: "/settings#transcoding" },
    { label: "Hardware Accel.", to: "/settings#hardware" },
    { label: "API", to: "/api/info" },
    { label: "System Status", to: "/health" },
];

const LEGAL_LINKS = [
    { label: "Privacy Policy", to: "/privacy" },
    { label: "Terms of Use", to: "/terms" },
    { label: "DMCA", to: "/dmca" },
    { label: "Licenses", to: "/licenses" },
    { label: "Disclaimer", to: "/disclaimer" },
];

const OPEN_SOURCE_LINKS = [
    { label: "GitHub", href: "https://github.com" },
    { label: "Documentation", href: "#" },
    { label: "Report Issue", href: "#" },
    { label: "Contributors", href: "#" },
];

const TECH_STACK = [
    { name: "React", color: "#61DAFB" },
    { name: "Node.js", color: "#4ade80" },
    { name: "FFmpeg", color: "#f97316" },
    { name: "TMDB", color: "#01d277" },
    { name: "Video.js", color: "#f8cc2d" },
    { name: "CasaOS", color: "#6C7EF7" },
];

const STATUS_INDICATORS = [
    { label: "Server Online", color: "#22c55e", pulse: true },
    { label: "Direct Play", color: "#3b82f6", pulse: false },
    { label: "HLS Streaming", color: "#a855f7", pulse: false },
    { label: "GPU Accel.", color: "#f97316", pulse: false },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function FooterSection({ title, children }) {
    return (
        <div className="flex flex-col gap-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-base-content/30 mb-0.5">{title}</p>
            {children}
        </div>
    );
}

function FooterNavLink({ to, label }) {
    return (
        <NavLink
            to={to}
            className="text-[13px] text-base-content/50 hover:text-base-content/85
                       transition-colors duration-150 w-fit leading-none">
            {label}
        </NavLink>
    );
}

function FooterAnchor({ href, label }) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] text-base-content/50 hover:text-base-content/85
                       transition-colors duration-150 w-fit leading-none">
            {label}
        </a>
    );
}

function StatusDot({ label, color, pulse }) {
    return (
        <div className="flex items-center gap-2">
            <span className={`relative flex h-1.5 w-1.5 rounded-full ${pulse ? "animate-pulse" : ""}`} style={{ backgroundColor: color }}>
                {pulse && <span className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping" style={{ backgroundColor: color }} />}
            </span>
            <span className="text-[11px] text-base-content/40 font-mono">{label}</span>
        </div>
    );
}

function TechBadge({ name, color }) {
    return (
        <span
            className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold
                       border border-white/8 bg-white/4 tracking-wide"
            style={{ color }}>
            {name}
        </span>
    );
}

// ─── Main Footer ──────────────────────────────────────────────────────────────

export default function Footer() {
    return (
        <footer className="w-full border-t border-white/0.06 bg-base-200/60 backdrop-blur-sm mt-auto">
            {/* Top divider glow */}
            <div
                className="w-full h-px"
                style={{
                    background: "linear-gradient(90deg, transparent 0%, oklch(58% 0.22 20 / 0.25) 30%, oklch(65% 0.2 240 / 0.18) 70%, transparent 100%)",
                }}
            />

            {/* Main grid */}
            <div className="max-w-7xl mx-auto px-6 py-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-10">
                {/* ── Brand ── */}
                <div className="lg:col-span-2 flex flex-col gap-4">
                    {/* Logo */}
                    <div className="flex items-baseline gap-1">
                        <span className="text-primary font-black text-[1.62rem] font-ibm-plex-sans leading-none">
                            F<span className="text-xl lowercase">LU</span>X
                        </span>
                        <span
                            className="ml-2 text-[9px] font-mono font-semibold tracking-widest
                                       border border-primary/30 text-primary/60 px-1.5 py-0.5 rounded">
                            v0.1 BETA
                        </span>
                    </div>

                    {/* Tagline */}
                    <p className="text-[12px] text-base-content/40 leading-relaxed max-w-xs">
                        Self-hosted streaming platform inspired by Plex, Jellyfin, and MX Player. Your media. Your server. Your rules.
                    </p>

                    {/* Tech stack */}
                    <div className="flex flex-wrap gap-1.5 mt-1">
                        {TECH_STACK.map((tech) => (
                            <TechBadge key={tech.name} {...tech} />
                        ))}
                    </div>

                    {/* TMDB attribution */}
                    <div
                        className="flex items-start gap-2 mt-1 p-2.5 rounded border border-white/5
                                   bg-white/0.03">
                        <span
                            className="shrink-0 mt-px font-mono font-bold text-[9px] px-1 py-0.5 rounded
                                       text-[#01d277] border border-[#01d277]/25 bg-[#01d277]/8">
                            TMDB
                        </span>
                        <p className="text-[10px] text-base-content/30 leading-relaxed">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
                    </div>
                </div>

                {/* ── Navigation ── */}
                <FooterSection title="Navigate">
                    <nav className="flex flex-col gap-2.5">
                        {NAV_LINKS.map((link) => (
                            <FooterNavLink key={link.to} {...link} />
                        ))}
                    </nav>
                </FooterSection>

                {/* ── Server ── */}
                <FooterSection title="Server">
                    <nav className="flex flex-col gap-2.5">
                        {SERVER_LINKS.map((link) => (
                            <FooterNavLink key={link.to} {...link} />
                        ))}
                    </nav>
                </FooterSection>

                {/* ── Legal + Open Source ── */}
                <div className="flex flex-col gap-8">
                    <FooterSection title="Legal">
                        <nav className="flex flex-col gap-2.5">
                            {LEGAL_LINKS.map((link) => (
                                <FooterNavLink key={link.to} {...link} />
                            ))}
                        </nav>
                    </FooterSection>

                    <FooterSection title="Open Source">
                        <nav className="flex flex-col gap-2.5">
                            {OPEN_SOURCE_LINKS.map((link) => (
                                <FooterAnchor key={link.label} {...link} />
                            ))}
                        </nav>
                    </FooterSection>
                </div>
            </div>

            {/* ── Bottom bar ── */}
            <div className="border-t border-white/0.05 px-6 py-4">
                <div
                    className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center
                                justify-between gap-4">
                    {/* Status indicators */}
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                        {STATUS_INDICATORS.map((s) => (
                            <StatusDot key={s.label} {...s} />
                        ))}
                    </div>

                    {/* Copyright */}
                    <div className="flex items-center gap-3">
                        <span className="text-[11px] text-base-content/25 font-mono">© 2026 FLUX Media Server</span>
                        <span className="w-px h-3 bg-white/10" />
                        <span className="text-[11px] text-base-content/20 font-mono">MIT License · Open Source</span>
                    </div>
                </div>
            </div>
        </footer>
    );
}
