// web/src/Errors/Error500.jsx
import ErrorCard from "./ErrorCard";
import { ServerCrashIllustration } from "./ErrorIllustration";
import { RefreshCw } from "lucide-react";

export default function Error500() {
    return (
        <ErrorCard
            code="500"
            title="Something Went Wrong"
            description="An unexpected server error occurred. Our team has been notified. Please try reloading the page."
            illustration={ServerCrashIllustration}
            primaryAction={() => window.location.reload()}
            primaryLabel="Reload Page"
            primaryIcon={RefreshCw}
        />
    );
}
