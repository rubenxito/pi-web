"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { ParsedPermissionRequest } from "@/lib/permission-payload";
import { useDialogArming } from "@/hooks/useDialogArming";
import { useDialogDrag } from "@/hooks/useDialogDrag";
import { useI18n } from "@/hooks/useI18n";
import type { ExtensionUiRequest } from "@/lib/types";

/**
 * A dedicated card for `@gotgenes/pi-permission-system` permission asks
 * (`lib/permission-payload.ts` does the recognition; `isPermissionDenyReasonInput`
 * catches the follow-up input the "No, provide reason" option opens).
 *
 * The extension's select fallback feeds pi-web one flattened string — a
 * "Permission Required" header plus aligned `label : value` facts, all of
 * which the generic dialog renders at one size and one color, with the decision
 * options (which start at "Yes") as equal buttons. This card restores the
 * structure the request already carries: the thing being ruled on (a command, a
 * path, a tool input) as the dominant mono text, what the policy matched as
 * quiet detail rows, and the options grouped by intent — approve pair filled
 * green, deny pair filled red, no borders. The option strings are sent back
 * verbatim; they are the extension's matching contract.
 *
 * Collapse keeps the card shell: same header, same position (once parked the
 * card is absolutely anchored at its top-left corner, so folding the body
 * leaves the header exactly where it was — see `hooks/useDialogDrag.ts`), just
 * without the body.
 */

const CATEGORY_LABEL: Record<string, string> = {
  read: "read",
  edit: "write",
  shell: "shell",
  mcp: "mcp",
  other: "tool",
};

/** The one warning tint: the marked unit inside the command, and any path
 *  that leaves the project. Mixed with --text so it stays readable in both
 *  light and dark themes. */
const WARN_TEXT = "color-mix(in srgb, #f59e0b 55%, var(--text))";
/** The chat's own green/red tints, mixed with --text so a button label stays
 *  readable on a pale fill in the light theme. */
const APPROVE_TEXT = "color-mix(in srgb, #22c55e 70%, var(--text))";
const DENY_TEXT = "color-mix(in srgb, #f87171 70%, var(--text))";

/** Wraps each flagged occurrence inside the main value (what the TUI paints). */
function FlaggedText({ text, flagged }: { text: string; flagged: readonly string[] }) {
  const parts = useMemo(() => {
    if (flagged.length === 0) return [{ text, flagged: false }];
    type Part = { text: string; flagged: boolean };
    const result: Part[] = [{ text: "", flagged: false }];
    let rest = text;
    // First-flag-first: walk the remaining string, splitting out each flagged
    // occurrence in payload order so nested/overlapping flags stay consistent.
    for (const flag of flagged) {
      if (!flag) continue;
      const index = rest.indexOf(flag);
      if (index === -1) continue;
      const tail = rest.slice(index + flag.length);
      if (index > 0) result.push({ text: rest.slice(0, index), flagged: false });
      result.push({ text: flag, flagged: true });
      rest = tail;
      result.push({ text: "", flagged: false });
    }
    if (rest) result.push({ text: rest, flagged: false });
    return result.filter((part) => part.text !== "");
  }, [text, flagged]);
  return (
    <>
      {parts.map((part, index) =>
        part.flagged
          ? <span key={index} style={{ fontWeight: 700, color: WARN_TEXT }}>{part.text}</span>
          : <span key={index}>{part.text}</span>,
      )}
    </>
  );
}

function CategoryChip({ parsed }: { parsed: ParsedPermissionRequest }) {
  const label = parsed.tool ?? CATEGORY_LABEL[parsed.category];
  const fg = `var(--perm-${parsed.category}-fg, var(--text))`;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 6,
        // Darker than the header strip it sits on, so the chip reads as a
        // distinct object in the corner.
        background: "color-mix(in srgb, var(--bg) 70%, var(--bg-hover))",
        color: fg,
        fontSize: 11,
        fontWeight: 700,
        fontFamily: "var(--font-mono)",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  );
}

