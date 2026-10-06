import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { Users, ChevronLeft, ChevronRight } from "lucide-react";
import { useApi } from "../Context/apiContext";
import { getMediaById } from "../api";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function mergeCrewJobs(crewList) {
    if (!crewList || !Array.isArray(crewList)) return [];
    const map = new Map();
    for (const member of crewList) {
        const key = member.tmdbPersonId || member.name;
        if (map.has(key)) {
            const existing = map.get(key);
            if (member.job && !existing.job.includes(member.job)) existing.job += ` / ${member.job}`;
        } else {
            map.set(key, { ...member });
        }
    }
    return Array.from(map.values());
}

// ─── SectionHeading ───────────────────────────────────────────────────────────
function SectionHeading({ icon: Icon, children }) {
    return (
        <h2 className="text-base sm:text-lg font-semibold text-base-content mb-3 flex items-center gap-2">
            {Icon && <Icon size={18} className="text-primary" />}
            {children}
        </h2>
    );
}

// ─── PersonCard — cursor-pointer on avatar + name ─────────────────────────────
function PersonCard({ member, onClick }) {
    const [imgErr, setImgErr] = useState(false);
    return (
        <button onClick={() => onClick(member)} className="shrink-0 w-20 sm:w-24 text-center group focus:outline-none cursor-pointer">
            <div
                className="w-16 h-16 sm:w-20 sm:h-20 rounded-full overflow-hidden bg-base-300 mx-auto
                            ring-2 ring-white/10 transition-all duration-200 cursor-pointer
                            group-hover:ring-primary/60 group-hover:scale-105">
                {member.photo && !imgErr ? (
                    <img src={member.photo} alt={member.name} className="w-full h-full object-cover cursor-pointer" onError={() => setImgErr(true)} loading="lazy" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center bg-base-200">
                        <Users size={24} className="text-base-content/30" />
                    </div>
                )}
            </div>
            <p className="text-[11px] font-medium text-base-content mt-1.5 leading-tight line-clamp-2 group-hover:text-primary transition-colors cursor-pointer">{member.name}</p>
            <p className="text-[10px] text-base-content/45 leading-tight line-clamp-2">{member.character || member.job}</p>
        </button>
    );
}

// ─── PersonCarousel ───────────────────────────────────────────────────────────
function PersonCarousel({ people, onPersonClick }) {
    const scrollRef = useRef(null);
    const [canLeft, setCanLeft] = useState(false);
    const [canRight, setCanRight] = useState(false);

    const checkScroll = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        setCanLeft(el.scrollLeft > 0);
        setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    }, []);

    useEffect(() => {
        const t = setTimeout(checkScroll, 50);
        const el = scrollRef.current;
        el?.addEventListener("scroll", checkScroll, { passive: true });
        window.addEventListener("resize", checkScroll);
        return () => {
            clearTimeout(t);
            el?.removeEventListener("scroll", checkScroll);
            window.removeEventListener("resize", checkScroll);
        };
    }, [people, checkScroll]);

    const scroll = (dir) => scrollRef.current?.scrollBy({ left: dir * 300, behavior: "smooth" });

    return (
        <div className="relative">
            {canLeft && (
                <button
                    onClick={() => scroll(-1)}
                    className="absolute -left-4 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full cursor-pointer
                               bg-base-300/90 hover:bg-base-200 border border-white/10
                               flex items-center justify-center shadow-lg transition-colors"
                    aria-label="Scroll left">
                    <ChevronLeft size={16} className="text-base-content/70" />
                </button>
            )}
            <div ref={scrollRef} className="flex gap-4 overflow-x-auto pb-2" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                {people.map((member, i) => (
                    <PersonCard key={i} member={member} onClick={onPersonClick} />
                ))}
            </div>
            {canRight && (
                <button
                    onClick={() => scroll(1)}
                    className="absolute -right-4 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full cursor-pointer
                               bg-base-300/90 hover:bg-base-200 border border-white/10
                               flex items-center justify-center shadow-lg transition-colors"
                    aria-label="Scroll right">
                    <ChevronRight size={16} className="text-base-content/70" />
                </button>
            )}
        </div>
    );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
// metadata (optional): pass directly for titles that are not in the library (tmdb-* ids)
const CastAndCrew = ({ metadata } = {}) => {
    const { id } = useParams();
    const navigate = useNavigate();
    const decodedId = decodeURIComponent(id);
    const { movies, series, anime } = useApi();

    const [cast, setCast] = useState([]);
    const [crew, setCrew] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (metadata) {
            setCast(metadata.cast || []);
            setCrew(mergeCrewJobs(metadata.crew));
            setLoading(false);
            return;
        }

        const contextItem = [...movies, ...series, ...anime].find((m) => m.id === decodedId || m.seriesKey === decodedId);
        if (contextItem) {
            const m = contextItem.metadata || contextItem;
            setCast(m?.cast || []);
            setCrew(mergeCrewJobs(m?.crew));
            setLoading(false);
            return;
        }

        let cancelled = false;
        setLoading(true);
        getMediaById(decodedId)
            .then((data) => {
                if (!cancelled) {
                    const item = data?.file ?? data;
                    const m = item?.metadata || item;
                    setCast(m?.cast || []);
                    setCrew(mergeCrewJobs(m?.crew));
                    setLoading(false);
                }
            })
            .catch((err) => {
                if (!cancelled) {
                    console.error("Failed to load cast & crew:", err);
                    setLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [decodedId, movies, series, anime, metadata]);

    // Click → separate person page. tmdbPersonId missing → page falls back to name search.
    const handlePersonClick = useCallback(
        (member) => {
            const pid = member.tmdbPersonId || 0;
            navigate(`/person/${pid}?name=${encodeURIComponent(member.name)}`, {
                state: { name: member.name, photo: member.photo || null, role: member.character || member.job || null },
            });
        },
        [navigate],
    );

    if (loading) return <div className="w-full h-32 animate-pulse bg-base-200 rounded-xl" />;

    const combinedPeople = [...cast, ...crew];
    if (combinedPeople.length === 0) return null;

    return (
        <section className="w-full">
            <SectionHeading icon={Users}>Cast &amp; Crew</SectionHeading>
            <PersonCarousel people={combinedPeople} onPersonClick={handlePersonClick} />
        </section>
    );
};

export default CastAndCrew;
