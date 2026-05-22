import Logo from "./Logo";
import tmdbLogo from "../assets/tmdb.svg";

const Footer = () => {
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
        { label: "Licenses", to: "/licenses" },
    ];

    return (
        <footer className="bg-base-200 mt-auto">
            {/* Main footer content */}
            <div className="max-w-7xl mx-auto px-6 py-12">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10">
                    {/* Brand column */}
                    <div className="flex flex-col gap-4">
                        <Logo />
                        <p className="text-sm text-base-content leading-relaxed max-w-220px">
                            Self-hosted media server.
                            <br />
                            Your content, your network, your control.
                        </p>
                        <span className="inline-flex w-fit items-center border border-primary/40 text-primary/70 text-[10px] font-mono tracking-widest px-3 py-1 rounded-sm uppercase">v0.1 Beta</span>
                    </div>

                    {/* Navigate */}
                    <div>
                        <p className="text-[11px] font-semibold text-base-content uppercase tracking-[0.18em] mb-4">Navigate</p>
                        <ul className="flex flex-col gap-2.5">
                            {navLinks.map(({ label, to }) => (
                                <li key={to}>
                                    <a href={to} className="text-sm text-base-content hover:text-base-content transition-colors duration-150">
                                        {label}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Server */}
                    <div>
                        <p className="text-[11px] font-semibold text-base-content uppercase tracking-[0.18em] mb-4">Server</p>
                        <ul className="flex flex-col gap-2.5">
                            {serverLinks.map(({ label, to }) => (
                                <li key={to}>
                                    <a href={to} className="text-sm text-base-content hover:text-base-content transition-colors duration-150">
                                        {label}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Legal + TMDB */}
                    <div className="flex flex-col gap-6">
                        <div>
                            <p className="text-[11px] font-semibold text-base-content uppercase tracking-[0.18em] mb-4">Legal</p>
                            <ul className="flex flex-col gap-2.5">
                                {legalLinks.map(({ label, to }) => (
                                    <li key={to}>
                                        <a href={to} className="text-sm text-base-content hover:text-base-content transition-colors duration-150">
                                            {label}
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* TMDB badge */}
                        <div className="border border-base-content/10 rounded-lg p-3.5 bg-base-200/60 max-w-220px">
                            <img src={tmdbLogo} alt="TMDB Logo" className="h-3 mb-2.5 w-auto" />
                            <p className="text-xs text-base-content leading-relaxed">Uses the TMDB API. Not endorsed or certified by TMDB.</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Bottom bar */}
            <div>
                <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-center justify-center gap-3 border-t border-base-content/25">
                    {/* Copyright */}
                    <p className="text-xs text-base-content font-mono tracking-wide whitespace-nowrap">© 2026 FLUX · MIT License</p>
                </div>
            </div>
        </footer>
    );
};

export default Footer;
