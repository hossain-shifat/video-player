import { useState } from "react";
import { LogIn, Eye, EyeOff } from "lucide-react";
import { Modal } from "./shared";

export default function LoginModal({ open, onClose, onLogin, onOpenSignup }) {
    const [usernameOrEmail, setUsernameOrEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPass, setShowPass] = useState(false);

    const submit = () => {
        if (!usernameOrEmail.trim()) return;
        onLogin({ username: usernameOrEmail.trim() });
        onClose();
    };

    const handleSignupClick = () => {
        onClose();
        onOpenSignup();
    };

    return (
        <Modal open={open} onClose={onClose} title="Sign In" subtitle="Local account">
            <div className="space-y-3">
                <input
                    autoFocus
                    value={usernameOrEmail}
                    onChange={(e) => setUsernameOrEmail(e.target.value)}
                    placeholder="Username or Email"
                    style={{ outline: "none", boxShadow: "none" }}
                    className="input input-sm w-full bg-base-300 border-white/10 text-sm rounded focus:outline-none focus-visible:outline-none"
                    onKeyDown={(e) => e.key === "Enter" && submit()}
                />
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
            </div>

            <button
                onClick={submit}
                disabled={!usernameOrEmail.trim()}
                style={{ outline: "none", boxShadow: "none" }}
                className="btn btn-sm btn-primary w-full rounded mt-5 gap-1.5 focus:outline-none focus-visible:outline-none">
                <LogIn size={13} /> Sign In
            </button>

            <p className="text-center text-xs text-base-content/40 mt-3">
                Don't have an account?{" "}
                <button
                    type="button"
                    onClick={handleSignupClick}
                    style={{ outline: "none", boxShadow: "none" }}
                    className="text-primary hover:underline font-medium transition-colors border-none cursor-pointer">
                    Sign up
                </button>
            </p>
        </Modal>
    );
}
