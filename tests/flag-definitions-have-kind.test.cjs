const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const folder = path.join(__dirname, "..", "src", "lib", "flags", "definitions");
const files = fs.readdirSync(folder).filter((name) => name.endsWith(".ts") && !name.startsWith("index"));

// HTPR-7084: these flags used to be shown as Bug through a display-only list. Their effective
// default must stay Owner and QA when no saved row exists.
const FORMERLY_LEGACY = [
  "5906", "5908", "6112", "6177", "6951", "6421", "6407", "6512",
  "6516", "6553", "6278", "6372", "6363", "6197", "6154", "6141", "6911",
];

test("every flag definition declares its kind", () => {
  assert.ok(files.length > 0);
  const missing = files.filter((name) => !/^\s{2}kind:\s*"(feature|bugfix|improvement)",$/m.test(fs.readFileSync(path.join(folder, name), "utf8")));
  assert.deepEqual(missing, []);
});

test("formerly legacy flags keep the Owner and QA default", () => {
  for (const number of FORMERLY_LEGACY) {
    const name = files.find((file) => file.startsWith(`htpr-${number}-`));
    assert.ok(name, number);
    const source = fs.readFileSync(path.join(folder, name), "utf8");
    if (/kind:\s*"bugfix"/.test(source)) {
      assert.match(source, /defaultMode:\s*"OWNER_AND_QA"/, name);
    } else {
      assert.doesNotMatch(source, /defaultMode:\s*"EVERYONE"/, name);
    }
  }
});

test("flags.ts no longer forces legacy display kinds", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "flags.ts"), "utf8");
  assert.doesNotMatch(source, /LEGACY_BUGFIX_DISPLAY_KINDS/);
});
