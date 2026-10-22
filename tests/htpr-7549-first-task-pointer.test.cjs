const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
const { JSDOM } = require("jsdom");
const { load } = require("./helpers/agent-connection.cjs");
const key = "htpr-7549-first-task-pointer";
const composeKey = "htpr-6929-compose-task-writer";
const flagModule = load("src/lib/flags/definitions/htpr-7549-first-task-pointer.ts");
const { CommandMode } = load("src/models/enums.ts");
const store = { showCommandsAtom: "commands", activeSectionAtom: "section", activeSectionIdAtom: "sectionId" };
const keyboard = load("src/lib/utils/keyboardShortcuts.ts", {
  "@/lib/constants/keyboard-handler": load("src/lib/constants/keyboard-handler.ts"),
});
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

async function withPointer(fn) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://fixture.test/project?id=7" });
  const previous = { window: global.window, document: global.document, IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = require("react-dom/client");
  const container = dom.window.document.getElementById("root");
  const root = createRoot(container);
  const state = { enabled: true, compose: true, apple: false, pending: false, fetching: false, data: { eligible: true, starterTaskId: 71, sectionId: 10 } };
  const actions = [];
  const cacheWrites = [];
  const cancellations = [];
  const queryClient = { cancelQueries: async (options) => { cancellations.push(options); }, setQueryData: (key, data) => { cacheWrites.push([key, data]); state.data = data; } };
  let query;
  const Pointer = load("src/components/PageComponents/Kanban/KanbanSectionComponents/FirstTaskPointer.tsx", {
    "@tanstack/react-query": { useQuery: (options) => { query = options; return { data: state.data, isPending: state.pending, isFetching: state.fetching }; }, useQueryClient: () => queryClient },
    "@/hooks/useFlag": { useFlag: (flag) => flag === key ? state.enabled : flag === composeKey ? state.compose : assert.fail(`Unexpected flag ${flag}`) },
    "@/lib/flags/definitions/htpr-7549-first-task-pointer": flagModule,
    "@/lib/flags/keys": { HTPR_6929_COMPOSE_TASK_WRITER_FLAG: composeKey },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => state.apple },
    "@/lib/state": { useSetRecoilState: (atom) => (value) => actions.push([atom, value]) },
    "@/lib/utils/keyboardShortcuts": keyboard,
    "@/models/enums": { CommandMode },
    "@/store": store,
    "@/components/Common/kbd": { __esModule: true, default: ({ content }) => React.createElement("kbd", null, content) },
  });
  const render = async (overrides = {}) => React.act(async () => root.render(React.createElement(Pointer, {
    projectId: 7, sectionId: 10, sectionIndex: 2, taskIds: [71], ready: true, writable: true, filtered: false, ...overrides,
  })));
  try { await fn({ dom, container, render, state, actions, cacheWrites, cancellations, getQuery: () => query }); }
  finally {
    await React.act(async () => root.unmount());
    Object.assign(global, previous);
    dom.window.close();
  }
}

