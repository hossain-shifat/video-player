// Mirrors the layout of pages/Media/Details/MediaDetails.jsx.
// Keep section order + widths in sync with that file so there is no layout jump on load.

// ─── Shared bits ──────────────────────────────────────────────────────────────

// Mirrors <SectionHeading>: accent bar + icon + title
function SkeletonHeading({ width = "w-28" }) {
    return (
        <div className="flex items-center gap-2.5 mb-3">
            <div className="w-1 h-4 rounded-full bg-primary/30 shrink-0" />
            <div className="h-[18px] w-[18px] rounded bg-base-300 shrink-0" />
            <div className={`h-5 ${width} rounded bg-base-300`} />
        </div>
    );
}

// Mirrors <Divider>
function Divider() {
    return <div className="border-t border-white/5" />;
}

// Mirrors MediaCard footprint (w-40 sm:w-44, 2/3 poster, title, year row)
function PosterCardSkeleton() {
    return (
        <div className="shrink-0 w-40 sm:w-44 my-2">
            <div className="aspect-2/3 rounded-xl bg-base-300 ring-1 ring-white/5" />
            <div className="mt-2 px-0.5">
                <div className="h-3.5 w-3/4 rounded bg-base-300" />
                <div className="flex items-center justify-between mt-1.5">
                    <div className="h-3 w-8 rounded bg-base-300/70" />
                    <div className="h-3 w-14 rounded bg-base-300/70" />
                </div>
            </div>
        </div>
    );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
export default function MediaDetailsSkeleton() {
    return (
        <div className="min-h-screen -m-4 sm:-m-6 lg:-m-8 animate-pulse">
            {/* ── Backdrop + Hero ─────────────────────────────────────────── */}
            <div className="relative">
                {/* Backdrop — same sizing as real page */}
                <div className="absolute inset-x-0 top-0 h-[42vh] min-h-[280px] max-h-[520px] sm:h-[48vh] sm:max-h-[560px] pointer-events-none" style={{ zIndex: 0 }}>
                    <div className="w-full h-full bg-linear-to-br from-base-300 via-base-200 to-base-300" />
                    <div className="absolute inset-0 bg-linear-to-t from-base-100 via-base-100/75 to-transparent" />
                    <div className="absolute inset-0 bg-linear-to-r from-base-100/95 via-base-100/40 to-transparent hidden sm:block" />
                </div>

                {/* Hero content */}
                <div className="relative px-4 sm:px-6 md:px-8 lg:px-12 pt-6 sm:pt-10 pb-8" style={{ zIndex: 1 }}>
                    <div className="flex flex-col sm:flex-row gap-5 sm:gap-8 max-w-6xl">
                        {/* ── Poster ──────────────────────────────────────── */}
                        <div className="shrink-0 mx-auto sm:mx-0 w-32 xs:w-36 sm:w-44 md:w-52 lg:w-56">
                            <div className="aspect-2/3 rounded-2xl bg-base-300 shadow-2xl" />

                            {/* Rating below poster */}
                            <div className="mt-3 px-1 space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <div className="h-4 w-20 rounded bg-base-300" />
                                    <div className="h-3 w-12 rounded bg-base-300" />
                                </div>
                                <div className="h-1.5 w-full rounded-full bg-base-300" />
                            </div>
                        </div>

                        {/* ── Info panel ──────────────────────────────────── */}
                        <div className="flex-1 min-w-0">
                            {/* Badges: type · status · certification */}
                            <div className="flex flex-wrap gap-1.5 mb-2">
                                <div className="h-5 w-16 rounded bg-primary/20" />
                                <div className="h-5 w-20 rounded bg-base-300" />
                                <div className="h-5 w-12 rounded bg-base-300" />
                            </div>

                            {/* Title */}
                            <div className="h-8 sm:h-10 lg:h-11 w-3/4 rounded-xl bg-base-300 mb-1" />

                            {/* Original title */}
                            <div className="h-3 w-1/3 rounded bg-base-300/60 mb-2" />

                            {/* Tagline */}
                            <div className="h-4 w-1/2 rounded bg-base-300/70 mb-3" />

                            {/* Meta row — date · runtime · language · seasons */}
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-3">
                                <div className="h-4 w-32 rounded bg-base-300" />
                                <div className="h-4 w-14 rounded bg-base-300" />
                                <div className="h-4 w-16 rounded bg-base-300" />
                            </div>

                            {/* Inline rating badges — IMDb / RT / TMDB (icon + score) */}
                            <div className="flex flex-wrap items-center gap-2 mb-3">
                                {[1, 2, 3].map((i) => (
                                    <div key={i} className="flex items-center gap-1.5 px-2.5 py-1">
                                        <div className="h-4 w-6 rounded bg-base-300" />
                                        <div className="h-3.5 w-7 rounded bg-base-300" />
                                    </div>
                                ))}
                            </div>

                            {/* Genre tags */}
                            <div className="flex flex-wrap gap-1.5 mb-5">
                                <div className="h-5 w-16 rounded-md bg-base-300" />
                                <div className="h-5 w-20 rounded-md bg-base-300" />
                                <div className="h-5 w-14 rounded-md bg-base-300" />
                                <div className="h-5 w-24 rounded-md bg-base-300" />
                            </div>

                            {/* Action buttons — Play · Trailer · ⋮ (single nowrap row) */}
                            <div className="flex flex-nowrap items-center gap-2 mb-5 overflow-hidden">
                                <div className="h-8 sm:h-10 w-28 rounded-full bg-primary/30 shrink-0" />
                                <div className="h-8 sm:h-10 w-24 rounded-full bg-base-300 shrink-0" />
                                <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-full bg-base-300 shrink-0" />
                            </div>

                            {/* Overview */}
                            <div className="space-y-2">
                                <div className="h-4 w-full rounded bg-base-300" />
                                <div className="h-4 w-[95%] rounded bg-base-300" />
                                <div className="h-4 w-[85%] rounded bg-base-300" />
                                <div className="h-4 w-[60%] rounded bg-base-300" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Page body ────────────────────────────────────────────────── */}
            <div className="space-y-8 px-4 sm:px-8 lg:px-12 pb-20">
                {/* ── Seasons (MediaCard-style poster row) ──────────────────── */}
                <section className="w-full">
                    <SkeletonHeading width="w-24" />
                    <div className="flex gap-3 overflow-hidden -mx-1 px-1">
                        {[1, 2, 3, 4].map((i) => (
                            <PosterCardSkeleton key={i} />
                        ))}
                    </div>
                </section>

                {/* ── Cast & Crew ───────────────────────────────────────────── */}
                <section className="w-full">
                    <SkeletonHeading width="w-32" />
                    <div className="flex gap-4 overflow-hidden">
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                            <div key={i} className="w-20 sm:w-24 shrink-0 text-center">
                                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-base-300 mx-auto mb-2" />
                                <div className="h-3 w-14 rounded bg-base-300 mx-auto mb-1" />
                                <div className="h-2.5 w-10 rounded bg-base-300/70 mx-auto" />
                            </div>
                        ))}
                    </div>
                </section>

                <Divider />

                {/* ── Reviews ───────────────────────────────────────────────── */}
                <section className="w-full">
                    <SkeletonHeading width="w-24" />
                    <div className="flex gap-3 overflow-hidden">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="shrink-0 w-72 sm:w-80 bg-base-200 rounded-xl border border-white/5 p-4 space-y-3">
                                <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-full bg-base-300 shrink-0" />
                                    <div className="flex-1 space-y-1.5">
                                        <div className="h-3.5 w-24 rounded bg-base-300" />
                                        <div className="flex gap-0.5">
                                            {[1, 2, 3, 4, 5].map((s) => (
                                                <div key={s} className="h-3 w-3 rounded-sm bg-base-300" />
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <div className="h-3 w-full rounded bg-base-300" />
                                    <div className="h-3 w-[92%] rounded bg-base-300" />
                                    <div className="h-3 w-[70%] rounded bg-base-300/70" />
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <Divider />

                {/* ── Trailers & Extras ─────────────────────────────────────── */}
                <section className="w-full">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <div className="h-[18px] w-[18px] rounded bg-base-300" />
                            <div className="h-5 w-40 rounded bg-base-300" />
                        </div>
                        <div className="flex items-center gap-1">
                            <div className="w-7 h-7 rounded-full bg-base-300" />
                            <div className="w-7 h-7 rounded-full bg-base-300" />
                        </div>
                    </div>
                    <div className="flex gap-3 overflow-hidden">
                        {[1, 2, 3, 4].map((i) => (
                            <div key={i} className="shrink-0 w-52 sm:w-60 rounded-xl overflow-hidden bg-base-200 border border-white/5">
                                <div className="aspect-video bg-base-300" />
                                <div className="px-3 py-2 space-y-1.5">
                                    <div className="h-3 w-3/4 rounded bg-base-300" />
                                    <div className="h-3 w-1/2 rounded bg-base-300/60" />
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <Divider />

                {/* ── Production companies ──────────────────────────────────── */}
                <section className="w-full">
                    <SkeletonHeading width="w-28" />
                    <div className="flex gap-3 overflow-hidden sm:flex-wrap">
                        {[1, 2, 3, 4].map((i) => (
                            <div key={i} className="flex items-start gap-3 bg-base-200 rounded-xl border border-white/5 px-3.5 py-3 w-40 sm:w-44 shrink-0">
                                <div className="w-12 h-9 rounded-md bg-base-300 shrink-0 mt-0.5" />
                                <div className="flex-1 space-y-1.5 pt-0.5">
                                    <div className="h-3 w-full rounded bg-base-300" />
                                    <div className="h-2.5 w-8 rounded bg-base-300/70" />
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <Divider />

                {/* ── Details grid (15 cells max, xl:5 cols) ───────────────── */}
                <section className="w-full">
                    <SkeletonHeading width="w-20" />
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                        {Array.from({ length: 10 }).map((_, i) => (
                            <div key={i} className="bg-base-200 rounded-xl p-3 flex flex-col gap-1 border border-white/5">
                                <div className="flex items-center gap-1.5">
                                    <div className="h-[11px] w-[11px] rounded bg-base-300" />
                                    <div className="h-3 w-16 rounded bg-base-300/70" />
                                </div>
                                <div className="h-4 w-24 rounded bg-base-300" />
                                {i === 1 && <div className="h-2.5 w-14 rounded bg-primary/20 mt-0.5" />}
                            </div>
                        ))}
                    </div>
                </section>

                <Divider />

                {/* ── Related sections (MediaRow-style) ─────────────────────── */}
                <section className="w-full">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <div className="h-5 w-32 rounded bg-base-300" />
                            <div className="h-5 w-8 rounded-full bg-base-300" />
                        </div>
                        <div className="hidden sm:flex items-center gap-1">
                            <div className="w-7 h-7 rounded-full bg-base-300" />
                            <div className="w-7 h-7 rounded-full bg-base-300" />
                        </div>
                    </div>
                    <div className="flex gap-3 overflow-hidden -mx-1 px-1">
                        {[1, 2, 3, 4, 5, 6].map((i) => (
                            <PosterCardSkeleton key={i} />
                        ))}
                    </div>
                </section>
            </div>
        </div>
    );
}
