// Behavioral coverage for src/utils/helperFunctions/messageHtmlLinks.ts, the
// module Agent Chat's reply rendering (HTPR-6038) and AI Chat's MessageItem
// both now share for table-scroll wrapping and internal-link/task-mention
// click interception.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const source = fs.readFileSync(
  path.join(__dirname, "../src/utils/helperFunctions/messageHtmlLinks.ts"),
  "utf8",
);

const javascript = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

function loadModule() {
  // `MouseEvent` is imported type-only, so it's erased by transpileModule
  // and no mock require is needed here (same as tests/message-links.test.cjs).
  const mod = { exports: {} };
  new Function("module", "exports", "require", javascript)(
    mod,
    mod.exports,
    require,
  );
  return mod.exports;
}

const { wrapTablesInMessageHtml, interceptMessageLinkClick } = loadModule();

// interceptMessageLinkClick resolves hrefs against window.location.origin
// (a browser global); stub the minimum it reads/writes for a Node test run.
global.window = { location: { origin: "http://localhost", href: "" } };

test("wrapTablesInMessageHtml wraps a top-level table in a scroll container", () => {
  const html = "<p>before</p><table><tr><td>x</td></tr></table><p>after</p>";
  const wrapped = wrapTablesInMessageHtml(html);
  assert.match(wrapped, /<div class="message-table-scroll"><table>/);
  assert.match(wrapped, /<\/table><\/div>/);
});

test("wrapTablesInMessageHtml is a no-op on html with no table", () => {
  const html = "<p>no tables here</p>";
  assert.equal(wrapTablesInMessageHtml(html), html);
});

test("wrapTablesInMessageHtml does not double-wrap on a second pass", () => {
  const once = wrapTablesInMessageHtml("<table><tr><td>x</td></tr></table>");
  assert.equal(wrapTablesInMessageHtml(once), once);
});

function fakeEvent(target) {
  return { target, preventDefault: () => {} };
}

function fakeAnchor(href) {
  return {
    tagName: "A",
    getAttribute: (name) => (name === "href" ? href : null),
  };
}

function fakeTaskMention(projectId, uniqueIndex) {
  const attrs = {
    "data-type": "mention",
    "data-label": "task",
    projectId: String(projectId),
    uniqueIndex: String(uniqueIndex),
  };
  return {
    tagName: "SPAN",
    getAttribute: (name) => attrs[name] ?? null,
  };
}

test("interceptMessageLinkClick routes an internal same-origin link through the router", () => {
  const pushed = [];
  const router = { push: (href) => pushed.push(href) };
  interceptMessageLinkClick(
    fakeEvent(fakeAnchor("http://localhost/detail/project-15/6038")),
    router,
  );
  assert.deepEqual(pushed, ["/detail/project-15/6038"]);
});

test("interceptMessageLinkClick routes a task-mention span to its ticket", () => {
  const pushed = [];
  const router = { push: (href) => pushed.push(href) };
  interceptMessageLinkClick(fakeEvent(fakeTaskMention(15, 6038)), router);
  assert.deepEqual(pushed, ["/detail/project-15/6038"]);
});

test("interceptMessageLinkClick calls the optional onNavigate hook only on a routed navigation", () => {
  let navigated = 0;
  const router = { push: () => {} };
  interceptMessageLinkClick(
    fakeEvent(fakeAnchor("http://localhost/detail/project-15/6038")),
    router,
    () => navigated++,
  );
  assert.equal(navigated, 1);
  // A plain click (no anchor/mention target) never fires it.
  interceptMessageLinkClick(fakeEvent({ tagName: "SPAN", getAttribute: () => null }), router, () => navigated++);
  assert.equal(navigated, 1);
});

test("interceptMessageLinkClick leaves an external link to the browser (no router.push)", () => {
  const pushed = [];
  const router = { push: (href) => pushed.push(href) };
  interceptMessageLinkClick(fakeEvent(fakeAnchor("https://example.com/x")), router);
  assert.deepEqual(pushed, []);
});
