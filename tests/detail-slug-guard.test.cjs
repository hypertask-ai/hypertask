const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const { parseDetailSlug } = jiti(
  path.join(root, "src/utils/controllers/taskDetail/load.ts")
);

// A detail URL missing its ticket number used to reach Prisma as
// `uniqueIndex: NaN`, which Prisma rejects outright rather than matching
// nothing — so /detail/project-15 answered 500 instead of showing anything
// (HTPR-4838). Nothing may reach the query without both ids.
test("a slug with no ticket number never becomes a query", () => {
  assert.equal(parseDetailSlug(["project-15"]), null);
  assert.equal(parseDetailSlug(["project-15", ""]), null);
  assert.equal(parseDetailSlug(["project-15", "not-a-number"]), null);
  assert.equal(parseDetailSlug([]), null);
  assert.equal(parseDetailSlug(undefined), null);
});

test("a slug with no board id never becomes a query", () => {
  assert.equal(parseDetailSlug(["", "4838"]), null);
  assert.equal(parseDetailSlug(["project-", "4838"]), null);
  assert.equal(parseDetailSlug(["notaboard", "4838"]), null);
});

test("a real ticket URL still resolves to both ids", () => {
  assert.deepEqual(parseDetailSlug(["project-15", "4838"]), {
    projectId: 15,
    uniqueIndex: 4838,
  });
});
