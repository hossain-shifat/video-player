import { Link } from "react-router";
import Logo from "./Logo";
import tmdbLogo from "../assets/tmdb.svg";
import { ExternalLink } from "lucide-react";
import { FaGithub } from "react-icons/fa";

const navLinks = [
    { label: "Home", to: "/" },
    { label: "Movies", to: "/movies" },
    { label: "Series", to: "/series" },
    { label: "Live TV", to: "/live" },
    { label: "Watchlist", to: "/watchlist" },
    { label: "Settings", to: "/settings" },
];

const serverLinks = [
    { label: "Libraries", to: "/folders" },
    { label: "Dashboard", to: "/dashboard" },
    { label: "System Status", to: "/status" },
];

const legalLinks = [
    { label: "Privacy Policy", to: "/privacy" },
    { label: "Terms & Conditions", to: "/terms" },
    { label: "Licenses", to: "/licenses" },
];

function FooterLinkList({ links }) {
    return (
        <ul className="flex flex-col gap-2.5">
            {links.map(({ label, to }) => (
                <li key={to}>
                    <Link to={to} className="text-sm text-base-content hover:text-primary transition-colors duration-150">
                        {label}
                    </Link>
                </li>
            ))}
        </ul>
    );
}

const Footer = () => {
    return (
        <footer className="bg-base-200 mt-auto border-t border-base-content/8">
            {/* Main content */}
            <div className="max-w-7xl mx-auto px-6 py-12">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10">
                    {/* ── Brand column ── */}
                    <div className="flex flex-col gap-4">
                        <Logo />
                        <p className="text-sm text-base-content leading-relaxed max-w-220px">
                            Self-hosted media server.
                            <br />
                            Your content, your network, your control.
                        </p>

                        {/* Version badge */}
                        <span className="inline-flex w-fit items-center border border-primary/30 text-primary/60 text-[10px] font-mono tracking-widest px-3 py-1 rounded-sm uppercase">v0.1 Beta</span>

                        {/* Open source section */}
                        <div className="flex flex-col gap-2 pt-1">
                            <a
                                href="https://github.com/hossain-shifat/video-player"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 text-xs text-base-content hover:text-primary transition-colors duration-150 group">
                                <FaGithub size={13} />
                                <span>GitHub</span>
                                <ExternalLink size={10} className="opacity-0 group-hover:opacity-60 transition-opacity" />
                            </a>
                            <div className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-success/70" />
                                <span className="text-xs text-base-content font-mono">Open Source · MIT</span>
                            </div>
                        </div>
                    </div>

                    {/* ── Navigate ── */}
                    <div>
                        <p className="text-[11px] font-semibold text-primary/70 uppercase tracking-[0.18em] mb-4 font-mono">Navigate</p>
                        <FooterLinkList links={navLinks} />
                    </div>

                    {/* ── Server ── */}
                    <div>
                        <p className="text-[11px] font-semibold text-primary/70 uppercase tracking-[0.18em] mb-4 font-mono">Server</p>
                        <FooterLinkList links={serverLinks} />
                    </div>

                    {/* ── Legal + TMDB ── */}
                    <div className="flex flex-col gap-6">
                        <div>
                            <p className="text-[11px] font-semibold text-primary/70 uppercase tracking-[0.18em] mb-4 font-mono">Legal</p>
                            <FooterLinkList links={legalLinks} />
                        </div>

                        {/* TMDB attribution */}
                        <div className="border border-base-content/8 rounded-lg p-4 bg-base-300/30 max-w-220px">
                            <img src={tmdbLogo} alt="TMDB Logo" className="h-3 mb-2.5 w-auto opacity-80" />
                            <p className="text-xs text-base-content leading-relaxed">Uses the TMDB API. Not endorsed or certified by TMDB.</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Bottom bar ── */}
            <div className="border-t border-base-content/8">
                <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-center justify-center gap-2">
                    <p className="text-xs text-base-content font-mono tracking-wide text-center">© 2026 FLUX Media Server · MIT Licensed · Self-hosted Streaming Platform</p>
                </div>
            </div>
        </footer>
    );
};

export default Footer;
