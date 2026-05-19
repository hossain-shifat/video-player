/**
 * AppearanceSection.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Full appearance / personalization settings page for Flux media player.
 *
 * Sections:
 *   1. Themes           — built-in + custom, recent, active indicator
 *   2. Custom Builder   — create / edit / delete custom themes with color pickers
 *   3. Typography       — font family, font scale, density
 *   4. Layout           — border radius, content width
 *   5. Player           — subtitle size/color/bg, controls opacity
 *   6. Accessibility    — reduced motion, high contrast, focus visible
 *
 * Architecture:
 *   • All state lives in ThemeContext (no local state duplication)
 *   • Each sub-section is a small pure component receiving slice of context
 *   • Persistence handled by context (localStorage)
 *   • CSS variables updated immediately on change (no page reload needed)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useRef, useCallback } from "react";
import { Palette, Plus, Trash2, Edit3, Check, Moon, Sun, Type, Layout, Play, Accessibility, ChevronDown, ChevronRight, Sparkles, RotateCcw, X, Eye, Copy, Download, Upload } from "lucide-react";
import { useTheme } from "../../Context/themeContext";
import { Card, SectionTitle, Row, Toggle, Modal, ThemeSwatch } from "./shared";

// ─── Small primitives ─────────────────────────────────────────────────────────

function SubSection({ title, icon: Icon, children }) {
    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2.5 w-full text-left">
                <span className="w-7 h-7 rounded flex items-center justify-center bg-base-300 text-primary">
                    <Icon size={14} />
                </span>
                <span className="text-sm font-semibold text-base-content flex-1">{title}</span>
            </div>
            <div className="pl-0">{children}</div>
        </div>
    );
}

function SegmentedControl({ options, value, onChange }) {
    return (
        <div className="flex bg-base-300 rounded p-0.5 gap-0.5">
            {options.map((opt) => (
                <button
                    key={opt.id}
                    onClick={() => onChange(opt.id)}
                    style={{ outline: "none" }}
                    className={`flex-1 text-xs px-2.5 py-1.5 rounded transition-all duration-150 font-medium ${
                        value === opt.id ? "bg-base-100 text-base-content shadow-sm" : "text-base-content/45 hover:text-base-content/70"
                    }`}>
                    {opt.label}
                </button>
            ))}
        </div>
    );
}

function ColorInput({ value, onChange, label }) {
    const inputRef = useRef(null);
    return (
        <div className="flex items-center gap-2">
            <button
                onClick={() => inputRef.current?.click()}
                style={{
                    background: value,
                    outline: "none",
                    border: "1px solid rgba(255,255,255,0.12)",
                }}
                className="w-8 h-8 rounded shrink-0 cursor-pointer"
                aria-label={`Pick ${label}`}
            />
            <input ref={inputRef} type="color" value={value} onChange={(e) => onChange(e.target.value)} className="sr-only" />
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="flex-1 bg-base-300 border border-white/5 rounded px-2.5 py-1.5 text-xs text-base-content font-mono focus:outline-none focus:border-primary/40"
                placeholder="#ffffff"
            />
        </div>
    );
}

function SliderInput({ value, onChange, min = 0, max = 1, step = 0.05, label, displayFn }) {
    return (
        <div className="flex items-center gap-3">
            <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} className="flex-1 accent-primary h-1.5 cursor-pointer" />
            <span className="text-xs text-base-content/50 w-10 text-right shrink-0 font-mono">{displayFn ? displayFn(value) : value}</span>
        </div>
    );
}

// ─── 1. Theme Grid ────────────────────────────────────────────────────────────

function ThemeGrid({ themes, activeId, onSelect }) {
    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {themes.map((t) => {
                const active = activeId === t.id;
                return (
                    <button
                        key={t.id}
                        onClick={() => onSelect(t.id)}
                        style={{ outline: "none" }}
                        className={`relative flex items-center gap-2.5 p-3 rounded-lg text-left transition-all duration-150 border cursor-pointer ${
                            active ? "border-primary/50 bg-primary/8" : "border-white/5 hover:border-white/15 hover:bg-white/[0.03]"
                        }`}>
                        <ThemeSwatch preview={t.preview} />
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1">
                                <p className={`text-xs font-semibold leading-none truncate ${active ? "text-primary" : "text-base-content"}`}>{t.label}</p>
                                {t.colorScheme === "dark" ? <Moon size={9} className="text-base-content/25 shrink-0" /> : <Sun size={9} className="text-base-content/25 shrink-0" />}
                            </div>
                            <p className="text-[10px] text-base-content/35 mt-0.5 leading-tight line-clamp-1">{t.description}</p>
                        </div>
                        {active && (
                            <span className="absolute top-1.5 right-1.5">
                                <Check size={11} className="text-primary" strokeWidth={3} />
                            </span>
                        )}
                        {t.custom && !active && <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-accent/60" />}
                    </button>
                );
            })}
        </div>
    );
}

// ─── 2. Custom Theme Builder ──────────────────────────────────────────────────

const DEFAULT_CUSTOM_VARS = {
    "--color-base-100": "oklch(12% 0.01 260)",
    "--color-base-200": "oklch(16% 0.01 260)",
    "--color-base-300": "oklch(20% 0.02 260)",
    "--color-base-content": "oklch(88% 0.01 260)",
    "--color-primary": "oklch(58% 0.22 200)",
    "--color-primary-content": "oklch(98% 0.01 200)",
    "--color-accent": "oklch(65% 0.2 150)",
    "--color-accent-content": "oklch(98% 0.01 150)",
};

// Simplified hex ↔ oklch bridge: just store raw CSS color strings
// Real apps would use a color library; here we store what the picker gives us
// and let the browser render it

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

function CustomThemeEditor({ initial, onSave, onClose }) {
    const [name, setName] = useState(initial?.label || "My Theme");
    const [desc, setDesc] = useState(initial?.description || "Custom theme");
    const [colorScheme, setColorScheme] = useState(initial?.colorScheme || "dark");
    const [vars, setVars] = useState(initial?.cssVars || { ...DEFAULT_CUSTOM_VARS });

    const setVar = (key, val) => setVars((v) => ({ ...v, [key]: val }));

    const preview = {
        base: vars["--color-base-100"],
        primary: vars["--color-primary"],
        accent: vars["--color-accent"],
    };

    const handleSave = () => {
        onSave({
            label: name.trim() || "Custom Theme",
            description: desc.trim(),
            colorScheme,
            preview,
            cssVars: vars,
        });
        onClose();
    };

    return (
        <div className="flex flex-col gap-5 max-h-[70vh] overflow-y-auto pr-1">
            {/* Name & scheme */}
            <div className="space-y-3">
                <div>
                    <label className="text-xs text-base-content/50 font-medium block mb-1.5">Theme Name</label>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={30}
                        className="w-full bg-base-300 border border-white/5 rounded px-3 py-2 text-sm text-base-content focus:outline-none focus:border-primary/40"
                        placeholder="My Theme"
                    />
                </div>
                <div>
                    <label className="text-xs text-base-content/50 font-medium block mb-1.5">Description</label>
                    <input
                        type="text"
                        value={desc}
                        onChange={(e) => setDesc(e.target.value)}
                        maxLength={60}
                        className="w-full bg-base-300 border border-white/5 rounded px-3 py-2 text-sm text-base-content focus:outline-none focus:border-primary/40"
                        placeholder="Short description"
                    />
                </div>
                <div>
                    <label className="text-xs text-base-content/50 font-medium block mb-1.5">Color Scheme</label>
                    <SegmentedControl
                        options={[
                            { id: "dark", label: "Dark" },
                            { id: "light", label: "Light" },
                        ]}
                        value={colorScheme}
                        onChange={setColorScheme}
                    />
                </div>
            </div>

            {/* Preview swatch */}
            <div className="flex items-center gap-3 p-3 bg-base-300 rounded-lg">
                <ThemeSwatch preview={preview} />
                <div>
                    <p className="text-xs font-semibold text-base-content">{name || "Preview"}</p>
                    <p className="text-[10px] text-base-content/40">{colorScheme} theme</p>
                </div>
            </div>

            {/* Color pickers */}
            <div className="space-y-3">
                <p className="text-xs font-semibold text-base-content/50 uppercase tracking-wider">Colors</p>
                {Object.entries(VAR_LABELS).map(([key, label]) => (
                    <div key={key}>
                        <label className="text-xs text-base-content/40 block mb-1">{label}</label>
                        <ColorInput value={vars[key] || "#888888"} onChange={(v) => setVar(key, v)} label={label} />
                    </div>
                ))}
            </div>

            {/* Import DaisyUI Theme */}
            <div className="space-y-3">
                <p className="text-xs font-semibold text-base-content/50 uppercase tracking-wider flex items-center justify-between">
                    Import
                </p>
                <div>
                    <label className="text-xs text-base-content/40 block mb-1">Paste DaisyUI v5 Theme Block</label>
                    <textarea 
                        className="w-full h-24 bg-base-300 border border-white/5 rounded px-3 py-2 text-[10px] font-mono text-base-content/70 focus:outline-none focus:border-primary/40 resize-none"
                        placeholder={'@plugin "daisyui/theme" {\n  name: "mytheme";\n  color-scheme: "dark";\n  --color-base-100: oklch(0% 0 0);\n  ...\n}'}
                        onChange={(e) => {
                            const val = e.target.value;
                            if(!val) return;
                            
                            try {
                                const nameMatch = val.match(/name:\s*"([^"]+)"/);
                                const schemeMatch = val.match(/color-scheme:\s*"?([^";\s]+)"?/);
                                
                                if(nameMatch) setName(nameMatch[1]);
                                if(schemeMatch) setColorScheme(schemeMatch[1].replace(/['"]/g, ''));
                                
                                const newVars = { ...vars };
                                Object.keys(VAR_LABELS).forEach(k => {
                                    // Match --var-name: value; 
                                    // Handle cases with or without trailing semicolon
                                    const regex = new RegExp(`${k}\\s*:\\s*([^;]+)`);
                                    const match = val.match(regex);
                                    if(match) {
                                        newVars[k] = match[1].trim();
                                    }
                                });
                                setVars(newVars);
                            } catch(err) {
                                console.error("Failed to parse theme", err);
                            }
                        }}
                    />
                </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2 border-t border-white/5">
                <button onClick={onClose} style={{ outline: "none" }} className="flex-1 px-4 py-2 rounded text-sm text-base-content/60 bg-base-300 hover:bg-base-300/80 transition-colors">
                    Cancel
                </button>
                <button onClick={handleSave} style={{ outline: "none" }} className="flex-1 px-4 py-2 rounded text-sm font-semibold bg-primary text-primary-content hover:opacity-90 transition-opacity">
                    Save Theme
                </button>
            </div>
        </div>
    );
}

