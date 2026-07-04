// licenseConfig.js
// Single source of truth for the Licenses page. Edit here, never in components.

export const TOC = [
    { id: "overview", label: "Overview" },
    { id: "permissions", label: "Permissions" },
    { id: "conditions", label: "Conditions" },
    { id: "limitations", label: "Limitations" },
    { id: "license-text", label: "Full License Text" },
    { id: "frontend", label: "Frontend Libraries" },
    { id: "backend", label: "Backend Libraries" },
    { id: "ffmpeg", label: "Media Processing & Codecs" },
    { id: "tmdb", label: "TMDB Attribution" },
    { id: "fonts", label: "Fonts" },
    { id: "assets", label: "Icons & Assets" },
    { id: "privacy", label: "Privacy & Data" },
    { id: "disclaimer", label: "Disclaimer" },
    { id: "changelog", label: "License Changelog" },
    { id: "faq", label: "FAQ" },
    { id: "contact", label: "Contact" },
];

export const LICENSE_STATUS = {
    licenseType: "Open Source (Non-Commercial)",
    version: "0.9.0",
    buildVersion: "2026.05.23-b1",
    releaseDate: "May 23, 2026",
    status: "active", // active | deprecated | preview
    copyright: "© 2026 FLUX Contributors",
};

export const QUICK_OVERVIEW = [
    { icon: "Scale", label: "License", value: "Personal Use, Non-Commercial" },
    { icon: "User", label: "Author", value: "FLUX Contributors" },
    { icon: "Building2", label: "Organization", value: "Self-Hosted / Independent" },
    { icon: "Globe", label: "Website", value: "Not configured yet", url: null },
    { icon: "BookOpen", label: "Documentation", value: "In-app Help Center", url: null },
    { icon: "GitBranch", label: "Repository", value: "Open source — link coming soon", url: null },
    { icon: "Bug", label: "Issue Tracker", value: "Not configured yet", url: null },
    { icon: "Tag", label: "Current Version", value: LICENSE_STATUS.version },
    { icon: "Layers", label: "Supported Editions", value: "Self-Hosted (single edition)" },
];

export const PERMISSIONS = [
    { icon: "Briefcase", title: "Commercial Use", status: "not-allowed", description: "FLUX is a personal project. It may not be sold, sublicensed, or used as part of a commercial product or service." },
    { icon: "Home", title: "Private Use", status: "allowed", description: "Use and modify FLUX freely for your own personal, private purposes." },
    { icon: "Wrench", title: "Modification", status: "allowed", description: "Modify the source code to fit your own home server setup." },
    { icon: "Share2", title: "Distribution", status: "allowed", description: "Source is open — fork it, share it, or run your own copy on your own network." },
    { icon: "Server", title: "Self Hosting", status: "allowed", description: "Run FLUX on your own hardware, within your own home or private network." },
    { icon: "FileCheck2", title: "Patent Use", status: "not-allowed", description: "No patent rights are granted; none are claimed by this project either." },
    { icon: "BadgeCheck", title: "Trademark Use", status: "not-allowed", description: "The FLUX name and logo may not be used to endorse or promote any other project." },
    { icon: "GitBranch", title: "Sublicensing", status: "not-allowed", description: "You may not grant your own license terms for copies of FLUX." },
    { icon: "Cpu", title: "Reverse Engineering", status: "allowed", description: "Inspect and adapt the code freely — the full source is already yours to see." },
    { icon: "Code2", title: "Source Code Access", status: "allowed", description: "Full source is available to you, always, as the owner of this instance." },
];

export const CONDITIONS = [
    { icon: "Copyright", title: "Preserve Copyright", description: "Keep the original copyright notice in any copy you keep or share personally." },
    { icon: "FileText", title: "Include License", description: "Keep this licenses page and notice intact alongside any copy of the project." },
    { icon: "History", title: "State Changes", description: "Not required, but noting your own modifications helps future-you when debugging." },
    { icon: "Ban", title: "No Commercial Use", description: "Don't sell FLUX, host it as a paid service, or bundle it into a commercial product." },
    { icon: "GitPullRequest", title: "Contributions Welcome", description: "Bug fixes and improvements are welcome via pull request — contributions are provided under this same license." },
    { icon: "BookOpen", title: "Personal Scope Only", description: "Treat a running instance as a private household tool — not a public or hosted offering." },
];

export const LIMITATIONS = [
    { icon: "ShieldOff", title: "Liability", description: "No one is liable for any damages, data loss, or downtime arising from running FLUX." },
    { icon: "AlertTriangle", title: "Warranty", description: "FLUX is provided \"as is\", without warranty of any kind, explicit or implied." },
    { icon: "LifeBuoy", title: "Support", description: "This is a solo, personal project — there is no guaranteed support, SLA, or maintenance schedule." },
    { icon: "BadgeCheck", title: "Trademark Rights", description: "No trademark rights are granted or implied by using this software." },
    { icon: "FileCheck2", title: "Patent Rights", description: "No patent rights are granted beyond what is inherently necessary to run the code locally." },
    { icon: "Gavel", title: "Legal Responsibility", description: "You are responsible for how you deploy, share, and use this project on your own network." },
];

