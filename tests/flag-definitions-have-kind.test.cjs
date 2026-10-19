const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const folder = path.join(__dirname, "..", "src", "lib", "flags", "definitions");
const files = fs.readdirSync(folder).filter((name) => name.endsWith(".ts") && !name.startsWith("index"));

// HTPR-7084 changed display-only kinds into real kinds without releasing missing rows.
// Derive surviving legacy flags from an immutable registry snapshot; removals never edit it.
const { defaultModes } = require("./fixtures/legacy-flag-defaults.json");

function assertLegacyDefaults(definitions) {
  for (const [name, source] of definitions) {
    const expected = defaultModes[name.replace(/\.ts$/, "")];
    if (!expected) continue;
    const explicit = /defaultMode:\s*"(\w+)"/.exec(source)?.[1];
    const effective = explicit ?? (/kind:\s*"bugfix"/.test(source) ? "EVERYONE" : "OWNER_AND_QA");
    assert.equal(effective, expected, name);
  }
}

test("every flag definition declares its kind", () => {
  assert.ok(files.length > 0);
  const missing = files.filter((name) => !/^\s{2}kind:\s*"(feature|bugfix|improvement|internal)",$/m.test(fs.readFileSync(path.join(folder, name), "utf8")));
  assert.deepEqual(missing, []);
});

test("surviving legacy flags keep their historical Owner and QA default", () => {
  assertLegacyDefaults(files.map((name) => [name, fs.readFileSync(path.join(folder, name), "utf8")]));
});

test("legacy default protection ignores removed definitions but rejects accidental releases", () => {
  const name = `${Object.keys(defaultModes)[0]}.ts`;
  assertLegacyDefaults([]);
  assertLegacyDefaults([[name, 'kind: "feature",']]);
  assertLegacyDefaults([[name, 'kind: "bugfix", defaultMode: "OWNER_AND_QA",']]);
  assert.throws(() => assertLegacyDefaults([[name, 'kind: "bugfix",']]), assert.AssertionError);
  assert.throws(() => assertLegacyDefaults([[name, 'kind: "feature", defaultMode: "EVERYONE",']]), assert.AssertionError);
});

test("flags.ts no longer forces legacy display kinds", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "flags.ts"), "utf8");
  assert.doesNotMatch(source, /LEGACY_BUGFIX_DISPLAY_KINDS/);
});