// ─── Custom Theme List item ───────────────────────────────────────────────────

function CustomThemeItem({ t, isActive, onSelect, onEdit, onDelete }) {
    return (
        <div className={`flex items-center gap-2.5 p-2.5 rounded-lg border transition-all ${isActive ? "border-primary/40 bg-primary/8" : "border-white/5 hover:border-white/10"}`}>
            <button onClick={() => onSelect(t.id)} style={{ outline: "none" }} className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
                <ThemeSwatch preview={t.preview} />
                <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold truncate ${isActive ? "text-primary" : "text-base-content"}`}>{t.label}</p>
                    <p className="text-[10px] text-base-content/35 truncate">{t.description}</p>
                </div>
                {isActive && <Check size={12} className="text-primary shrink-0" strokeWidth={3} />}
            </button>
            <div className="flex items-center gap-1 shrink-0">
                <button
                    onClick={() => onEdit(t)}
                    style={{ outline: "none" }}
                    className="w-6 h-6 rounded flex items-center justify-center text-base-content/30 hover:text-base-content hover:bg-white/10 transition-colors">
                    <Edit3 size={11} />
                </button>
                <button
                    onClick={() => onDelete(t.id)}
                    style={{ outline: "none" }}
                    className="w-6 h-6 rounded flex items-center justify-center text-base-content/30 hover:text-error hover:bg-error/10 transition-colors">
                    <Trash2 size={11} />
                </button>
            </div>
        </div>
    );
}

// ─── Main AppearanceSection ───────────────────────────────────────────────────

export default function AppearanceSection() {
    const {
        theme,
        setTheme,
        builtinThemes,
        customThemes,
        addCustomTheme,
        updateCustomTheme,
        deleteCustomTheme,
        appearance,
        setAppearance,
        fontFamilies,
        densityPresets,
        radiusPresets,
        subtitleSizePresets,
    } = useTheme();

    // Modal states
    const [builderOpen, setBuilderOpen] = useState(false);
    const [editTarget, setEditTarget] = useState(null); // theme obj being edited
    const [resetModalOpen, setResetModalOpen] = useState(false);
    const [deleteTargetId, setDeleteTargetId] = useState(null);

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

    const handleSave = (data) => {
        if (editTarget) {
            updateCustomTheme(editTarget.id, data);
        } else {
            const id = addCustomTheme(data);
            setTheme(id);
        }
    };

    const handleDelete = (id) => {
        setDeleteTargetId(id);
    };

    const confirmDelete = () => {
        if (deleteTargetId) {
            deleteCustomTheme(deleteTargetId);
            setDeleteTargetId(null);
        }
    };

    const set = (key) => (val) => setAppearance({ [key]: val });

    return (
        <div className="space-y-8">


            {/* ── 1. Themes ─────────────────────────────────────────────────── */}
            <SubSection title="Theme" icon={Palette} defaultOpen>
                <Card>
                    <div className="p-4 space-y-4">
                        {/* Built-in themes */}
                        <div>
                            <p className="text-[10px] text-base-content/35 font-semibold uppercase tracking-wider mb-2">Built-in</p>
                            <ThemeGrid themes={builtinThemes} activeId={theme} onSelect={setTheme} />
                        </div>

                        {/* Custom themes */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <p className="text-[10px] text-base-content/35 font-semibold uppercase tracking-wider">
                                    Custom
                                    {customThemes.length > 0 && <span className="ml-1.5 text-accent">{customThemes.length}</span>}
                                </p>
                            </div>

                            {customThemes.length === 0 ? (
                                <button
                                    onClick={openCreate}
                                    style={{ outline: "none" }}
                                    className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border border-white/20 hover:border-white/40 hover:bg-white/5 transition-all text-sm font-medium text-base-content">
                                    <Plus size={16} />
                                    Add Custom Theme
                                </button>
                            ) : (
                                <div className="space-y-3">
                                    <div className="space-y-1.5">
                                        {customThemes.map((t) => (
                                            <CustomThemeItem key={t.id} t={t} isActive={theme === t.id} onSelect={setTheme} onEdit={openEdit} onDelete={handleDelete} />
                                        ))}
                                    </div>
                                    <button
                                        onClick={openCreate}
                                        style={{ outline: "none" }}
                                        className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border border-white/20 hover:border-white/40 hover:bg-white/5 transition-all text-sm font-medium text-base-content">
                                        <Plus size={16} />
                                        Add Custom Theme
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="px-4 py-2.5 border-t border-white/5">
                        <p className="text-xs text-base-content/25">Theme saved automatically · Custom themes stored in browser</p>
                    </div>
                </Card>
            </SubSection>

            {/* ── 2. Typography ─────────────────────────────────────────────── */}
            <SubSection title="Typography" icon={Type}>
                <Card>
                    <Row label="Font Family" desc="UI font used throughout the app">
                        <select
                            value={appearance.fontFamily}
                            onChange={(e) => set("fontFamily")(e.target.value)}
                            className="bg-base-300 border border-white/5 rounded px-2.5 py-1.5 text-xs text-base-content focus:outline-none focus:border-primary/40">
                            {fontFamilies.map((f) => (
                                <option key={f.id} value={f.id}>
                                    {f.label}
                                </option>
                            ))}
                        </select>
                    </Row>

                    <Row label="Global Font Size" desc="Scales text sizes up or down">
                        <div className="w-44">
                            <SliderInput value={appearance.fontScale} onChange={set("fontScale")} min={0.8} max={1.3} step={0.05} displayFn={(v) => `${Math.round(v * 100)}%`} />
                        </div>
                    </Row>
                    
                    <Row label="UI Scaling" desc="Scales all UI elements and spacing">
                        <div className="w-44">
                            <SliderInput value={appearance.uiScale} onChange={set("uiScale")} min={0.8} max={1.3} step={0.05} displayFn={(v) => `${Math.round(v * 100)}%`} />
                        </div>
                    </Row>

                    <Row label="Text Density" desc="Controls spacing within components">
                        <div className="w-48">
                            <SegmentedControl options={densityPresets.map((d) => ({ id: d.id, label: d.label }))} value={appearance.density} onChange={set("density")} />
                        </div>
                    </Row>
                    
                    <Row label="Line Height" desc="Vertical spacing between text lines">
                        <div className="w-44">
                            <SliderInput value={appearance.lineHeight} onChange={set("lineHeight")} min={1.1} max={2.0} step={0.1} displayFn={(v) => v.toFixed(1)} />
                        </div>
                    </Row>
                </Card>
            </SubSection>

            {/* ── 3. Layout ─────────────────────────────────────────────────── */}
            <SubSection title="Layout" icon={Layout}>
                <Card>
                    <Row label="Border Radius" desc="Controls roundness of UI elements">
                        <div className="w-56">
                            <SegmentedControl options={radiusPresets.map((r) => ({ id: r.id, label: r.label }))} value={appearance.radius} onChange={set("radius")} />
                        </div>
                    </Row>

                    <Row label="Content Width" desc="Maximum width of main content area">
                        <select
                            value={appearance.contentWidth}
                            onChange={(e) => set("contentWidth")(e.target.value)}
                            className="bg-base-300 border border-white/5 rounded px-2.5 py-1.5 text-xs text-base-content focus:outline-none focus:border-primary/40">
                            <option value="narrow">Narrow (800px)</option>
                            <option value="default">Default (1200px)</option>
                            <option value="wide">Wide (1600px)</option>
                            <option value="full">Full Width</option>
                        </select>
                    </Row>
                    
                    <Row label="Sidebar Width" desc="Desktop sidebar width in pixels">
                        <div className="w-44">
                            <SliderInput value={appearance.sidebarWidth} onChange={set("sidebarWidth")} min={180} max={320} step={10} displayFn={(v) => `${v}px`} />
                        </div>
                    </Row>
                </Card>
            </SubSection>

            {/* ── 5. Accessibility ──────────────────────────────────────────── */}
            <SubSection title="Accessibility" icon={Accessibility}>
                <Card>
                    <Row label="Reduced Motion" desc="Disables non-essential animations">
                        <Toggle value={appearance.reducedMotion} onChange={set("reducedMotion")} />
                    </Row>
                    <Row label="High Contrast" desc="Increases text and border contrast">
                        <Toggle value={appearance.highContrast} onChange={set("highContrast")} />
                    </Row>
                    <Row label="Focus Indicators" desc="Always-visible keyboard focus rings">
                        <Toggle value={appearance.focusVisible} onChange={set("focusVisible")} />
                    </Row>
                    <Row label="Dyslexia-Friendly Font" desc="Uses OpenDyslexic font for easier reading">
                        <Toggle value={appearance.dyslexiaFont} onChange={set("dyslexiaFont")} />
                    </Row>
                </Card>
            </SubSection>

            {/* ── Reset button ──────────────────────────────────────────────── */}
            <div className="flex justify-end">
                <button
                    onClick={() => setResetModalOpen(true)}
                    style={{ outline: "none" }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-base-content/35 hover:text-base-content/70 hover:bg-white/5 rounded transition-all">
                    <RotateCcw size={12} />
                    Reset to defaults
                </button>
            </div>

            {/* ── Custom Theme Builder Modal ─────────────────────────────────── */}
            <Modal
                open={builderOpen}
                onClose={closeBuilder}
                title={editTarget ? `Edit: ${editTarget.label}` : "Create Custom Theme"}
                subtitle={editTarget ? "Update your theme colors and settings" : "Design a unique theme with custom colors"}>
                <CustomThemeEditor initial={editTarget} onSave={handleSave} onClose={closeBuilder} />
            </Modal>
            
            {/* ── Reset Confirm Modal ────────────────────────────────────────── */}
            <Modal open={resetModalOpen} onClose={() => setResetModalOpen(false)} title="Reset Appearance Settings?" subtitle="This will restore all default layout and typography settings.">
                <div className="flex gap-3 justify-end mt-6">
                    <button onClick={() => setResetModalOpen(false)} className="px-4 py-2 rounded text-sm text-base-content/60 bg-base-300 hover:bg-base-300/80 transition-colors cursor-pointer border-none" style={{ outline: "none" }}>Cancel</button>
                    <button onClick={() => {
                        setAppearance({
                            fontFamily: "inter",
                            fontScale: 1,
                            uiScale: 1,
                            lineHeight: 1.5,
                            density: "comfortable",
                            radius: "moderate",
                            contentWidth: "default",
                            sidebarWidth: 224,
                            reducedMotion: false,
                            highContrast: false,
                            focusVisible: true,
                            dyslexiaFont: false,
                        });
                        setResetModalOpen(false);
                    }} className="px-4 py-2 rounded text-sm font-semibold bg-error text-error-content hover:bg-error/90 transition-colors cursor-pointer border-none" style={{ outline: "none" }}>Reset Settings</button>
                </div>
            </Modal>

            {/* ── Delete Confirm Modal ───────────────────────────────────────── */}
            <Modal open={!!deleteTargetId} onClose={() => setDeleteTargetId(null)} title="Delete Custom Theme?" subtitle="This theme will be permanently removed.">
                <div className="flex gap-3 justify-end mt-6">
                    <button onClick={() => setDeleteTargetId(null)} className="px-4 py-2 rounded text-sm text-base-content/60 bg-base-300 hover:bg-base-300/80 transition-colors cursor-pointer border-none" style={{ outline: "none" }}>Cancel</button>
                    <button onClick={confirmDelete} className="px-4 py-2 rounded text-sm font-semibold bg-error text-error-content hover:bg-error/90 transition-colors cursor-pointer border-none" style={{ outline: "none" }}>Delete Theme</button>
                </div>
            </Modal>
        </div>
    );
}