export const MIT_FULL_TEXT = `FLUX — Open Source, Non-Commercial License

Copyright (c) 2026 FLUX Contributors

FLUX is an open-source, self-hosted media project — a personal alternative to Plex and Jellyfin, built for private use on a home network.

1. Open Source
   The source code is open for anyone to read, learn from, fork, and improve. Bug reports and pull requests are welcome.

2. Personal, Non-Commercial Use
   Running instances of FLUX are for personal, non-commercial use. FLUX may not be sold, sublicensed, rented, hosted as a paid service, or bundled into a commercial product.

3. Contributions
   By submitting a bug fix, patch, or improvement, you agree it's provided under this same license, with no expectation of compensation.

4. Modification & Forking
   You may modify or fork the code for your own use or to contribute back. You are not required to publish your changes.

5. No Warranty
   FLUX is provided "as is", without warranty of any kind, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, and non-infringement.

6. No Liability
   In no event shall the author or contributors be liable for any claim, damages, data loss, or other liability arising from the use of this software.

7. Third-Party Software
   FLUX includes third-party open-source libraries, each governed by their own original licenses (see the Frontend Libraries and Backend Libraries sections below). This notice applies only to FLUX's own code, not to the third-party software it depends on.`;

export const FRONTEND_LIBS = [
    { name: "React", version: "19.x", author: "Meta Platforms, Inc.", license: "MIT", url: "https://react.dev", description: "UI library powering every FLUX view." },
    { name: "React Router", version: "7.x", author: "Remix Software, Inc.", license: "MIT", url: "https://reactrouter.com", description: "Client-side routing between library, player, and settings." },
    { name: "Vite", version: "8.x", author: "Evan You & Vite Contributors", license: "MIT", url: "https://vitejs.dev", description: "Dev server and production bundler." },
    { name: "Tailwind CSS", version: "4.x", author: "Tailwind Labs, Inc.", license: "MIT", url: "https://tailwindcss.com", description: "Utility-first styling engine." },
    { name: "DaisyUI", version: "5.x", author: "Pouya Saadeghi", license: "MIT", url: "https://daisyui.com", description: "Themeable component classes on top of Tailwind." },
    { name: "Lucide React", version: "1.x", author: "Lucide Contributors", license: "ISC", url: "https://lucide.dev", description: "Icon set used throughout the interface." },
    { name: "HLS.js", version: "1.x", author: "HLS.js Contributors", license: "Apache-2.0", url: "https://github.com/video-dev/hls.js", description: "Client-side HLS playback for transcoded streams." },
    { name: "@use-gesture/react", version: "10.x", author: "Poimandres", license: "MIT", url: "https://use-gesture.netlify.app", description: "Powers MX Player–style swipe and pinch gestures." },
    { name: "@tanstack/react-query", version: "5.x", author: "Tanner Linsley", license: "MIT", url: "https://tanstack.com/query", description: "Server-state caching and data fetching." },
    { name: "Axios", version: "1.x", author: "Matt Zabriskie & Axios Contributors", license: "MIT", url: "https://axios-http.com", description: "HTTP client for the backend API." },
    { name: "React Icons", version: "5.x", author: "kamijin_fanta & React Icons Contributors", license: "MIT", url: "https://react-icons.github.io/react-icons", description: "Supplementary icon packs." },
    { name: "screenfull", version: "6.x", author: "Sindre Sorhus", license: "MIT", url: "https://github.com/sindresorhus/screenfull", description: "Cross-browser Fullscreen API wrapper." },
];