test("starter-only board points to the original column even after reorder and opens the real compose writer", async () => {
  await withPointer(async ({ dom, container, render, actions, state }) => {
    await render();
    const button = container.querySelector("button");
    assert.match(button.textContent, /Write your first task here/);
    assert.equal(button.tabIndex, 0);
    for (const token of ["bg-shadcn-primary", "text-primary-foreground", "focus-visible:bg-hover-active", "focus-visible:outline-none"]) assert.ok(button.classList.contains(token));
    assert.doesNotMatch(button.className, /(?:^| )border(?: |$)|outline-white|ring-white/);
    assert.equal(button.getAttribute("aria-keyshortcuts"), "Control+J");
    assert.deepEqual([...button.querySelectorAll("kbd")].map((node) => node.textContent), ["CTRL", "J"]);
    await React.act(async () => button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    assert.deepEqual(actions, [["section", 2], ["sectionId", 10], ["commands", { show: true, mode: CommandMode.Command, paletteTab: "compose" }]]);
    state.apple = true;
    await render();
    assert.equal(container.querySelector("button").getAttribute("aria-keyshortcuts"), "Meta+J");
    assert.deepEqual([...container.querySelectorAll("kbd")].map((node) => node.textContent), ["CMD", "J"]);
  });
});

test("query stays board-keyed across task changes and background refetches do not flicker", async () => {
  await withPointer(async ({ container, render, state, getQuery, cacheWrites }) => {
    await render();
    assert.deepEqual(getQuery().queryKey, ["first-task-pointer", 7]);
    assert.equal(getQuery().enabled, true);
    state.fetching = true;
    await render({ taskIds: [] });
    assert.ok(container.querySelector("button"));
    assert.deepEqual(getQuery().queryKey, ["first-task-pointer", 7]);
    assert.deepEqual(cacheWrites, []);
    await render({ projectId: 8 });
    assert.deepEqual(getQuery().queryKey, ["first-task-pointer", 8]);
  });
});

for (const taskIds of [[71, 72], null, [72]]) {
  test(`real task hides immediately and clears only this board's cached eligibility (${JSON.stringify(taskIds)})`, async () => {
    await withPointer(async ({ container, render, getQuery, cacheWrites, cancellations }) => {
      await render();
      assert.ok(container.querySelector("button"));
      await render({ taskIds });
      assert.equal(container.querySelector("button"), null);
      assert.equal(getQuery().enabled, taskIds !== null && taskIds.length <= 1);
      assert.deepEqual(getQuery().queryKey, ["first-task-pointer", 7]);
      assert.deepEqual(cacheWrites, [[["first-task-pointer", 7], { eligible: false, starterTaskId: 71, sectionId: 10 }]]);
      assert.deepEqual(cancellations, [{ queryKey: ["first-task-pointer", 7], exact: true }]);
      await render();
      assert.equal(container.querySelector("button"), null, "deletion cannot revive cached eligibility");
    });
  });
}

test("flag-off normal user is still refused, as are read-only, filtered and loading boards", async () => {
  await withPointer(async ({ container, render, state, getQuery }) => {
    for (const props of [{ writable: false }, { filtered: true }, { ready: false }]) {
      await render(props);
      assert.equal(container.querySelector("button"), null);
      assert.equal(getQuery().enabled, false);
    }
    for (const property of ["enabled", "compose"]) {
      state[property] = false;
      await render();
      assert.equal(container.querySelector("button"), null);
      assert.equal(getQuery().enabled, false);
      state[property] = true;
    }
    for (const data of [undefined, { eligible: false }, { eligible: true, starterTaskId: 71, sectionId: 11 }]) {
      state.data = data;
      await render();
      assert.equal(container.querySelector("button"), null);
    }
    state.data = { eligible: true, starterTaskId: 71, sectionId: 10 };
    state.pending = true;
    await render();
    assert.equal(container.querySelector("button"), null);
  });
});

function routeHarness(overrides = {}) {
  const state = { userId: 6, enabled: true, project: { firstTaskPointerTaskId: 71, firstTaskPointerSectionId: 10, firstRealTaskCreatedAt: null }, count: 0, section: { id: 10 }, ...overrides };
  const calls = [];
  const accessWhere = { OR: [{ ownerId: state.userId }, { members: { some: { userId: state.userId, agentId: null } } }] };
  const { GET } = load("src/app/api/projects/first-task-pointer/route.ts", {
    "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => state.userId ? { userId: state.userId, agentId: state.agentId } : null },
    "@/lib/flags": { isFeatureEnabled: async (flag, id) => { assert.equal(flag, key); assert.equal(id, state.userId); return state.enabled; } },
    "@/lib/flags/definitions/htpr-7549-first-task-pointer": flagModule,
    "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: (userId, agentId) => { assert.equal(userId, state.userId); assert.equal(agentId, state.agentId); return accessWhere; } },
    "@/lib/prisma": { __esModule: true, default: {
      project: { findFirst: async (args) => { calls.push(args); assert.deepEqual(args.where, { id: 7, ownerId: state.userId, seeded: true, status: "Normal", AND: [accessWhere] }); return state.project; } },
      task: {
        count: async ({ where }) => { calls.push({ where }); assert.deepEqual(where, { projectId: 7, id: { not: 71 }, project: accessWhere }); return state.count; },
      },
      section: { findFirst: async ({ where }) => { calls.push({ where }); assert.deepEqual(where, { id: 10, projectId: 7 }); return state.section; } },
    } },
  });
  return { state, calls, get: (id = "7") => GET({ headers: new Headers(), nextUrl: new URL(`https://fixture.test/api/projects/first-task-pointer?projectId=${id}`) }) };
}

test("first-task pointer: owner human still allowed", async () => {
  const harness = routeHarness();
  const response = await harness.get();
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { eligible: true, starterTaskId: 71, sectionId: 10 });
  assert.equal(harness.calls.length, 3);
});

test("first-task pointer: agent without board access now refused before any board query", async () => {
  const harness = routeHarness({ agentId: "ungranted-agent" });
  const response = await harness.get();
  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { eligible: false });
  assert.deepEqual(harness.calls, []);
});

test("server identifies edited starter by stored ID, counts every status, and refuses foreign/unmarked/completed boards", async () => {
  const harness = routeHarness();
  assert.deepEqual((await harness.get()).body, { eligible: true, starterTaskId: 71, sectionId: 10 });
  for (const patch of [
    { count: 1 },
    { section: null },
    { project: null },
    { project: { firstTaskPointerTaskId: null } },
    { project: { firstTaskPointerTaskId: 71, firstTaskPointerSectionId: 10, firstRealTaskCreatedAt: new Date() } },
    { enabled: false },
    { userId: null },
    { agentId: "agent" },
  ]) assert.equal((await routeHarness(patch).get()).body.eligible, false);
  const off = routeHarness({ userId: 2343, enabled: false });
  assert.equal((await off.get()).body.eligible, false);
  assert.deepEqual(off.calls, []);
  assert.equal((await harness.get("bad")).status, 400);
});

