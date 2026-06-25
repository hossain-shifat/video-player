// web/src/Errors/ErrorNetwork.jsx
import ErrorScene from "./ErrorScene";
import { NetworkOfflineIllustration } from "./ErrorIllustration";
import { RefreshCw } from "lucide-react";

export default function ErrorNetwork() {
    return (
        <ErrorScene
            code="NETWORK"
            eyebrow="FLUX · Signal Lost"
            title="Connection Lost"
            description="Unable to connect to the FLUX server. Please check your internet connection or server status."
            illustration={NetworkOfflineIllustration}
            primaryAction={() => window.location.reload()}
            primaryLabel="Retry"
            primaryIcon={RefreshCw}
        />
    );
}
