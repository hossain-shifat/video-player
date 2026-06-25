// web/src/Errors/Error429.jsx
import ErrorScene from "./ErrorScene";
import { RateLimitIllustration } from "./ErrorIllustration";
import { Timer } from "lucide-react";

export default function Error429() {
    return (
        <ErrorScene
            code="429"
            eyebrow="FLUX · Live TV Congested"
            title="Slow Down"
            description="Too many requests have been sent in a short period. Please wait a moment before trying again."
            illustration={RateLimitIllustration}
            primaryAction={() => window.location.reload()}
            primaryLabel="Retry Later"
            primaryIcon={Timer}
        />
    );
}
