"use client";

import { useEffect, useState } from "react";

/**
 * Arming delay for extension dialogs.
 *
 * A dialog can surface mid-keystroke — the user is typing in the composer when
 * the model reaches a gated tool. An immediately-live dialog eats the next
 * Enter/Esc: Enter lands on the focused (or first) option and accepts it. The
 * dialog therefore opens inert: key submissions are ignored for
 * ARM_DELAY_MS, long enough that a keystroke already in flight or typed
 * reflexively lands nowhere, and a deliberate press after the delay still
 * works. Pointer clicks are exempt — aiming at a button is deliberate by
 * itself.
 */
export const ARM_DELAY_MS = 350;

/** True only after the dialog has been open past the arming delay. */
export function useDialogArming(): boolean {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setArmed(true), ARM_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  return armed;
}