export const BACKEND_LIBS = [
    { name: "Express", version: "5.x", author: "TJ Holowaychuk & OpenJS Foundation", license: "MIT", url: "https://expressjs.com", description: "HTTP server and API routing." },
    { name: "Prisma", version: "7.x", author: "Prisma Data, Inc.", license: "Apache-2.0", url: "https://www.prisma.io", description: "Type-safe database ORM." },
    { name: "@libsql/client", version: "0.17.x", author: "Turso / libSQL Contributors", license: "MIT", url: "https://github.com/tursodatabase/libsql-client-ts", description: "SQLite-compatible database driver." },
    { name: "argon2", version: "0.44.x", author: "Ranieri Althoff", license: "MIT", url: "https://github.com/ranisalt/node-argon2", description: "Password hashing for local accounts." },
    { name: "jsonwebtoken", version: "9.x", author: "Auth0", license: "MIT", url: "https://github.com/auth0/node-jsonwebtoken", description: "Session token signing and verification." },
    { name: "cors", version: "2.x", author: "Troy Goode", license: "MIT", url: "https://github.com/expressjs/cors", description: "Cross-origin request handling." },
    { name: "dotenv", version: "17.x", author: "Scott Motte", license: "BSD-2-Clause", url: "https://github.com/motdotla/dotenv", description: "Environment variable loading." },
    { name: "mime-types", version: "3.x", author: "Jonathan Ong & Douglas Christopher Wilson", license: "MIT", url: "https://github.com/jshttp/mime-types", description: "MIME type detection for streamed files." },
    { name: "multer", version: "2.x", author: "Express Contributors", license: "MIT", url: "https://github.com/expressjs/multer", description: "Multipart upload handling." },
    { name: "fluent-ffmpeg", version: "2.x", author: "Stefano Sala", license: "MIT", url: "https://github.com/fluent-ffmpeg/node-fluent-ffmpeg", description: "Node.js wrapper for FFmpeg transcoding jobs." },
    { name: "systeminformation", version: "5.x", author: "Sebastian Hildebrandt", license: "MIT", url: "https://systeminformation.io", description: "Server hardware and health metrics." },
    { name: "ua-parser-js", version: "2.x", author: "Faisal Salman", license: "MIT", url: "https://github.com/faisalman/ua-parser-js", description: "Client device and browser detection." },
    { name: "js-yaml", version: "5.x", author: "Vitaly Puzrin", license: "MIT", url: "https://github.com/nodeca/js-yaml", description: "YAML config parsing." },
    { name: "resend", version: "6.x", author: "Resend, Inc.", license: "MIT", url: "https://resend.com", description: "Transactional email delivery (invites, resets)." },
    { name: "playwright", version: "1.x", author: "Microsoft Corporation", license: "Apache-2.0", url: "https://playwright.dev", description: "Used internally for automated UI testing." },
    { name: "nodemon", version: "3.x", author: "Remy Sharp", license: "MIT", url: "https://nodemon.io", description: "Auto-restarts the dev server on file changes." },
];

export const FONTS = [
    { name: "Inter", author: "Rasmus Andersson", license: "SIL Open Font License 1.1", url: "https://rsms.me/inter/", role: "Interface body text" },
    { name: "IBM Plex Sans", author: "IBM Corp.", license: "SIL Open Font License 1.1", url: "https://www.ibm.com/plex/", role: "Headings and emphasis" },
];

export const ASSET_NOTICES = [
    { icon: "Image", title: "Icons", description: "Interface icons are provided by Lucide and React Icons, both MIT licensed." },
    { icon: "Palette", title: "Illustrations & Backgrounds", description: "No third-party illustrations are bundled with FLUX; any backgrounds are generated CSS gradients." },
    { icon: "Clapperboard", title: "Posters & Artwork", description: "Movie and show posters are fetched live from TMDB and remain the property of their respective studios and rights holders." },
    { icon: "Database", title: "Metadata Providers", description: "Titles, descriptions, and cast data are sourced from TMDB and are not stored or redistributed by FLUX beyond local caching for your own library." },
];

export const PRIVACY_LINKS = [
    { label: "Privacy Policy", to: "/legal/privacy" },
    { label: "Terms of Service", to: "/legal/terms" },
];

export const CHANGELOG = [
    { version: "0.9.0", date: "May 23, 2026", title: "Licenses page rebuild", changes: ["Rebuilt as a config-driven, sectioned reference page", "Added permissions, conditions, and limitations breakdown", "Added searchable full license text viewer"] },
    { version: "0.6.0", date: "Mar 2, 2026", title: "TMDB attribution added", changes: ["Added required TMDB attribution block", "Documented metadata and poster sourcing"] },
    { version: "0.3.0", date: "Jan 14, 2026", title: "Initial licenses page", changes: ["First version listing MIT license and core dependencies"] },
];

export const FAQ = [
    { q: "Can I modify the software?", a: "Yes. You're free to modify FLUX for your own personal, self-hosted setup." },
    { q: "Can I redistribute it?", a: "Yes — the source is open, so forking and sharing your own copy is welcome. Selling it or hosting it commercially isn't permitted." },
    { q: "Can I use it commercially?", a: "No. FLUX is a personal, non-commercial project and isn't licensed for resale or paid hosting." },
    { q: "Can I contribute?", a: "Yes! Bug reports and pull requests are welcome. The repository link will be published here once it's public." },
    { q: "How do I report issues?", a: "Through the project's issue tracker once the repository is published; that link isn't configured yet." },
    { q: "How do I request another license?", a: "FLUX is only offered under this open-source, non-commercial license; no alternate licensing is available." },
    { q: "Where can I find the full license?", a: "The complete license text is available above in the \"Full License Text\" section, and is also copyable and downloadable from there." },
];

export const CONTACT = [
    { icon: "Globe", label: "Website", value: "Not configured yet" },
    { icon: "BookOpen", label: "Documentation", value: "In-app Help Center" },
    { icon: "GitBranch", label: "Repository", value: "Open source — link coming soon" },
    { icon: "Bug", label: "Issue Tracker", value: "Not configured yet" },
    { icon: "Mail", label: "Email", value: "Not configured" },
];
