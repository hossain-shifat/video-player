// web/src/Errors/Error403.jsx
import ErrorCard from "./ErrorCard";
import { ForbiddenShieldIllustration } from "./ErrorIllustration";
import { ShieldCheck } from "lucide-react";

export default function Error403() {
    return (
        <ErrorCard
            code="403"
            title="Permission Denied"
            description="Your account does not currently have access to this resource. Contact an administrator for assistance."
            illustration={ForbiddenShieldIllustration}
            primaryAction={() => window.location.href = "/"}
            primaryLabel="Request Access"
            primaryIcon={ShieldCheck}
        />
    );
}
