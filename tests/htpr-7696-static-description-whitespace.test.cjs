const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const shell = fs.readFileSync(
  path.join(root, "src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/StaticDescriptionShell.tsx"),
  "utf8"
);
const editorStyles = fs.readFileSync(path.join(root, "src/styles/tiptap.module.scss"), "utf8");
const seed = fs.readFileSync(path.join(root, "scripts/seed-browser-smoke.mjs"), "utf8");
const layoutLock = fs.readFileSync(path.join(root, "e2e/smoke/layout-lock.spec.ts"), "utf8");

test("the static first paint collapses stored newlines the way the editor parser does", () => {
  const rootStyle = /const PROSEMIRROR_ROOT_STYLE[\s\S]*?\n};/.exec(shell)?.[0] ?? "";
  assert.match(rootStyle, /whiteSpace: "normal"/);
  assert.doesNotMatch(rootStyle, /break-spaces|pre-wrap|pre-line/);
});

test("code blocks keep their own line breaks in the static first paint", () => {
  assert.match(shell, /styles\.hellow/);
  assert.match(editorStyles, /pre \{[^}]*white-space: pre-wrap;/);
});

test("browser smoke seeds an agent-style description and pins its first-paint height", () => {
  assert.match(seed, /suffix: "agentdesc",\s*descriptionHtml: \[[\s\S]*?\\n[\s\S]*?\]\.join\("\\n\\n"\)/);
  assert.match(seed, /agentDescriptionDetailPath/);
  assert.match(layoutLock, /an agent-written description keeps its height from first paint to the live editor/);
});
