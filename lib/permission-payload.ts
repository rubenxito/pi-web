/**
 * Parser for `@gotgenes/pi-permission-system` permission dialogs (pi-web only).
 *
 * In RPC mode the extension asks through pi's generic `ui.select()` dialog,
 * whose title is one plain string: `"Permission Required"` on the first line,
 * then aligned `label : value` fact lines rendered at an 80-column budget
 * (`src/presentation/dialog-renderer.ts`). The decision options are known
 * verbatim strings the extension matches on, so they are never rewritten —
 * only detected.
 *
 * This module recognizes that shape and turns it into a structured card:
 * anything that does not parse (another extension's select, a changed
 * vocabulary after an extension update) returns null, and the caller falls
 * back to rendering the request the generic way.
 *
 * Kept client-safe and dependency-free so it is unit-testable in isolation.
 */
import type { ExtensionUiRequest } from "./types";

export type PermissionCategory = "read" | "edit" | "shell" | "mcp" | "other";

export interface PermissionFact {
  label: string;
  value: string;
}

export interface ParsedPermissionRequest {
  /** The header line's constant part, without the subagent suffix. */
  header: string;
  /** The ask was forwarded from a subagent ("Permission Required (Subagent)"). */
  subagent: boolean;
  surface: string | null;
  /** The gated tool name, without an " (invoked as …)" suffix. */
  tool: string | null;
  category: PermissionCategory;
  /** The label of the decision-relevant fact (command / path / input / …). */
  mainLabel: string | null;
  mainValue: string | null;
  /**
   * For a write/edit ask whose `input` fact reads `for '<path>' (<info>)`:
   * the file the request targets. Null when the value does not match the
   * preview sentence (then the raw value renders instead).
   */
  inputPath: string | null;
  /** The trailing caption of that preview, e.g. `2 lines, 107 characters`. */
  inputInfo: string | null;
  /**
   * Strings to highlight inside `mainValue`: the unit the rule fired on when
   * the ask is about one unit of a longer command line, plus — for a bash ask
   * that escaped the working directory — the external paths (what the TUI
   * paints; the select fallback drops the paint). Empty otherwise.
   */
  flagged: string[];
  /** Repeated evidence facts, in payload order (external path, read path, …). */
  evidence: PermissionFact[];
  /** The remaining facts (rule, matched as, why, runs, context, …), in order. */
  details: PermissionFact[];
}

/** The option strings the extension matches on verbatim (`permission-dialog.ts`). */
const APPROVE_OPTION = "Yes";
const DENY_OPTION = "No";
const DENY_WITH_REASON_PREFIX = "No, provide reason";

const HEADER = "Permission Required";
const SUBAGENT_HEADER = "Permission Required (Subagent)";

/**
 * Labels the fallback render emits. Label vocabulary is pinned to the
 * extension's renderers; an unknown label degrades to a continuation line
 * (its text stays visible) rather than failing the parse.
 */
const FACT_LABELS = new Set([
  "tool",
  "surface",
  "rule",
  "matched as",
  "command",
  "path",
  "target",
  "skill",
  "input",
  "why",
  "runs",
  "context",
  "agent",
  "subagent",
  "working directory",
  "external path",
  "full command",
  "read path",
  "resolves to",
]);

const EVIDENCE_LABELS = new Set(["external path", "full command", "read path", "resolves to"]);
/** The fact that is the thing being ruled on, shown as the card's main block. */
const MAIN_LABELS = new Set(["command", "path", "target", "skill", "input"]);

const FACT_LINE = /^([A-Za-z][A-Za-z _-]{0,30}?)\s\s*:\s?(.*)$/;

/** `for '<path>' (<info>)` — the write/edit preview sentence the extension builds. */
const INPUT_PREVIEW = /^for '([\s\S]+)' \(([\s\S]*)\)$/;

const SHELL_TOOLS = new Set(["bash", "shell", "sh", "zsh", "cmd", "powershell", "exec_command", "run_terminal_cmd", "terminal_command"]);
const EDIT_TOOLS = new Set(["write", "edit", "write_file", "edit_file", "apply_patch", "multi_edit", "multiedit", "notebook_edit", "replace"]);
const READ_TOOLS = new Set(["read", "grep", "find", "ls", "head", "tail", "cat", "glob", "search", "list_files", "list", "ollama_web_search", "ollama_web_fetch", "web_search", "webfetch"]);

/**
 * Recognize a permission-system select and split its title into facts.
 *
 * Returns null when this is some other extension's dialog — detection must be
 * strict in what it consumes and graceful about what it cannot map, because
 * the extension package updates on its own schedule.
 */
