// web/src/Errors/ErrorTimeout.jsx
import ErrorScene from "./ErrorScene";
import { TimeoutClockIllustration } from "./ErrorIllustration";
import { RefreshCw } from "lucide-react";

export default function ErrorTimeout() {
    return (
        <ErrorScene
            code="TIMEOUT"
            eyebrow="FLUX · Buffering Stalled"
            title="Request Timed Out"
            description="The server took too long to respond. The media or resource might be unavailable or busy."
            illustration={TimeoutClockIllustration}
            primaryAction={() => window.location.reload()}
            primaryLabel="Try Again"
            primaryIcon={RefreshCw}
        />
    );
}
