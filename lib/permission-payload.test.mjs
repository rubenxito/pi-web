import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { parsePermissionRequest } = await jiti.import("./permission-payload.ts");

/** The two real dialogs from the user's pi-web session (review log, 2026-10-28). */
const OPTIONS = ["Yes", "Yes, allow reads to 3 paths for this session", "No", "No, provide reason"];

const WRITE_DIALOG = {
  type: "extension_ui_request",
  id: "perm-a",
  method: "select",
  title: [
    "Permission Required",
    "tool           : write",
    "input          : for 'permission-dialog-test.txt' (2 lines, 107 characters)",
  ].join("\n"),
  options: ["Yes", "Yes, allow write '/Users/antropoloops/code/_tools_ext/pi-web/**' for this session", "No", "No, provide reason"],
};

const BASH_EXTERNAL_DIALOG = {
  type: "extension_ui_request",
  id: "perm-b",
  method: "select",
  title: [
    "Permission Required",
    "tool                : bash",
    "surface             : external_directory_read",
    "command             : cd \"/Users/antropoloops/PycharmProjects/antropoloops_MAP_3\"",
    "                    && grep -rIl --exclude-dir=.git --exclude-dir=.venv --exclude-",
    "                    dir=node_modules",
    "                    -e \"song_page_url\" -e \"item_page_url\" -e \"USLT\" | head -20",
    "why                 : /Users/antropoloops/PycharmProjects/antropoloops_MAP_3: read",
    "                    (pure-reader command)",
    "working directory   : /Users/antropoloops/code/atpls",
    "external path       : /Users/antropoloops/PycharmProjects/antropoloops_MAP_3",
    "external path       : /Users/antropoloops/PycharmProjects/antropoloops_MAP_3/.git",
    "external path       : /Users/antropoloops/PycharmProjects/antropoloops_MAP_3/.venv",
  ].join("\n"),
  options: OPTIONS,
};

test("parses a plain write dialog into an edit-card", () => {
  const parsed = parsePermissionRequest(WRITE_DIALOG);
  assert.ok(parsed);
  assert.equal(parsed.subagent, false);
  assert.equal(parsed.tool, "write");
  assert.equal(parsed.category, "edit");
  assert.equal(parsed.mainLabel, "input");
  assert.equal(parsed.mainValue, "for 'permission-dialog-test.txt' (2 lines, 107 characters)");
  assert.deepEqual(parsed.flagged, []);
  assert.deepEqual(parsed.evidence, []);
  assert.deepEqual(parsed.details, []);
});

test("parses the bash external-directory dialog: evidence, details and flags", () => {
  const parsed = parsePermissionRequest(BASH_EXTERNAL_DIALOG);
  assert.ok(parsed);
  assert.equal(parsed.tool, "bash");
  assert.equal(parsed.surface, "external_directory_read");
  assert.equal(parsed.category, "shell");
  assert.equal(parsed.mainLabel, "command");
  assert.ok(parsed.mainValue.startsWith("cd \"/Users/antropoloops/PycharmProjects/antropoloops_MAP_3\""));
  // Continuations keep their indentation and stay inside the command block.
  assert.ok(parsed.mainValue.includes("                    && grep -rIl"));
  // The three external paths become flagged evidence, in order.
  assert.deepEqual(parsed.flagged, [
    "/Users/antropoloops/PycharmProjects/antropoloops_MAP_3",
    "/Users/antropoloops/PycharmProjects/antropoloops_MAP_3/.git",
    "/Users/antropoloops/PycharmProjects/antropoloops_MAP_3/.venv",
  ]);
  assert.equal(parsed.evidence.length, 3);
  assert.equal(parsed.evidence.every((fact) => fact.label === "external path"), true);
  // why and working directory survive as detail rows, why with its wrapped part.
  const why = parsed.details.find((fact) => fact.label === "why");
  assert.ok(why);
  assert.ok(why.value.includes("(pure-reader command)"));
  const cwd = parsed.details.find((fact) => fact.label === "working directory");
  assert.equal(cwd?.value, "/Users/antropoloops/code/atpls");
  assert.ok(!parsed.details.some((fact) => fact.label === "tool" || fact.label === "surface"));
});

test("a colon inside the why value is not read as a label separator", () => {
  const parsed = parsePermissionRequest(BASH_EXTERNAL_DIALOG);
  const why = parsed.details.find((fact) => fact.label === "why");
  assert.ok(why);
  assert.ok(why.value.startsWith("/Users/antropoloops/PycharmProjects/antropoloops_MAP_3: read"));
});

test("the subagent header variant parses with subagent: true", () => {
  const parsed = parsePermissionRequest({
    type: "extension_ui_request",
    id: "perm-c",
    method: "select",
    title: "Permission Required (Subagent)\ntool : bash\ncommand : ls",
    options: ["Yes", "No", "No, provide reason"],
  });
  assert.ok(parsed);
  assert.equal(parsed.subagent, true);
  assert.equal(parsed.category, "shell");
});

test("an unknown select (another extension) is not a permission dialog", () => {
  assert.equal(parsePermissionRequest({
    type: "extension_ui_request",
    id: "x",
    method: "select",
    title: "Pick a color",
    options: ["red", "green"],
  }), null);
  assert.equal(parsePermissionRequest({
    type: "extension_ui_request",
    id: "x",
    method: "confirm",
    title: "Permission Required\nreally?",
    options: [],
    message: "sure?",
  }), null);
  assert.equal(parsePermissionRequest({
    type: "extension_ui_request",
    id: "x",
    method: "select",
    title: "Permission Required",
    options: ["Continue", "Abort"],
  }), null);
});

test("unknown fact labels degrade to continuation text, keeping the parse", () => {
  const parsed = parsePermissionRequest({
    type: "extension_ui_request",
    id: "perm-d",
    method: "select",
    title: "Permission Required\ntool : bash\ncommand : ls\nnewlabel : something future versions add",
    options: ["Yes", "No", "No, provide reason"],
  });
  assert.ok(parsed);
  // `newlabel : …` glues onto the command value instead of failing.
  assert.ok(parsed.mainValue.includes("newlabel : something future versions add"));
});

test("session-width options (the proven/family grant) keep the parse", () => {
  const parsed = parsePermissionRequest({
    type: "extension_ui_request",
    id: "perm-e",
    method: "select",
    title: "Permission Required\ntool : edit\npath : /tmp/x.md",
    options: [
      "Yes",
      "Yes, allow edits to /tmp/x.md for this session",
      "Yes, allow reads and writes to /tmp/x.md for this session",
      "No",
      "No, provide reason",
    ],
  });
  assert.ok(parsed);
  assert.equal(parsed.category, "edit");
  assert.equal(parsed.mainLabel, "path");
});