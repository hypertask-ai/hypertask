const test = require("node:test");
const assert = require("node:assert/strict");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

function fixture(t, { enabled = true, refused = [], readFails = false, pauseArchive } = {}) {
  const ui = mount();
  t.after(() => ui.close());
  const tasks = [
    { id: 1, projectId: 15, sectionId: 11, title: "Visible", status: "Normal" },
    { id: 2, projectId: 15, sectionId: 11, title: "Hidden by view filter", status: "Normal" },
    { id: 3, projectId: 15, sectionId: 12, title: "Other column", status: "Normal" },
    { id: 4, projectId: 15, sectionId: 11, title: "Already archived", status: "Archive" },
    { id: 5, projectId: 16, sectionId: 11, title: "Other board", status: "Normal" },
  ];
  const requests = [], undos = [], errors = [], refreshes = [];
  let closes = 0, hook, projectId = 15;
  const load = loader({
    axios: { default: { post: async (path, body) => {
      requests.push([path, body]);
      if (readFails) throw new Error("Unavailable");
      return { data: { tasks: structuredClone(tasks) } };
    } } },
    "react-hot-toast": { default: { error: (text) => errors.push(text) } },
    "@tanstack/react-query": { useQueryClient: () => ({}) },
    "@/lib/boardSync/reconcileActiveBoardQuery": { reconcileActiveBoardTasks: async (_client, ...ids) => refreshes.push(ids) },
    "@/utils/api/global": { default: { archiveTask: async (id, status, scope) => {
      assert.deepEqual(scope, { projectId: 15, sectionId: 11 });
      requests.push([id, status]);
      if (pauseArchive) await pauseArchive;
      if (refused.includes(id)) throw new Error("Permission denied");
      tasks.find((task) => task.id === id).status = status;
    } } },
    "@/hooks/MultiPages/useUpdateTaskInBoards": { default: () => ({ deleteTodo: (text, data) => undos.push({ text, data }) }) },
  });
  const { useArchiveColumn } = load("src/hooks/Kanban/useArchiveColumn.ts");
  function Harness() {
    hook = useArchiveColumn({ enabled, active: true, projectId, userId: 985, onClose: () => closes++ });
    return null;
  }
  ui.render(React.createElement(Harness));
  return { tasks, requests, undos, errors, refreshes, get hook() { return hook; }, get closes() { return closes; }, switchBoard() { projectId = 16; ui.render(React.createElement(Harness)); } };
}

const column = { id: 11, section_title: "Features" };

test("fresh column snapshot counts filtered-out tickets without writing before confirmation", async (t) => {
  const f = fixture(t);
  await React.act(() => f.hook.prepare(column));
  assert.equal(f.hook.state.kind, "confirm");
  assert.equal(f.hook.state.snapshot.column, "Features");
  assert.deepEqual(f.hook.state.snapshot.tasks.map((task) => task.id), [1, 2]);
  assert.deepEqual(f.requests, [["/api/projects/boardTasks", { projectId: 15 }]]);
  React.act(() => f.hook.close());
  assert.equal(f.hook.state.kind, "pick");
  assert.equal(f.closes, 1);
  assert.deepEqual(f.tasks.map((task) => task.status), ["Normal", "Normal", "Normal", "Archive", "Normal"]);
});

test("archives the whole chosen column, preserves other columns and registers one complete Undo", async (t) => {
  const f = fixture(t);
  await React.act(() => f.hook.prepare(column));
  await React.act(() => f.hook.confirm());
  assert.deepEqual(f.requests.slice(1), [[1, "Archive"], [2, "Archive"]]);
  assert.deepEqual(f.tasks.map((task) => task.status), ["Archive", "Archive", "Normal", "Archive", "Normal"]);
  assert.deepEqual(f.undos, [{ text: "Archived 2 tickets from Features", data: { taskIds: [1, 2], projectId: 15 } }]);
  assert.deepEqual(f.refreshes, [[15, 985]]);
  assert.equal(f.closes, 1);
});

test("individual refusal does not stop later tickets and Undo includes only successes", async (t) => {
  const f = fixture(t, { refused: [1] });
  await React.act(() => f.hook.prepare(column));
  await React.act(() => f.hook.confirm());
  assert.deepEqual(f.requests.slice(1), [[1, "Archive"], [2, "Archive"]]);
  assert.deepEqual(f.tasks.map((task) => task.status), ["Normal", "Archive", "Normal", "Archive", "Normal"]);
  assert.deepEqual(f.undos[0].data, { taskIds: [2], projectId: 15 });
  assert.deepEqual(f.errors, ["1 tickets not archived: Visible"]);
});

test("disabled flag prevents both reads and archives", async (t) => {
  const f = fixture(t, { enabled: false });
  await React.act(() => f.hook.prepare(column));
  await React.act(() => f.hook.confirm());
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.undos, []);
});

test("empty column cannot run an archive or create Undo", async (t) => {
  const f = fixture(t);
  await React.act(() => f.hook.prepare({ id: 99, section_title: "Empty" }));
  assert.equal(f.hook.state.snapshot.tasks.length, 0);
  await React.act(() => f.hook.confirm());
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.undos, []);
});

test("failed read returns to the picker without an archive", async (t) => {
  const f = fixture(t, { readFails: true });
  await React.act(() => f.hook.prepare(column));
  assert.equal(f.hook.state.kind, "pick");
  assert.deepEqual(f.errors, ["Could not load this column's tickets"]);
  assert.equal(f.requests.length, 1);
});

test("repeated confirmation and cancel cannot interrupt or duplicate a running batch", async (t) => {
  let resume;
  const pauseArchive = new Promise((resolve) => { resume = resolve; });
  const f = fixture(t, { pauseArchive });
  await React.act(() => f.hook.prepare(column));
  const confirm = f.hook.confirm;
  let running;
  React.act(() => { running = confirm(); });
  await React.act(() => confirm());
  React.act(() => f.hook.close());
  for (const [key, code] of [["k", "KeyK"], ["л", "KeyK"], ["о", "KeyJ"]]) {
    const event = new window.KeyboardEvent("keydown", { key, code, ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
  }
  assert.equal(f.closes, 0);
  assert.deepEqual(f.requests.slice(1), [[1, "Archive"]]);
  await React.act(async () => { resume(); await running; });
  assert.deepEqual(f.requests.slice(1), [[1, "Archive"], [2, "Archive"]]);
  assert.equal(f.undos.length, 1);
  assert.equal(f.closes, 1);
});

test("column archive flag is a reversible Everyone feature", () => {
  const load = loader();
  const { default: flag } = load("src/lib/flags/definitions/htpr-7907-column-archive.ts");
  assert.equal(flag.key, "htpr-7907-column-archive");
  assert.equal(flag.kind, "feature");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
});


test("a board switch cannot confirm a previous board's snapshot", async (t) => {
  const f = fixture(t);
  await React.act(() => f.hook.prepare(column));
  f.switchBoard();
  await React.act(() => f.hook.confirm());
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.undos, []);
});
