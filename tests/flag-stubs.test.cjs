const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { Linter } = require("eslint");
const parser = require("@typescript-eslint/parser");
const { createJiti } = require("jiti");
const { root } = require("./helpers/loadModule.cjs");

const load = createJiti(__filename, { interopDefault: true });
const { stubFlags } = load(path.join(__dirname, "helpers/flags.ts"));
const realDefinitions = () => require("./helpers/flag-files.cjs").definitions();
const config = import("../eslint-local-rules/flag-stubs.mjs");
const realKey = "htpr-7582-agent-access-request";

async function lint(code, file = "tests/new-flag-list.test.cjs") {
  const { flagStubsLintConfig } = await config;
  return new Linter({ cwd: root }).verify(code, [{ ...flagStubsLintConfig, languageOptions: { parser } }], { filename: path.join(root, file) });
}

test("stubFlags carries every real definition, so a new flag needs no test edit", () => {
  const stub = stubFlags().FEATURE_FLAG_DEFINITIONS;
  assert.deepEqual(stub.map((definition) => definition.key), realDefinitions().map((definition) => definition.key));
  assert.ok(stub.length > 0);
});

test("an override changes only the named fields and keeps the real definition", () => {
  const real = realDefinitions();
  const changed = stubFlags({ [realKey]: { defaultMode: "EVERYONE" } }).FEATURE_FLAG_DEFINITIONS;
  assert.deepEqual(changed.find((definition) => definition.key === realKey), { ...real.find((definition) => definition.key === realKey), defaultMode: "EVERYONE" });
  assert.deepEqual(changed.filter((definition) => definition.key !== realKey), real.filter((definition) => definition.key !== realKey));
});

test("an unknown or retired key fails loudly instead of passing a stale test", () => {
  assert.throws(
    () => stubFlags({ "htpr-0-retired": { defaultMode: "EVERYONE" } }),
    /htpr-0-retired is not a flag in src\/lib\/flags\/definitions/,
  );
});

test("a new hand-made flag list fails lint with a message naming the helper", async () => {
  const messages = await lint('const stub = { "@/lib/flags/definitions": { FEATURE_FLAG_DEFINITIONS: [{ key: "htpr-1-new" }] } };\n');
  assert.deepEqual(messages.map((message) => message.message), [
    "Use tests/helpers/flags.ts (stubFlags) instead of a hand-made flag list. A new flag then needs no test edit, and a renamed key fails loudly.",
  ]);
});

test("the helper and lists built from real definitions pass lint", async () => {
  assert.equal((await lint(`const stub = stubFlags({ "${realKey}": { defaultMode: "EVERYONE" } });\n`)).length, 0);
  assert.equal((await lint("const stub = { FEATURE_FLAG_DEFINITIONS: [definition.default] };\n")).length, 0);
  assert.equal((await lint("const stub = { FEATURE_FLAG_DEFINITIONS: [] };\n")).length, 0);
});

test("a grandfathered file keeps its one existing list and fails on a second", async () => {
  const file = "tests/htpr-7132-cold-start.test.cjs";
  assert.equal((await lint('const stub = { FEATURE_FLAG_DEFINITIONS: [{ key: "fixture" }] };\n', file)).length, 0);
  const messages = await lint('const one = { FEATURE_FLAG_DEFINITIONS: [{ key: "fixture" }] };\nconst two = { FEATURE_FLAG_DEFINITIONS: [{ key: "other" }] };\n', file);
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /tests\/helpers\/flags\.ts \(stubFlags\)/);
});

test("a hand mock of the flag module fails lint outside the helper", async () => {
  const messages = await lint('vi.mock("@/lib/flags", () => ({ isFeatureEnabled: async () => true }));\n');
  assert.deepEqual(messages.map((message) => message.message), [
    "Use tests/helpers/flags.ts (stubFlags) instead of mocking src/lib/flags by hand.",
  ]);
  assert.equal((await lint('jest.mock("@/lib/flags/definitions", () => ({}));\n')).length, 1);
  assert.equal((await lint('vi.mock("@/lib/flags", () => ({}));\n', "tests/helpers/flags.ts")).filter((message) => message.severity === 2).length, 0);
});
