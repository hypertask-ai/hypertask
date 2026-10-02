// HTPR-6818: /detail URLs without a ticket number redirect in the proxy, before
// the page streams, so React never reports error #419 for them.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });
const { detailWithoutTicketRedirect } = jiti(path.join(root, "src/lib/routing/detailWithoutTicket.ts"));

test("detail URLs without a ticket number go to their board", () => {
  assert.equal(detailWithoutTicketRedirect("/detail/project-5515"), "/project?id=5515");
  assert.equal(detailWithoutTicketRedirect("/detail/project-15/"), "/project?id=15");
  assert.equal(detailWithoutTicketRedirect("/detail/project-15/abc"), "/project?id=15");
  assert.equal(detailWithoutTicketRedirect("/detail/project-abc/12"), "/");
  assert.equal(detailWithoutTicketRedirect("/detail/"), "/");
});

test("real ticket URLs and other routes pass through", () => {
  assert.equal(detailWithoutTicketRedirect("/detail/project-15/6818"), null);
  assert.equal(detailWithoutTicketRedirect("/detail/project-15/6818/comments"), null);
  assert.equal(detailWithoutTicketRedirect("/project"), null);
  assert.equal(detailWithoutTicketRedirect("/details/project-15"), null);
});

test("the proxy applies the redirect before its other branches", () => {
  const source = fs.readFileSync(path.join(root, "src/proxy.ts"), "utf8");
  const call = source.indexOf("detailWithoutTicketRedirect(currentPath)");
  assert.notEqual(call, -1);
  assert.ok(call < source.indexOf("mcp.hypertask.ai"), "redirect must run before host and auth branches");
});
