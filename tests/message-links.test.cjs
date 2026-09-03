const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const source = fs.readFileSync(
  path.join(__dirname, "../src/lib/agents/messageLinks.ts"),
  "utf8",
);

const javascript = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

function loadMessageLinksModule() {
  // Same load mechanism as the repo's other colocated-TS tests (see
  // tests/accounts.test.cjs): run the transpiled output in this realm via
  // `new Function`, not a vm sandbox, so the arrays it returns are ordinary
  // Arrays as far as assert.deepEqual is concerned. messageLinks.ts has no
  // imports of its own, so no mock require is needed.
  const messageLinksModule = { exports: {} };
  new Function("module", "exports", "require", javascript)(
    messageLinksModule,
    messageLinksModule.exports,
    require,
  );
  return messageLinksModule.exports;
}

const { tokenizeMessageLinks, extractMessageLinks } = loadMessageLinksModule();

test("tokenizeMessageLinks links a bare URL", () => {
  assert.deepEqual(tokenizeMessageLinks("see https://example.com/x for it"), [
    { type: "text", value: "see " },
    { type: "link", value: "https://example.com/x", href: "https://example.com/x" },
    { type: "text", value: " for it" },
  ]);
});

test("tokenizeMessageLinks links a ticket id only when the prefix resolves", () => {
  const resolver = (prefix) => (prefix === "HTPR" ? 15 : undefined);
  assert.deepEqual(tokenizeMessageLinks("fixed in HTPR-6033 today", resolver), [
    { type: "text", value: "fixed in " },
    {
      type: "link",
      value: "HTPR-6033",
      href: "https://app.hypertask.ai/detail/project-15/6033",
    },
    { type: "text", value: " today" },
  ]);
});

test("tokenizeMessageLinks leaves an unresolved ticket id as plain text", () => {
  const resolver = (prefix) => (prefix === "HTPR" ? 15 : undefined);
  assert.deepEqual(tokenizeMessageLinks("see ABCX-1", resolver), [
    { type: "text", value: "see ABCX-1" },
  ]);
});

test("tokenizeMessageLinks strips trailing sentence punctuation off a URL", () => {
  assert.deepEqual(tokenizeMessageLinks("check https://example.com/x."), [
    { type: "text", value: "check " },
    { type: "link", value: "https://example.com/x", href: "https://example.com/x" },
    { type: "text", value: "." },
  ]);
  assert.deepEqual(tokenizeMessageLinks("really? https://example.com/x!"), [
    { type: "text", value: "really? " },
    { type: "link", value: "https://example.com/x", href: "https://example.com/x" },
    { type: "text", value: "!" },
  ]);
});

test("tokenizeMessageLinks passes plain text through unchanged", () => {
  assert.deepEqual(tokenizeMessageLinks("just plain text"), [
    { type: "text", value: "just plain text" },
  ]);
});

test("extractMessageLinks returns hrefs only, in reading order", () => {
  const resolver = (prefix) => (prefix === "HTPR" ? 15 : undefined);
  assert.deepEqual(
    extractMessageLinks("HTPR-1 then https://a.test then HTPR-2", resolver),
    [
      "https://app.hypertask.ai/detail/project-15/1",
      "https://a.test",
      "https://app.hypertask.ai/detail/project-15/2",
    ],
  );
});
