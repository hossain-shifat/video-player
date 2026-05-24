import { useEffect } from "react";
import LegalLayout, { LegalSection } from "../../Layout/LegalLayout";
import tmdbLogo from "../../assets/tmdb.svg";

const TOC = [
    { id: "flux-license", label: "FLUX License" },
    { id: "frontend", label: "Frontend Libraries" },
    { id: "backend", label: "Backend Libraries" },
    { id: "ffmpeg", label: "Media Processing & Codecs" },
    { id: "tmdb", label: "TMDB Attribution" },
    { id: "fonts", label: "Fonts" },
    { id: "open-source", label: "Open Source Spirit" },
];

const MIT_LIBS = [
    { name: "React", version: "19.x", author: "Meta Platforms, Inc.", url: "https://react.dev" },
    { name: "React Router", version: "7.x", author: "Remix Software, Inc.", url: "https://reactrouter.com" },
    { name: "Vite", version: "8.x", author: "Evan You & Vite Contributors", url: "https://vitejs.dev" },
    { name: "Tailwind CSS", version: "4.x", author: "Tailwind Labs, Inc.", url: "https://tailwindcss.com" },
    { name: "DaisyUI", version: "5.x", author: "Pouya Saadeghi", url: "https://daisyui.com" },
    { name: "Lucide React", version: "1.x", author: "Lucide Contributors", url: "https://lucide.dev" },
];

const BACKEND_LIBS = [
    { name: "Express", version: "5.x", author: "TJ Holowaychuk & OpenJS Foundation", license: "MIT", url: "https://expressjs.com" },
    { name: "cors", version: "2.x", author: "Troy Goode", license: "MIT", url: "https://github.com/expressjs/cors" },
    { name: "dotenv", version: "17.x", author: "Scott Motte", license: "BSD-2-Clause", url: "https://github.com/motdotla/dotenv" },
    { name: "mime-types", version: "3.x", author: "Jonathan Ong & Douglas Christopher Wilson", license: "MIT", url: "https://github.com/jshttp/mime-types" },
    { name: "nodemon", version: "3.x", author: "Remy Sharp", license: "MIT", url: "https://nodemon.io" },
];

function LibCard({ name, version, author, license = "MIT", url }) {
    return (
        <div className="flex items-start justify-between gap-4 py-3 border-b border-base-content/6 last:border-0">
            <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-base-content/80 hover:text-primary transition-colors duration-150">
                        {name}
                    </a>
                    <span className="text-[10px] font-mono text-base-content/30">{version}</span>
                </div>
                <p className="text-xs text-base-content/40 mt-0.5">{author}</p>
            </div>
            <span className="shrink-0 text-[10px] font-mono text-primary/60 bg-primary/8 px-2 py-0.5 rounded">{license}</span>
        </div>
    );
}

