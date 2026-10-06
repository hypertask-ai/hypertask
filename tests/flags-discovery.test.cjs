const assert = require("node:assert/strict");
const test = require("node:test");
const { matchesFeatureFlagSearch, relatedFeatureFlags } = require("jiti")(__filename)("../src/lib/flags/discovery.ts");

const flag = (key, extra = {}) => ({ key, ticketId: null, ticketTitle: null, description: "", ...extra });
const searchFlag = flag("htpr-6853-fast-open", {
  ticketId: "HTPR-6853", ticketTitle: "Instant ticket details", description: "Keeps the comment editor ready",
});

test("search matches numeric/prefixed tickets and every word across metadata, ignoring case and whitespace", () => {
  for (const query of ["", "  ", "6853", "HTPR-6853", "fast-open", "INSTANT details", "6853 comment", " ready  TICKET "]) {
    assert.equal(matchesFeatureFlagSearch(searchFlag, query), true, query);
  }
  for (const query of ["6854", "instant missing", "6853 unknown", "HTPR-68530"]) {
    assert.equal(matchesFeatureFlagSearch(searchFlag, query), false, query);
  }
  assert.equal(matchesFeatureFlagSearch(flag("legacy"), "legacy"), true);
  assert.equal(matchesFeatureFlagSearch(flag("legacy"), "null"), false);
});

test("related flags share an exact ticket, not a numeric substring or another project", () => {
  const a = flag("htpr-6853-first");
  const b = flag("htpr-6853-second");
  const other = [flag("htpr-68530-other"), flag("yper4-6853-other"), flag("legacy"), flag("another")];
  assert.deepEqual(relatedFeatureFlags(a, [a, b, ...other]), [b]);
  assert.deepEqual(relatedFeatureFlags(other[2], other), []);
});

test("explicit relations are bidirectional and shared registered parents link siblings", () => {
  const parent = flag("htpr-1-parent");
  const a = flag("htpr-2-child", { related: [parent.key, parent.key, "retired", "htpr-2-child"] });
  const b = flag("htpr-3-child", { related: [parent.key, "retired"] });
  const outsider = flag("htpr-4-other", { related: ["retired"] });
  const flags = [parent, a, b, outsider];
  assert.deepEqual(relatedFeatureFlags(parent, flags), [a, b]);
  assert.deepEqual(relatedFeatureFlags(a, flags), [parent, b]);
  assert.deepEqual(relatedFeatureFlags(b, flags), [parent, a]);
  assert.deepEqual(relatedFeatureFlags(outsider, flags), []);
});

test("legacy metadata can supply a ticket ID without inventing relations between missing IDs", () => {
  const a = flag("legacy-a", { ticketId: "HTPR-1" });
  const b = flag("legacy-b", { ticketId: "htpr-1" });
  assert.deepEqual(relatedFeatureFlags(a, [a, b, flag("unknown")]), [b]);
});
