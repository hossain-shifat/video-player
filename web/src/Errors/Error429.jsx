// web/src/Errors/Error429.jsx
import ErrorCard from "./ErrorCard";
import { RateLimitIllustration } from "./ErrorIllustration";
import { Timer } from "lucide-react";

export default function Error429() {
    return (
        <ErrorCard
            code="429"
            title="Slow Down"
            description="Too many requests have been sent in a short period. Please wait a moment before trying again."
            illustration={RateLimitIllustration}
            primaryAction={() => window.location.reload()}
            primaryLabel="Retry Later"
            primaryIcon={Timer}
        />
    );
}
