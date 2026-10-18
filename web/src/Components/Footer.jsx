import { useId } from "react";
import { Link } from "react-router";
import Logo from "./Logo";
import tmdbLogo from "../assets/tmdb.svg";
import { ExternalLink, Scale } from "lucide-react";
import { FaGithub } from "react-icons/fa";

const navLinks = [
    { label: "Home", to: "/" },
    { label: "Movies", to: "/movies" },
    { label: "Series", to: "/series" },
    { label: "Live TV", to: "/live" },
    { label: "Watchlist", to: "/watchlist" },
    { label: "Settings", to: "/settings" },
];

// Shown only when parent passes canManage. No auth exists in app yet,
// so default is false (links hidden). Wire to real auth state later.
// Hiding links is NOT security: backend must still enforce access.
const manageLinks = [
    { label: "Libraries", to: "/folders" },
    { label: "Dashboard", to: "/dashboard" },
    { label: "System Status", to: "/status" },
];

const legalLinks = [
    { label: "Privacy Policy", to: "/privacy" },
    { label: "Terms & Conditions", to: "/terms" },
    { label: "Licenses", to: "/licenses" },
];

const focusRing = "rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

function FooterSection({ title, links }) {
    // useId keeps heading id unique even if footer renders twice
    const headingId = useId();

    return (
        <nav aria-labelledby={headingId} className="min-w-0">
            <h2 id={headingId} className="text-sm font-semibold text-base-content mb-4 pb-3 border-b border-base-content/10 relative">
                {title}
                {/* short accent segment on the divider */}
                <span aria-hidden="true" className="absolute -bottom-px left-0 h-px w-6 bg-primary" />
            </h2>
            <ul className="flex flex-col gap-0.5">
                {links.map(({ label, to }) => (
                    <li key={to}>
                        <Link
                            to={to}
                            className={`inline-block py-1.5 text-sm text-base-content/70 hover:text-primary hover:translate-x-0.5 transition-[color,transform] duration-150 motion-reduce:transition-none motion-reduce:hover:translate-x-0 ${focusRing}`}>
                            {label}
                        </Link>
                    </li>
                ))}
            </ul>
        </nav>
    );
}

const Footer = ({ canManage = false }) => {
    return (
        <footer className="relative bg-base-200 mt-auto overflow-hidden border-t border-base-300">
            {/* ── Main ── */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-14 pb-10">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-x-12 gap-y-12">
                    {/* Brand */}
                    <div className="lg:col-span-4 flex flex-col gap-5 min-w-0">
                        <Logo />
                        <p className="text-sm text-base-content/80 leading-relaxed max-w-[260px]">
                            Self-hosted media server.
                            <br />
                            Your content, your network, your control.
                        </p>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                            {/* TODO: pick one real version source (web 0.0.0, server 1.0.0) */}
                            <span className="inline-flex items-center rounded-full border border-primary/40 text-primary text-xs font-medium px-3 py-1">v0.1 Beta</span>
                            <span className="inline-flex items-center gap-1.5 text-xs text-base-content/80">
                                <Scale size={13} aria-hidden="true" />
                                Open Source, MIT
                            </span>
                        </div>
                    </div>

                    {/* Link columns */}
                    <div className={`lg:col-span-8 grid grid-cols-2 gap-x-6 gap-y-10 sm:gap-x-10 ${canManage ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                        <FooterSection title="Navigate" links={navLinks} />
                        {canManage && <FooterSection title="Manage" links={manageLinks} />}
                        <FooterSection title="Legal" links={legalLinks} />
                    </div>
                </div>

                {/* ── Attribution strip ── */}
                <div className="mt-12 pt-6 border-t border-base-content/10 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
                    <div className="flex items-center gap-4 min-w-0">
                        <img src={tmdbLogo} alt="TMDB" className="h-3 w-auto shrink-0 opacity-90" />
                        <p className="text-xs text-base-content/70 leading-relaxed max-w-md">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
                    </div>

                    <a
                        href="https://github.com/hossain-shifat/video-player"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group inline-flex w-fit items-center gap-2 rounded-full border border-base-content/15 hover:border-primary/60 px-4 py-2 text-sm text-base-content hover:text-primary transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                        <FaGithub size={15} aria-hidden="true" />
                        <span>View on GitHub</span>
                        <ExternalLink size={12} aria-hidden="true" className="opacity-60 group-hover:opacity-100 transition-opacity" />
                        <span className="sr-only">(opens in new tab)</span>
                    </a>
                </div>
            </div>

            {/* ── Wordmark (decorative) ── */}
            {/* leading-[0.9] + small px: gradient box fully covers glyphs, so bg-clip-text never cuts letter tops */}
            <div aria-hidden="true" className="select-none pointer-events-none overflow-hidden text-center px-2">
                <span className="block font-ibm-plex-sans font-black tracking-tighter text-[clamp(5rem,26vw,18rem)] leading-[0.9] -mb-[0.1em] bg-linear-to-b from-base-content/15 to-transparent bg-clip-text text-transparent">
                    FLUX
                </span>
            </div>

            {/* ── Bottom bar ── */}
            <div className="relative border-t border-base-content/10 bg-base-200">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-x-6 gap-y-1 text-xs text-base-content/70 text-center sm:text-left">
                    <p>© 2026 FLUX Media Server</p>
                    <p>MIT licensed. Self-hosted by design.</p>
                </div>
            </div>
        </footer>
    );
};

export default Footer;
