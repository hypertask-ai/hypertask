const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { isShareHydrationError, summarizeHydrationMutation } = jiti(
  path.join(root, "src/lib/telemetry/hydrationDiagnosticsCore.ts"),
);

test("share hydration diagnostics only classify React hydration failures", () => {
  assert.equal(
    isShareHydrationError("Minified React error #418", "/share"),
    true,
  );
  assert.equal(
    isShareHydrationError("Hydration failed because HTML differed", "/share/project"),
    true,
  );
  assert.equal(isShareHydrationError("Minified React error #418", "/inbox"), false);
  assert.equal(isShareHydrationError("Request failed", "/share"), false);
});

test("mutation summaries contain structure but never text content", () => {
  const target = {
    nodeName: "DIV",
    nodeType: 1,
    id: "description",
    classList: ["tiptap", "secret-task-title"],
  };
  const addedText = {
    nodeName: "#text",
    nodeType: 3,
    textContent: "private task content",
  };

  const summary = summarizeHydrationMutation({
    type: "childList",
    target,
    addedNodes: [addedText],
    removedNodes: [],
  });

  assert.match(summary, /^children:div#id\.tiptap\.secret-task-title:/);
  assert.doesNotMatch(summary, /description/);
  assert.match(summary, /added=#text/);
  assert.doesNotMatch(summary, /private task content/);
});
