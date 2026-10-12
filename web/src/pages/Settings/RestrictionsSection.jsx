import { useMemo, useState } from "react";
import { Lock, LockOpen, KeyRound, Eye, EyeOff, ShieldAlert } from "lucide-react";
import { useApi } from "../../Context/apiContext";
import {
    Card,
    Row,
    Toggle,
    Seg,
    Chip,
    Notice,
    Modal,
    Field,
    Input,
    ConfirmModal,
    PinModal,
    SectionLabel,
    PrimaryButton,
    GhostButton,
    StatGrid,
    StatTile,
    RATING_LIMITS,
    isAllowedByPrefs,
    hasPin,
    isValidPin,
    setPin,
    removePin,
} from "./shared";

const toList = (x) => (Array.isArray(x) ? x : (x?.items ?? []));

// ─── Set / change PIN ─────────────────────────────────────────────────────────
function SetPinModal({ open, onClose, changing, onDone }) {
    const [pin, setPinValue] = useState("");
    const [confirm, setConfirm] = useState("");
    const [error, setError] = useState(null);

    // Reset fields every time the modal opens (render-time reset, no effect needed)
    const [wasOpen, setWasOpen] = useState(false);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) {
            setPinValue("");
            setConfirm("");
            setError(null);
        }
    }

    function save() {
        if (!isValidPin(pin)) return setError("PIN must be 4 to 6 digits.");
        if (pin !== confirm) return setError("PINs don't match.");
        setPin(pin);
        onDone();
    }

    const digits = (fn) => (e) => fn(e.target.value.replace(/\D/g, ""));

    return (
        <Modal open={open} onClose={onClose} title={changing ? "Change PIN" : "Set a PIN"} subtitle="The PIN protects restriction settings, data reset and import on this browser.">
            <div className="space-y-4">
                {error && (
                    <p role="alert" className="rounded-md border border-error/35 bg-error/10 px-3 py-2 text-[13px] text-error">
                        {error}
                    </p>
                )}
                <Field id="np-1" label="New PIN" required hint="4 to 6 digits.">
                    <Input id="np-1" name="np-1" type="password" inputMode="numeric" maxLength={6} autoComplete="off" value={pin} onChange={digits(setPinValue)} mono autoFocus />
                </Field>
                <Field id="np-2" label="Confirm PIN" required>
                    <Input id="np-2" name="np-2" type="password" inputMode="numeric" maxLength={6} autoComplete="off" value={confirm} onChange={digits(setConfirm)} onKeyDown={(e) => e.key === "Enter" && save()} mono />
                </Field>
                <div className="flex gap-2 pt-1">
                    <GhostButton onClick={onClose} className="flex-1">
                        Cancel
                    </GhostButton>
                    <PrimaryButton onClick={save} disabled={pin.length < 4 || confirm.length < 4} className="flex-1">
                        <KeyRound size={14} /> {changing ? "Change PIN" : "Set PIN"}
                    </PrimaryButton>
                </div>
            </div>
        </Modal>
    );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function RestrictionsSection({ prefs, setPref }) {
    const { movies, series, anime } = useApi();

    const [pinSet, setPinSet] = useState(hasPin);
    const [unlocked, setUnlocked] = useState(false);
    const [unlockOpen, setUnlockOpen] = useState(false);
    const [pinFormOpen, setPinFormOpen] = useState(false);
    const [removeOpen, setRemoveOpen] = useState(false);

    const locked = pinSet && !unlocked;
    const limitId = prefs.maxRating ?? "all";
    const limit = RATING_LIMITS.find((l) => l.id === limitId) || RATING_LIMITS[0];
    const blockUnrated = prefs.blockUnrated ?? false;
    const active = limitId !== "all" || blockUnrated;

    // Live impact on the real library
    const impact = useMemo(() => {
        const all = [...toList(movies), ...toList(series), ...toList(anime)];
        const visible = all.filter((i) => isAllowedByPrefs(i, prefs)).length;
        return { total: all.length, visible, hidden: all.length - visible };
    }, [movies, series, anime, prefs]);

    return (
        <div className="w-full space-y-6">
            <Notice tone="info" icon={ShieldAlert} title="Restricted content controls">
                Limit titles by rating on this browser. Titles above your limit are hidden wherever the library is listed. Titles with no rating follow the unrated rule below.
            </Notice>

            <StatGrid cols="grid-cols-3">
                <StatTile icon={active ? EyeOff : Eye} label="Limit" value={limit.label} tone={active ? "warn" : "muted"} />
                <StatTile icon={Eye} label="Titles visible" value={`${impact.visible} of ${impact.total}`} />
                <StatTile icon={EyeOff} label="Titles hidden" value={impact.hidden} tone={impact.hidden ? "warn" : "muted"} />
            </StatGrid>

            {locked ? (
                <Card>
                    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
                        <span className="flex size-12 items-center justify-center rounded-md border border-base-content/15 bg-base-300">
                            <Lock size={22} className="text-base-content/60" />
                        </span>
                        <div>
                            <p className="text-sm font-semibold text-base-content">Restrictions are locked</p>
                            <p className="mx-auto mt-1 max-w-xs text-[13px] leading-relaxed text-base-content/65">Enter your PIN to change the rating limit or the PIN itself.</p>
                        </div>
                        <PrimaryButton onClick={() => setUnlockOpen(true)}>
                            <LockOpen size={14} /> Enter PIN
                        </PrimaryButton>
                    </div>
                </Card>
            ) : (
                <>
                    <div id="r-limit" className="scroll-mt-28">
                        <SectionLabel hint="Anything rated above this is hidden.">Content rating limit</SectionLabel>
                        <Card>
                            <div className="space-y-3 p-3 sm:p-4">
                                <Seg opts={RATING_LIMITS.map((l) => ({ id: l.id, label: l.label }))} value={limitId} onChange={(v) => setPref("maxRating", v === "all" ? undefined : v)} />
                                <p className="px-1 text-[13px] text-base-content/65">{limit.desc}</p>
                            </div>
                        </Card>
                    </div>

                    <Card>
                        <Row id="r-unrated" label="Hide unrated titles" desc="Titles without a rating are hidden too. Turn on for strict kid-safe browsing.">
                            <Toggle label="Hide unrated titles" value={blockUnrated} onChange={(v) => setPref("blockUnrated", v || undefined)} />
                        </Row>
                    </Card>

                    <div id="r-pin" className="scroll-mt-28">
                        <SectionLabel hint="Stops casual changes. It is a soft lock stored in this browser, not account security.">PIN lock</SectionLabel>
                        <Card>
                            <Row label="Restriction PIN" desc={pinSet ? "Required to change restrictions, import data or reset preferences." : "Set a PIN so these settings can't be changed by anyone else."}>
                                <div className="flex flex-wrap items-center justify-end gap-2">
                                    {pinSet && (
                                        <Chip tone="success">
                                            <Lock size={11} /> PIN on
                                        </Chip>
                                    )}
                                    <GhostButton onClick={() => setPinFormOpen(true)}>
                                        <KeyRound size={13} /> {pinSet ? "Change PIN" : "Set PIN"}
                                    </GhostButton>
                                </div>
                            </Row>
                            {pinSet && (
                                <Row label="Lock now" desc="Require the PIN again before the next change.">
                                    <div className="flex flex-wrap items-center justify-end gap-2">
                                        <GhostButton onClick={() => setUnlocked(false)}>
                                            <Lock size={13} /> Lock
                                        </GhostButton>
                                        <GhostButton onClick={() => setRemoveOpen(true)} className="border-error/40 text-error hover:bg-error/10 hover:text-error">
                                            Remove PIN
                                        </GhostButton>
                                    </div>
                                </Row>
                            )}
                        </Card>
                    </div>
                </>
            )}

            <PinModal
                open={unlockOpen}
                onClose={() => setUnlockOpen(false)}
                title="Unlock restrictions"
                onVerified={() => {
                    setUnlocked(true);
                    setUnlockOpen(false);
                }}
            />

            <SetPinModal
                open={pinFormOpen}
                onClose={() => setPinFormOpen(false)}
                changing={pinSet}
                onDone={() => {
                    setPinSet(true);
                    setUnlocked(true);
                    setPinFormOpen(false);
                }}
            />

            <ConfirmModal
                open={removeOpen}
                onClose={() => setRemoveOpen(false)}
                title="Remove PIN?"
                subtitle="Anyone using this browser will be able to change restrictions."
                confirmLabel="Remove PIN"
                onConfirm={() => {
                    removePin();
                    setPinSet(false);
                    setUnlocked(false);
                    setRemoveOpen(false);
                }}
            />
        </div>
    );
}
