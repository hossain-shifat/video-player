// web/src/Errors/Error401.jsx
import ErrorScene from "./ErrorScene";
import { AuthVaultIllustration } from "./ErrorIllustration";
import { LogIn } from "lucide-react";
import { useNavigate } from "react-router";

export default function Error401() {
    const navigate = useNavigate();
    return (
        <ErrorScene
            code="401"
            eyebrow="FLUX · Series Vault Sealed"
            title="Access Restricted"
            description="Authentication is required before accessing this content. Please log in to continue."
            illustration={AuthVaultIllustration}
            primaryAction={() => navigate("/login")}
            primaryLabel="Login"
            primaryIcon={LogIn}
        />
    );
}
