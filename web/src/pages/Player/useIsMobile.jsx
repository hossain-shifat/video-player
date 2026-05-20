import { useState, useEffect } from "react";

/**
 * useIsMobile
 *
 * Returns true when viewport is < 768px wide or the device has touch support.
 * Re-evaluates on window resize.
 */
export default function useIsMobile() {
    const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768 || "ontouchstart" in window);

    useEffect(() => {
        const check = () => setIsMobile(window.innerWidth < 768 || "ontouchstart" in window);

        window.addEventListener("resize", check);
        return () => window.removeEventListener("resize", check);
    }, []);

    return isMobile;
}
