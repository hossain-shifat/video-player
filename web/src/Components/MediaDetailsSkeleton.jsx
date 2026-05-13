export default function MediaDetailsSkeleton() {
    return (
        <div className="min-h-screen -m-4 sm:-m-6 lg:-m-8 animate-pulse">
            {/* ── Backdrop + Hero ──────────────────────────────────────────── */}
            <div className="relative">
                {/* Backdrop gradient */}
                <div className="absolute inset-x-0 top-0 h-80 sm:h-105 bg-linear-to-br from-base-300 via-base-200 to-base-300" />

                {/* Hero content — matches pt-8 sm:pt-10 of the real page */}
                <div className="relative px-4 sm:px-8 lg:px-12 pt-8 sm:pt-10 pb-8 z-10">
                    <div className="flex flex-col sm:flex-row gap-6 sm:gap-8 max-w-5xl">
                        {/* Poster */}
                        <div className="shrink-0 mx-auto sm:mx-0 w-36 sm:w-44 md:w-52">
                            <div className="aspect-2/3 rounded-2xl bg-base-300 ring-1 ring-white/5 shadow-2xl" />

                            {/* Rating bar below poster */}
                            <div className="mt-3 px-1 space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <div className="h-4 w-16 rounded bg-base-300" />
                                    <div className="h-3 w-12 rounded bg-base-300" />
                                </div>
                                <div className="h-1.5 w-full rounded-full bg-base-300" />
                            </div>
                        </div>

                        {/* Info panel */}
                        <div className="flex-1 min-w-0 pt-2">
                            {/* Type + status badges */}
                            <div className="flex gap-1.5 mb-2">
                                <div className="h-5 w-14 rounded bg-base-300" />
                                <div className="h-5 w-18 rounded bg-base-300" />
                            </div>

                            {/* Title */}
                            <div className="h-9 w-3/4 rounded-xl bg-base-300 mb-2" />

                            {/* Original title */}
                            <div className="h-3 w-1/3 rounded bg-base-300/60 mb-3" />

                            {/* Tagline */}
                            <div className="h-4 w-1/2 rounded bg-base-300/70 mb-3" />

                            {/* Meta row — year · runtime · language · seasons */}
                            <div className="flex flex-wrap gap-x-3 gap-y-1.5 mb-3">
                                <div className="h-4 w-10 rounded bg-base-300" />
                                <div className="h-4 w-14 rounded bg-base-300" />
                                <div className="h-4 w-16 rounded bg-base-300" />
                            </div>

                            {/* Genre pills */}
                            <div className="flex flex-wrap gap-1.5 mb-4">
                                <div className="h-5 w-14 rounded-full bg-base-300" />
                                <div className="h-5 w-18 rounded-full bg-base-300" />
                                <div className="h-5 w-12 rounded-full bg-base-300" />
                                <div className="h-5 w-20 rounded-full bg-base-300" />
                            </div>

                            {/* Action buttons — Play · Trailer · Eye · Heart */}
                            <div className="flex gap-2 mb-5">
                                <div className="h-10 w-28 rounded-full bg-primary/30" />
                                <div className="h-10 w-24 rounded-full bg-base-300" />
                                <div className="h-10 w-10 rounded-full bg-base-300" />
                                <div className="h-10 w-10 rounded-full bg-base-300" />
                            </div>

                            {/* Overview lines */}
                            <div className="space-y-2">
                                <div className="h-4 w-full rounded bg-base-300" />
                                <div className="h-4 w-[95%] rounded bg-base-300" />
                                <div className="h-4 w-[75%] rounded bg-base-300" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Page body ────────────────────────────────────────────────── */}
            <div className="space-y-8 px-4 sm:px-8 lg:px-12 pb-20">
                {/* Seasons skeleton */}
                <div className="max-w-5xl">
                    <div className="flex items-center gap-2 mb-3">
                        <div className="h-5 w-5 rounded bg-base-300" />
                        <div className="h-5 w-28 rounded bg-base-300" />
                    </div>
                    <div className="space-y-3">
                        {[1, 2].map((i) => (
                            <div key={i} className="bg-base-200 rounded-xl p-4 border border-white/5">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-14 rounded bg-base-300 shrink-0" />
                                    <div className="flex-1">
                                        <div className="h-5 w-36 rounded bg-base-300 mb-2" />
                                        <div className="h-3 w-20 rounded bg-base-300" />
                                    </div>
                                    <div className="w-4 h-4 rounded bg-base-300" />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Cast skeleton */}
                <div className="max-w-5xl">
                    <div className="flex items-center gap-2 mb-3">
                        <div className="h-5 w-5 rounded bg-base-300" />
                        <div className="h-5 w-16 rounded bg-base-300" />
                    </div>
                    <div className="flex gap-4 overflow-hidden">
                        {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                            <div key={i} className="w-20 sm:w-24 shrink-0 text-center">
                                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-base-300 mx-auto mb-2" />
                                <div className="h-3 w-14 rounded bg-base-300 mx-auto mb-1" />
                                <div className="h-2 w-10 rounded bg-base-300 mx-auto" />
                            </div>
                        ))}
                    </div>
                </div>

                {/* Divider */}
                <div className="border-t border-white/5" />

                {/* Details grid skeleton — matches grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 */}
                <div className="max-w-5xl">
                    <div className="flex items-center gap-2 mb-3">
                        <div className="h-5 w-5 rounded bg-base-300" />
                        <div className="h-5 w-20 rounded bg-base-300" />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                            <div key={i} className="bg-base-200 rounded-xl p-3">
                                {/* Icon + label row */}
                                <div className="flex items-center gap-1.5 mb-1.5">
                                    <div className="h-3 w-3 rounded bg-base-300" />
                                    <div className="h-3 w-12 rounded bg-base-300" />
                                </div>
                                {/* Value */}
                                <div className="h-4 w-20 rounded bg-base-300" />
                                {/* Optional note (e.g. Dual Audio) */}
                                {i === 2 && <div className="h-2.5 w-16 rounded bg-base-300 mt-1" />}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Divider */}
                <div className="border-t border-white/5" />

                {/* Similar Media row skeleton */}
                <div>
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <div className="h-5 w-28 rounded bg-base-300" />
                            <div className="h-5 w-8 rounded-full bg-base-300" />
                        </div>
                        <div className="hidden sm:flex items-center gap-1">
                            <div className="w-7 h-7 rounded-full bg-base-300" />
                            <div className="w-7 h-7 rounded-full bg-base-300" />
                        </div>
                    </div>
                    <div className="flex gap-3 overflow-hidden">
                        {[1, 2, 3, 4, 5, 6].map((i) => (
                            <div key={i} className="shrink-0 w-40 sm:w-44">
                                <div className="aspect-2/3 rounded-xl bg-base-300 mb-2" />
                                <div className="h-3.5 w-3/4 rounded bg-base-300 mb-1.5" />
                                <div className="h-3 w-1/2 rounded bg-base-300" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
