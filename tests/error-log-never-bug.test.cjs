const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false });
const { withholdBugFromErrorLog } = load(path.join(root, "src/lib/ai/labelClassifierOutput.ts"));

const values = new Map([["bug", "Bug"], ["other", "Billing"]]);

test("a ticket carrying Error Log never gets Bug", () => {
  assert.deepEqual(withholdBugFromErrorLog(["bug", "other"], values, ["Error Log"]), ["other"]);
  assert.deepEqual(withholdBugFromErrorLog(["bug"], values, ["error log", "High"]), []);
});

test("a normal bug report still gets Bug", () => {
  assert.deepEqual(withholdBugFromErrorLog(["bug", "other"], values, []), ["bug", "other"]);
  assert.deepEqual(withholdBugFromErrorLog(["bug"], values, ["Feature"]), ["bug"]);
});
