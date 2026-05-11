import { useEffect, useRef, useState } from "react";
import { useTheme } from "../Context/themeContext";
import { Sun, Moon, Monitor, Palette, Check, ChevronDown } from "lucide-react";

function ThemeIcon({ colorScheme, size = 16 }) {
    if (colorScheme === "light") return <Sun size={size} />;
    return <Moon size={size} />;
}

function ThemeSwatch({ preview }) {
    return (
        <span className="flex items-center gap-0.5 shrink-0">
            <span className="w-3 h-5 rounded-l-sm" style={{ background: preview.base, border: "1px solid rgba(255,255,255,0.08)" }} />
            <span className="w-3 h-5" style={{ background: preview.primary }} />
            <span className="w-3 h-5 rounded-r-sm" style={{ background: preview.accent }} />
        </span>
    );
}

export default function ThemeDropdown({ align = "end" }) {
    const { theme, setTheme, themes, currentTheme } = useTheme();
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        function handleClickOutside(e) {
            if (ref.current && !ref.current.contains(e.target)) {
                setOpen(false);
            }
        }
        if (open) document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [open]);

    const handleSelect = (id) => {
        setTheme(id);
        setOpen(false);
    };

    return (
        <div className="relative" ref={ref}>
            {/* Trigger button */}
            <button onClick={() => setOpen((v) => !v)} className="btn btn-ghost btn-sm gap-2 px-3" aria-label="Select theme" aria-haspopup="listbox" aria-expanded={open}>
                <Palette size={16} className="text-primary" />
                <span className="hidden sm:inline text-sm font-medium">{currentTheme?.label ?? "Theme"}</span>
                <ChevronDown size={14} className={`text-base-content/50 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
            </button>

            {/* Dropdown panel */}
            {open && (
                <div
                    className={`
                        absolute z-50 mt-2 w-64
                        bg-base-200 border border-base-300
                        rounded-box shadow-xl
                        animate-[fadeSlideIn_0.15s_ease-out]
                        ${align === "end" ? "right-0" : "left-0"}
                    `}
                    role="listbox"
                    aria-label="Theme options"
                    style={{
                        animationFillMode: "both",
                    }}>
                    {/* Header */}
                    <div className="px-3 pt-3 pb-2 border-b border-base-300">
                        <p className="text-xs font-semibold text-base-content/50 uppercase tracking-widest">Appearance</p>
                    </div>

                    {/* Theme list */}
                    <ul className="p-2 space-y-0.5">
                        {themes.map((t) => {
                            const isActive = theme === t.id;
                            return (
                                <li key={t.id}>
                                    <button
                                        onClick={() => handleSelect(t.id)}
                                        role="option"
                                        aria-selected={isActive}
                                        className={`
                                            w-full flex items-center gap-3 px-3 py-2.5
                                            rounded-field text-left
                                            transition-colors duration-150
                                            ${isActive ? "bg-primary/15 text-primary" : "hover:bg-base-300 text-base-content"}
                                        `}>
                                        {/* Color swatch */}
                                        <ThemeSwatch preview={t.preview} />

                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                            <p className={`text-sm font-medium leading-none mb-0.5 ${isActive ? "text-primary" : ""}`}>{t.label}</p>
                                            <p className="text-xs text-base-content/45 truncate">{t.description}</p>
                                        </div>

                                        {/* Mode icon + active check */}
                                        <span className="flex items-center gap-1.5 shrink-0">
                                            <ThemeIcon colorScheme={t.colorScheme} size={13} />
                                            {isActive && <Check size={14} className="text-primary" strokeWidth={2.5} />}
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>

                    {/* Footer hint */}
                    <div className="px-3 py-2 border-t border-base-300">
                        <p className="text-xs text-base-content/35">Theme is saved automatically</p>
                    </div>
                </div>
            )}

            <style>{`
                @keyframes fadeSlideIn {
                    from { opacity: 0; transform: translateY(-6px) scale(0.97); }
                    to   { opacity: 1; transform: translateY(0)  scale(1); }
                }
            `}</style>
        </div>
    );
}