export const PermissionDialogView = memo(function PermissionDialogView({
  request,
  parsed,
  waitingCount,
  onRespond,
}: {
  request: ExtensionUiRequest;
  /** The parse from `lib/permission-payload.ts`; the seam routes here only when it is non-null. */
  parsed: ParsedPermissionRequest;
  /** Further dialogs queued behind this one; each opens after this one is answered. */
  waitingCount: number;
  onRespond: (request: ExtensionUiRequest, response: { value: string } | { cancelled: true }) => void;
}) {
  const { t } = useI18n();
  // Hooks run before the select guard, so expiry reads through a narrowed
  // view of the request: only select dialogs carry an expiry.
  const selectRequest = request.method === "select" ? request : null;
  const [collapsed, setCollapsed] = useState(false);
  const [full, setFull] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const armed = useDialogArming();
  const dialogRef = useRef<HTMLDivElement>(null);
  const drag = useDialogDrag(dialogRef, { storeKey: "permission" });
  // Maximize exists only to lift the value block's scroll cap, so it appears
  // only when capped content actually overflows (measured live: content,
  // fonts, and the cap itself all move); once full, it stays visible to be
  // able to restore.
  const valueRef = useRef<HTMLDivElement | null>(null);
  const [valueOverflows, setValueOverflows] = useState(false);
  useEffect(() => {
    const element = valueRef.current;
    if (!element) return;
    const check = () => setValueOverflows(element.scrollHeight > element.clientHeight + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    // Highlighted code replaces its plain fallback after the first paint.
    const mutations = new MutationObserver(check);
    mutations.observe(element, { childList: true, subtree: true, characterData: true });
    void document.fonts?.ready.then(check);
    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  }, [parsed.mainValue, collapsed]);

  useEffect(() => {
    if (selectRequest?.expiresAt === undefined) return;
    // The server closes expired requests via extension_ui_closed.
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [selectRequest?.expiresAt]);

  const waitingPill = waitingCount > 0 && (
    <span style={{ fontSize: 11, fontWeight: 650, color: "var(--accent)", whiteSpace: "nowrap", flexShrink: 0 }}>
      {t("chat.extensionMoreWaiting", { count: waitingCount })}
    </span>
  );
  const remainingSeconds = selectRequest?.expiresAt === undefined
    ? null
    : Math.max(0, Math.ceil((selectRequest.expiresAt - now) / 1000));
  const countdown = remainingSeconds !== null && (
    <span style={{ fontSize: 11, color: "var(--text-dim)", whiteSpace: "nowrap", flexShrink: 0 }}>
      {t("chat.extensionExpiresIn", { seconds: remainingSeconds })}
    </span>
  );

  if (request.method !== "select") return null;
  // Options split by intent at the first "No…" option; the labels are the
  // extension's matching contract and are sent back verbatim.
  const options = request.options;
  const denyStart = options.findIndex((option) => option.startsWith("No"));
  const approveOptions = denyStart === -1 ? options : options.slice(0, denyStart);
  const denyOptions = denyStart === -1 ? [] : options.slice(denyStart);
  const cardStyle: React.CSSProperties = {
    pointerEvents: "auto",
    // Maximize fills the chat pane (width and height), so it always reads as a
    // deliberate layout change; the content area takes the freed height.
    ...(full
      ? { width: "100%", height: "100%", maxHeight: "100%" }
      // Content-sized, floored so a short button set does not collapse it, and
      // capped in px: CSS sizes from the text's *unwrapped* width, so without a
      // cap a long command always stretches the card to the whole frame.
      : { width: "fit-content", minWidth: "min(420px, 100%)", maxWidth: "min(800px, 100%)", maxHeight: "min(760px, 100%)" }),
    display: "flex",
    flexDirection: "column",
    border: "1px solid var(--border)",
    borderRadius: 8,
    // Elevated surface: one step above the chat pane, so the card reads as a
    // thing on top of the transcript (dark: lighter; light: greyer, shadowed).
    background: "var(--bg-panel)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.28)",
    overflow: "hidden",
    // Until the first drag the card is flex-centered; once parked, the drag
    // hook fixes its top-left (size changes then never move the header).
    ...(drag.anchor
      ? { position: "absolute", left: drag.anchor.x, top: drag.anchor.y }
      : null),
  };

  const submitOption = (option: string) => onRespond(request, { value: option });

  // The button classes ship with the component: a <style> tag cannot go stale
  // the way an appended rule in globals.css did (Turbopack occasionally
  // misses the invalidation, and machines without the lockfile may resolve a
  // different build chain — both bit us). Duplicate tags are harmless.
  const hoverStyles = `
    .perm-approve-solid { background: rgba(34, 197, 94, 0.12); }
    .perm-approve-solid:hover { background: rgba(34, 197, 94, 0.22); }
    .perm-approve-line { background: transparent; border: 1px solid rgba(34, 197, 94, 0.35) !important; }
    .perm-approve-line:hover { background: rgba(34, 197, 94, 0.12); }
    .perm-deny-solid { background: rgba(248, 113, 113, 0.12); }
    .perm-deny-solid:hover { background: rgba(248, 113, 113, 0.22); }
    .perm-deny-line { background: transparent; border: 1px solid rgba(248, 113, 113, 0.35) !important; }
    .perm-deny-line:hover { background: rgba(248, 113, 113, 0.12); }
    .perm-neutral { background: var(--bg-hover); }
    .perm-neutral:hover { background: var(--bg-selected); }
  `;

  return (
    <div
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        if (!armed) return; // Arming delay: a reflexive Esc right as the card opens does nothing.
        onRespond(request, { cancelled: true });
      }}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 90,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        pointerEvents: "none",
      }}
    >
      <style>{hoverStyles}</style>
      <div
        ref={dialogRef}
        role="dialog"
        aria-label={t("chat.permissionTitle")}
        style={cardStyle}
      >
        <div
          {...drag.handleProps}
          style={{ flexShrink: 1, minHeight: 0, display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "var(--bg-hover)", ...drag.handleProps.style }}
        >
          <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <CategoryChip parsed={parsed} />
            <span style={{ color: "var(--text)", fontSize: 14, fontWeight: 400 }}>
              {t("chat.permissionTitle")}
            </span>
            {parsed.subagent && (
              <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                {t("chat.permissionSubagent")}
              </span>
            )}
            {parsed.surface && (
              <span style={{ fontSize: 11, lineHeight: 1, alignSelf: "center", color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
                {parsed.surface}
              </span>
            )}
            {waitingPill}
            {countdown}
          </div>
          {(full || (!collapsed && valueOverflows)) && (
            <button
              type="button"
              onClick={() => setFull((prev) => !prev)}
              title={full ? t("chat.extensionRestoreSize") : t("chat.extensionMaximize")}
              aria-label={full ? t("chat.extensionRestoreSize") : t("chat.extensionMaximize")}
              style={{
              display: "grid",
              placeItems: "center",
              width: 28,
              height: 28,
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg-panel)",
              color: "var(--text-muted)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {full
                ? <path d="M3.5 1v2.5H1M6.5 1v2.5H9M6.5 9v-2.5H9M3.5 9v-2.5H1" />
                : <path d="M1 3.5V1h2.5M6.5 1H9v2.5M9 6.5V9H6.5M3.5 9H1V6.5" />}
            </svg>
            </button>
          )}
          <button
            type="button"
            onClick={() => { drag.requestAnchor(); setCollapsed((prev) => !prev); }}
            aria-expanded={!collapsed}
            title={collapsed ? t("chat.extensionExpand") : t("chat.extensionCollapse")}
            aria-label={collapsed ? t("chat.extensionExpand") : t("chat.extensionCollapse")}
            style={{
              display: "grid",
              placeItems: "center",
              width: 28,
              height: 28,
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg-panel)",
              color: "var(--text-muted)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {collapsed ? <polyline points="2 6.5 5 3.5 8 6.5" /> : <polyline points="2 3.5 5 6.5 8 3.5" />}
            </svg>
          </button>
        </div>

        {!collapsed && (<>
        <div style={{ padding: 14, flex: "1 1 auto", minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, borderTop: "1px solid var(--border)" }}>
          {parsed.mainValue && (
            <div
              ref={valueRef}
              style={{
                // Fills the card the buttons decided, and wraps inside it.
                maxWidth: "100%",
                fontFamily: "var(--font-mono)",
                fontSize: 14,
                lineHeight: 1.5,
                color: "var(--text)",
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                wordBreak: "normal",
                maxHeight: full ? "none" : "40vh",
                // Maximize hands the freed pane height to the value block, so
                // the enlargement is not just an empty frame.
                flex: full ? "1 1 auto" : undefined,
                overflowY: "auto",
              }}
            >
              {parsed.inputPath ? (
                <>
                  <FlaggedText text={parsed.inputPath} flagged={parsed.flagged} />
                  {parsed.inputInfo && (
                    <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
                      {parsed.inputInfo}
                    </div>
                  )}
                </>
              ) : (
                <FlaggedText text={parsed.mainValue} flagged={parsed.flagged} />
              )}
            </div>
          )}

          {/* One dict, one style: the remaining facts in payload order,
              labels sans, values mono — repeated `external path` entries
              simply repeat as rows, verbatim. A path that leaves the project
              is the one thing worth spotting here, so it carries the warning
              tint; everything else stays in the text colour. */}
          {[...parsed.details, ...parsed.evidence].map((fact, index) => (
            <div key={index} style={{ display: "flex", gap: 8, fontSize: 12, lineHeight: 1.5, alignItems: "baseline" }}>
              <span style={{ color: "color-mix(in srgb, var(--text-dim) 55%, var(--bg))", flexShrink: 0, minWidth: 90 }}>{fact.label}</span>
              <span style={{ color: fact.label === "external path" ? WARN_TEXT : "var(--text)", fontFamily: "var(--font-mono)", overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{fact.value}</span>
            </div>
          ))}
        </div>

        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 8, padding: "10px 14px", background: "var(--bg-panel)", marginTop: 8 }}>
          {/* Two rows, as asked: Yes + all its session-grant variants, then the
              No pair. The grant side can hold 1–2 variants (proven / family);
              the pair stays a row either way. */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {approveOptions.map((option, index) => (
              <button
                key={option}
                onClick={() => submitOption(option)}
                title={option}
                className={index === 0 ? "perm-approve-solid" : "perm-approve-line"}
                style={{
                  padding: "7px 12px",
                  borderRadius: 6,
                  // Fill/border live in the class (inline styles cannot :hover):
                  // primary option filled, long session grants outlined.
                  color: APPROVE_TEXT,
                  fontWeight: 500,
                  fontSize: 12.5,
                  cursor: "pointer",
                  textAlign: "left",
                  width: "fit-content",
                  maxWidth: "100%",
                  // One line per button: a long session-grant label elides
                  // instead of wrapping, so the card's height stays put. The
                  // full string is the title (and still what gets sent back).
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  minHeight: 34,
                }}
              >
                {option}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {denyOptions.map((option, index) => (
              <button
                key={option}
                onClick={() => submitOption(option)}
                title={option}
                className={index === 0 ? "perm-deny-solid" : "perm-deny-line"}
                style={{
                  padding: "7px 12px",
                  borderRadius: 6,
                  color: DENY_TEXT,
                  fontWeight: 500,
                  fontSize: 12.5,
                  cursor: "pointer",
                  textAlign: "left",
                  width: "fit-content",
                  maxWidth: "100%",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  minHeight: 34,
                }}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
        </>)}
      </div>
    </div>
  );
});

/**
 * The follow-up input the "No, provide reason" option opens: one text field on
 * the same card shell (same header treatment, same anchored collapse and
 * position memory under its own key), so the denial flow never falls back to
 * the generic dialog layout.
 */
export function isPermissionDenyReasonInput(request: ExtensionUiRequest): boolean {
  if (request.method !== "input") return false;
  const lines = request.title.split("\n");
  if (lines[0] !== "Permission Required") return false;
  // The sentence is fixed in the extension's `permission-dialog.ts`; a changed
  // wording after an update degrades to the generic dialog, never breaks.
  return lines.slice(1).some((line) => line.startsWith("Share why this request was denied"));
}

export const PermissionReasonView = memo(function PermissionReasonView({
  request,
  waitingCount,
  onRespond,
}: {
  request: Extract<ExtensionUiRequest, { method: "input" }>;
  waitingCount: number;
  onRespond: (request: ExtensionUiRequest, response: { value: string } | { cancelled: true }) => void;
}) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [value, setValue] = useState("");
  const armed = useDialogArming();
  const dialogRef = useRef<HTMLDivElement>(null);
  const drag = useDialogDrag(dialogRef, { storeKey: "permission-reason" });

  const waitingPill = waitingCount > 0 && (
    <span style={{ fontSize: 11, fontWeight: 650, color: "var(--accent)", whiteSpace: "nowrap", flexShrink: 0 }}>
      {t("chat.extensionMoreWaiting", { count: waitingCount })}
    </span>
  );

  const cardStyle: React.CSSProperties = {
    pointerEvents: "auto",
    width: "min(520px, 100%)",
    display: "flex",
    flexDirection: "column",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-panel)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.28)",
    overflow: "hidden",
    ...(drag.anchor
      ? { position: "absolute", left: drag.anchor.x, top: drag.anchor.y }
      : null),
  };

  const denyLabel = request.title.split("\n").find((line) => line.startsWith("Share why")) ?? "Permission Required";

  const hoverStyles = `
    .perm-deny-solid { background: rgba(248, 113, 113, 0.12); }
    .perm-deny-solid:hover { background: rgba(248, 113, 113, 0.22); }
    .perm-neutral { background: var(--bg-hover); }
    .perm-neutral:hover { background: var(--bg-selected); }
  `;

  return (
    <div
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        if (!armed) return;
        onRespond(request, { cancelled: true });
      }}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 90,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        pointerEvents: "none",
      }}
    >
      <style>{hoverStyles}</style>
      <div
        ref={dialogRef}
        role="dialog"
        aria-label={denyLabel}
        style={cardStyle}
      >
        <div
          {...drag.handleProps}
          style={{ flexShrink: 1, minHeight: 0, display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "var(--bg-hover)", ...drag.handleProps.style }}
        >
          <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "2px 8px",
                borderRadius: 6,
                background: "rgba(248,113,113,0.12)",
                fontSize: 11,
                fontWeight: 700,
                fontFamily: "var(--font-mono)",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              why
            </span>
            <span style={{ color: "var(--text)", fontSize: 14, fontWeight: 400 }}>
              {t("chat.permissionTitle")}
            </span>
            {waitingPill}
          </div>
          <button
            type="button"
            onClick={() => { drag.requestAnchor(); setCollapsed((prev) => !prev); }}
            aria-expanded={!collapsed}
            title={collapsed ? t("chat.extensionExpand") : t("chat.extensionCollapse")}
            aria-label={collapsed ? t("chat.extensionExpand") : t("chat.extensionCollapse")}
            style={{
              display: "grid",
              placeItems: "center",
              width: 28,
              height: 28,
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg-panel)",
              color: "var(--text-muted)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {collapsed ? <polyline points="2 6.5 5 3.5 8 6.5" /> : <polyline points="2 3.5 5 6.5 8 3.5" />}
            </svg>
          </button>
        </div>

        {!collapsed && (
          <>
            <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{denyLabel}</div>
              <input
                value={value}
                placeholder={request.placeholder}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                  if (!armed) return;
                  e.preventDefault();
                  onRespond(request, { value });
                }}
                style={{
                  width: "100%",
                  padding: "9px 10px",
                  borderRadius: 7,
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  color: "var(--text)",
                  outline: "none",
                  fontSize: 13,
                }}
              />
            </div>
            <div style={{ flexShrink: 0, display: "flex", flexWrap: "wrap", gap: 8, padding: "10px 14px", background: "var(--bg-panel)", marginTop: 8 }}>
              <button
                onClick={() => onRespond(request, { cancelled: true })}
                className="perm-neutral"
                style={{
                  padding: "7px 12px",
                  borderRadius: 6,
                  border: "none",
                  color: "var(--text-muted)",
                  fontWeight: 500,
                  fontSize: 12.5,
                  cursor: "pointer",
                  textAlign: "left",
                  width: "fit-content",
                  maxWidth: "100%",
                  minHeight: 34,
                }}
              >
                {t("chat.cancel")}
              </button>
              <button
                onClick={() => onRespond(request, { value })}
                className="perm-deny-solid"
                style={{
                  padding: "7px 12px",
                  borderRadius: 6,
                  border: "none",
                  color: "var(--text)",
                  fontWeight: 500,
                  fontSize: 12.5,
                  cursor: "pointer",
                  textAlign: "left",
                  width: "fit-content",
                  maxWidth: "100%",
                  minHeight: 34,
                }}
              >
                {t("chat.submit")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
});