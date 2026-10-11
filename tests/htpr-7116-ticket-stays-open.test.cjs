// HTPR-7116: a ticket opened on a phone must not vanish when its late panels load.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { fsCache: false, interopDefault: true, alias: { "@": path.join(root, "src") } });
const hook = fs.readFileSync(path.join(root, "src/hooks/Task Detail/useTaskDetailGlobalStates.ts"), "utf8");

test("the late panels mount in a transition when the flag is on, urgently when off", () => {
  assert.match(hook, /const ticketStaysOpen = useFlag\(HTPR_7116_TICKET_STAYS_OPEN_FLAG\);/);
  assert.match(hook, /ticketStaysOpen\s*\?\s*\(\) => startTransition\(\(\) => setSecondaryPanelsReady\(true\)\)\s*:\s*\(\) => setSecondaryPanelsReady\(true\)/);
  // No other path may flip the panels on outside the flagged choice.
  assert.equal(hook.match(/setSecondaryPanelsReady\(true\)/g).length, 2);
});

test("flag is a bugfix, default Everyone, with release risk", () => {
  const def = jiti(path.join(root, "src/lib/flags/definitions/htpr-7116-ticket-stays-open.ts"));
  assert.equal(def.default.key, "htpr-7116-ticket-stays-open");
  assert.equal(def.default.kind, "bugfix");
  assert.equal(def.default.defaultMode, undefined);
  assert.ok(def.default.releaseRisk);
});

// The mechanism the fix relies on: React keeps an already shown Suspense boundary on
// screen while a transition suspends, but hides it for an urgent update.
test("react keeps a shown boundary for a suspending transition and hides it for an urgent update", async () => {
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM("<!doctype html><div id=root></div>");
  // Left installed: React's scheduler may still tick after the test (own process per file).
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  {
    const React = require("react");
    const { createRoot } = require("react-dom/client");
    const run = async (useTransition) => {
      let resolve;
      const chunk = new Promise((r) => { resolve = r; });
      const Editor = React.lazy(() => chunk);
      let reveal;
      function Ticket() {
        const [ready, setReady] = React.useState(false);
        reveal = () => (useTransition ? React.startTransition(() => setReady(true)) : setReady(true));
        return React.createElement("div", { id: "ticket" }, "Title", ready ? React.createElement(Editor) : null);
      }
      const container = document.createElement("div");
      const root = createRoot(container);
      await React.act(async () => {
        root.render(React.createElement(React.Suspense, { fallback: null }, React.createElement(Ticket)));
      });
      await React.act(async () => { reveal(); });
      const ticket = container.querySelector("#ticket");
      const hidden = !ticket || ticket.style.display === "none";
      await React.act(async () => { resolve({ default: () => React.createElement("span", null, "editor") }); await chunk; });
      root.unmount();
      return hidden;
    };
    assert.equal(await run(false), true, "urgent update re-hides the shown ticket (the bug)");
    assert.equal(await run(true), false, "transition keeps the shown ticket (the fix)");
  }
});
