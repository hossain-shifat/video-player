// web/src/dashboard/components/ConfirmModal.jsx
// Professional DaisyUI confirm/alert modal — replaces all alert/confirm dialogs

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Trash2, Ban, X } from "lucide-react";

const VARIANT = {
    danger:  { icon: Trash2,         iconCls: "text-error",   btnCls: "btn-error" },
    warning: { icon: AlertTriangle,  iconCls: "text-warning",  btnCls: "btn-warning" },
    info:    { icon: AlertTriangle,  iconCls: "text-info",     btnCls: "btn-info" },
};

/**
 * ConfirmModal — DaisyUI-based modal
 *
 * Props:
 *   open        boolean
 *   onClose     () => void
 *   onConfirm   () => void | Promise<void>
 *   title       string
 *   message     string | ReactNode
 *   confirmText string  (default "Confirm")
 *   cancelText  string  (default "Cancel")
 *   variant     "danger" | "warning" | "info"  (default "danger")
 *   loading     boolean
 */
export default function ConfirmModal({
    open, onClose, onConfirm,
    title = "Are you sure?",
    message,
    confirmText = "Confirm",
    cancelText = "Cancel",
    variant = "danger",
    loading = false,
}) {
    const { icon: Icon, iconCls, btnCls } = VARIANT[variant] || VARIANT.danger;
    const cancelRef = useRef(null);

    // Focus trap — focus cancel on open
    useEffect(() => {
        if (open) setTimeout(() => cancelRef.current?.focus(), 50);
    }, [open]);

    // Close on Escape
    useEffect(() => {
        if (!open) return;
        const handler = (e) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [open, onClose]);

    if (!open) return null;

    return createPortal(
        <div className="modal modal-open" role="dialog" aria-modal="true" aria-labelledby="confirm-title" style={{ zIndex: 999999 }}>
            <div className="modal-box max-w-sm">
                <div className="flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-full bg-base-300 flex items-center justify-center shrink-0 ${iconCls}`}>
                        <Icon size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 id="confirm-title" className="font-semibold text-base-content text-base leading-tight">{title}</h3>
                        {message && (
                            <p className="text-sm text-base-content/60 mt-1.5 leading-relaxed">{message}</p>
                        )}
                    </div>
                    <button onClick={onClose} disabled={loading} className="btn btn-ghost btn-xs btn-square text-base-content/40">
                        <X size={14} />
                    </button>
                </div>
                <div className="modal-action mt-5 gap-2">
                    <button
                        ref={cancelRef}
                        onClick={onClose}
                        disabled={loading}
                        className="btn btn-sm btn-ghost"
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={loading}
                        className={`btn btn-sm ${btnCls}`}
                    >
                        {loading && <span className="loading loading-spinner loading-xs" />}
                        {confirmText}
                    </button>
                </div>
            </div>
            {/* Backdrop */}
            <div className="modal-backdrop bg-black/50 backdrop-blur-sm" onClick={onClose} />
        </div>,
        document.body
    );
}
