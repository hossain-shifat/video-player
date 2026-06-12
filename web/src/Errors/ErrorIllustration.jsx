// web/src/Errors/ErrorIllustration.jsx
import { ShieldAlert, Lock, SearchX, Gauge, ServerCrash, Clock, WifiOff } from "lucide-react";

export function AuthVaultIllustration(props) {
    return <Lock strokeWidth={1.5} {...props} />;
}

export function ForbiddenShieldIllustration(props) {
    return <ShieldAlert strokeWidth={1.5} {...props} />;
}

export function NotFoundIllustration(props) {
    return <SearchX strokeWidth={1.5} {...props} />;
}

export function RateLimitIllustration(props) {
    return <Gauge strokeWidth={1.5} {...props} />;
}

export function ServerCrashIllustration(props) {
    return <ServerCrash strokeWidth={1.5} {...props} />;
}

export function TimeoutClockIllustration(props) {
    return <Clock strokeWidth={1.5} {...props} />;
}

export function NetworkOfflineIllustration(props) {
    return <WifiOff strokeWidth={1.5} {...props} />;
}
