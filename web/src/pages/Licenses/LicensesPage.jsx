import { useEffect } from "react";
import LegalLayout, { LegalSection } from "../../Layout/LegalLayout";
import tmdbLogo from "../../assets/tmdb.svg";
import {
    TOC,
    LICENSE_STATUS,
    QUICK_OVERVIEW,
    PERMISSIONS,
    CONDITIONS,
    LIMITATIONS,
    MIT_FULL_TEXT,
    FRONTEND_LIBS,
    BACKEND_LIBS,
    FONTS,
    ASSET_NOTICES,
    PRIVACY_LINKS,
    CHANGELOG,
    FAQ,
    CONTACT,
} from "./licenseConfig";
import {
    LicenseStatusCard,
    QuickOverviewGrid,
    PermissionCard,
    ConditionCard,
    LimitationCard,
    DependencyCard,
    InfoBanner,
    LicenseTextViewer,
    ChangelogTimeline,
    FAQAccordion,
    BackToTopButton,
    Icon,
} from "./LicenseComponents";
import { ExternalLink } from "lucide-react";

export default function LicensesPage() {
    useEffect(() => {
        document.title = "FLUX — Licenses";
    }, []);

    return (
        <LegalLayout
            title="Licenses"
            lastUpdated={LICENSE_STATUS.releaseDate}
            description="Licensing information, third-party acknowledgements, permissions, and legal notices for FLUX — an open-source, self-hosted media server built as a personal alternative to Plex and Jellyfin, for use on your own network."
            toc={TOC}
        >
            {/* 1 — Overview: hero status card + quick facts */}
            <LegalSection id="overview" title="Overview">
                <div className="flex flex-col gap-4">
                    <LicenseStatusCard status={LICENSE_STATUS} />
                    <QuickOverviewGrid items={QUICK_OVERVIEW} />
                </div>
            </LegalSection>

            {/* 2 — Permissions */}
            <LegalSection id="permissions" title="License Permissions">
                <p>What this open-source, non-commercial license grants you.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
                    {PERMISSIONS.map((p) => (
                        <PermissionCard key={p.title} {...p} />
                    ))}
                </div>
            </LegalSection>

            {/* 3 — Conditions */}
            <LegalSection id="conditions" title="License Conditions">
                <p>What to keep in mind when running, forking, or contributing to FLUX.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                    {CONDITIONS.map((c) => (
                        <ConditionCard key={c.title} {...c} />
                    ))}
                </div>
            </LegalSection>

            {/* 4 — Limitations */}
            <LegalSection id="limitations" title="License Limitations">
                <p>What this license does not cover, offer, or guarantee.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                    {LIMITATIONS.map((l) => (
                        <LimitationCard key={l.title} {...l} />
                    ))}
                </div>
            </LegalSection>

            {/* 5 — Full license text */}
            <LegalSection id="license-text" title="Complete License Text">
                <p>
                    FLUX is an <strong className="text-base-content/95">open-source, non-commercial project</strong>. The code is free to run, fork, and improve — it just isn't licensed for
                    resale or commercial hosting.
                </p>
                <div className="mt-3">
                    <LicenseTextViewer text={MIT_FULL_TEXT} fileName="FLUX-LICENSE.txt" />
                </div>
            </LegalSection>

            {/* 6 — Frontend libraries */}
            <LegalSection id="frontend" title="Frontend Libraries">
                <p>The FLUX web client is built with the following open-source libraries:</p>
                <div className="bg-base-200 rounded-lg px-4 mt-3">
                    {FRONTEND_LIBS.map((lib) => (
                        <DependencyCard key={lib.name} {...lib} />
                    ))}
                </div>
                <p className="mt-3 text-base-content/60 text-xs">These libraries keep their own original licenses regardless of FLUX's personal-use terms — most are MIT, a few use Apache-2.0 or ISC as noted above.</p>
            </LegalSection>

            {/* 7 — Backend libraries */}
            <LegalSection id="backend" title="Backend Libraries">
                <p>The FLUX Node.js server uses the following open-source packages:</p>
                <div className="bg-base-200 rounded-lg px-4 mt-3">
                    {BACKEND_LIBS.map((lib) => (
                        <DependencyCard key={lib.name} {...lib} />
                    ))}
                </div>
                <p className="mt-3 text-base-content/60 text-xs">
                    Full dependency trees including transitive dependencies are documented in <code className="bg-base-300 px-1 rounded">server/package-lock.json</code> and{" "}
                    <code className="bg-base-300 px-1 rounded">web/package-lock.json</code>.
                </p>
            </LegalSection>

            {/* 8 — FFmpeg / codecs */}
            <LegalSection id="ffmpeg" title="Media Processing & Codecs">
                <p>FLUX utilizes FFmpeg for video transcoding, audio processing, and media streaming.</p>
                <div className="bg-base-200 rounded-lg p-4 mt-3 border border-base-content/6">
                    <p className="font-medium text-base-content/95 text-sm mb-2">FFmpeg</p>
                    <p className="text-sm mb-2">
                        FFmpeg is a trademark of Fabrice Bellard, originator of the FFmpeg project. FLUX does not claim ownership of FFmpeg, and the source code can be found at{" "}
                        <a href="https://ffmpeg.org" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                            ffmpeg.org <ExternalLink className="w-3 h-3" strokeWidth={1.75} />
                        </a>
                        .
                    </p>
                    <p className="text-sm mb-2">
                        FFmpeg is licensed under the <strong className="text-base-content/95">GNU Lesser General Public License (LGPL) version 2.1 or later</strong>. Depending on your installation
                        method (e.g., Docker), your FLUX instance may include compiled FFmpeg binaries subject to these terms.
                    </p>
                    <p className="text-sm">
                        <strong className="text-base-content/95">Codec Liability:</strong> FLUX accepts no liability for the unlicensed use of patented codecs (such as H.264, HEVC/H.265, or AAC)
                        processed, transcoded, or streamed through your personal installation.
                    </p>
                </div>
            </LegalSection>

            {/* 9 — TMDB attribution */}
            <LegalSection id="tmdb" title="TMDB Attribution">
                <p>FLUX uses The Movie Database (TMDB) API to fetch metadata, posters, and related information for your media library. Per TMDB's attribution requirements:</p>
                <div className="mt-4 border border-base-content/12 rounded-xl p-5 bg-base-200">
                    <div className="flex items-start gap-4 flex-wrap">
                        <img src={tmdbLogo} alt="The Movie Database" className="h-5 w-auto mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm text-base-content/85 leading-relaxed">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
                            <div className="mt-3 space-y-1.5">
                                <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer" className="block text-xs text-primary hover:underline">themoviedb.org →</a>
                                <a href="https://www.themoviedb.org/terms-of-use" target="_blank" rel="noopener noreferrer" className="block text-xs text-primary hover:underline">TMDB Terms of Use →</a>
                                <a href="https://www.themoviedb.org/privacy-policy" target="_blank" rel="noopener noreferrer" className="block text-xs text-primary hover:underline">TMDB Privacy Policy →</a>
                                <a href="https://developers.themoviedb.org/3" target="_blank" rel="noopener noreferrer" className="block text-xs text-primary hover:underline">TMDB API Documentation →</a>
                            </div>
                        </div>
                    </div>
                </div>
                <p className="mt-3">
                    All movie and TV show data, images, and metadata displayed in FLUX originate from TMDB. Posters and artwork are subject to TMDB's image usage policy and the copyright of their
                    respective owners.
                </p>
            </LegalSection>

            {/* 10 — Fonts */}
            <LegalSection id="fonts" title="Fonts">
                <p>The FLUX interface uses the following typefaces:</p>
                <div className="space-y-2 mt-3">
                    {FONTS.map((f) => (
                        <div key={f.name} className="flex items-center justify-between gap-4 bg-base-200 rounded-lg px-4 py-3 border border-base-content/6">
                            <div>
                                <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-base-content/95 hover:text-primary transition-colors">{f.name}</a>
                                <p className="text-xs text-base-content/60 mt-0.5">{f.author} · {f.role}</p>
                            </div>
                            <span className="text-[10px] font-mono text-primary/60 bg-primary/8 px-2 py-0.5 rounded shrink-0">{f.license}</span>
                        </div>
                    ))}
                </div>
            </LegalSection>

            {/* 11 — Icons & assets */}
            <LegalSection id="assets" title="Icons & Assets">
                <p>Ownership of imagery displayed by FLUX depends on its source:</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                    {ASSET_NOTICES.map((a) => (
                        <ConditionCard key={a.title} {...a} />
                    ))}
                </div>
            </LegalSection>

            {/* 12 — Privacy & data */}
            <LegalSection id="privacy" title="Privacy & Data">
                <p>
                    This licenses page covers software permissions and third-party attributions only. It does not replace, and should not be read as, a Privacy Policy or Terms of Service. As the
                    operator of this self-hosted instance, you remain responsible for how your own data and your users' data are stored, backed up, and secured.
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                    {PRIVACY_LINKS.map((l) => (
                        <a key={l.label} href={l.to} className="btn btn-sm rounded-md border-none bg-base-200 hover:bg-base-300 text-base-content/85">{l.label}</a>
                    ))}
                </div>
            </LegalSection>

            {/* 13 — Disclaimer */}
            <LegalSection id="disclaimer" title="Disclaimer">
                <InfoBanner icon="AlertTriangle" tone="warning">
                    FLUX is provided <strong>"as is"</strong>, without warranty of any kind, express or implied. There is no guarantee of fitness for a particular purpose, uninterrupted operation,
                    or data durability. You are solely responsible for compliance with laws applicable to your deployment, and for any damages arising from use of the software.
                </InfoBanner>
            </LegalSection>

            {/* 14 — Changelog */}
            <LegalSection id="changelog" title="License Changelog">
                <p>Notable changes to this licenses page and its underlying terms.</p>
                <div className="mt-4">
                    <ChangelogTimeline entries={CHANGELOG} />
                </div>
            </LegalSection>

            {/* 15 — FAQ */}
            <LegalSection id="faq" title="Frequently Asked Questions">
                <div className="mt-1">
                    <FAQAccordion items={FAQ} />
                </div>
            </LegalSection>

            {/* 16 — Contact */}
            <LegalSection id="contact" title="Contact">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {CONTACT.map((c) => (
                        <div key={c.label} className="flex items-center gap-3 bg-base-200 rounded-lg px-4 py-3 border border-base-content/6">
                            <Icon name={c.icon} className="w-4 h-4 text-base-content/60 shrink-0" />
                            <div className="min-w-0">
                                <p className="text-[11px] text-base-content/60">{c.label}</p>
                                <p className="text-sm text-base-content/95 font-medium truncate">{c.value}</p>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="bg-base-200 rounded-lg p-4 mt-4 border border-primary/15">
                    <p className="text-xs text-base-content/70 font-mono">FLUX · Open Source · Non-Commercial · Self-Hosted Media Platform</p>
                </div>
            </LegalSection>

            <BackToTopButton />
        </LegalLayout>
    );
}
