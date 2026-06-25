// web/src/Errors/Error403.jsx
import ErrorScene from "./ErrorScene";
import { ForbiddenShieldIllustration } from "./ErrorIllustration";
import { ShieldCheck } from "lucide-react";

export default function Error403() {
    return (
        <ErrorScene
            code="403"
            eyebrow="FLUX · Anime Access Denied"
            title="Permission Denied"
            description="Your account does not currently have access to this resource. Contact an administrator for assistance."
            illustration={ForbiddenShieldIllustration}
            primaryAction={() => (window.location.href = "/")}
            primaryLabel="Go Home"
            primaryIcon={ShieldCheck}
        />
    );
}
