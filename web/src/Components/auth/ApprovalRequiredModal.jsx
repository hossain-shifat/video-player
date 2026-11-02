// web/src/Components/auth/ApprovalRequiredModal.jsx
// Shown when an account that is not yet approved tries to start playback.
// Native <dialog> → focus trap, Escape to close, aria-modal, backdrop — without extra dependencies.

import { useEffect, useRef } from "react";
import { Hourglass } from "lucide-react";

export default function ApprovalRequiredModal({ open = true, onClose }) {
    const ref = useRef(null);

    useEffect(() => {
        const dlg = ref.current;
        if (!dlg) return;
        if (open && !dlg.open) dlg.showModal();
        if (!open && dlg.open) dlg.close();
    }, [open]);

    return (
        <dialog
            ref={ref}
            onClose={onClose}
            onCancel={onClose}
            aria-labelledby="approval-title"
            aria-describedby="approval-message"
            className="m-auto w-[min(92vw,26rem)] rounded-2xl border border-white/10 bg-base-200 p-0 text-base-content shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm">
            <div className="flex flex-col items-center px-7 pt-8 pb-6 text-center">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-warning/30 bg-warning/10">
                    <Hourglass size={26} className="text-warning" aria-hidden="true" />
                </div>
                <h2 id="approval-title" className="text-xl font-semibold">
                    Approval Required
                </h2>
                <p id="approval-message" className="mt-2 text-sm leading-relaxed text-base-content/65">
                    Your account is waiting for administrator approval. You can browse the FLUX library and explore media details, but watching content will become available once your account is approved.
                </p>
                <button type="button" autoFocus onClick={() => ref.current?.close()} className="btn btn-primary mt-6 w-full cursor-pointer">
                    Got it
                </button>
            </div>
        </dialog>
    );
}
