const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { load } = require("./task-route-loader.cjs");
const { fixture } = require("./legacy-task-relations-fixture.cjs");
const root = path.resolve(__dirname, "..");

function ui(file, mocks) {
  const exports = {};
  const javascript = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: file,
  }).outputText;
  new Function("require", "module", "exports", javascript)((name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith("@/")) return load(`src/${name.slice(2)}.ts`, mocks);
    return require(name);
  }, { exports }, exports);
  return exports.default;
}

function elements(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children)];
}

const icon = (name) => (props) => React.createElement("i", { "data-icon": name, "data-color": props.color });
const mocks = {
  "lucide-react": { Check: icon("check"), Reply: icon("reply"), Unlink: icon("unlink"), Plus: icon("plus") },
  "next/link": { __esModule: true, default: (props) => React.createElement("a", props) },
  "next/navigation": { useSearchParams: () => new URLSearchParams("inboxFlow=true") },
  "@/components/Common/Tooltip": { __esModule: true, default: () => null },
  "@/utils/undoActions/helperFuncs": { cn: (...classes) => classes.filter(Boolean).join(" ") },
};
const cardFile = "src/components/PageComponents/Kanban/KanbanTaskComponents/CardSubTasks.tsx";
const parentFile = "src/components/PageComponents/Kanban/KanbanTaskComponents/FlattenedParentTask.tsx";
const linkFile = "src/components/PageComponents/TaskDetail/TopRow/SubtaskLink.tsx";
const descriptionFile = "src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/DescriptionSubTasks/DescriptionSubTasks.tsx";

async function shapes() {
  return [
    (await fixture({ enabled: false, compat: "htpr-6924" }).invoke()).body,
    (await fixture({ enabled: true, compat: "htpr-6924" }).invoke()).body,
  ];
}

test("board card subtasks and parent chips render identical text/statuses and click behavior for both shapes", async () => {
  const [legacy, compact] = await shapes();
  const Card = ui(cardFile, mocks);
  const Parent = ui(parentFile, mocks);
  for (const setting of ["Card", "Flattened", "Flattened_Card", "None"]) {
    const rendered = [];
    const actions = [];
    for (const rows of [legacy, compact]) {
      const clicked = [];
      const card = Card({ subTasks: rows[0].subTasks, currentSetting: setting, onClick: (id) => clicked.push(id) });
      const parent = Parent({ parentTask: rows[0].parentTask, currentSetting: setting, onClick: () => clicked.push("parent") });
      rendered.push(renderToStaticMarkup(React.createElement(React.Fragment, null, card, parent)));
      for (const element of [...elements(card), ...elements(parent)]) {
        if (element.props?.onClick) element.props.onClick({ preventDefault() { clicked.push("prevent"); }, stopPropagation() { clicked.push("stop"); } });
      }
      actions.push(clicked);
    }
    assert.equal(rendered[0], rendered[1]);
    assert.deepEqual(actions[0], actions[1]);
    if (setting.includes("Card")) {
      assert.match(rendered[1], /HTPR-52/);
      assert.match(rendered[1], /Task 53/);
      assert.match(rendered[1], /data-color="green"/);
      assert.deepEqual(actions[1].slice(0, 6), ["prevent", "stop", 52, "prevent", "stop", 53]);
    }
    if (setting.startsWith("Flattened")) assert.match(rendered[1], /HTPR-40: Task 40/);
  }
  assert.equal(renderToStaticMarkup(Card({ subTasks: [], currentSetting: "Card" })), "");
  assert.equal(renderToStaticMarkup(Parent({ parentTask: null, currentSetting: "Flattened" })), "");
});

