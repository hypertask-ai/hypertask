const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const { createJiti } = require("jiti");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
  moduleCache: false,
});

// HTPR-6166: a board realtime event used to refetch the whole ["projectsAll"]
// list (every board the user belongs to) on a change to just one board -
// measured p75 1.6s in production. This pins the fix: only the changed
// project's cache entry is written.

test("patchProjectIntoCache writes only the target project's entry, leaving siblings untouched", () => {
  const { patchProjectIntoCache } = jiti(
    path.join(root, "src/utils/api/Homepage/index.ts"),
  );

  const other = { id: 16, tasks: [{ id: 1 }], section: [] };
  const target = { id: 15, tasks: [], section: [], project_view: null };
  const store = {
    projectsAll: { updatedProjects: [target, other] },
  };
  const queryClient = {
    getQueryData: (key) => store[key[0]],
    setQueryData: (key, value) => {
      store[key[0]] = value;
    },
  };

  const payload = {
    project: { id: 15, title: "Renamed", section: [] },
    tasks: [{ id: 99 }],
    allViews: [],
  };
  const patched = patchProjectIntoCache(queryClient, 15, payload);

  assert.equal(patched.title, "Renamed");
  assert.deepEqual(
    patched.tasks.map((t) => t.id),
    [99],
  );
  // The sibling project's own object reference must be untouched - no
  // whole-list rebuild/refetch happened.
  assert.equal(store.projectsAll.updatedProjects[1], other);
  assert.equal(store.projectsAll.updatedProjects[0].id, 15);
});

test("HTPR-6166: the scoped board realtime path never calls reconcileActiveBoardQuery (the unscoped ['projectsAll'] refetch)", () => {
  const src = fs.readFileSync(
    path.join(root, "src/hooks/realtime/useBoardRealtime.ts"),
    "utf8",
  );
  const scopedBranch = src.match(
    /: \(\) =>\s*Promise\.all\(\[\s*queryClient\s*\.fetchQuery\(\{[\s\S]{0,800}?\]\)\.then\(\(\) => undefined\);/,
  );
  assert.ok(scopedBranch, "expected the userId-present reconcile branch to exist");
  assert.ok(
    !/reconcileActiveBoardQuery/.test(scopedBranch[0]),
    "the scoped path must not call reconcileActiveBoardQuery (refetches the whole projectsAll list)",
  );
  assert.ok(
    /fetchBoardTasks\(projectId, userId\)/.test(scopedBranch[0]) &&
      /patchProjectIntoCache\(queryClient, projectId, payload\)/.test(scopedBranch[0]),
    "expected the scoped path to fetch just this project's tasks and patch just its cache entry",
  );
});
