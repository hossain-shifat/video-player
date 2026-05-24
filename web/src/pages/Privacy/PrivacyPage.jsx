import { useEffect } from "react";
import LegalLayout, { LegalSection } from "../../Layout/LegalLayout";
import { Server, Shield, Eye, Database, Globe, HardDrive } from "lucide-react";

const TOC = [
    { id: "intro", label: "Introduction" },
    { id: "data-collection", label: "Data Collection" },
    { id: "local-storage", label: "Local Data Storage" },
    { id: "third-party", label: "Third-Party APIs" },
    { id: "no-tracking", label: "No Centralized Tracking" },
    { id: "cookies", label: "Cookies & Local Storage" },
    { id: "user-control", label: "User Control" },
    { id: "security", label: "Data Security" },
    { id: "open-source", label: "Open Source Transparency" },
    { id: "contact", label: "Contact" },
];

function PrivacyHighlight({ icon: Icon, title, text }) {
    return (
        <div className="flex gap-3 p-4 bg-base-200 rounded-lg">
            <div className="shrink-0 mt-0.5">
                <Icon size={15} className="text-primary" />
            </div>
            <div>
                <p className="text-xs font-semibold text-base-content/70 uppercase tracking-wider mb-1">{title}</p>
                <p className="text-sm text-base-content/55 leading-relaxed">{text}</p>
            </div>
        </div>
    );
}

