
export default function MediaDetailsSkeleton() {
    return (
        <div className="min-h-screen -m-4 sm:-m-6 lg:-m-8 animate-pulse">
            {/* Backdrop */}
            <div className="relative">
                <div className="absolute inset-x-0 top-0 h-90 sm:h-105 bg-linear-to-br from-base-300 via-base-200 to-base-300" />

                <div className="relative px-4 sm:px-8 lg:px-12 pt-14 pb-8 sm:pt-10 z-10">
                    <div className="flex flex-col sm:flex-row gap-6 sm:gap-8 max-w-5xl">
                        {/* Poster Skeleton */}
                        <div className="shrink-0 mx-auto sm:mx-0 w-36 sm:w-44 md:w-52">
                            <div className="aspect-2/3 rounded-2xl bg-base-300 ring-1 ring-white/5 shadow-2xl overflow-hidden relative">
                                <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/5 to-transparent shimmer" />
                            </div>
                        </div>

                        {/* Info Skeleton */}
                        <div className="flex-1 min-w-0 pt-2">
                            {/* Title */}
                            <div className="h-10 w-3/4 rounded-xl bg-base-300 mb-3" />

                            {/* Tagline */}
                            <div className="h-4 w-1/2 rounded bg-base-300/70 mb-5" />

                            {/* Meta */}
                            <div className="flex flex-wrap gap-2 mb-5">
                                <div className="h-6 w-20 rounded-full bg-base-300" />
                                <div className="h-6 w-16 rounded-full bg-base-300" />
                                <div className="h-6 w-24 rounded-full bg-base-300" />
                                <div className="h-6 w-28 rounded-full bg-base-300" />
                            </div>

                            {/* Rating */}
                            <div className="flex gap-3 mb-6">
                                <div className="h-5 w-24 rounded bg-base-300" />
                                <div className="h-5 w-40 rounded bg-base-300" />
                            </div>

                            {/* Buttons */}
                            <div className="flex gap-3 mb-6">
                                <div className="h-11 w-36 rounded-full bg-primary/30" />
                                <div className="h-11 w-36 rounded-full bg-base-300" />
                                <div className="h-11 w-11 rounded-full bg-base-300" />
                                <div className="h-11 w-11 rounded-full bg-base-300" />
                            </div>

                            {/* Overview */}
                            <div className="space-y-2">
                                <div className="h-4 w-full rounded bg-base-300" />
                                <div className="h-4 w-[95%] rounded bg-base-300" />
                                <div className="h-4 w-[80%] rounded bg-base-300" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Seasons Skeleton */}
            <div className="px-4 sm:px-8 lg:px-12 pt-6 max-w-5xl">
                <div className="h-6 w-40 rounded bg-base-300 mb-4" />

                <div className="space-y-4">
                    {[1, 2].map((i) => (
                        <div key={i} className="bg-base-200 rounded-2xl p-4">
                            <div className="flex gap-3 mb-4">
                                <div className="w-12 h-16 rounded-lg bg-base-300" />

                                <div className="flex-1">
                                    <div className="h-5 w-40 rounded bg-base-300 mb-2" />
                                    <div className="h-3 w-24 rounded bg-base-300" />
                                </div>
                            </div>

                            <div className="space-y-2">
                                {[1, 2, 3].map((ep) => (
                                    <div key={ep} className="flex gap-3 p-2 rounded-xl">
                                        <div className="w-20 h-12 rounded bg-base-300 shrink-0" />

                                        <div className="flex-1">
                                            <div className="h-4 w-2/3 rounded bg-base-300 mb-2" />
                                            <div className="h-3 w-full rounded bg-base-300" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Cast Skeleton */}
            <div className="px-4 sm:px-8 lg:px-12 py-8">
                <div className="h-6 w-40 rounded bg-base-300 mb-5" />

                <div className="flex gap-4 overflow-hidden">
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                        <div key={i} className="w-20 sm:w-24 shrink-0 text-center">
                            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-base-300 mx-auto mb-2" />
                            <div className="h-3 w-16 rounded bg-base-300 mx-auto mb-1" />
                            <div className="h-2 w-12 rounded bg-base-300 mx-auto" />
                        </div>
                    ))}
                </div>
            </div>

            {/* Details Skeleton */}
            <div className="px-4 sm:px-8 lg:px-12 pb-12 max-w-5xl">
                <div className="h-6 w-32 rounded bg-base-300 mb-4" />

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                        <div key={i} className="bg-base-200 rounded-2xl p-3">
                            <div className="h-3 w-16 rounded bg-base-300 mb-2" />
                            <div className="h-5 w-24 rounded bg-base-300" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