export function parsePermissionRequest(request: ExtensionUiRequest): ParsedPermissionRequest | null {
  if (request.method !== "select") return null;
  const options = request.options;
  if (options.length < 2 || options[0] !== APPROVE_OPTION) return null;
  if (!options.includes(DENY_OPTION) || !options.some((option) => option.startsWith(DENY_WITH_REASON_PREFIX))) return null;

  const lines = request.title.split("\n");
  const headerLine = lines[0];
  if (headerLine !== HEADER && headerLine !== SUBAGENT_HEADER) return null;

  const facts: { label: string; value: string }[] = [];
  for (const line of lines.slice(1)) {
    const known = matchKnownFact(line);
    if (known) {
      facts.push(known);
    } else if (facts.length > 0) {
      // A wrapped fragment of the previous fact — kept verbatim, newline
      // embedded. No stitching or de-wrapping: the card renders the bytes
      // the extension produced.
      const last = facts[facts.length - 1];
      last.value = last.value === "" ? line : `${last.value}\n${line}`;
    }
    // A wrapped fragment before any fact carries no fact to join; drop it.
  }

  const core: { label: string; value: string }[] = [];
  const evidence: PermissionFact[] = [];
  for (const fact of facts) {
    if (EVIDENCE_LABELS.has(fact.label)) {
      evidence.push(fact);
    } else {
      core.push(fact);
    }
  }

  const main = core.find((fact) => MAIN_LABELS.has(fact.label)) ?? null;
  const surface = core.find((fact) => fact.label === "surface")?.value ?? null;
  const toolFact = core.find((fact) => fact.label === "tool");
  const tool = toolFact ? stripInvokedAs(toolFact.value) : null;

  // A bash ask rules on one unit of a longer command line, and says so: the
  // whole line arrives as `full command` evidence. The unit alone is the least
  // representative thing to anchor on — approving runs the entire line — so
  // the line becomes the main value with the unit marked inside it, and the
  // now-duplicated evidence row is dropped.
  const fullCommand = evidence.find((fact) => fact.label === "full command");
  const promoted = fullCommand !== undefined && main !== null && fullCommand.value !== main.value
    ? fullCommand
    : null;
  if (promoted) {
    evidence.splice(evidence.indexOf(promoted), 1);
  }

  const flagged = [
    // The unit may have been soft-wrapped inside the full command; it then
    // matches nothing and simply renders unmarked rather than wrongly marked.
    ...(promoted !== null && main !== null ? [main.value] : []),
    ...evidence
      .filter((fact) => fact.label === "external path" && fact.value !== "")
      .map((fact) => fact.value),
  ];

  // A write/edit ask's `input` fact is a preview sentence: `for '<path>'
  // (<info>)`. The path is the decision-relevant part; the parenthesis is a
  // caption. Only applies once the value is de-wrapped into one line.
  const inputMatch = main && main.label === "input" ? INPUT_PREVIEW.exec(main.value) : null;

  return {
    header: HEADER,
    subagent: headerLine === SUBAGENT_HEADER,
    surface,
    tool,
    category: classify(tool, main?.label ?? null, surface),
    mainLabel: main?.label ?? null,
    mainValue: promoted?.value ?? main?.value ?? null,
    inputPath: inputMatch?.[1] ?? null,
    inputInfo: inputMatch?.[2] ?? null,
    flagged,
    evidence,
    details: core.filter((fact) => fact !== main && fact.label !== "tool" && fact.label !== "surface"),
  };
}

/** Recognize one `label : value` line whose label the vocabulary knows. */
function matchKnownFact(line: string): PermissionFact | null {
  const match = FACT_LINE.exec(line);
  if (!match) return null;
  const label = match[1].trim();
  if (!FACT_LABELS.has(label)) return null;
  return { label, value: match[2] };
}

/** `bash (invoked as exec_command)` → `bash` (rendered by `toolText()`). */
function stripInvokedAs(tool: string): string {
  const index = tool.indexOf(" (invoked as ");
  return index === -1 ? tool : tool.slice(0, index);
}

function classify(tool: string | null, mainLabel: string | undefined | null, surface: string | null): PermissionCategory {
  if (mainLabel === "target" || (tool ?? "").startsWith("mcp__") || surface === "mcp") return "mcp";
  const name = (tool ?? "").toLowerCase();
  if (SHELL_TOOLS.has(name) || surface === "bash") return "shell";
  if (EDIT_TOOLS.has(name)) return "edit";
  if (READ_TOOLS.has(name)) return "read";
  if (surface !== null) {
    if (surface.endsWith("_read") || surface.endsWith("_search") || surface === "external_directory_read") return "read";
    if (surface.endsWith("_write") || surface.endsWith("_edit")) return "edit";
  }
  if (mainLabel === "skill") return "other";
  if (mainLabel === "path" || mainLabel === "input") return "other";
  return "other";
}