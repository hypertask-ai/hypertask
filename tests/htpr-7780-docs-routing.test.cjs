const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { load } = require("./helpers/flag-files.cjs");

const root = path.resolve(__dirname, "..");
const toolLoad = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false });

test("Docs routing improvement defaults to Everyone with a small reversible risk", () => {
  const definition = load("src/lib/flags/definitions/htpr-7780-docs-routing.ts");
  assert.equal(definition.key, "htpr-7780-docs-routing");
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason);
});

test("the help-docs guidance exists only while the flag is on", () => {
  const { createSearchHelpDocsTool } = toolLoad(path.join(root, "src/lib/ai/tools/searchHelpDocs.ts"));
  const context = (docsRoutingEnabled) => ({ docsRoutingEnabled, sendStatus: () => {} });
  const on = createSearchHelpDocsTool(context(true)).search_help_docs.description;
  const off = createSearchHelpDocsTool(context(false)).search_help_docs.description;
  assert.match(on, /Call before answering product, plan, price, limit, shortcut or setup questions/);
  assert.equal(on.replace(/ Call before answering[\s\S]*$/, ""), off);
  assert.doesNotMatch(off, /Call before answering/);
});
