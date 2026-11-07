import { useState, useEffect } from "react";

/** True for phones/tablets and touch-first layouts (max-width 1023px). */
export function useIsMobile() {
    const [isMobile, setIsMobile] = useState(() => {
        if (typeof window === "undefined") return false;
        return window.matchMedia("(max-width: 1023px)").matches;
    });

    useEffect(() => {
        const mq = window.matchMedia("(max-width: 1023px)");
        const onChange = () => setIsMobile(mq.matches);
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
    }, []);

    return isMobile;
}