export default function PrivacyPage() {
    useEffect(() => {
        document.title = "FLUX — Privacy Policy";
    }, []);

    return (
        <LegalLayout
            title="Privacy Policy"
            lastUpdated="May 23, 2026"
            description="FLUX is a self-hosted media server. Your data stays on your hardware. This policy explains exactly what FLUX collects, what it doesn't, and how your information is handled."
            toc={TOC}>
            {/* Key facts callouts */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 not-prose">
                <PrivacyHighlight icon={Server} title="Self-Hosted" text="Your media and data run on your own hardware. No centralized FLUX servers." />
                <PrivacyHighlight icon={Shield} title="No Telemetry" text="FLUX collects no usage analytics, crash reports, or behavioral data by default." />
                <PrivacyHighlight icon={Eye} title="No Surveillance" text="The FLUX project has zero visibility into what you watch or host." />
                <PrivacyHighlight icon={HardDrive} title="Local Storage" text="Watch history, preferences, and metadata cache are stored locally on your server." />
            </div>

            <LegalSection id="intro" title="Introduction">
                <p>
                    This Privacy Policy describes how FLUX handles information in the context of its self-hosted media server software. FLUX is designed with privacy as a core principle — your media,
                    your viewing habits, and your personal data remain under your exclusive control.
                </p>
                <p>
                    Unlike cloud streaming platforms, FLUX operates entirely on infrastructure you own. There are no FLUX-operated servers, no mandatory account creation, and no data transmitted to
                    the FLUX project by default.
                </p>
            </LegalSection>

            <LegalSection id="data-collection" title="Data Collection">
                <p>
                    <strong className="text-base-content/75">What FLUX does NOT collect:</strong>
                </p>
                <ul className="list-none space-y-1.5 mt-2">
                    {[
                        "Personally identifiable information (no name, email, or account required)",
                        "Viewing history or media consumption patterns sent to external servers",
                        "Usage analytics, crash reports, or telemetry data",
                        "IP addresses or device fingerprints transmitted off-device",
                        "Payment information of any kind",
                    ].map((item, i) => (
                        <li key={i} className="flex items-start gap-2">
                            <span className="text-error/60 mt-1 shrink-0">✕</span>
                            <span>{item}</span>
                        </li>
                    ))}
                </ul>
                <p className="mt-3">
                    <strong className="text-base-content/75">What FLUX does collect locally:</strong> Only the data necessary to operate its features, stored exclusively on your own server. See the
                    section below.
                </p>
            </LegalSection>

            <LegalSection id="local-storage" title="Local Data Storage">
                <p>FLUX stores the following data locally on your server's filesystem:</p>
                <div className="space-y-3 mt-3">
                    {[
                        {
                            label: "Watch History",
                            detail: "Playback positions and completion status for resume functionality. Stored in history.json on your server. Never transmitted externally.",
                        },
                        {
                            label: "Metadata Cache",
                            detail: "Movie and TV show information fetched from TMDB is cached locally in metadata.json to reduce repeated API calls. This cache is stored entirely on your server.",
                        },
                        {
                            label: "Library Configuration",
                            detail: "Folder paths and labels for your media libraries are stored in folders.json on your server.",
                        },
                        {
                            label: "Watchlist & Favourites",
                            detail: "Your personal lists are stored in userdata.json on your local server.",
                        },
                    ].map(({ label, detail }) => (
                        <div key={label} className="bg-base-200 rounded-lg p-4">
                            <p className="text-xs font-semibold text-base-content/70 uppercase tracking-wider mb-1">{label}</p>
                            <p>{detail}</p>
                        </div>
                    ))}
                </div>
                <p className="mt-3">
                    All local data can be deleted at any time by clearing the relevant JSON files in your FLUX server's{" "}
                    <code className="text-primary/80 bg-base-200 px-1.5 py-0.5 rounded text-xs">data/</code> directory.
                </p>
            </LegalSection>

            <LegalSection id="third-party" title="Third-Party APIs">
                <p>FLUX uses the following external service for metadata enrichment:</p>
                <div className="bg-base-200 rounded-lg p-4 mt-3">
                    <div className="flex items-start gap-3">
                        <Globe size={14} className="text-primary mt-0.5 shrink-0" />
                        <div>
                            <p className="text-xs font-semibold text-base-content/70 uppercase tracking-wider mb-1">The Movie Database (TMDB)</p>
                            <p>
                                When FLUX scans your library, it sends media title strings to the TMDB API to retrieve posters, descriptions, cast information, and other metadata. These requests
                                include the title of the media file being looked up and your server's outgoing IP address (inherent to any HTTP request).
                            </p>
                            <p className="mt-2">
                                No personally identifiable information is sent. TMDB operates under its own{" "}
                                <a href="https://www.themoviedb.org/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                                    Privacy Policy
                                </a>
                                . You can disable TMDB integration by removing the <code className="text-primary/80 bg-base-300 px-1 rounded text-xs">TMDB_API_KEY</code> from your server's environment
                                configuration.
                            </p>
                        </div>
                    </div>
                </div>
                <div className="bg-base-200 rounded-lg p-4 mt-3">
                    <div className="flex items-start gap-3">
                        <Server size={14} className="text-primary mt-0.5 shrink-0" />
                        <div>
                            <p className="text-xs font-semibold text-base-content/70 uppercase tracking-wider mb-1">GitHub API (Update Checks)</p>
                            <p>
                                To notify you of new software releases, your FLUX instance may periodically check the official GitHub repository. This request sends your server's IP address to GitHub,
                                which is subject to{" "}
                                <a
                                    href="https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-primary hover:underline">
                                    GitHub's Privacy Statement
                                </a>
                                . No local library data is included in this check.
                            </p>
                        </div>
                    </div>
                </div>
            </LegalSection>

            <LegalSection id="no-tracking" title="No Centralized User Tracking">
                <p>The FLUX project maintains no central servers that process user data. There is no:</p>
                <ul className="list-none space-y-1.5 mt-2">
                    {[
                        "User account system or registration",
                        "Analytics platform receiving usage data",
                        "Error reporting service receiving crash data",
                        "Content delivery network handling your media",
                        "Cloud sync service for your watch history or preferences",
                    ].map((item, i) => (
                        <li key={i} className="flex items-start gap-2">
                            <span className="text-error/60 mt-1 shrink-0">✕</span>
                            <span>{item}</span>
                        </li>
                    ))}
                </ul>
                <p className="mt-3">Every FLUX installation is entirely independent. Your instance has no communication with any other FLUX installation or the project's maintainers.</p>
            </LegalSection>

            <LegalSection id="cookies" title="Cookies & Local Storage">
                <p>The FLUX web client uses browser-side storage for the following purposes:</p>
                <div className="space-y-2 mt-3">
                    {[
                        { key: "mediaplayer-theme", purpose: "Remembers your selected UI theme (Cinema, AMOLED, Slate, Light Studio)" },
                        {
                            key: "flux-auth-session",
                            purpose:
                                "Stores a securely hashed session token to maintain your authenticated state with your local server without requiring repeated logins. This token remains until you explicitly log out or clear your browser data.",
                        },
                        {
                            key: "flux-player-prefs",
                            purpose: "Remembers video player settings such as default volume, subtitle preferences, and preferred audio tracks.",
                        },
                    ].map(({ key, purpose }) => (
                        <div key={key} className="flex gap-3 items-start bg-base-200 rounded p-3">
                            <code className="text-primary/70 text-xs bg-base-300 px-1.5 py-0.5 rounded shrink-0">{key}</code>
                            <span className="text-sm">{purpose}</span>
                        </div>
                    ))}
                </div>
                <p className="mt-3">
                    No tracking cookies, advertising pixels, or third-party scripts are embedded in the FLUX web client. You can clear browser local storage at any time through your browser's
                    developer tools or settings.
                </p>
            </LegalSection>

            <LegalSection id="user-control" title="User Control">
                <p>Because FLUX is self-hosted, you have complete control over all data:</p>
                <ul className="list-none space-y-1.5 mt-2">
                    {[
                        "Delete watch history via the FLUX UI or by editing data/history.json directly.",
                        "Clear metadata cache via the Settings page or by clearing data/metadata.json.",
                        "Remove all user data by stopping the server and deleting the data/ directory.",
                        "Disable TMDB metadata fetching by removing your TMDB API key from the environment.",
                        "Restrict network access by configuring your firewall — FLUX respects your network rules.",
                    ].map((item, i) => (
                        <li key={i} className="flex items-start gap-2">
                            <span className="text-primary mt-1 shrink-0">›</span>
                            <span>{item}</span>
                        </li>
                    ))}
                </ul>
            </LegalSection>

            <LegalSection id="security" title="Data Security">
                <p>Security of your FLUX installation is your responsibility as the server operator. Recommended practices:</p>
                <ul className="list-none space-y-1.5 mt-2">
                    {[
                        "Run FLUX behind a reverse proxy (e.g., Nginx) with HTTPS enabled for remote access.",
                        "Configure your firewall to restrict FLUX port access to trusted network ranges.",
                        "Keep your server's operating system and Node.js runtime updated.",
                        "Do not expose your FLUX instance to the public internet without authentication.",
                        "Regularly back up your data/ directory to prevent data loss.",
                    ].map((item, i) => (
                        <li key={i} className="flex items-start gap-2">
                            <span className="text-warning/70 mt-1 shrink-0">!</span>
                            <span>{item}</span>
                        </li>
                    ))}
                </ul>
                <p className="mt-3">The FLUX project provides the software but cannot be held responsible for security incidents resulting from misconfiguration of user-operated servers.</p>
            </LegalSection>

            <LegalSection id="open-source" title="Open Source Transparency">
                <p>FLUX is fully open source. Every line of code that handles your data is publicly auditable. You don't have to trust our privacy claims — you can verify them.</p>
                <p>
                    The server-side data handling code is located in <code className="text-primary/80 bg-base-200 px-1.5 py-0.5 rounded text-xs">server/utils/userStore.js</code>,{" "}
                    <code className="text-primary/80 bg-base-200 px-1.5 py-0.5 rounded text-xs">server/utils/metadataStore.js</code>, and related files in the repository.
                </p>
            </LegalSection>

            <LegalSection id="contact" title="Contact Information">
                <p>For privacy-related concerns about the FLUX software itself, please open an issue on the project's GitHub repository.</p>
                <p>
                    If you are a user of someone else's FLUX instance and have privacy concerns about that specific server, you must contact the operator of that server directly — the FLUX project has
                    no involvement in or visibility into private installations.
                </p>
            </LegalSection>
        </LegalLayout>
    );
}
