import { useEffect } from "react";
import LegalLayout, { LegalSection } from "../../Layout/LegalLayout";

const TOC = [
    { id: "intro", label: "Introduction" },
    { id: "responsibility", label: "User Responsibility" },
    { id: "acceptable-use", label: "Acceptable Use" },
    { id: "ownership", label: "Content Ownership" },
    { id: "copyright", label: "Copyright & Piracy" },
    { id: "third-party", label: "Third-Party Services" },
    { id: "self-hosted", label: "Self-Hosted Nature" },
    { id: "warranty", label: "No Warranty" },
    { id: "liability", label: "Limitation of Liability" },
    { id: "license", label: "Open Source License" },
    { id: "contact", label: "Contact" },
];

export default function TermsPage() {
    useEffect(() => {
        document.title = "FLUX — Terms & Conditions";
    }, []);

    return (
        <LegalLayout
            title="Terms & Conditions"
            lastUpdated="May 23, 2026"
            description="These terms govern your use of the FLUX self-hosted media server software. By installing or using FLUX, you agree to these terms."
            toc={TOC}>
            <LegalSection id="intro" title="Introduction">
                <p>
                    FLUX is an open-source, self-hosted media server platform designed for personal, private use on local networks and user-controlled infrastructure. FLUX is not a cloud streaming
                    service — all media files remain exclusively on systems you own and control.
                </p>
                <p>
                    These Terms & Conditions apply to the FLUX software itself and any official web or mobile client applications distributed as part of this project. By running, accessing, or using
                    FLUX, you acknowledge that you have read, understood, and agree to be bound by these terms.
                </p>
            </LegalSection>

            <LegalSection id="responsibility" title="User Responsibility">
                <p>You are solely responsible for all media content hosted, streamed, or otherwise processed through your FLUX installation. This includes but is not limited to:</p>
                <ul className="list-none space-y-1.5 mt-2">
                    {[
                        "Ensuring you hold the appropriate licenses or rights to any media files you store and stream.",
                        "Complying with all applicable local, national, and international laws regarding digital content.",
                        "Securing your FLUX installation and preventing unauthorized access to your media library.",
                        "Maintaining the integrity and security of your server infrastructure.",
                    ].map((item, i) => (
                        <li key={i} className="flex items-start gap-2">
                            <span className="text-primary mt-1 shrink-0">›</span>
                            <span>{item}</span>
                        </li>
                    ))}
                </ul>
            </LegalSection>

            <LegalSection id="acceptable-use" title="Acceptable Use">
                <p>
                    While FLUX is a neutral tool for media playback, its license is strictly conditional upon lawful use. You are expressly prohibited from using FLUX to host, stream, or distribute
                    Child Sexual Abuse Material (CSAM), terroristic content, or any other severely illegal material.
                </p>
                <p className="mt-3">
                    Any use of this software for such purposes immediately terminates your license to use FLUX. The FLUX project will cooperate fully with law enforcement regarding the use of this
                    software for these explicitly prohibited activities.
                </p>
            </LegalSection>

            <LegalSection id="ownership" title="Content Ownership">
                <p>
                    FLUX does not claim ownership of any media content you host or stream through this software. All intellectual property rights to your media files remain with their respective
                    owners. FLUX is simply a tool that facilitates playback of content you already possess.
                </p>
                <p>
                    The FLUX project does not upload, transmit, distribute, or store any of your media content on any external server. Your library is yours — it never leaves your network unless you
                    explicitly configure remote access.
                </p>
            </LegalSection>

            <LegalSection id="copyright" title="Copyright & Piracy Disclaimer">
                <p>
                    FLUX does not endorse, encourage, or facilitate piracy, copyright infringement, or any other illegal use of copyrighted material. The software is provided for legitimate personal
                    use of media you have lawfully acquired.
                </p>
                <p>
                    The FLUX project and its contributors bear no responsibility for how individual users choose to employ this software. Users bear full legal responsibility for the content they host
                    and any violations of intellectual property law that may result from their use of FLUX.
                </p>
                <p className="mt-3">
                    <strong className="text-base-content/80">No Ability to Process DMCA Requests:</strong> Because FLUX is entirely self-hosted and operates exclusively on user-controlled
                    infrastructure, the FLUX project possesses no technical means to view, access, modify, or delete any user content. Consequently, the FLUX maintainers cannot comply with Digital
                    Millennium Copyright Act (DMCA) takedown notices or similar legal requests. All copyright claims must be directed to the ISP or individual hosting the specific server instance.
                </p>
            </LegalSection>

            <LegalSection id="third-party" title="Third-Party Services">
                <p>FLUX integrates with the following third-party services to enhance your experience:</p>
                <div className="mt-3 space-y-3">
                    <div className="bg-base-200 rounded-lg p-4">
                        <p className="font-medium text-base-content/80 text-xs uppercase tracking-wider mb-1">The Movie Database (TMDB)</p>
                        <p>
                            FLUX uses the TMDB API to fetch movie and TV metadata, posters, and related information. This service is subject to{" "}
                            <a href="https://www.themoviedb.org/terms-of-use" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                                TMDB's own Terms of Use
                            </a>
                            . FLUX is not endorsed or certified by TMDB.
                        </p>
                    </div>
                </div>
                <p className="mt-3">
                    Third-party service availability, accuracy of data, and terms of service are outside the control of the FLUX project. FLUX makes no guarantees regarding the continued availability
                    or accuracy of third-party data.
                </p>
            </LegalSection>

            <LegalSection id="self-hosted" title="Self-Hosted Nature">
                <p>FLUX is fundamentally a self-hosted application. This means:</p>
                <ul className="list-none space-y-1.5 mt-2">
                    {[
                        "All media files remain on your own hardware and network.",
                        "You are responsible for the security, uptime, and configuration of your server.",
                        "The FLUX project team has no access to your installation, data, or network.",
                        "Remote access, if configured, is entirely your responsibility to secure appropriately.",
                        "Backups, data integrity, and system maintenance are the user's responsibility.",
                    ].map((item, i) => (
                        <li key={i} className="flex items-start gap-2">
                            <span className="text-primary mt-1 shrink-0">›</span>
                            <span>{item}</span>
                        </li>
                    ))}
                </ul>
            </LegalSection>

            <LegalSection id="warranty" title="No Warranty">
                <p>
                    FLUX is provided <strong className="text-base-content/80">"as is"</strong>, without warranty of any kind, express or implied. The FLUX project and its contributors make no
                    representations or warranties regarding:
                </p>
                <ul className="list-none space-y-1.5 mt-2">
                    {[
                        "Fitness for a particular purpose",
                        "Merchantability",
                        "Non-infringement of third-party rights",
                        "Accuracy, reliability, or completeness of metadata or functionality",
                        "Uninterrupted or error-free operation",
                    ].map((item, i) => (
                        <li key={i} className="flex items-start gap-2">
                            <span className="text-base-content/30 mt-1 shrink-0">–</span>
                            <span>{item}</span>
                        </li>
                    ))}
                </ul>
                <p className="mt-3">Your use of FLUX is entirely at your own risk. The entire risk as to the quality and performance of the software is with you.</p>
                <div className="bg-base-200 rounded-lg p-4 mt-4">
                    <p className="font-medium text-base-content/80 text-xs uppercase tracking-wider mb-1">Hardware Utilization and Damage</p>
                    <p className="text-sm">
                        FLUX includes features such as real-time media transcoding (via FFmpeg), which requires intensive CPU and GPU resources. Prolonged use of these features may result in high
                        thermal output, power consumption, and potential hardware degradation. The FLUX maintainers accept zero liability for any thermal damage, hardware failure, reduced component
                        lifespan, or increased electricity costs resulting from the operation of this software on your infrastructure.
                    </p>
                </div>
            </LegalSection>

            <LegalSection id="liability" title="Limitation of Liability">
                <div className="bg-base-200/50 border border-base-content/10 rounded-lg p-4 mb-4">
                    <p className="text-xs font-bold text-base-content/70 uppercase tracking-wider mb-2">Maximum Extent Permitted by Law</p>
                    <p className="text-sm font-medium leading-relaxed uppercase">
                        In no event shall the FLUX project, its contributors, maintainers, or affiliated parties be liable for any direct, indirect, incidental, special, exemplary, or consequential
                        damages arising out of or in connection with your use of FLUX.
                    </p>
                </div>
                <p>
                    This includes, without limitation: loss of data, loss of profits, server downtime, legal liability arising from hosted content, or any other commercial or personal damages — even
                    if a party has been advised of the possibility of such damages.
                </p>
            </LegalSection>

            <LegalSection id="license" title="Open Source License">
                <p>
                    FLUX is open-source software distributed under the <strong className="text-base-content/80">MIT License</strong>. You are free to use, copy, modify, merge, publish, distribute,
                    sublicense, and/or sell copies of the software, subject to the conditions of the MIT License.
                </p>
                <div className="bg-base-200 rounded-lg p-4 font-mono text-xs text-base-content/50 leading-relaxed mt-3">
                    Copyright (c) 2026 FLUX Contributors
                    <br />
                    <br />
                    Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without
                    restriction...
                </div>
                <p className="mt-3">
                    See the full license on the{" "}
                    <a href="/licenses" className="text-primary hover:underline">
                        Licenses page
                    </a>{" "}
                    for complete details and third-party attributions.
                </p>
            </LegalSection>

            <LegalSection id="contact" title="Contact & Project Info">
                <p>FLUX is a personal open-source project. For questions, bug reports, or contributions, please use the project's GitHub repository.</p>
                <p className="mt-2">As a self-hosted project, FLUX has no formal support staff or legal department. Community support is available via GitHub Issues and Discussions.</p>
                <div className="bg-base-200 rounded-lg p-4 mt-3">
                    <p className="text-xs font-mono text-base-content/40">Project: FLUX Media Server · License: MIT · Version: 0.1 Beta</p>
                </div>
            </LegalSection>
        </LegalLayout>
    );
}
