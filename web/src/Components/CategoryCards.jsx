// src/components/CategoryCard.jsx
import { Link } from "react-router";

const CATEGORY_COLORS = {
    Action: { bg: "#b91c1c", s1: "#ef4444", s2: "#7f1d1d", icon: "⚡" },
    Animation: { bg: "#0369a1", s1: "#38bdf8", s2: "#0c4a6e", icon: "✦" },
    Comedy: { bg: "#d97706", s1: "#fbbf24", s2: "#92400e", icon: "☺" },
    Crime: { bg: "#1e293b", s1: "#475569", s2: "#0f172a", icon: "⚖" },
    Documentary: { bg: "#065f46", s1: "#34d399", s2: "#022c22", icon: "◉" },
    Drama: { bg: "#7c3aed", s1: "#a78bfa", s2: "#4c1d95", icon: "𝄡" },
    Horror: { bg: "#111827", s1: "#dc2626", s2: "#1f2937", icon: "☠" },
    Music: { bg: "#be185d", s1: "#f472b6", s2: "#831843", icon: "♪" },
    Romance: { bg: "#db2777", s1: "#fb7185", s2: "#9d174d", icon: "♡" },
    "Sci-Fi": { bg: "#1d4ed8", s1: "#60a5fa", s2: "#1e3a8a", icon: "◎" },
    Thriller: { bg: "#374151", s1: "#6b7280", s2: "#111827", icon: "◈" },
    Western: { bg: "#92400e", s1: "#f59e0b", s2: "#451a03", icon: "✦" },
    Fantasy: { bg: "#5b21b6", s1: "#c084fc", s2: "#2e1065", icon: "✧" },
    Adventure: { bg: "#0f766e", s1: "#2dd4bf", s2: "#042f2e", icon: "◎" },
};

const FALLBACK = { bg: "#374151", s1: "#6b7280", s2: "#111827", icon: "◈" };

const CategoryCard = ({ name }) => {
    const colors = CATEGORY_COLORS[name] ?? FALLBACK;

    return (
        <Link
            to={`/category/${encodeURIComponent(name)}`}
            className="group relative rounded-2xl overflow-hidden flex items-end justify-start aspect-video p-2.5 transition-transform duration-200 hover:scale-[1.04] active:scale-[0.97]"
            style={{
                background: colors.bg,
                border: "2px solid transparent",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.85)")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "transparent")}>
            {/* blobs */}
            <div className="absolute rounded-full z-1" style={{ width: 100, height: 100, background: colors.s1, opacity: 0.45, bottom: -30, right: -30 }} />
            <div className="absolute rounded-full z-1" style={{ width: 55, height: 55, background: colors.s2, opacity: 0.6, top: -15, left: -15 }} />
            <div className="absolute rounded-full z-1" style={{ width: 40, height: 40, background: colors.s1, opacity: 0.3, top: "50%", left: "40%", transform: "translate(-50%,-50%)" }} />

            {/* dark overlay for contrast */}
            <div className="absolute inset-0 z-2" style={{ background: "linear-gradient(135deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.32) 100%)" }} />

            {/* icon top-right */}
            <span className="absolute top-2.5 right-3 z-3 text-xl opacity-90 text-white/85">{colors.icon}</span>

            {/* label bottom-left */}
            <span className="relative z-3 text-white text-xs sm:text-sm font-medium leading-tight" style={{ textShadow: "0 1px 6px rgba(0,0,0,0.5)" }}>
                {name}
            </span>
        </Link>
    );
};

export default CategoryCard;
