import { createContext, useContext, useEffect, useState } from "react";

const THEMES = [
    {
        id: "cinema",
        label: "Cinema",
        description: "Dark red accent, cinematic feel",
        colorScheme: "dark",
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
        preview: {
            base: "oklch(98% 0.01 250)",
            primary: "oklch(50% 0.22 250)",
            accent: "oklch(58% 0.2 20)",
        },
    },
];

const STORAGE_KEY = "mediaplayer-theme";
const DEFAULT_THEME = "cinema";

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
    const [theme, setTheme] = useState(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            return THEMES.find((t) => t.id === saved) ? saved : DEFAULT_THEME;
        } catch {
            return DEFAULT_THEME;
        }
    });

    useEffect(() => {
        document.documentElement.setAttribute("data-theme", theme);
        try {
            localStorage.setItem(STORAGE_KEY, theme);
        } catch {
            // ignore
        }
    }, [theme]);

    const currentTheme = THEMES.find((t) => t.id === theme);

    return (
        <ThemeContext.Provider
            value={{
                theme,
                setTheme,
                themes: THEMES,
                currentTheme,
            }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
    return ctx;
}

export { THEMES };
