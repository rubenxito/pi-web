"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

export interface DialogAnchor {
  x: number;
  y: number;
}

/**
 * Per-page memory of where the user last parked a dialog, by key, in the
 * pane's own coordinates. The card remounts on every queued permission ask
 * (it is keyed by request id), so the anchor has to outlive one component
 * instance for the next dialog to open with its header where the last one was
 * parked. Double-click (recenter) clears the entry.
 */
const rememberedAnchors = new Map<string, DialogAnchor>();

function rememberAnchor(key: string, anchor: DialogAnchor | null): void {
  if (anchor === null) rememberedAnchors.delete(key);
  else rememberedAnchors.set(key, anchor);
}

/**
 * Free drag for an extension dialog, from its header, by explicit anchoring.
 *
 * Until the user drags, the card is flex-centered in the pane. The **first**
 * drag converts it to an explicit `left/top` (its current visual top-left, in
 * pane coordinates) and thereafter the card is positioned absolutely: its
 * top-left corner is fixed regardless of the card's size. That makes
 * Collapse/Expand, Maximize and the next ask's different content all grow or
 * shrink from the header's place — the header bar never slides anywhere, and
 * nothing ever drifts back toward the center.
 *
 * Measurement direction: read the **card itself** and the **pane** (the
 * card's parent) for the conversion and for every post-render clamp, which
 * keeps at least EDGE_KEEP_PX of the card inside the pane on each side —
 * including after window resizes.
 */
export interface DialogDrag {
  /** Explicit pane coordinates of the card's top-left; null while centered. */
  anchor: DialogAnchor | null;
  /** True from pointerdown to pointerup — style hooks (cursor, selection). */
  dragging: boolean;
  /**
   * Call within the click that changes the card's height (collapse/expand):
   * an untouched card is anchored at its current header position first, so
   * the fold keeps the header where it was — ALWAYS, moved or not.
   */
  requestAnchor: () => void;
  /** Attach to the header strip that should act as the handle. */
  handleProps: {
    onPointerDown: (event: React.PointerEvent) => void;
    onDoubleClick: (event: React.MouseEvent) => void;
    style: React.CSSProperties;
  };
}

export function useDialogDrag(cardRef: RefObject<HTMLElement | null>, options: { enabled?: boolean; storeKey?: string } = {}): DialogDrag {
  const { enabled = true, storeKey } = options;
  const [anchor, setAnchorState] = useState<DialogAnchor | null>(() => (storeKey ? rememberedAnchors.get(storeKey) ?? null : null));
  const [dragging, setDragging] = useState(false);
  const anchorRef = useRef<DialogAnchor>(
    storeKey ? rememberedAnchors.get(storeKey) ?? { x: 0, y: 0 } : { x: 0, y: 0 },
  );
  const session = useRef<{ pointerX: number; pointerY: number } | null>(null);

  const setAnchor = useCallback((next: DialogAnchor | null) => {
    if (storeKey) rememberAnchor(storeKey, next);
    anchorRef.current = next ?? { x: 0, y: 0 };
    setAnchorState(next);
  }, [storeKey]);

  const endDrag = useCallback(() => {
    session.current = null;
    setDragging(false);
  }, []);

  // One pass converts a centered card to an explicit anchor: the card's
  // current visual top-left, minus the pane's, minus the padding-box
  // question — the overlay has no border, so its border box and padding box
  // share the origin and the subtraction below is already padding-box-ready.
  const materializeAnchor = useCallback(() => {
    if (anchor !== null) return;
    const card = cardRef.current;
    const pane = card?.parentElement;
    if (!card || !pane) return;
    const cardRect = card.getBoundingClientRect();
    const paneRect = pane.getBoundingClientRect();
    setAnchor({ x: cardRect.left - paneRect.left, y: cardRect.top - paneRect.top });
  }, [anchor, cardRef, setAnchor]);

  // Collapse/expand must leave the header in place — ALWAYS, moved or not.
  // A parked card is already anchored at its top-left, so nothing to do; an
  // untouched (centered) card is materialized first: its current top-left
  // becomes the anchor, and the fold happens from that spot.
  const requestAnchor = useCallback(() => {
    if (anchor === null) materializeAnchor();
  }, [anchor, materializeAnchor]);

  // Post-render clamp: an anchored card stays inside the pane, also after
  // window resizes. Centered cards need nothing.
  useLayoutEffect(() => {
    if (anchor === null) return;
    const card = cardRef.current;
    const pane = card?.parentElement;
    if (!card || !pane) return;
    const paneRect = pane.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const clamped = {
      x: clamp(
        anchorRef.current.x,
        EDGE_KEEP_PX - cardRect.width,
        paneRect.width - EDGE_KEEP_PX,
      ),
      y: clamp(
        anchorRef.current.y,
        -cardRect.height + EDGE_KEEP_PX,
        paneRect.height - EDGE_KEEP_PX,
      ),
    };
    if (clamped.x !== anchorRef.current.x || clamped.y !== anchorRef.current.y) setAnchor(clamped);
  });

  useEffect(() => {
    if (!dragging) return;
    // Document-level listeners: the pointer outruns the card mid-drag.
    document.body.style.userSelect = "none";
    const onMove = (event: PointerEvent) => {
      const state = session.current;
      if (!state) return;
      const next = {
        x: anchorRef.current.x + (event.clientX - state.pointerX),
        y: anchorRef.current.y + (event.clientY - state.pointerY),
      };
      session.current = { pointerX: event.clientX, pointerY: event.clientY };
      setAnchor(next);
    };
    const onUp = () => endDrag();
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    return () => {
      document.body.style.userSelect = "";
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, endDrag, setAnchor]);

  if (!enabled) {
    return {
      anchor: null,
      dragging: false,
      requestAnchor: () => {},
      handleProps: { onPointerDown: () => {}, onDoubleClick: () => {}, style: {} },
    };
  }

  return {
    anchor,
    dragging,
    requestAnchor,
    handleProps: {
      onPointerDown: (event) => {
        if (event.button !== 0) return;
        if ((event.target as HTMLElement).closest("button")) return; // buttons stay buttons
        materializeAnchor();
        session.current = { pointerX: event.clientX, pointerY: event.clientY };
        event.preventDefault();
        setDragging(true);
      },
      onDoubleClick: (event) => {
        // Rapid toggle clicks (collapse → uncollapse) synthesize a dblclick
        // that bubbles out of the button; recenter is only the header's own
        // empty-area gesture.
        if ((event.target as HTMLElement).closest("button")) return;
        setAnchor(null);
      },
      style: {
        cursor: dragging ? "grabbing" : "grab",
        touchAction: "none",
      },
    },
  };
}

/** The header's own width must always be reachable; 64px keeps the buttons too. */
const EDGE_KEEP_PX = 64;

function clamp(value: number, min: number, max: number): number {
  if (min > max) return value;
  return Math.min(Math.max(value, min), max);
}