// web/src/Errors/ErrorNetwork.jsx
import ErrorCard from "./ErrorCard";
import { NetworkOfflineIllustration } from "./ErrorIllustration";
import { RefreshCw } from "lucide-react";

export default function ErrorNetwork() {
    return (
        <ErrorCard
            code="NETWORK"
            title="Connection Lost"
            description="Unable to connect to the FLUX server. Please check your internet connection or server status."
            illustration={NetworkOfflineIllustration}
            primaryAction={() => window.location.reload()}
            primaryLabel="Retry"
            primaryIcon={RefreshCw}
        />
    );
}
