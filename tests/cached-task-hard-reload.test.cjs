const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const flag = "htpr-7004-no-loading-flash";

function mount({ enabled, cachedLayout }) {
  const effects = [];
  const refreshes = [];
  const projects = [];
  const context = {
    _currentTask: { id: 57094 },
    _parsedTask: { id: 57094, projectId: 6859, project: { id: 6859 } },
    currentUser: { id: 2343 },
    navigate: page => refreshes.push(page),
    setCurrentProject: project => projects.push(project),
  };
  const mocks = {
    "@/hooks/useFlag": { useFlag: key => key === flag && enabled },
    "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => ({ cachedLayout }) },
    "@/lib/configs/taskDetail.config": { default: { navigation: { refresh: "Refresh" }, taskIds: { newTask: -1 } } },
    "@/utils/api/global": { default: {} },
    axios: { default: {} },
    "react-hot-toast": { default: () => {} },
    react: { useEffect: (callback, dependencies) => effects.push({ callback, dependencies }), useLayoutEffect: () => {} },
    "@tanstack/react-query": { focusManager: { setEventListener: () => {} } },
    "@/lib/analytics/productPerformance": {},
    "@/lib/analytics/appPerformanceScope": {},
    "@/lib/analytics/taskDetailReadiness": {},
    "@/lib/analytics/taskDetailPhaseTimings": {},
  };
  const { useTaskDetailModalActions } = load("src/app/detail/[...slug]/useTaskDetailModalActions.tsx", mocks);
  Object.assign(context, useTaskDetailModalActions(() => context));
  const { useTaskDetailReadiness } = load("src/app/detail/[...slug]/useTaskDetailReadiness.tsx", mocks);
  useTaskDetailReadiness(context);
  const mountEffect = effects.find(effect => effect.dependencies[0] === context._currentTask);
  assert(mountEffect, "the actual detail mount effect must run");
  mountEffect.callback();
  return { context, refreshes, projects };
}

test("cached parent mount after subtask Back does not enqueue redundant RSC refresh", () => {
  const flow = mount({ enabled: true, cachedLayout: true });
  assert.deepEqual(flow.refreshes, []);
  assert.deepEqual(flow.projects, [{ id: 6859 }], "cached mount still initializes the current board");
});

test("flag off preserves the cached mount refresh", () => {
  const flow = mount({ enabled: false, cachedLayout: true });
  assert.deepEqual(flow.refreshes, ["Refresh"]);
  assert.deepEqual(flow.projects, [{ id: 6859 }]);
});

for (const enabled of [false, true]) {
  test(`native detail still refreshes on mount with flag ${enabled ? "on" : "off"}`, () => {
    const flow = mount({ enabled, cachedLayout: false });
    assert.deepEqual(flow.refreshes, ["Refresh"]);
    assert.deepEqual(flow.projects, [{ id: 6859 }]);
  });
}

test("explicit task refresh after restoring a description remains available in cached detail", async () => {
  const flow = mount({ enabled: true, cachedLayout: true });
  await flow.context.getTask();
  assert.deepEqual(flow.refreshes, ["Refresh"], "only the mount refresh is suppressed, not explicit actions");
  assert.equal(flow.projects.length, 2);
});
