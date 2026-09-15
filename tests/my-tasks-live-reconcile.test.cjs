const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/board-realtime-reconciliation-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const {
  buildMyTasksListUrl,
  createMyTasksReconcileRunner,
  parseMyTasksListPayload,
} = jiti(path.join(root, "src/lib/myTasks/reconcileMyTasks.ts"));

test("my-tasks reconcile drops stale responses", async () => {
  assert.equal(buildMyTasksListUrl(["assigned"]), "/api/my-tasks?scopes=assigned");
  assert.equal(parseMyTasksListPayload({ tabs: ["All"] }), null);
  const applied = [];
  let resolveFirst;
  let n = 0;
  const runner = createMyTasksReconcileRunner({
    fetchList: (signal) => {
      n += 1;
      if (n === 1) {
        return new Promise((resolve, reject) => {
          resolveFirst = () =>
            signal.aborted
              ? reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
              : resolve({
                  sections: [{ id: "old" }],
                  tabs: ["All"],
                  boards: [],
                  accessibleProjectIds: [1],
                });
          signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        });
      }
      return Promise.resolve({
        sections: [{ id: "new" }],
        tabs: ["All"],
        boards: [],
        accessibleProjectIds: [2],
      });
    },
    apply: (payload) => applied.push(payload.sections[0].id),
  });
  runner.request();
  await Promise.resolve();
  runner.request();
  resolveFirst();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(applied, ["old", "new"]);
});
