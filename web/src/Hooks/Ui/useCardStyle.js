import { useEffect, useState } from "react";
import { loadPrefs } from "../../Pages/Settings/Components/shared";

// Card style is stored in the shared "flux-prefs" object (key: cardStyle),
// so Settings.jsx owns the write (setPref) and every card just reads it here.
export const CARD_STYLES = [
    { id: "classic", label: "Classic", desc: "The original FLUX cards. Default." },
    { id: "flux", label: "Flux", desc: "Flat cards with corner rating tab, type-coloured tags and a compact footer." },
];

export const DEFAULT_CARD_STYLE = "classic";

const isValid = (id) => CARD_STYLES.some((s) => s.id === id);

function read() {
    const v = loadPrefs().cardStyle;
    return isValid(v) ? v : DEFAULT_CARD_STYLE;
}

/** const style = useCardStyle();  // "classic" | "flux" */
export function useCardStyle() {
    const [style, setStyle] = useState(read);

    useEffect(() => {
        const on = () => setStyle(read());
        window.addEventListener("flux-prefs-changed", on);
        window.addEventListener("storage", on);
        return () => {
            window.removeEventListener("flux-prefs-changed", on);
            window.removeEventListener("storage", on);
        };
    }, []);

    return style;
}
