// web/src/Errors/Error401.jsx
import ErrorCard from "./ErrorCard";
import { AuthVaultIllustration } from "./ErrorIllustration";
import { LogIn } from "lucide-react";
import { useNavigate } from "react-router";

export default function Error401() {
    const navigate = useNavigate();
    return (
        <ErrorCard
            code="401"
            title="Access Restricted"
            description="Authentication is required before accessing this content. Please log in to continue."
            illustration={AuthVaultIllustration}
            primaryAction={() => navigate("/login")}
            primaryLabel="Login"
            primaryIcon={LogIn}
        />
    );
}
