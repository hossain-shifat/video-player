import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Palette, Plus, Trash2, Edit3, Check, Moon, Sun, ChevronDown, RotateCcw, Type, Layout, Accessibility } from "lucide-react";
import { useTheme } from "../../Context/themeContext";
import { Card, Row, Toggle, Modal, ThemeSwatch, SectionLabel, Select } from "./shared";

// ─── Segmented control ────────────────────────────────────────────────────────
function Seg({ opts, value, onChange }) {
    return (
        <div className="flex bg-white/[0.04] rounded-lg p-0.5 gap-0.5 border border-white/[0.06] w-full">
            {opts.map((o) => (
                <button
                    key={o.id}
                    onClick={() => onChange(o.id)}
                    style={{ outline: "none" }}
                    className={`flex-1 text-[11px] px-1.5 py-1.5 rounded-md transition-all font-medium whitespace-nowrap ${value === o.id ? "bg-white/12 text-white" : "text-white/35 hover:text-white/60"}`}>
                    {o.label}
                </button>
            ))}
        </div>
    );
}

// ─── Stack row — label + control stacked on mobile, inline on sm+ ─────────────
// Use this instead of <Row> when the right-side control is wide (Seg with 3+ options)
function StackRow({ label, desc, children }) {
    return (
        <div className="px-5 py-4 border-b border-white/[0.045] last:border-0 hover:bg-white/[0.015] transition-colors">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 sm:gap-6">
                <div className="min-w-0">
                    <p className="text-[13px] font-medium text-white/90 leading-tight">{label}</p>
                    {desc && <p className="text-[11px] text-white/35 mt-0.5 leading-snug">{desc}</p>}
                </div>
                <div className="w-full sm:w-auto sm:shrink-0 sm:min-w-[12rem]">{children}</div>
            </div>
        </div>
    );
}

// ─── Slider ───────────────────────────────────────────────────────────────────
function Slider({ value, onChange, min, max, step, fmt }) {
    return (
        <div className="flex items-center gap-3">
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => onChange(parseFloat(e.target.value))}
                style={{ outline: "none", border: "none", boxShadow: "none" }}
                className="flex-1 h-[3px] rounded-full cursor-pointer appearance-none accent-primary bg-white/10"
            />
            <span className="text-[11px] text-white/40 w-10 text-right shrink-0 font-mono tabular-nums">{fmt ? fmt(value) : value}</span>
        </div>
    );
}

// ─── Color swatch input ───────────────────────────────────────────────────────
function ColorPick({ value, onChange, label }) {
    const ref = useRef(null);
    return (
        <div className="flex items-center gap-2">
            <button
                onClick={() => ref.current?.click()}
                style={{ background: value, outline: "none", border: "1px solid rgba(255,255,255,0.12)" }}
                className="w-7 h-7 rounded-lg shrink-0 cursor-pointer"
            />
            <input ref={ref} type="color" value={value} onChange={(e) => onChange(e.target.value)} className="sr-only" />
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                style={{ outline: "none" }}
                className="flex-1 bg-white/[0.05] border border-white/[0.07] rounded-lg px-2.5 py-1.5 text-[11px] text-white font-mono focus:border-primary/40 transition-colors min-w-0"
            />
        </div>
    );
}

