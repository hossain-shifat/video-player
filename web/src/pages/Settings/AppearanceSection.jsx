import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2, Pencil, Check, RotateCcw, Moon, Sun, ChevronDown } from "lucide-react";
import { useTheme } from "../../Context/themeContext";
import { Card, Row, Toggle, Modal, ConfirmModal, SectionLabel, Select, Seg, Slider, Field, Input, PrimaryButton, GhostButton, ThemeSwatch, FOCUS } from "./shared";

// ─── Helpers ──────────────────────────────────────────────────────────────────
// <input type="color"> only takes hex, theme vars are oklch → convert through a canvas pixel.
function toHex(css) {
    try {
        const c = document.createElement("canvas");
        c.width = c.height = 1;
        const x = c.getContext("2d", { willReadFrequently: true });
        x.clearRect(0, 0, 1, 1);
        x.fillStyle = "#000000";
        x.fillStyle = css;
        x.fillRect(0, 0, 1, 1);
        const [r, g, b] = x.getImageData(0, 0, 1, 1).data;
        return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
    } catch {
        return "#000000";
    }
}

const isColor = (v) => {
    try {
        return typeof v === "string" && v.trim() !== "" && CSS.supports("color", v);
    } catch {
        return true;
    }
};

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
    "--color-base-300": "Raised surface",
    "--color-base-content": "Text",
    "--color-primary": "Primary",
    "--color-primary-content": "Text on primary",
    "--color-accent": "Accent",
    "--color-accent-content": "Text on accent",
};

function ColorField({ id, label, value, onChange }) {
    const ref = useRef(null);
    const ok = isColor(value);
    return (
        <div className="space-y-1.5">
            <label htmlFor={id} className="block text-[13px] font-medium text-base-content">
                {label}
            </label>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => ref.current?.click()}
                    aria-label={`Pick ${label} colour`}
                    style={{ background: ok ? value : "transparent" }}
                    className={`size-9 shrink-0 cursor-pointer rounded-field border border-base-content/25 ${FOCUS}`}
                />
                <input ref={ref} type="color" value={ok ? toHex(value) : "#000000"} onChange={(e) => onChange(e.target.value)} className="sr-only" tabIndex={-1} aria-hidden="true" />
                <Input id={id} name={id} value={value} onChange={(e) => onChange(e.target.value)} mono className={ok ? "" : "border-error"} />
            </div>
            {!ok && <p className="text-xs text-error">Not a valid CSS colour.</p>}
        </div>
    );
}

function ThemeBuilder({ initial, onSave, onClose }) {
    const [name, setName] = useState(initial?.label || "My theme");
    const [desc, setDesc] = useState(initial?.description || "");
    const [scheme, setScheme] = useState(initial?.colorScheme || "dark");
    const [vars, setVars] = useState(() => ({ ...DEFAULT_VARS, ...(initial?.cssVars || {}) }));
    const sv = (k, v) => setVars((x) => ({ ...x, [k]: v }));

    const valid = Object.values(vars).every(isColor);
    const canSave = valid && name.trim().length > 0;

    function save() {
        if (!canSave) return;
        onSave({
            label: name.trim(),
            description: desc.trim(),
            colorScheme: scheme,
            preview: { base: vars["--color-base-100"], primary: vars["--color-primary"], accent: vars["--color-accent"] },
            cssVars: vars,
        });
        onClose();
    }

    const safe = (k) => (isColor(vars[k]) ? vars[k] : DEFAULT_VARS[k]);

    return (
        <div className="space-y-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field id="tb-name" label="Name" required>
                    <Input id="tb-name" name="tb-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="My theme" autoFocus />
                </Field>
                <Field id="tb-desc" label="Description">
                    <Input id="tb-desc" name="tb-desc" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={60} placeholder="Short description" />
                </Field>
            </div>

            <Field id="tb-scheme" label="Base scheme" hint="Sets native form controls and scrollbars to light or dark.">
                <Seg
                    opts={[
                        { id: "dark", label: "Dark" },
                        { id: "light", label: "Light" },
                    ]}
                    value={scheme}
                    onChange={setScheme}
                />
            </Field>

            {/* Live preview */}
            <div className="overflow-hidden rounded-box border border-base-content/20" style={{ background: safe("--color-base-100") }} aria-label="Theme preview">
                <div className="flex items-center gap-2 px-3 py-2" style={{ background: safe("--color-base-300") }}>
                    <span className="h-2 w-10 rounded-md" style={{ background: safe("--color-primary") }} />
                    <span className="h-2 w-6 rounded-md" style={{ background: safe("--color-base-content"), opacity: 0.4 }} />
                </div>
                <div className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0 flex-1 rounded-field p-3" style={{ background: safe("--color-base-200"), color: safe("--color-base-content") }}>
                        <p className="truncate text-sm font-semibold">{name.trim() || "Sample title"}</p>
                        <p className="mt-0.5 text-xs" style={{ opacity: 0.65 }}>
                            This is how text looks on a surface.
                        </p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1.5">
                        <span className="rounded-field px-3 py-1.5 text-center text-xs font-medium" style={{ background: safe("--color-primary"), color: safe("--color-primary-content") }}>
                            Play
                        </span>
                        <span className="rounded-field px-3 py-1.5 text-center text-xs font-medium" style={{ background: safe("--color-accent"), color: safe("--color-accent-content") }}>
                            Trailer
                        </span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                {Object.entries(VAR_LABELS).map(([k, lbl]) => (
                    <ColorField key={k} id={`tb-${k}`} label={lbl} value={vars[k] ?? ""} onChange={(v) => sv(k, v)} />
                ))}
            </div>

            <div className="flex gap-2 border-t border-base-content/10 pt-4">
                <GhostButton onClick={onClose} className="flex-1">
                    Cancel
                </GhostButton>
                <PrimaryButton onClick={save} disabled={!canSave} className="flex-1">
                    <Check size={14} /> Save theme
                </PrimaryButton>
            </div>
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
            <Modal open={builderOpen} onClose={closeBuilder} width="max-w-xl" title={editTarget ? `Edit ${editTarget.label}` : "New custom theme"} subtitle="Colours accept any CSS value: hex, rgb, oklch.">
                <ThemeBuilder key={editTarget?.id || "new"} initial={editTarget} onSave={handleSave} onClose={closeBuilder} />
            </Modal>

            <ConfirmModal
                open={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                title="Delete theme?"
                subtitle={`"${deleteTarget?.label || ""}" will be removed for good.`}
                confirmLabel="Delete theme"
                onConfirm={() => {
                    if (deleteTarget) deleteCustomTheme(deleteTarget.id);
                    setDeleteTarget(null);
                }}
            />

            <ConfirmModal
                open={resetOpen}
                onClose={() => setResetOpen(false)}
                title="Reset appearance?"
                subtitle="Typography, layout and accessibility return to their defaults. Your themes stay."
                confirmLabel="Reset"
                onConfirm={() => {
                    setAppearance(APPEARANCE_DEFAULTS);
                    setResetOpen(false);
                }}
            />
        </div>
    );
}
