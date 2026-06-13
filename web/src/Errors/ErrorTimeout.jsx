// web/src/Errors/ErrorTimeout.jsx
import ErrorCard from "./ErrorCard";
import { TimeoutClockIllustration } from "./ErrorIllustration";
import { RefreshCw } from "lucide-react";

export default function ErrorTimeout() {
    return (
        <ErrorCard
            code="TIMEOUT"
            title="Request Timed Out"
            description="The server took too long to respond. The media or resource might be unavailable or busy."
            illustration={TimeoutClockIllustration}
            primaryAction={() => window.location.reload()}
            primaryLabel="Try Again"
            primaryIcon={RefreshCw}
        />
    );
}
