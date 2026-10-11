// Compact regression pins for the HTPR-6968 route tests (HTPR-6992).
// Each test records the full value it observed (response, effects, state) under a
// group, usually the route. After the file's tests finish, every group's values are
// hashed and compared with tests/fixtures/htpr-6992-pins/<name>.json, which holds one
// short digest per group. The digests were taken from the values the retired handlers
// produced, so a mismatch means the shared handler's behaviour changed.
// Re-record after an intended change: UPDATE_HTPR_6992_PINS=1 node --test <file>
// Debug a mismatch: HTPR_6992_PINS_DUMP=<dir> writes the observed values per group.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { after } = require("node:test");

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function digestOf(entries) {
  const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return crypto.createHash("sha256").update(JSON.stringify(canonical(sorted))).digest("hex").slice(0, 16);
}

function pins(name) {
  const file = path.join(__dirname, "..", "fixtures", "htpr-6992-pins", `${name}.json`);
  const update = Boolean(process.env.UPDATE_HTPR_6992_PINS);
  const groups = new Map();
  after(() => {
    const actual = Object.fromEntries([...groups].sort(([a], [b]) => (a < b ? -1 : 1)).map(([group, entries]) => [group, digestOf(entries)]));
    if (process.env.HTPR_6992_PINS_DUMP) {
      fs.mkdirSync(process.env.HTPR_6992_PINS_DUMP, { recursive: true });
      fs.writeFileSync(path.join(process.env.HTPR_6992_PINS_DUMP, `${name}.json`), JSON.stringify(Object.fromEntries(groups), null, 1));
    }
    if (update) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(actual, null, 1) + "\n");
      return;
    }
    assert.deepEqual(actual, JSON.parse(fs.readFileSync(file, "utf8")), `pinned behaviour changed (${name})`);
  });
  return function pin(group, key, value) {
    const plain = JSON.parse(JSON.stringify(value === undefined ? null : value));
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push([key, plain]);
    return plain;
  };
}

module.exports = { pins, digestOf };