// ─── Portal dropdown for theme picker ─────────────────────────────────────────
// FIX: self-contained `dropIn` keyframe injected inside the portal so it
// works even when no <Modal> is rendered (modalIn keyframe would be missing).
function ThemeDropdown({ themes, activeId, onSelect }) {
    const [open, setOpen] = useState(false);
    const trigRef = useRef(null);
    const [rect, setRect] = useState(null);
    const active = themes.find((t) => t.id === activeId) || themes[0];
    const dark = themes.filter((t) => t.colorScheme === "dark");
    const light = themes.filter((t) => t.colorScheme !== "dark");

    function openMenu() {
        if (trigRef.current) setRect(trigRef.current.getBoundingClientRect());
        setOpen(true);
    }

    useEffect(() => {
        if (!open) return;
        const upd = () => {
            if (trigRef.current) setRect(trigRef.current.getBoundingClientRect());
        };
        window.addEventListener("scroll", upd, true);
        window.addEventListener("resize", upd);
        return () => {
            window.removeEventListener("scroll", upd, true);
            window.removeEventListener("resize", upd);
        };
    }, [open]);

    function TRow({ t }) {
        const on = t.id === activeId;
        return (
            <button
                onClick={() => { onSelect(t.id); setOpen(false); }}
                style={{ outline: "none" }}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all text-left ${on ? "bg-primary/12" : "hover:bg-white/[0.05]"}`}>
                <ThemeSwatch preview={t.preview} size="sm" />
                <div className="flex-1 min-w-0">
                    <p className={`text-[12px] font-semibold truncate ${on ? "text-primary" : "text-white/75"}`}>{t.label}</p>
                    {t.description && <p className="text-[10px] text-white/25 truncate">{t.description}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    {t.colorScheme === "dark" ? <Moon size={9} className="text-white/20" /> : <Sun size={9} className="text-white/20" />}
                    {on && <Check size={11} className="text-primary" strokeWidth={3} />}
                </div>
            </button>
        );
    }

    function Group({ label, items }) {
        if (!items.length) return null;
        return (
            <div>
                <p className="text-[9px] font-bold text-white/20 uppercase tracking-[0.12em] px-2.5 py-1.5">{label}</p>
                {items.map((t) => <TRow key={t.id} t={t} />)}
            </div>
        );
    }

    const panel =
        open &&
        rect &&
        createPortal(
            <>
                {/* Self-contained keyframe — no dependency on Modal being mounted */}
                <style>{`@keyframes dropIn{from{opacity:0;transform:translateY(-4px) scale(0.97)}to{opacity:1;transform:translateY(0) scale(1)}}`}</style>
                <div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} />
                <div
                    style={{
                        position: "fixed",
                        top: rect.bottom + 4,
                        left: rect.left,
                        width: rect.width,
                        zIndex: 9999,
                        background: "oklch(13% 0.01 260)",
                        maxHeight: 280,
                        overflowY: "auto",
                        borderRadius: "0.75rem",
                        border: "1px solid rgba(255,255,255,0.09)",
                        boxShadow: "0 24px 64px rgba(0,0,0,0.75)",
                        animation: "dropIn .12s ease-out both",
                    }}>
                    <div className="p-1.5 space-y-0.5">
                        <Group label="Dark" items={dark} />
                        {dark.length > 0 && light.length > 0 && <div className="border-t border-white/[0.05] my-1" />}
                        <Group label="Light" items={light} />
                    </div>
                </div>
            </>,
            document.body,
        );

    return (
        <div ref={trigRef} className="relative">
            <button
                onClick={openMenu}
                style={{ outline: "none", boxShadow: "none" }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.07] hover:border-white/[0.14] transition-all cursor-pointer">
                {active && <ThemeSwatch preview={active.preview} size="sm" />}
                <span className="flex-1 text-left text-[13px] font-medium text-white truncate">{active?.label || "Select"}</span>
                <ChevronDown size={13} className={`text-white/30 shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
            </button>
            {panel}
        </div>
    );
}

// ─── Custom theme builder ─────────────────────────────────────────────────────
const DEFAULT_VARS = {
    "--color-base-100": "oklch(12% 0.01 260)",
    "--color-base-200": "oklch(16% 0.01 260)",
    "--color-base-300": "oklch(20% 0.02 260)",
    "--color-base-content": "oklch(88% 0.01 260)",
    "--color-primary": "oklch(58% 0.22 200)",
    "--color-primary-content": "oklch(98% 0.01 200)",
    "--color-accent": "oklch(65% 0.2 150)",
    "--color-accent-content": "oklch(98% 0.01 150)",
};
const VAR_LABELS = {
    "--color-base-100": "Background",
    "--color-base-200": "Surface",
    "--color-base-300": "Raised Surface",
    "--color-base-content": "Text",
    "--color-primary": "Primary",
    "--color-primary-content": "Primary Text",
    "--color-accent": "Accent",
    "--color-accent-content": "Accent Text",
};

function ThemeBuilder({ initial, onSave, onClose }) {
    const [name, setName] = useState(initial?.label || "My Theme");
    const [desc, setDesc] = useState(initial?.description || "");
    const [scheme, setScheme] = useState(initial?.colorScheme || "dark");
    const [vars, setVars] = useState(initial?.cssVars || { ...DEFAULT_VARS });
    const sv = (k, v) => setVars((x) => ({ ...x, [k]: v }));
    const prev = { base: vars["--color-base-100"], primary: vars["--color-primary"], accent: vars["--color-accent"] };

    return (
        <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-0.5">
            <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1.5">
                    <label className="text-[10px] font-bold text-white/25 uppercase tracking-[0.1em] block">Name</label>
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={30}
                        placeholder="My Theme"
                        style={{ outline: "none" }}
                        className="input input-sm w-full bg-white/[0.05] border border-white/[0.08] rounded-lg text-[13px] text-white"
                    />
                </div>
                <div className="col-span-2 space-y-1.5">
                    <label className="text-[10px] font-bold text-white/25 uppercase tracking-[0.1em] block">Description</label>
                    <input
                        value={desc}
                        onChange={(e) => setDesc(e.target.value)}
                        maxLength={60}
                        placeholder="Short description"
                        style={{ outline: "none" }}
                        className="input input-sm w-full bg-white/[0.05] border border-white/[0.08] rounded-lg text-[13px] text-white"
                    />
                </div>
            </div>

            <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-white/25 uppercase tracking-[0.1em] block">Scheme</label>
                <Seg opts={[{ id: "dark", label: "Dark" }, { id: "light", label: "Light" }]} value={scheme} onChange={setScheme} />
            </div>

            <div className="flex items-center gap-3 px-3.5 py-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                <ThemeSwatch preview={prev} />
                <div>
                    <p className="text-[12px] font-semibold text-white">{name || "Preview"}</p>
                    <p className="text-[10px] text-white/30">{scheme} theme</p>
                </div>
            </div>

            <div className="space-y-3">
                <p className="text-[9px] font-bold text-white/20 uppercase tracking-[0.12em]">Colors</p>
                {Object.entries(VAR_LABELS).map(([k, lbl]) => (
                    <div key={k}>
                        <label className="text-[10px] text-white/30 block mb-1">{lbl}</label>
                        <ColorPick value={vars[k] || "#888"} onChange={(v) => sv(k, v)} label={lbl} />
                    </div>
                ))}
            </div>

            <div className="flex gap-2 pt-1 border-t border-white/[0.06] sticky bottom-0 pb-0.5" style={{ background: "oklch(13% 0.01 260)" }}>
                <button
                    onClick={onClose}
                    style={{ outline: "none" }}
                    className="flex-1 py-2 rounded-lg text-[12px] text-white/40 hover:text-white/70 hover:bg-white/[0.05] transition-colors border border-white/[0.07]">
                    Cancel
                </button>
                <button
                    onClick={() => {
                        onSave({ label: name.trim() || "Custom", description: desc.trim(), colorScheme: scheme, preview: prev, cssVars: vars });
                        onClose();
                    }}
                    style={{ outline: "none" }}
                    className="flex-1 py-2 rounded-lg text-[12px] font-semibold bg-primary text-primary-content hover:opacity-90 transition-opacity border-none">
                    Save Theme
                </button>
            </div>
        </div>
    );
}

function CustomThemeItem({ t, active, onSelect, onEdit, onDelete }) {
    return (
        <div className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all ${active ? "border-primary/30 bg-primary/6" : "border-white/[0.06] hover:border-white/[0.10]"}`}>
            <button onClick={() => onSelect(t.id)} style={{ outline: "none" }} className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
                <ThemeSwatch preview={t.preview} size="sm" />
                <div className="flex-1 min-w-0">
                    <p className={`text-[12px] font-semibold truncate ${active ? "text-primary" : "text-white/70"}`}>{t.label}</p>
                    {t.description && <p className="text-[10px] text-white/25 truncate">{t.description}</p>}
                </div>
                {active && <Check size={11} className="text-primary shrink-0" strokeWidth={3} />}
            </button>
            <div className="flex items-center gap-0.5 shrink-0">
                <button
                    onClick={() => onEdit(t)}
                    style={{ outline: "none" }}
                    className="w-6 h-6 rounded flex items-center justify-center text-white/20 hover:text-white hover:bg-white/10 transition-colors">
                    <Edit3 size={11} />
                </button>
                <button
                    onClick={() => onDelete(t.id)}
                    style={{ outline: "none" }}
                    className="w-6 h-6 rounded flex items-center justify-center text-white/20 hover:text-error hover:bg-error/10 transition-colors">
                    <Trash2 size={11} />
                </button>
            </div>
        </div>
    );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function AppearanceSection() {
    const { theme, setTheme, allThemes, customThemes, addCustomTheme, updateCustomTheme, deleteCustomTheme, appearance, setAppearance, fontFamilies, densityPresets, radiusPresets } = useTheme();

    const [builderOpen, setBuilderOpen] = useState(false);
    const [editTarget, setEditTarget] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [resetOpen, setResetOpen] = useState(false);

    const openCreate = () => { setEditTarget(null); setBuilderOpen(true); };
    const openEdit = (t) => { setEditTarget(t); setBuilderOpen(true); };

    function handleSave(data) {
        if (editTarget) updateCustomTheme(editTarget.id, data);
        else { const id = addCustomTheme(data); setTheme(id); }
    }

    const set = (k) => (v) => setAppearance({ [k]: v });

    return (
        // FIX: removed max-w-2xl — full outlet width on PC
        <div className="space-y-6 w-full">
            {/* ── Theme ── */}
            <div>
                <SectionLabel>Theme</SectionLabel>
                <Card>
                    <Row label="Theme" desc="Active color scheme">
                        <div className="w-48">
                            <ThemeDropdown themes={allThemes} activeId={theme} onSelect={setTheme} />
                        </div>
                    </Row>
                    <Row label="Add custom" desc={customThemes?.length ? `${customThemes.length} custom theme${customThemes.length > 1 ? "s" : ""} saved` : "Create a personalized color scheme"}>
                        <button
                            onClick={openCreate}
                            style={{ outline: "none" }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.09] text-white/45 hover:text-white hover:border-white/20 hover:bg-white/[0.05] transition-all text-[11px] font-medium">
                            <Plus size={12} /> New Theme
                        </button>
                    </Row>
                    {customThemes?.length > 0 && (
                        <div className="px-4 pb-4 pt-2 border-t border-white/[0.04] space-y-1.5">
                            {customThemes.map((t) => (
                                <CustomThemeItem key={t.id} t={t} active={theme === t.id} onSelect={setTheme} onEdit={openEdit} onDelete={setDeleteTarget} />
                            ))}
                        </div>
                    )}
                </Card>
            </div>

            {/* ── Typography ── */}
            <div>
                <SectionLabel>Typography</SectionLabel>
                <Card>
                    <Row label="Font family" desc="UI font used throughout the app">
                        <Select id="ff" name="fontFamily" value={appearance?.fontFamily || "inter"} onChange={(e) => set("fontFamily")(e.target.value)} className="min-w-[9rem]">
                            {(fontFamilies || []).map((f) => (
                                <option key={f.id} value={f.id}>{f.label}</option>
                            ))}
                        </Select>
                    </Row>
                    <StackRow label="Font scale" desc="Scales all text sizes">
                        <Slider value={appearance?.fontScale ?? 1} onChange={set("fontScale")} min={0.8} max={1.3} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} />
                    </StackRow>
                    <StackRow label="Line height" desc="Vertical spacing between lines">
                        <Slider value={appearance?.lineHeight ?? 1.5} onChange={set("lineHeight")} min={1.1} max={2.0} step={0.1} fmt={(v) => v.toFixed(1)} />
                    </StackRow>
                    {/* FIX: StackRow — stacks on mobile so Seg never overflows */}
                    <StackRow label="Density" desc="Spacing within components">
                        <Seg opts={(densityPresets || []).map((d) => ({ id: d.id, label: d.label }))} value={appearance?.density || "comfortable"} onChange={set("density")} />
                    </StackRow>
                </Card>
            </div>

            {/* ── Layout ── */}
            <div>
                <SectionLabel>Layout</SectionLabel>
                <Card>
                    {/* FIX: StackRow — stacks on mobile so Seg never overflows */}
                    <StackRow label="Border radius" desc="Roundness of UI elements">
                        <Seg opts={(radiusPresets || []).map((r) => ({ id: r.id, label: r.label }))} value={appearance?.radius || "moderate"} onChange={set("radius")} />
                    </StackRow>
                    <StackRow label="Sidebar width" desc="Desktop sidebar width">
                        <Slider value={appearance?.sidebarWidth ?? 224} onChange={set("sidebarWidth")} min={180} max={320} step={10} fmt={(v) => `${v}px`} />
                    </StackRow>
                </Card>
            </div>

            {/* ── Accessibility ── */}
            <div>
                <SectionLabel>Accessibility</SectionLabel>
                <Card>
                    <Row label="Reduced motion" desc="Disable non-essential animations">
                        <Toggle value={appearance?.reducedMotion ?? false} onChange={set("reducedMotion")} />
                    </Row>
                    <Row label="High contrast" desc="Increase text and border contrast">
                        <Toggle value={appearance?.highContrast ?? false} onChange={set("highContrast")} />
                    </Row>
                    <Row label="Focus indicators" desc="Always-visible keyboard focus rings">
                        <Toggle value={appearance?.focusVisible ?? true} onChange={set("focusVisible")} />
                    </Row>
                </Card>
            </div>

            {/* Reset */}
            <div className="flex justify-end">
                <button
                    onClick={() => setResetOpen(true)}
                    style={{ outline: "none" }}
                    className="flex items-center gap-1.5 text-[11px] text-white/20 hover:text-white/45 transition-colors px-2 py-1 rounded-lg hover:bg-white/[0.04] border-none">
                    <RotateCcw size={10} /> Reset appearance
                </button>
            </div>

            {/* Modals */}
            <Modal open={builderOpen} onClose={() => { setBuilderOpen(false); setEditTarget(null); }} title={editTarget ? `Edit: ${editTarget.label}` : "New Custom Theme"}>
                <ThemeBuilder initial={editTarget} onSave={handleSave} onClose={() => { setBuilderOpen(false); setEditTarget(null); }} />
            </Modal>

            <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete theme?" subtitle="This custom theme will be permanently removed.">
                <div className="flex gap-2 mt-2">
                    <button onClick={() => setDeleteTarget(null)} style={{ outline: "none" }} className="flex-1 py-2 rounded-lg text-[12px] text-white/40 border border-white/[0.07] hover:bg-white/[0.05] transition-colors">Cancel</button>
                    <button onClick={() => { deleteCustomTheme(deleteTarget); setDeleteTarget(null); }} style={{ outline: "none" }} className="flex-1 py-2 rounded-lg text-[12px] font-semibold bg-error text-error-content hover:opacity-90 transition-opacity border-none">Delete</button>
                </div>
            </Modal>

            <Modal open={resetOpen} onClose={() => setResetOpen(false)} title="Reset appearance?" subtitle="Restores all layout and typography settings to defaults.">
                <div className="flex gap-2 mt-2">
                    <button onClick={() => setResetOpen(false)} style={{ outline: "none" }} className="flex-1 py-2 rounded-lg text-[12px] text-white/40 border border-white/[0.07] hover:bg-white/[0.05] transition-colors">Cancel</button>
                    <button
                        onClick={() => {
                            setAppearance({ fontFamily: "inter", fontScale: 1, uiScale: 1, lineHeight: 1.5, density: "comfortable", radius: "moderate", sidebarWidth: 224, reducedMotion: false, highContrast: false, focusVisible: true });
                            setResetOpen(false);
                        }}
                        style={{ outline: "none" }}
                        className="flex-1 py-2 rounded-lg text-[12px] font-semibold bg-error text-error-content hover:opacity-90 transition-opacity border-none">
                        Reset
                    </button>
                </div>
            </Modal>
        </div>
    );
}
