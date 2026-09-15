const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(
  path.join(root, "tests/my-tasks-live-reconcile-entry.cjs"),
  {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  },
);

const {
  buildMyTasksListUrl,
  createMyTasksReconcileRunner,
  parseMyTasksListPayload,
} = jiti(path.join(root, "src/lib/myTasks/reconcileMyTasks.ts"));

const { createMyTasksRealtimeEventHandler } = jiti(
  path.join(root, "src/hooks/realtime/useMyTasksRealtime.ts"),
);

test("buildMyTasksListUrl encodes scopes for the list API", () => {
  assert.equal(buildMyTasksListUrl(), "/api/my-tasks");
  assert.equal(
    buildMyTasksListUrl(["assigned", "created"]),
    "/api/my-tasks?scopes=assigned%2Ccreated",
  );
});

test("parseMyTasksListPayload requires sections and tabs", () => {
  assert.equal(parseMyTasksListPayload(null), null);
  assert.equal(parseMyTasksListPayload({ tabs: ["All"] }), null);
  assert.deepEqual(
    parseMyTasksListPayload({
      sections: [],
      tabs: ["All"],
      boards: [{ id: 1 }],
      accessibleProjectIds: [1, 2, "x"],
    }),
    {
      sections: [],
      tabs: ["All"],
      boards: [{ id: 1 }],
      accessibleProjectIds: [1, 2],
    },
  );
});

test("createMyTasksRealtimeEventHandler forwards board events to refresh", () => {
  const calls = [];
  const handler = createMyTasksRealtimeEventHandler((trigger) => {
    calls.push(trigger);
  });
  handler();
  assert.deepEqual(calls, ["event"]);
});

test("reconcile runner rejects a stale response when a newer request starts", async () => {
  const applied = [];
  let resolveFirst;
  const firstPayload = {
    sections: [{ id: "old" }],
    tabs: ["All"],
    boards: [],
    accessibleProjectIds: [1],
  };
  const secondPayload = {
    sections: [{ id: "new" }],
    tabs: ["All"],
    boards: [],
    accessibleProjectIds: [1, 2],
  };

  let fetchCount = 0;
  const runner = createMyTasksReconcileRunner({
    fetchList: (signal) => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return new Promise((resolve, reject) => {
          resolveFirst = () => {
            if (signal.aborted) {
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
              return;
            }
            resolve(firstPayload);
          };
          signal.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        });
      }
      return Promise.resolve(secondPayload);
    },
    apply: (payload) => applied.push(payload.sections[0].id),
  });

  runner.request();
  await Promise.resolve();
  runner.request();
  resolveFirst();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(applied, ["new"]);
});

test("reconcile runner runs a trailing fetch when an event arrives mid-flight", async () => {
  const applied = [];
  let releaseFirst;
  const first = {
    sections: [{ id: "first" }],
    tabs: ["All"],
    boards: [],
    accessibleProjectIds: [1],
  };
  const second = {
    sections: [{ id: "second" }],
    tabs: ["All"],
    boards: [],
    accessibleProjectIds: [1],
  };

  let fetchCount = 0;
  const runner = createMyTasksReconcileRunner({
    fetchList: () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return new Promise((resolve) => {
          releaseFirst = () => resolve(first);
        });
      }
      return Promise.resolve(second);
    },
    apply: (payload) => applied.push(payload.sections[0].id),
  });

  runner.request();
  await Promise.resolve();
  runner.request();
  releaseFirst();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.ok(applied.includes("second"));
  assert.equal(applied[applied.length - 1], "second");
});
