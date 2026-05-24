import { Link, useLocation } from "react-router";
import { ArrowLeft } from "lucide-react";

/**
 * LegalLayout — reusable wrapper for Terms, Privacy, Licenses pages
 *
 * Props:
 *   title       — page heading
 *   lastUpdated — ISO date string or readable date
 *   description — short intro paragraph
 *   toc         — optional [{ id, label }] for table of contents
 *   children    — page sections
 */
export default function LegalLayout({ title, lastUpdated, description, toc, children }) {
    return (
        <div className="min-h-screen bg-base-100">
            {/* ── Sticky sub-header ── */}
            {/* <div className="sticky top-14 z-40 bg-base-100/80 backdrop-blur border-b border-base-content/8">
                <div className="max-w-4xl mx-auto px-6 h-12 flex items-center gap-4">
                    <Link to="/" className="flex items-center gap-1.5 text-xs text-base-content/50 hover:text-primary transition-colors duration-150">
                        <ArrowLeft size={13} />
                        Back
                    </Link>
                    <span className="text-base-content/20 text-xs">·</span>
                    <span className="text-xs text-base-content/40 font-mono">FLUX / Legal</span>
                    <span className="text-base-content/20 text-xs">·</span>
                    <span className="text-xs text-base-content/40 truncate">{title}</span>
                </div>
            </div> */}

            <div className="max-w-full mx-auto p-3 md:px-16 md:py-6">
                {/* ── Page header ── */}
                <div className="mb-12 pb-8 border-b border-base-content/10">
                    <p className="text-[11px] font-semibold text-primary uppercase tracking-[0.2em] mb-3 font-mono">FLUX · Legal</p>
                    <h1 className="text-3xl sm:text-4xl font-bold text-base-content mb-4 leading-tight">{title}</h1>
                    {description && <p className="text-base text-base-content/60 leading-relaxed max-w-2xl">{description}</p>}
                    {lastUpdated && <p className="text-xs text-base-content/35 font-mono mt-4">Last updated: {lastUpdated}</p>}
                </div>

                <div className="flex gap-12">
                    {/* ── Optional TOC (desktop only) ── */}
                    {toc?.length > 0 && (
                        <aside className="hidden lg:block w-48 shrink-0">
                            <div className="sticky top-32">
                                <p className="text-md font-semibold text-primary uppercase tracking-widest mb-3 font-mono">Contents</p>
                                <nav className="flex flex-col gap-1">
                                    {toc.map(({ id, label }) => (
                                        <a key={id} href={`#${id}`} className="text-sm text-base-content hover:text-primary transition-colors duration-150 py-0.5 leading-snug">
                                            {label}
                                        </a>
                                    ))}
                                </nav>
                            </div>
                        </aside>
                    )}

                    {/* ── Main content ── */}
                    <div className="flex-1 min-w-0 space-y-10">{children}</div>
                </div>
            </div>
        </div>
    );
}

// ── Section building block ────────────────────────────────────────────────────
export function LegalSection({ id, title, children }) {
    return (
        <section id={id} className="scroll-mt-28">
            <h2 className="text-lg font-semibold text-base-content mb-3 flex items-center gap-2">
                <span className="w-1 h-4 bg-primary rounded-full shrink-0" />
                {title}
            </h2>
            <div className="text-sm text-base-content/65 leading-7 space-y-3 pl-3 border-l border-base-content/8">{children}</div>
        </section>
    );
}
