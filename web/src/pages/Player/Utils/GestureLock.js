// gestureLock.js
//
// Cross-component gesture arbitration. data-gesture-exclude + closest() (in
// PlayerGestures.jsx) is the normal way an overlay opts out of the global
// full-screen swipe gesture, and still works fine for things like the Quick
// Action row. But the subtitle dialogue-skip zone's actual DOM hit box is
// only as wide as the centered caption text — narrower than the visual
// "swipe zone" a user naturally swipes across — so a touch can start just
// outside it and still visually feel like "swiping the subtitle", letting
// the global seek gesture engage at the same time as the subtitle skip.
//
// This is a second, DOM-independent line of defense: whichever gesture's
// pointerdown fires first locks it immediately (synchronously, before any
// other handler runs), and the global seek gesture checks this lock too.
let locked = false;

export function lockGesture() {
    locked = true;
}

export function unlockGesture() {
    locked = false;
}

export function isGestureLocked() {
    return locked;
}
