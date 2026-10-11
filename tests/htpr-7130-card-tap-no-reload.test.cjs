// HTPR-7130: a phone tap on a server-painted board card before React hydrated
// it followed the plain link and reloaded the whole page.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM, VirtualConsole } = require("jsdom");
const { createRefactoredModuleRequire } = require("./refactored-module-require.cjs");

const ROOT = path.join(__dirname, "..");
const pushed = [];
const load = createRefactoredModuleRequire(ROOT, {
  "next/navigation": { useRouter: () => ({ push: (href) => pushed.push(href) }) },
});
const { buildPendingTaskTapScript, consumePendingTaskTap } = load("./src/lib/firstScreen/pendingTaskTap.ts");

function boardDocument(fallbackMs) {
  // jsdom reports location.assign as "not implemented: navigation"; that report is the fallback call.
  const virtualConsole = new VirtualConsole();
  const navigations = [];
  virtualConsole.on("jsdomError", (error) => { if (/navigation/i.test(error.message)) navigations.push(error.message); });
  const dom = new JSDOM(
    `<div id="task-1"><a id="card" href="/detail/project-15/1"><p id="title">Card</p></a></div>` +
      `<div id="other"><a id="plain" href="/detail/project-15/2">Elsewhere</a></div>`,
    { url: "https://app.hypertask.ai/project?id=15", runScripts: "outside-only", virtualConsole },
  );
  dom.window.eval(buildPendingTaskTapScript(fallbackMs));
  dom.navigations = navigations;
  return dom;
}

const tap = (dom, id, init = {}) => {
  const event = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  dom.window.document.getElementById(id).dispatchEvent(event);
  return event;
};

const nextTask = (dom) => new Promise((resolve) => dom.window.setTimeout(resolve, 0));

test("a tap on a card link React has not hydrated is held instead of reloading the page", async () => {
  const dom = boardDocument();
  let announced = 0;
  dom.window.addEventListener("ht-pending-task-tap", () => announced++);
  // React's root listener stops a click it cannot hydrate for yet, but leaves the link's default action.
  dom.window.document.addEventListener("click", (e) => e.stopPropagation(), true);
  const event = tap(dom, "title");
  assert.equal(event.defaultPrevented, true, "the native link navigation (full page load) must not run");
  await nextTask(dom);
  assert.equal(announced, 1);
  assert.equal(consumePendingTaskTap(dom.window), "/detail/project-15/1");
  assert.equal(consumePendingTaskTap(dom.window), null, "a held tap opens once");
});

test("hydrated cards, clicks React handles, modifier clicks and non-card links are left alone", async () => {
  const dom = boardDocument();
  const card = dom.window.document.getElementById("card");
  card["__reactProps$test"] = {};
  assert.equal(tap(dom, "title").defaultPrevented, false);
  delete card["__reactProps$test"];
  assert.equal(tap(dom, "title", { metaKey: true }).defaultPrevented, false, "open in new tab still works");
  assert.equal(tap(dom, "plain").defaultPrevented, false);
  // React hydrates the card synchronously during the click and its own handler opens the ticket.
  dom.window.document.addEventListener("click", (e) => { card["__reactProps$test"] = {}; e.preventDefault(); }, true);
  let announced = 0;
  dom.window.addEventListener("ht-pending-task-tap", () => announced++);
  tap(dom, "title");
  await nextTask(dom);
  assert.equal(announced, 0);
  assert.equal(consumePendingTaskTap(dom.window), null, "a click the app already handled is not opened twice");
});

const wait = (dom, ms) => new Promise((resolve) => dom.window.setTimeout(resolve, ms));
const blockedByReact = (dom) => dom.window.document.addEventListener("click", (e) => e.stopPropagation(), true);

test("if the app never opens the held tap, it falls back to loading the ticket the old way once", async () => {
  const dom = boardDocument(30);
  blockedByReact(dom);
  tap(dom, "title");
  tap(dom, "title"); // a second tap while one is held must not stack a second fallback
  await wait(dom, 80);
  assert.equal(dom.navigations.length, 1, "exactly one fallback navigation");
  assert.equal(consumePendingTaskTap(dom.window), null, "the fallback clears the held tap");
});

test("no fallback navigation once the replay consumed the held tap", async () => {
  const dom = boardDocument(30);
  blockedByReact(dom);
  tap(dom, "title");
  assert.equal(consumePendingTaskTap(dom.window), "/detail/project-15/1");
  await wait(dom, 80);
  assert.equal(dom.navigations.length, 0);
});

test("the held tap opens the ticket with a client navigation once the app has started", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://app.hypertask.ai/project?id=15" });
  const previous = new Map(["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const Replay = load("./src/lib/firstScreen/PendingTaskTapReplay.tsx").default;
  pushed.length = 0;
  dom.window.__htPendingTaskTap = "/detail/project-15/1";
  const root = createRoot(dom.window.document.getElementById("root"));
  try {
    await React.act(async () => root.render(React.createElement(Replay)));
    assert.deepEqual(pushed, ["/detail/project-15/1"]);
    dom.window.__htPendingTaskTap = "/detail/project-15/3";
    await React.act(async () => dom.window.dispatchEvent(new dom.window.Event("ht-pending-task-tap")));
    assert.deepEqual(pushed, ["/detail/project-15/1", "/detail/project-15/3"]);
  } finally {
    await React.act(async () => root.unmount());
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  }
});

test("the root layout installs the hold and replay only behind the HTPR-7130 flag", () => {
  const layout = fs.readFileSync(path.join(ROOT, "src/app/layout.tsx"), "utf8");
  assert.match(layout, /boardDocument\?\.flags\.values\[HTPR_7130_CARD_TAP_NO_RELOAD_FLAG\] === true/);
  assert.match(layout, /holdEarlyCardTap && \(\s*<script id="ht-pending-task-tap"/);
  assert.match(layout, /holdEarlyCardTap && <PendingTaskTapReplay \/>/);
});
