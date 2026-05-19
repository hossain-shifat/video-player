/**
 * themeContext.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralised appearance store for the media player app.
 *
 * Manages:
 *   • Built-in DaisyUI themes
 *   • Custom user-created themes (unlimited, persisted in localStorage)
 *   • Typography scale & font family
 *   • Layout density & border-radius intensity
 *   • Player appearance (subtitle, controls)
 *   • Accessibility flags
 *
 * All settings are stored under a single localStorage key ("flux-appearance")
 * so they can later be trivially synced to a backend profile endpoint.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createContext, useContext, useEffect, useState, useCallback } from "react";

// ─── Built-in themes ─────────────────────────────────────────────────────────

export const BUILTIN_THEMES = [
    {
        id: "cinema",
        label: "Cinema",
        description: "Dark red accent, cinematic feel",
        colorScheme: "dark",
        custom: false,
        preview: {
            base: "oklch(12% 0.01 260)",
            primary: "oklch(58% 0.22 20)",
            accent: "oklch(65% 0.2 240)",
        },
    },
    {
        id: "amoled",
        label: "AMOLED",
        description: "Pure black, battery saving",
        colorScheme: "dark",
        custom: false,
        preview: {
            base: "oklch(0% 0 0)",
            primary: "oklch(65% 0.28 300)",
            accent: "oklch(70% 0.22 150)",
        },
    },
    {
        id: "slate",
        label: "Slate",
        description: "Soft blue-grey, easy on eyes",
        colorScheme: "dark",
        custom: false,
        preview: {
            base: "oklch(18% 0.03 250)",
            primary: "oklch(62% 0.2 250)",
            accent: "oklch(72% 0.18 200)",
        },
    },
    {
        id: "light-studio",
        label: "Light Studio",
        description: "Clean light theme for bright environments",
        colorScheme: "light",
        custom: false,
        preview: {
            base: "oklch(98% 0.01 250)",
            primary: "oklch(50% 0.22 250)",
            accent: "oklch(58% 0.2 20)",
        },
    },
];

// ─── Font families ────────────────────────────────────────────────────────────

export const FONT_FAMILIES = [
    { id: "inter", label: "Inter", stack: "'Inter', sans-serif" },
    { id: "ibm-plex-sans", label: "IBM Plex Sans", stack: "'IBM Plex Sans', sans-serif" },
    { id: "circular", label: "Circular Std", stack: "'CircularStd', sans-serif" },
    { id: "system", label: "System Default", stack: "system-ui, sans-serif" },
    { id: "mono", label: "Monospace", stack: "'Courier New', monospace" },
];

// ─── Density presets ──────────────────────────────────────────────────────────

export const DENSITY_PRESETS = [
    { id: "compact", label: "Compact", scale: 0.875 },
    { id: "comfortable", label: "Comfortable", scale: 1 },
    { id: "spacious", label: "Spacious", scale: 1.125 },
];

// ─── Radius presets ───────────────────────────────────────────────────────────

export const RADIUS_PRESETS = [
    { id: "sharp", label: "Sharp", field: "0.2rem", box: "0.3rem" },
    { id: "moderate", label: "Moderate", field: "0.4rem", box: "0.6rem" },
    { id: "rounded", label: "Rounded", field: "0.6rem", box: "1rem" },
    { id: "pill", label: "Pill", field: "9999px", box: "1.5rem" },
];

// ─── Subtitle size presets ────────────────────────────────────────────────────

export const SUBTITLE_SIZE_PRESETS = [
    { id: "small", label: "Small", rem: 0.875 },
    { id: "medium", label: "Medium", rem: 1 },
    { id: "large", label: "Large", rem: 1.25 },
    { id: "xlarge", label: "X-Large", rem: 1.5 },
];

// ─── Default appearance state ─────────────────────────────────────────────────

const DEFAULT_APPEARANCE = {
    // Active theme ID (built-in or custom)
    theme: "cinema",

    // Custom themes the user has created
    // Shape: [{ id, label, description, colorScheme, custom: true, preview, cssVars }]
    customThemes: [],

    // Typography
    fontFamily: "inter",
    fontScale: 1, // 0.875 | 1 | 1.125 | 1.25
    uiScale: 1,
    lineHeight: 1.5,
    density: "comfortable",

    // Layout
    radius: "moderate",
    contentWidth: "default", // "narrow" | "default" | "wide" | "full"
    sidebarWidth: 224, // in pixels

    // Accessibility
    reducedMotion: false,
    highContrast: false,
    focusVisible: true,
    dyslexiaFont: false,
};

const STORAGE_KEY = "flux-appearance";

// ─── Persistence helpers ──────────────────────────────────────────────────────

function loadAppearance() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_APPEARANCE;
        return { ...DEFAULT_APPEARANCE, ...JSON.parse(raw) };
    } catch {
        return DEFAULT_APPEARANCE;
    }
}

function saveAppearance(state) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // quota exceeded etc — silently ignore
    }
}

// ─── CSS application helpers ──────────────────────────────────────────────────

function applyTheme(themeId) {
    document.documentElement.setAttribute("data-theme", themeId);
}

function applyCustomThemeCss(customTheme) {
    const el =
        document.getElementById("flux-custom-theme-style") ||
        (() => {
            const s = document.createElement("style");
            s.id = "flux-custom-theme-style";
            document.head.appendChild(s);
            return s;
        })();

    if (!customTheme?.cssVars) {
        el.textContent = "";
        return;
    }

    const vars = Object.entries(customTheme.cssVars)
        .map(([k, v]) => `  ${k}: ${v};`)
        .join("\n");

    el.textContent = `[data-theme="${customTheme.id}"] {\n${vars}\n}`;
}

function applyTypography(fontFamily, fontScale, uiScale, density, lineHeight) {
    const root = document.documentElement;
    const fontObj = FONT_FAMILIES.find((f) => f.id === fontFamily) || FONT_FAMILIES[0];
    const densityObj = DENSITY_PRESETS.find((d) => d.id === density) || DENSITY_PRESETS[1];
    root.style.setProperty("--flux-font-family", fontObj.stack);
    root.style.setProperty("--flux-font-scale", fontScale);
    root.style.setProperty("--flux-ui-scale", uiScale);
    root.style.setProperty("--flux-density-scale", densityObj.scale);
    root.style.setProperty("--flux-line-height", lineHeight);
}

function applyLayout(contentWidth, sidebarWidth) {
    const root = document.documentElement;
    
    // Map contentWidth to max-width value
    const widthMap = {
        narrow: "800px",
        default: "1200px",
        wide: "1600px",
        full: "100%"
    };
    
    root.style.setProperty("--flux-content-width", widthMap[contentWidth] || "1200px");
    root.style.setProperty("--flux-sidebar-width", `${sidebarWidth}px`);
}

function applyRadius(radiusId) {
    const preset = RADIUS_PRESETS.find((r) => r.id === radiusId) || RADIUS_PRESETS[1];
    const root = document.documentElement;
    root.style.setProperty("--radius-field", preset.field);
    root.style.setProperty("--radius-box", preset.box);
}

function applyAccessibility(reducedMotion, highContrast) {
    const root = document.documentElement;
    root.classList.toggle("flux-reduced-motion", reducedMotion);
    root.classList.toggle("flux-high-contrast", highContrast);
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
    const [appearance, setAppearanceState] = useState(loadAppearance);

    // Derived: all themes = built-ins + custom
    const allThemes = [...BUILTIN_THEMES, ...appearance.customThemes];
    const currentTheme = allThemes.find((t) => t.id === appearance.theme) || BUILTIN_THEMES[0];

    // Convenience alias kept for backward compat with existing code
    const themes = allThemes;
    const theme = appearance.theme;

    // ── Core setter — always persists ────────────────────────────────────────
    const setAppearance = useCallback((patch) => {
        setAppearanceState((prev) => {
            const next = typeof patch === "function" ? patch(prev) : { ...prev, ...patch };
            saveAppearance(next);
            return next;
        });
    }, []);

    // ── Theme switching ───────────────────────────────────────────────────────
    const setTheme = useCallback(
        (id) => {
            setAppearance((prev) => {
                return { ...prev, theme: id };
            });
        },
        [setAppearance],
    );

    // ── Custom theme CRUD ─────────────────────────────────────────────────────

    const addCustomTheme = useCallback(
        (themeObj) => {
            // themeObj: { label, description, colorScheme, preview, cssVars }
            const id = `custom-${Date.now()}`;
            const newTheme = { ...themeObj, id, custom: true };
            setAppearance((prev) => ({
                ...prev,
                customThemes: [...prev.customThemes, newTheme],
            }));
            return id;
        },
        [setAppearance],
    );

    const updateCustomTheme = useCallback(
        (id, patch) => {
            setAppearance((prev) => ({
                ...prev,
                customThemes: prev.customThemes.map((t) => (t.id === id ? { ...t, ...patch } : t)),
            }));
        },
        [setAppearance],
    );

    const deleteCustomTheme = useCallback(
        (id) => {
            setAppearance((prev) => {
                const next = {
                    ...prev,
                    customThemes: prev.customThemes.filter((t) => t.id !== id),
                    // Fall back to cinema if deleting active theme
                    theme: prev.theme === id ? "cinema" : prev.theme,
                };
                return next;
            });
        },
        [setAppearance],
    );

    // ── Apply side-effects whenever state changes ──────────────────────────────
    useEffect(() => {
        applyTheme(appearance.theme);

        // Apply CSS vars for custom themes
        const activeCustom = appearance.customThemes.find((t) => t.id === appearance.theme);
        if (activeCustom) {
            applyCustomThemeCss(activeCustom);
        }

        // Always inject CSS for ALL custom themes so switching is instant
        appearance.customThemes.forEach(applyCustomThemeCss);
    }, [appearance.theme, appearance.customThemes]);

    useEffect(() => {
        applyTypography(appearance.fontFamily, appearance.fontScale, appearance.uiScale, appearance.density, appearance.lineHeight);
    }, [appearance.fontFamily, appearance.fontScale, appearance.uiScale, appearance.density, appearance.lineHeight]);

    useEffect(() => {
        applyRadius(appearance.radius);
    }, [appearance.radius]);

    useEffect(() => {
        applyLayout(appearance.contentWidth, appearance.sidebarWidth);
    }, [appearance.contentWidth, appearance.sidebarWidth]);

    useEffect(() => {
        applyAccessibility(appearance.reducedMotion, appearance.highContrast);
    }, [appearance.reducedMotion, appearance.highContrast]);

    const value = {
        // ── Backward-compat exports (existing components use these) ──────────
        theme,
        setTheme,
        themes,
        currentTheme,

        // ── Full appearance state ────────────────────────────────────────────
        appearance,
        setAppearance,

        // ── Derived collections ──────────────────────────────────────────────
        allThemes,
        builtinThemes: BUILTIN_THEMES,
        customThemes: appearance.customThemes,

        // ── Custom theme actions ─────────────────────────────────────────────
        addCustomTheme,
        updateCustomTheme,
        deleteCustomTheme,

        // ── Presets for UI ───────────────────────────────────────────────────
        fontFamilies: FONT_FAMILIES,
        densityPresets: DENSITY_PRESETS,
        radiusPresets: RADIUS_PRESETS,
        subtitleSizePresets: SUBTITLE_SIZE_PRESETS,
    };

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
    return ctx;
}

// Keep named export for external consumers that import { THEMES }
export { BUILTIN_THEMES as THEMES };
