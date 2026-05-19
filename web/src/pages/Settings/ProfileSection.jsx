import { User, LogOut, LogIn, Pencil, Save, X } from "lucide-react";
import { Card, Row, SectionTitle } from "./shared";

export default function ProfileSection({ user, editingName, draftName, setDraftName, setEditingName, saveName, handleLogout, setLoginOpen }) {
    return (
        <div className="space-y-5">
            <Card>
                {user ? (
                    <>
                        <div className="flex items-center gap-5 px-6 py-6 border-b border-white/5">
                            <div className="w-16 h-16 rounded-full bg-primary/15 flex items-center justify-center ring-2 ring-primary/25 shrink-0">
                                <span className="text-2xl font-bold text-primary">{user.username?.[0]?.toUpperCase() ?? "U"}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                                {editingName ? (
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <input
                                            autoFocus
                                            value={draftName}
                                            onChange={(e) => setDraftName(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") saveName();
                                                if (e.key === "Escape") setEditingName(false);
                                            }}
                                            className="input input-xs bg-base-300 border-white/10 text-sm rounded w-40"
                                        />
                                        <button
                                            onClick={saveName}
                                            style={{ outline: "none", boxShadow: "none" }}
                                            className="btn btn-xs btn-primary rounded gap-1 focus:outline-none focus-visible:outline-none">
                                            <Save size={11} /> Save
                                        </button>
                                        <button
                                            onClick={() => setEditingName(false)}
                                            style={{ outline: "none", boxShadow: "none" }}
                                            className="btn btn-xs btn-ghost rounded focus:outline-none focus-visible:outline-none">
                                            <X size={11} />
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <p className="font-semibold text-base-content text-lg">{user.username}</p>
                                        <button
                                            onClick={() => setEditingName(true)}
                                            style={{ outline: "none", boxShadow: "none" }}
                                            className="text-base-content/25 hover:text-primary transition-colors focus:outline-none focus-visible:outline-none">
                                            <Pencil size={13} />
                                        </button>
                                    </div>
                                )}
                                <p className="text-xs text-base-content/40 mt-1">Local account · Personal use</p>
                                {user.email && <p className="text-xs text-base-content/30 mt-0.5">{user.email}</p>}
                            </div>
                        </div>
                        <Row label="Sign Out" desc="Log out of your local profile" danger>
                            <button
                                onClick={handleLogout}
                                style={{ outline: "none", boxShadow: "none" }}
                                className="btn btn-xs btn-error btn-outline rounded gap-1.5 focus:outline-none focus-visible:outline-none">
                                <LogOut size={12} /> Sign Out
                            </button>
                        </Row>
                    </>
                ) : (
                    <div className="flex flex-col items-center gap-4 px-6 py-12">
                        <div className="w-16 h-16 rounded-full bg-base-300 flex items-center justify-center">
                            <User size={28} className="text-base-content/25" />
                        </div>
                        <div className="text-center">
                            <p className="font-medium text-base-content">Not signed in</p>
                            <p className="text-xs text-base-content/40 mt-1">Sign in to save preferences and watch history</p>
                        </div>
                        <button
                            onClick={() => setLoginOpen(true)}
                            style={{ outline: "none", boxShadow: "none" }}
                            className="btn btn-sm btn-primary rounded gap-1.5 px-6 border-none">
                            <LogIn size={14} /> Sign In
                        </button>
                    </div>
                )}
            </Card>
        </div>
    );
}
