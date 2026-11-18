// Card detail helpers for the Flux card style.
// Every helper returns null when the field is missing, so the tag/tile simply hides.
// If your /media items use different field names, change them here — one place only.

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
};

const firstEpisode = (item) => item?.episodes?.[0] ?? item?.seasons?.[0]?.episodes?.[0] ?? null;

function labelFromHeight(h) {
    if (h >= 2000) return "4K";
    if (h >= 1400) return "1440p";
    if (h >= 1000) return "1080p";
    if (h >= 700) return "720p";
    return "SD";
}

/** "4K" | "1080p" | "720p" | "SD" | null */
export function getResolution(item) {
    const src = item?.mediaInfo ?? item?.mediainfo ?? item;
    const ep = firstEpisode(item);
    const raw = src?.resolution ?? item?.parsed?.resolution ?? item?.quality ?? ep?.resolution ?? ep?.parsed?.resolution ?? null;

    if (typeof raw === "string") {
        if (/4k|2160/i.test(raw)) return "4K";
        const p = raw.match(/(\d{3,4})\s*p/i);
        if (p) return labelFromHeight(Number(p[1]));
        const wh = raw.match(/(\d{3,4})\s*[x×]\s*(\d{3,4})/i);
        if (wh) return labelFromHeight(Number(wh[2]));
    }
    const h = num(src?.height ?? src?.video?.height ?? ep?.height ?? ep?.video?.height);
    return h ? labelFromHeight(h) : null;
}

/** minutes -> "2H 49M" */
export function fmtRuntimeMins(mins) {
    const m = Math.round(mins);
    if (!m || m <= 0) return null;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return h > 0 ? `${h}H ${r}M` : `${r}M`;
}

/** movie runtime label, e.g. "2H 49M" */
export function getRuntimeLabel(item) {
    const mins = num(item?.metadata?.runtime ?? item?.runtime);
    if (mins) return fmtRuntimeMins(mins);
    const secs = num(item?.duration ?? item?.mediaInfo?.duration ?? item?.mediainfo?.duration);
    return secs ? fmtRuntimeMins(secs / 60) : null;
}

/** series label, e.g. "2 SE · 18 EPI" */
export function getSeasonEpLabel(item) {
    const seasons = num(item?.seasonCount ?? item?.metadata?.seasonCount ?? item?.seasons?.length);
    let eps = num(item?.episodeCount ?? item?.metadata?.episodeCount);
    if (!eps && Array.isArray(item?.seasons)) {
        const total = item.seasons.reduce((n, s) => n + (Array.isArray(s?.episodes) ? s.episodes.length : 0), 0);
        eps = num(total);
    }
    if (!eps && Array.isArray(item?.episodes)) eps = num(item.episodes.length);
    const parts = [seasons ? `${seasons} SE` : null, eps ? `${eps} EPI` : null].filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
}

/** ISO string / ms -> "Today", "2d ago" ... */
export function timeAgo(ts) {
    if (!ts) return null;
    const t = new Date(ts).getTime();
    if (Number.isNaN(t)) return null;
    const mins = Math.floor((Date.now() - t) / 60000);
    if (mins < 60) return "Today";
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return "Today";
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
}

export const lastWatchedAt = (item) => item?.updatedAt ?? item?.lastWatched ?? item?.lastWatchedAt ?? item?.watchedAt ?? item?.timestamp ?? item?.date ?? null;
