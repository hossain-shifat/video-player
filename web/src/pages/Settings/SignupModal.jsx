import { useState } from "react";
import { UserPlus, Eye, EyeOff } from "lucide-react";
import { Modal } from "./shared";

function getStrength(pw) {
    if (!pw) return 0;
    let score = 0;
    if (pw.length >= 8) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[a-z]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return score; // 0-4
}

const STRENGTH_LABELS = ["", "Weak", "Fair", "Good", "Strong"];
const SEGMENT_COLORS = ["bg-error", "bg-warning", "bg-yellow-400", "bg-success"];

function StrengthBar({ password }) {
    const score = getStrength(password);
    if (!password) return null;
    const labelColor = score <= 1 ? "text-error" : score === 2 ? "text-warning" : score === 3 ? "text-yellow-400" : "text-success";
    return (
        <div className="mt-2 space-y-1">
            <div className="flex gap-1">
                {SEGMENT_COLORS.map((color, i) => (
                    <div key={i} className={`h-1 flex-1 rounded-full transition-all duration-300 ${i < score ? color : "bg-white/10"}`} />
                ))}
            </div>
            <p className={`text-xs ${labelColor}`}>{STRENGTH_LABELS[score]}</p>
        </div>
    );
}

function isPasswordValid(pw) {
    return pw.length >= 8 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[^A-Za-z0-9]/.test(pw);
}

export default function SignupModal({ open, onClose, onSignup, onOpenLogin }) {
    const [username, setUsername] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [rePassword, setRePassword] = useState("");
    const [showPass, setShowPass] = useState(false);
    const [showRePass, setShowRePass] = useState(false);

    const passwordValid = isPasswordValid(password);
    const passwordsMatch = password === rePassword;
    const canSubmit = username.trim() && email.trim() && passwordValid && rePassword && passwordsMatch;

    const submit = () => {
        if (!canSubmit) return;
        onSignup({ username: username.trim(), email: email.trim() });
        onClose();
    };

    const handleLoginClick = () => {
        onClose();
        onOpenLogin();
    };

    return (
        <Modal open={open} onClose={onClose} title="Create Account" subtitle="Local account">
            <div className="space-y-3">
                <input
                    autoFocus
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Username"
                    style={{ outline: "none", boxShadow: "none" }}
                    className="input input-sm w-full bg-base-300 border-white/10 text-sm rounded focus:outline-none focus-visible:outline-none"
                    onKeyDown={(e) => e.key === "Enter" && submit()}
                />
                <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email address"
                    style={{ outline: "none", boxShadow: "none" }}
                    className="input input-sm w-full bg-base-300 border-white/10 text-sm rounded focus:outline-none focus-visible:outline-none"
                    onKeyDown={(e) => e.key === "Enter" && submit()}
                />

                {/* Password + strength bar */}
                <div>
                    <div className="relative">
                        <input
                            type={showPass ? "text" : "password"}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Password"
                            style={{ outline: "none", boxShadow: "none" }}
                            className="input input-sm w-full bg-base-300 border-white/10 text-sm rounded pr-9 focus:outline-none focus-visible:outline-none"
                            onKeyDown={(e) => e.key === "Enter" && submit()}
                        />
                        <button
                            onClick={() => setShowPass((v) => !v)}
                            style={{ outline: "none", boxShadow: "none" }}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-base-content/40 hover:text-base-content transition-colors focus:outline-none focus-visible:outline-none">
                            {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                    </div>
                    <StrengthBar password={password} />
                    {password && !passwordValid && <p className="text-xs text-white/35 mt-1">Need 8+ chars, uppercase, lowercase &amp; special character</p>}
                </div>

                {/* Re-enter password */}
                <div className="relative">
                    <input
                        type={showRePass ? "text" : "password"}
                        value={rePassword}
                        onChange={(e) => setRePassword(e.target.value)}
                        placeholder="Re-enter Password"
                        style={{ outline: "none", boxShadow: "none" }}
                        className={`input input-sm w-full bg-base-300 border-white/10 text-sm rounded pr-9 focus:outline-none focus-visible:outline-none ${rePassword && !passwordsMatch ? "border-error/50" : ""}`}
                        onKeyDown={(e) => e.key === "Enter" && submit()}
                    />
                    <button
                        onClick={() => setShowRePass((v) => !v)}
                        style={{ outline: "none", boxShadow: "none" }}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-base-content/40 hover:text-base-content transition-colors focus:outline-none focus-visible:outline-none">
                        {showRePass ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                </div>
                {rePassword && !passwordsMatch && <p className="text-xs text-error -mt-1">Passwords do not match</p>}
            </div>

            <button onClick={submit} disabled={!canSubmit} style={{ outline: "none", boxShadow: "none" }} className="btn btn-sm btn-primary w-full rounded mt-5 gap-1.5 border-none">
                <UserPlus size={13} /> Create Account
            </button>

            <p className="text-center text-xs text-base-content/40 mt-3">
                Have an account?{" "}
                <button type="button" onClick={handleLoginClick} style={{ outline: "none", boxShadow: "none" }} className="text-primary hover:underline font-medium transition-colors cursor-pointer">
                    Login
                </button>
            </p>
        </Modal>
    );
}
