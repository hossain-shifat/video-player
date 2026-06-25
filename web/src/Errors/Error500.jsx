// web/src/Errors/Error500.jsx
import ErrorScene from "./ErrorScene";
import { ServerCrashIllustration } from "./ErrorIllustration";
import { RefreshCw } from "lucide-react";

export default function Error500() {
    return (
        <ErrorScene
            code="500"
            eyebrow="FLUX · Broadcast Static"
            title="Something Went Wrong"
            description="An unexpected server error occurred. Our team has been notified. Please try reloading the page."
            illustration={ServerCrashIllustration}
            primaryAction={() => window.location.reload()}
            primaryLabel="Reload Page"
            primaryIcon={RefreshCw}
        />
    );
}