test("task-detail parent link preserves navigation/inbox flow and unlink callback for legacy or compact parent", async () => {
  const markup = [];
  for (const rows of await shapes()) {
    let unlinked = 0;
    const Link = ui(linkFile, { ...mocks, "@/hooks/Task Detail/useUpdateSubtask": { __esModule: true, default: () => ({ callBackHandlerRemoveParent: () => unlinked++ }) } });
    const tree = Link({ parentTask: rows[0].parentTask, projectId: 15 });
    markup.push(renderToStaticMarkup(tree));
    const anchor = elements(tree).find((element) => element.props?.href);
    assert.equal(anchor.props.href, "/detail/project-15/40?inboxFlow=true");
    elements(tree).find((element) => element.props?.onClick).props.onClick();
    assert.equal(unlinked, 1);
    assert.equal(Link({ parentTask: rows[1].parentTask, projectId: 15 }), null);
  }
  assert.equal(markup[0], markup[1]);
  assert.match(markup[1], /Sub-task of/);
  assert.match(markup[1], /HTPR-40/);
});

test("task-detail subtasks retain identical links, archive colors, playlist, and add controls in both shapes", async () => {
  const markup = [];
  const playlists = [];
  for (const rows of await shapes()) {
    const playlist = [];
    let linking = 0;
    let pages = 0;
    const Description = ui(descriptionFile, {
      ...mocks,
      react: { ...React, useMemo: (compute) => compute() },
      "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
      "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => ({ currentTask: rows[0], editMode: "", cachedLayout: false, toggleSubtaskLinkingModal: () => linking++ }) },
      "@/store": { tasksPlayListAtom: {} },
      "@/lib/state": { useRecoilState: () => [[], (value) => playlist.push(value)] },
      "../../../TopRow/CreateSummaryButton": { __esModule: true, default: () => null },
      "@/lib/configs/taskDetail.config": { taskDetailSpacing: { mobile: { descriptionContainer: "" } } },
      "./TaskPagesContext": { useTaskPages: () => ({ loading: false, hasPages: false, createAndOpenPage: () => pages++ }) },
    });
    const tree = Description();
    markup.push(renderToStaticMarkup(tree));
    const nodes = elements(tree);
    const links = nodes.filter((element) => element.props?.href);
    assert.deepEqual(links.map((element) => element.props.href), ["/detail/project-15/52?inboxFlow=true", "/detail/project-15/53?inboxFlow=true"]);
    for (const element of nodes) if (element.props?.onClick) element.props.onClick();
    assert.equal(linking, 1);
    assert.equal(pages, 1);
    playlists.push(playlist);
  }
  assert.equal(markup[0], markup[1]);
  assert.match(markup[1], /data-color="green"/);
  assert.deepEqual(playlists[0], playlists[1]);
  assert.deepEqual(playlists[1][0], [{ projectId: 15, uniqueIndex: 50 }, { projectId: 15, uniqueIndex: 52 }, { projectId: 15, uniqueIndex: 53 }]);
});

test("existing board client accepts both task relation shapes without requesting either legacy URL or opting in", async () => {
  for (const rows of await shapes()) {
    const calls = [];
    const api = load("src/utils/api/Homepage/index.ts", {
      axios: { default: { post: async (...args) => { calls.push(args); return { data: { project: { id: 15 }, tasks: rows, allViews: [] } }; } } },
      "@/utils/axiosClient": {},
      "@/utils/helperFunctions/helperFunctions": {},
      "@/lib/firstScreen/boardPayload": {},
      "@/utils/api/Homepage/sidebarTeamsResponse": {},
      "@/lib/boardBootstrap/earlyBoardBootstrap": { consumeEarlyBoardBootstrap: async () => undefined },
      "@/lib/appShellBootstrap/client": {},
      "@/lib/boardSync/startupRace": {},
      "@/lib/analytics/boardReadinessPhases": { getBoardReadinessTraceScope: () => null, markBoardReadinessPhase: () => {} },
    });
    const result = await api.fetchBoardTasks(15, 7);
    assert.deepEqual(result.tasks, rows);
    assert.deepEqual(calls, [["/api/projects/boardTasks", { projectId: 15, userId: 7 }, { signal: undefined }]]);
  }
});