test("shared human/agent task transaction records the irreversible milestone only on enrolled boards and rolls it back on failure", async () => {
  let completed = false;
  let fail = false;
  const { createTaskWithBoardWebhookOutbox } = load("src/lib/mcp/webhooks/taskEvents.ts", {
    "./outbox": { persistBoardWebhookEvent: async () => [] },
    "../../telemetry/savedWork": { enqueueTaskCreated: async () => { if (fail) throw new Error("rollback"); return "key"; }, processAnalyticsIntentSoon() {} },
  });
  const db = { $transaction: async (callback) => {
    let staged = completed;
    const result = await callback({ project: { updateMany: async ({ where, data }) => {
      assert.deepEqual(where, { id: 7, firstTaskPointerTaskId: 71, firstRealTaskCreatedAt: null });
      assert.ok(data.firstRealTaskCreatedAt instanceof Date);
      staged = true;
    } } });
    completed = staged;
    return result;
  } };
  for (const agentId of [null, "agent"]) {
    completed = false;
    fail = true;
    const create = () => createTaskWithBoardWebhookOutbox(db, { userId: 6, agentId }, async () => ({ taskId: 72, firstTaskPointerTaskId: 71, result: {}, webhookTask: { projectId: 7 } }), "web");
    await assert.rejects(create(), /rollback/);
    assert.equal(completed, false);
    fail = false;
    await create();
    assert.equal(completed, true);
  }
});

test("Homepage skips task-ID work above one task and deduplicates the starter across board stores", () => {
  const homepage = read("src/components/PageComponents/Kanban/KanbanHomepageComponents/Homepage.tsx");
  const body = /const pointerTaskIds = useMemo\(\(\) => \{([\s\S]*?)\n  \}, \[/.exec(homepage)?.[1];
  assert.ok(body);
  const collect = new Function("firstTaskPointerEnabled", "_currentProject", "sections", body);
  const unreadableTask = { get id() { assert.fail("a multi-task board must not read task IDs"); } };
  assert.equal(collect(true, { tasks: [unreadableTask, unreadableTask] }, []), null);
  assert.equal(collect(true, { tasks: [] }, [{ items: [unreadableTask, unreadableTask] }]), null);
  assert.equal(collect(false, { get tasks() { assert.fail("OFF must not inspect tasks"); } }, []), null);
  assert.deepEqual(collect(true, { tasks: [{ id: 71 }] }, [{ items: [{ id: 71 }] }]), [71]);
  assert.equal(collect(true, { tasks: [] }, [{ items: [{ id: 71 }] }, { items: [{ id: 72 }] }]), null);
});

test("integration keeps the existing plus, shares Ctrl+J action, and adds no motion or synthetic keys", () => {
  const pointer = read("src/components/PageComponents/Kanban/KanbanSectionComponents/FirstTaskPointer.tsx");
  const shortcut = read("src/hooks/General/useCommandCenterShortcut.ts");
  assert.match(pointer, /setShowCommands\(\{ show: true, mode: CommandMode.Command, paletteTab: "compose" \}\)/);
  assert.match(shortcut, /setShowCommands\(\{ show: true, mode: CommandMode.Command, paletteTab: e.code === "KeyJ" \? "compose" : "search" \}\)/);
  assert.doesNotMatch(pointer, /KeyboardEvent|dispatchEvent|animate-|transition-|#[0-9a-fA-F]{3,8}/);
  const section = read("src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx");
  assert.match(section, /<NewTaskButton[\s\S]*?buttonPosition="top"[\s\S]*?\{firstTaskPointer\}/);
  const homepage = read("src/components/PageComponents/Kanban/KanbanHomepageComponents/Homepage.tsx");
  assert.match(homepage, /getActiveFiltersFromProject\(_currentProject\).addedFilters/);
  assert.match(homepage, /ready=\{tasksHydrated && secondaryStartupEnabled\}/);
  const pointerIds = homepage.slice(homepage.indexOf("const pointerTaskIds = useMemo"), homepage.indexOf("const pointerFiltered ="));
  assert.ok(pointerIds.indexOf("_currentProject.tasks?.length") < pointerIds.indexOf("new Set"));
  assert.match(pointerIds, /if \(ids.size > 1\) return null/);
  assert.doesNotMatch(pointerIds, /flatMap|\.sort\(/);
  assert.doesNotMatch(pointer, /Tooltip|kanban|isFetching/);
  assert.match(read("src/app/[...boardURL]/LandingPage.tsx"), /boardLayout === "table"[\s\S]*?<TableView[\s\S]*?: \([\s\S]*?<HomePage/);
});
