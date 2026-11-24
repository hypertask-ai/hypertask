const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { QueryClient } = require("@tanstack/react-query");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true });
const { openCachedTaskDetail, openSavedComposeTask, cachedTaskDetailKey } = jiti(path.join(root, "src/lib/navigation/cachedTaskDetail.ts"));

const saved = {
  id: 9300,
  projectId: 15,
  uniqueIndex: 9300,
  title: "Retry checkout",
  status: "Normal",
  ticketNumber: "HTPR-9300",
  description_: { content: "<p>Retry failed checkout payments.</p>" },
};

function percentile(samples, ratio) {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1));
  return sorted[index];
}

function withWindow(run) {
  const original = global.window;
  const calls = [];
  const history = { state: { __NA: true, _N: true, tree: "board" } };
  for (const method of ["pushState", "replaceState"]) {
    history[method] = (state, unused, href) => {
      calls.push({ method, state, href });
      history.state = state;
    };
  }
  global.window = { history, dispatchEvent: () => {}, scrollTo: () => {} };
  try {
    return run(calls);
  } finally {
    global.window = original;
  }
}

test("a saved Ctrl+J task opens from the copy already in hand", () => {
  const client = new QueryClient();
  const pageLoads = [];
  withWindow((calls) => {
    const opened = openSavedComposeTask(true, () => openCachedTaskDetail({
      queryClient: client,
      accountId: 985,
      projectId: saved.projectId,
      uniqueIndex: saved.uniqueIndex,
      href: "/detail/project-15/9300",
      task: saved,
    }));
    assert.equal(opened, true);
    assert.equal(pageLoads.length, 0);
    assert.equal(calls[0].href, "/detail/project-15/9300");
    assert.equal(client.getQueryData(cachedTaskDetailKey(985, saved.id)).description_.content, saved.description_.content);
  });
  client.clear();
});

test("the flag off leaves the full page open in charge", () => {
  let cached = 0;
  assert.equal(openSavedComposeTask(false, () => {
    cached += 1;
    return true;
  }), false);
  assert.equal(cached, 0);
});

test("a cache miss still needs the full page open", () => {
  const client = new QueryClient();
  withWindow(() => {
    assert.equal(openSavedComposeTask(true, () => openCachedTaskDetail({
      queryClient: client,
      accountId: 985,
      projectId: 15,
      uniqueIndex: 1,
      href: "/detail/project-15/1",
      task: { id: 1, projectId: 15, uniqueIndex: 1, status: "Deleted", description_: { content: "gone" } },
    })), false);
  });
  client.clear();
});

test("the cache open in this process stays under the recorded production screen-update times", () => {
  const field = { n: 163, p50: 1209, p75: 2026, p95: 9172 };
  const samples = [];
  const rounds = 41;
  for (let index = 0; index < rounds; index++) {
    const client = new QueryClient();
    const task = { ...saved, id: 10000 + index };
    const started = performance.now();
    withWindow((calls) => {
      const opened = openSavedComposeTask(true, () => openCachedTaskDetail({
        queryClient: client, accountId: 985, projectId: 15, uniqueIndex: task.uniqueIndex,
        href: `/detail/project-15/${task.uniqueIndex}`, task,
      }));
      assert.equal(opened, true);
      assert.equal(calls.length, 1);
      assert.equal(client.getQueryData(cachedTaskDetailKey(985, task.id)).description_.content, task.description_.content);
    });
    samples.push(performance.now() - started);
    client.clear();
  }
  const after = {
    n: samples.length,
    p50: percentile(samples, 0.5),
    p75: percentile(samples, 0.75),
    p95: percentile(samples, 0.95),
  };
  console.log(`HTPR-9300 screen step ${JSON.stringify({ field, after })}`);
  assert.ok(after.p50 < field.p50);
  assert.ok(after.p75 < field.p75);
  assert.ok(after.p95 < field.p95);
});