const MIT_FULL_TEXT = `MIT License

Copyright (c) 2026 FLUX Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

export default function LicensesPage() {
    useEffect(() => {
        document.title = "FLUX — Licenses";
    }, []);

    return (
        <LegalLayout
            title="Licenses"
            lastUpdated="May 23, 2026"
            description="FLUX is open-source software. Below you'll find FLUX's own license, attributions for all third-party libraries used, and required notices for external services."
            toc={TOC}>
            <LegalSection id="flux-license" title="FLUX License">
                <p>
                    FLUX is distributed under the <strong className="text-base-content/75">MIT License</strong> — one of the most permissive open-source licenses. You are free to use, modify, and
                    distribute FLUX for any purpose, including commercial use.
                </p>
                <pre className="bg-base-200 rounded-lg p-4 text-xs font-mono text-base-content/45 leading-relaxed overflow-x-auto whitespace-pre-wrap mt-3">{MIT_FULL_TEXT}</pre>
            </LegalSection>

            <LegalSection id="frontend" title="Frontend Libraries">
                <p>The FLUX web client is built with the following open-source libraries:</p>
                <div className="bg-base-200 rounded-lg px-4 mt-3">
                    {MIT_LIBS.map((lib) => (
                        <LibCard key={lib.name} {...lib} />
                    ))}
                </div>
                <p className="mt-3 text-base-content/40 text-xs">All frontend libraries listed are distributed under the MIT License unless otherwise noted.</p>
            </LegalSection>

            <LegalSection id="backend" title="Backend Libraries">
                <p>The FLUX Node.js server uses the following open-source packages:</p>
                <div className="bg-base-200 rounded-lg px-4 mt-3">
                    {BACKEND_LIBS.map((lib) => (
                        <LibCard key={lib.name} {...lib} />
                    ))}
                </div>
                <p className="mt-3 text-base-content/40 text-xs">
                    Full dependency trees including transitive dependencies are documented in <code className="bg-base-300 px-1 rounded">server/package-lock.json</code> and{" "}
                    <code className="bg-base-300 px-1 rounded">web/package-lock.json</code>.
                </p>
            </LegalSection>

            <LegalSection id="ffmpeg" title="Media Processing & Codecs">
                <p>FLUX utilizes FFmpeg for video transcoding, audio processing, and media streaming.</p>
                <div className="bg-base-200 rounded-lg p-4 mt-3">
                    <p className="font-medium text-base-content/80 text-sm mb-2">FFmpeg</p>
                    <p className="text-sm mb-2">
                        FFmpeg is a trademark of Fabrice Bellard, originator of the FFmpeg project. FLUX does not claim ownership of FFmpeg, and the source code can be found at{" "}
                        <a href="https://ffmpeg.org" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                            ffmpeg.org
                        </a>
                        .
                    </p>
                    <p className="text-sm mb-2">
                        FFmpeg is licensed under the <strong className="text-base-content/75">GNU Lesser General Public License (LGPL) version 2.1 or later</strong>. Depending on your installation
                        method (e.g., Docker), your FLUX instance may include compiled FFmpeg binaries subject to these terms.
                    </p>
                    <p className="text-sm">
                        <strong className="text-base-content/75">Codec Liability:</strong> FLUX accepts no liability for the unlicensed use of patented codecs (such as H.264, HEVC/H.265, or AAC)
                        processed, transcoded, or streamed through your personal installation.
                    </p>
                </div>
            </LegalSection>

            <LegalSection id="tmdb" title="TMDB Attribution">
                <p>FLUX uses The Movie Database (TMDB) API to fetch metadata, posters, and related information for your media library. Per TMDB's attribution requirements:</p>

                {/* TMDB official attribution card */}
                <div className="mt-4 border border-base-content/12 rounded-xl p-5 bg-base-200/50">
                    <div className="flex items-start gap-4 flex-wrap">
                        <img src={tmdbLogo} alt="The Movie Database" className="h-5 w-auto mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm text-base-content/65 leading-relaxed">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
                            <div className="mt-3 space-y-1.5">
                                <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer" className="block text-xs text-primary hover:underline">
                                    themoviedb.org →
                                </a>
                                <a href="https://www.themoviedb.org/terms-of-use" target="_blank" rel="noopener noreferrer" className="block text-xs text-primary hover:underline">
                                    TMDB Terms of Use →
                                </a>
                                <a href="https://www.themoviedb.org/privacy-policy" target="_blank" rel="noopener noreferrer" className="block text-xs text-primary hover:underline">
                                    TMDB Privacy Policy →
                                </a>
                                <a href="https://developers.themoviedb.org/3" target="_blank" rel="noopener noreferrer" className="block text-xs text-primary hover:underline">
                                    TMDB API Documentation →
                                </a>
                            </div>
                        </div>
                    </div>
                </div>

                <p className="mt-3">
                    All movie and TV show data, images, and metadata displayed in FLUX originate from TMDB. Posters and artwork are subject to TMDB's image usage policy and the copyright of their
                    respective owners.
                </p>
            </LegalSection>

            <LegalSection id="fonts" title="Fonts">
                <p>The FLUX interface uses the following typefaces:</p>
                <div className="space-y-2 mt-3">
                    {[
                        { name: "Inter", author: "Rasmus Andersson", license: "SIL Open Font License 1.1", url: "https://rsms.me/inter/" },
                        { name: "IBM Plex Sans", author: "IBM Corp.", license: "SIL Open Font License 1.1", url: "https://www.ibm.com/plex/" },
                    ].map(({ name, author, license, url }) => (
                        <div key={name} className="flex items-center justify-between gap-4 bg-base-200 rounded-lg px-4 py-3">
                            <div>
                                <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-base-content/75 hover:text-primary transition-colors">
                                    {name}
                                </a>
                                <p className="text-xs text-base-content/35 mt-0.5">{author}</p>
                            </div>
                            <span className="text-[10px] font-mono text-primary/60 bg-primary/8 px-2 py-0.5 rounded shrink-0">{license}</span>
                        </div>
                    ))}
                </div>
            </LegalSection>

            <LegalSection id="open-source" title="Open Source Spirit">
                <p>
                    FLUX exists because of the incredible open-source ecosystem. Every library, tool, and standard used to build FLUX was created by developers who chose to share their work with the
                    world.
                </p>
                <p>
                    If FLUX is useful to you and you have the means, consider contributing back to the open-source projects that make it possible — whether through code contributions, bug reports,
                    documentation, or financial support to their maintainers.
                </p>
                <div className="bg-base-200 rounded-lg p-4 mt-3 border border-primary/15">
                    <p className="text-xs text-base-content/50 font-mono">FLUX · MIT Licensed · Open Source · Self-Hosted Media Platform</p>
                </div>
            </LegalSection>
        </LegalLayout>
    );
}
