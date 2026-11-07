import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2, Pencil, Check, RotateCcw, Moon, Sun, ChevronDown } from "lucide-react";
import { useTheme } from "../../../Context/themeContext";
import { Card, Row, Toggle, SectionLabel, Select, Seg, Slider, GhostButton, ThemeSwatch, FOCUS } from "../Components/shared";
import { ThemeBuilderModal, SettingsConfirm } from "../../../Components/Layout/Modal";

// ─── Theme dropdown (portal, grouped dark / light) ───────────────────────────
function ThemeRow({ t, on, onPick }) {
    return (
        <button
            type="button"
            role="option"
            aria-selected={on}
            onClick={() => onPick(t.id)}
            className={`flex w-full cursor-pointer items-center gap-2.5 rounded-field px-2.5 py-2 text-left transition-colors ${FOCUS} ${on ? "bg-primary/12" : "hover:bg-base-content/10"}`}>
            <ThemeSwatch preview={t.preview} size="sm" />
            <div className="min-w-0 flex-1">
                <p className={`truncate text-[13px] font-medium ${on ? "text-primary" : "text-base-content"}`}>{t.label}</p>
                {t.description && <p className="truncate text-xs text-base-content/55">{t.description}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
                {t.colorScheme === "light" ? <Sun size={12} className="text-base-content/55" /> : <Moon size={12} className="text-base-content/55" />}
                {on && <Check size={13} className="text-primary" strokeWidth={3} />}
            </div>
        </button>
    );
}

function ThemeGroupLabel({ children }) {
    return <p className="px-2.5 pb-1 pt-2 text-xs font-medium text-base-content/55">{children}</p>;
}

function ThemeDropdown({ themes, activeId, onSelect }) {
    const [open, setOpen] = useState(false);
    const [rect, setRect] = useState(null);
    const trigRef = useRef(null);

    const active = themes.find((t) => t.id === activeId) || themes[0];
    const dark = themes.filter((t) => t.colorScheme !== "light");
    const light = themes.filter((t) => t.colorScheme === "light");

    const measure = () => trigRef.current && setRect(trigRef.current.getBoundingClientRect());

    useEffect(() => {
        if (!open) return;
        const onKey = (e) => e.key === "Escape" && setOpen(false);
        window.addEventListener("scroll", measure, true);
        window.addEventListener("resize", measure);
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("scroll", measure, true);
            window.removeEventListener("resize", measure);
            window.removeEventListener("keydown", onKey);
        };
    }, [open]);

    const pick = (id) => {
        onSelect(id);
        setOpen(false);
    };

    // Open upward when there is no room below
    const maxH = 320;
    const below = rect ? window.innerHeight - rect.bottom : 0;
    const top = rect ? (below >= Math.min(maxH, 200) ? rect.bottom + 4 : Math.max(8, rect.top - maxH - 4)) : 0;

    return (
        <div ref={trigRef}>
            <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => {
                    measure();
                    setOpen((v) => !v);
                }}
                className={`flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-field border border-base-content/20 bg-base-100 px-3 transition-colors hover:border-base-content/40 ${FOCUS}`}>
                {active && <ThemeSwatch preview={active.preview} size="sm" />}
                <span className="flex-1 truncate text-left text-[13px] font-medium text-base-content">{active?.label || "Select theme"}</span>
                <ChevronDown size={14} className={`shrink-0 text-base-content/60 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
            </button>

            {open &&
                rect &&
                createPortal(
                    <>
                        <style>{`@keyframes dropIn{from{opacity:0;transform:translateY(-4px) scale(.98)}to{opacity:1;transform:none}}@media (prefers-reduced-motion:reduce){[data-theme-menu]{animation:none!important}}`}</style>
                        <div className="fixed inset-0 z-[2147483646]" onClick={() => setOpen(false)} />
                        <div
                            data-theme-menu
                            role="listbox"
                            aria-label="Themes"
                            className="fixed z-[2147483647] overflow-y-auto rounded-box border border-base-content/15 bg-base-200 p-1.5 shadow-2xl"
                            style={{ top, left: rect.left, width: rect.width, maxHeight: maxH, animation: "dropIn .12s ease-out both" }}>
                            {dark.length > 0 && <ThemeGroupLabel>Dark</ThemeGroupLabel>}
                            {dark.map((t) => (
                                <ThemeRow key={t.id} t={t} on={t.id === activeId} onPick={pick} />
                            ))}
                            {dark.length > 0 && light.length > 0 && <div className="my-1 border-t border-base-content/10" />}
                            {light.length > 0 && <ThemeGroupLabel>Light</ThemeGroupLabel>}
                            {light.map((t) => (
                                <ThemeRow key={t.id} t={t} on={t.id === activeId} onPick={pick} />
                            ))}
                        </div>
                    </>,
                    document.body,
                )}
        </div>
    );
}

// ─── Saved custom theme row ───────────────────────────────────────────────────
function CustomThemeItem({ t, active, onSelect, onEdit, onDelete }) {
    return (
        <div className={`flex items-center gap-2 rounded-box border px-3 py-2 transition-colors ${active ? "border-primary/40 bg-primary/5" : "border-base-content/10 hover:border-base-content/30"}`}>
            <button type="button" onClick={() => onSelect(t.id)} className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-field text-left ${FOCUS}`}>
                <ThemeSwatch preview={t.preview} size="sm" />
                <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[13px] font-medium ${active ? "text-primary" : "text-base-content"}`}>{t.label}</span>
                    {t.description && <span className="block truncate text-xs text-base-content/55">{t.description}</span>}
                </span>
                {active && <Check size={13} className="shrink-0 text-primary" strokeWidth={3} />}
            </button>
            <button
                type="button"
                onClick={() => onEdit(t)}
                aria-label={`Edit ${t.label}`}
                className={`flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-field text-base-content/60 transition-colors hover:bg-base-content/10 hover:text-base-content ${FOCUS}`}>
                <Pencil size={14} />
            </button>
            <button
                type="button"
                onClick={() => onDelete(t)}
                aria-label={`Delete ${t.label}`}
                className={`flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-field text-base-content/60 transition-colors hover:bg-error/10 hover:text-error ${FOCUS}`}>
                <Trash2 size={14} />
            </button>
        </div>
    );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const APPEARANCE_DEFAULTS = {
    fontFamily: "inter",
    fontScale: 1,
    uiScale: 1,
    lineHeight: 1.5,
    density: "comfortable",
    radius: "moderate",
    sidebarWidth: 224,
    reducedMotion: false,
    highContrast: false,
    focusVisible: true,
};

export default function AppearanceSection() {
    const { theme, setTheme, allThemes, customThemes, addCustomTheme, updateCustomTheme, deleteCustomTheme, appearance, setAppearance, fontFamilies, densityPresets, radiusPresets } = useTheme();

    const [builderOpen, setBuilderOpen] = useState(false);
    const [editTarget, setEditTarget] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [resetOpen, setResetOpen] = useState(false);

    const openCreate = () => {
        setEditTarget(null);
        setBuilderOpen(true);
    };
    const openEdit = (t) => {
        setEditTarget(t);
        setBuilderOpen(true);
    };
    const closeBuilder = () => {
        setBuilderOpen(false);
        setEditTarget(null);
    };

    function handleSave(data) {
        if (editTarget) updateCustomTheme(editTarget.id, data);
        else {
            const id = addCustomTheme(data);
            if (id) setTheme(id);
        }
    }

    const set = (k) => (v) => setAppearance({ [k]: v });

    return (
        <div className="w-full space-y-6">
            {/* ── Theme ── */}
            <div id="a-theme" className="scroll-mt-28">
                <SectionLabel hint="Applies instantly and is remembered on this device.">Theme</SectionLabel>
                <Card>
                    <Row stack label="Theme" desc="Active color scheme">
                        <ThemeDropdown themes={allThemes || []} activeId={theme} onSelect={setTheme} />
                    </Row>
                    <Row label="Add custom" desc={customThemes?.length ? `${customThemes.length} custom theme${customThemes.length > 1 ? "s" : ""} saved` : "Create a personalized color scheme"}>
                        <GhostButton onClick={openCreate}>
                            <Plus size={13} /> New theme
                        </GhostButton>
                    </Row>
                    {customThemes?.length > 0 && (
                        <div className="space-y-1.5 border-t border-base-content/10 px-4 pb-4 pt-3 sm:px-5">
                            {customThemes.map((t) => (
                                <CustomThemeItem key={t.id} t={t} active={theme === t.id} onSelect={setTheme} onEdit={openEdit} onDelete={setDeleteTarget} />
                            ))}
                        </div>
                    )}
                </Card>
            </div>

            {/* ── Typography ── */}
            <div>
                <SectionLabel hint="Applies to the whole app.">Typography</SectionLabel>
                <Card>
                    <Row id="a-font" stack label="Font family" desc="Typeface used across the interface">
                        <Select id="ff" name="fontFamily" value={appearance?.fontFamily || "inter"} onChange={(e) => set("fontFamily")(e.target.value)} className="w-full">
                            {(fontFamilies || []).map((f) => (
                                <option key={f.id} value={f.id}>
                                    {f.label}
                                </option>
                            ))}
                        </Select>
                    </Row>
                    <Row id="a-scale" stack label="Font scale" desc="Scales all text sizes">
                        <Slider label="Font scale" value={appearance?.fontScale ?? 1} onChange={set("fontScale")} min={0.8} max={1.3} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} />
                    </Row>
                    <Row id="a-line" stack label="Line height" desc="Vertical space between lines of text">
                        <Slider label="Line height" value={appearance?.lineHeight ?? 1.5} onChange={set("lineHeight")} min={1.1} max={2.0} step={0.1} fmt={(v) => v.toFixed(1)} />
                    </Row>
                    <Row id="a-density" stack label="Density" desc="Spacing inside components">
                        <Seg opts={(densityPresets || []).map((d) => ({ id: d.id, label: d.label }))} value={appearance?.density || "comfortable"} onChange={set("density")} />
                    </Row>
                </Card>
            </div>

            {/* ── Layout ── */}
            <div>
                <SectionLabel>Layout</SectionLabel>
                <Card>
                    <Row id="a-radius" stack label="Border radius" desc="Roundness of cards, buttons and inputs">
                        <Seg opts={(radiusPresets || []).map((r) => ({ id: r.id, label: r.label }))} value={appearance?.radius || "moderate"} onChange={set("radius")} />
                    </Row>
                    <Row id="a-sidebar" stack label="Sidebar width" desc="Desktop sidebar width">
                        <Slider label="Sidebar width" value={appearance?.sidebarWidth ?? 224} onChange={set("sidebarWidth")} min={180} max={320} step={10} fmt={(v) => `${v}px`} />
                    </Row>
                </Card>
            </div>

            {/* ── Accessibility ── */}
            <div>
                <SectionLabel>Accessibility</SectionLabel>
                <Card>
                    <Row id="a-motion" label="Reduced motion" desc="Turn off non-essential animations">
                        <Toggle label="Reduced motion" value={appearance?.reducedMotion ?? false} onChange={set("reducedMotion")} />
                    </Row>
                    <Row id="a-contrast" label="High contrast" desc="Stronger text and border contrast">
                        <Toggle label="High contrast" value={appearance?.highContrast ?? false} onChange={set("highContrast")} />
                    </Row>
                    <Row id="a-focus" label="Focus indicators" desc="Always show keyboard focus rings">
                        <Toggle label="Focus indicators" value={appearance?.focusVisible ?? true} onChange={set("focusVisible")} />
                    </Row>
                </Card>
            </div>

            <div className="flex justify-end">
                <GhostButton onClick={() => setResetOpen(true)}>
                    <RotateCcw size={13} /> Reset appearance
                </GhostButton>
            </div>

            {/* ── Modals ── */}
            <ThemeBuilderModal open={builderOpen} onClose={closeBuilder} theme={editTarget} onSave={handleSave} />

            <SettingsConfirm
                kind="confirmDeleteTheme"
                data={{ theme: deleteTarget }}
                open={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                onConfirm={() => {
                    if (deleteTarget) deleteCustomTheme(deleteTarget.id);
                    setDeleteTarget(null);
                }}
            />

            <SettingsConfirm
                kind="confirmResetAppearance"
                open={resetOpen}
                onClose={() => setResetOpen(false)}
                onConfirm={() => {
                    setAppearance(APPEARANCE_DEFAULTS);
                    setResetOpen(false);
                }}
            />
        </div>
    );
}
