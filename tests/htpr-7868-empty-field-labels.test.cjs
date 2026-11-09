const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const FLAG = "htpr-7868-empty-field-labels";
const noop = () => {};
const marker = (name) => () => React.createElement("i", { "data-part": name });
const mobile = React.createContext(false);
let flagOn = true;

function load(relative, mocks, passthrough = ["react", "react/jsx-runtime", "date-fns"]) {
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports = {};
  for (const mock of Object.values(mocks)) if (mock && typeof mock === "object" && "default" in mock) mock.__esModule = true;
  new Function("require", "exports", js)((name) => {
    if (passthrough.includes(name)) return require(name);
    assert.ok(name in mocks, `Unexpected dependency in ${relative}: ${name}`);
    return mocks[name];
  }, exports);
  return exports;
}

const flagModule = load("src/lib/flags/definitions/htpr-7868-empty-field-labels.ts", {});
const useFlag = { useFlag: (key) => key === FLAG && flagOn };
const flagDefinition = { "@/lib/flags/definitions/htpr-7868-empty-field-labels": { HTPR_7868_EMPTY_FIELD_LABELS_FLAG: FLAG } };
const sharedRows = {
  ClickableSpan: ({ title }) => React.createElement("span", { "data-empty": title }, title),
  LocalRightSideInfo: ({ title }) => React.createElement("label", null, title),
  TaskInfoRow: ({ children }) => React.createElement("section", null, children),
  TaskInfoValue: ({ children }) => React.createElement("div", null, children),
  TaskInfoColumnContainer: ({ children }) => React.createElement("aside", null, children),
  TaskInfoLabel: ({ children }) => React.createElement("label", null, children),
  AssigneeCard: marker("assignee"),
};
const estimates = [{ estimate_index: 3, estimate_full_value: "Medium" }];

const panel = load("src/components/PageComponents/TaskDetail/TaskInfoColumn/TaskInfo.tsx", {
  "@/hooks/useFlag": useFlag,
  ...flagDefinition,
  "@/lib/flags/definitions/htpr-8917-agent-waiting-person": { HTPR_8917_AGENT_WAITING_PERSON_FLAG: "htpr-8917-agent-waiting-person" },
  "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => ({ cachedLayout: true, serverTaskSeed: { updatedAt: "2026-01-01T00:00:00.000Z" } }) },
  "@/lib/contexts/mobileContext": { MobileViewContext: mobile },
  "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
  "@/lib/api/typedClient": { getTaskCycle: noop },
  axios: { default: {} },
  "react-hot-toast": { default: {} },
  "@tanstack/react-query": { useQueryClient: () => ({}) },
  "@/lib/state": { useRecoilState: () => [{}, noop] },
  "@/components/PageComponents/TaskDetail/MainPageComponents": sharedRows,
  "@/hooks/General/useCopyURL": { default: () => ({ copyTicketNumber: noop }) },
  "@/hooks/General/useProjectQuery": { useProjectQuery: () => ({ goToProjectShortcut: noop }) },
  "@/hooks/MultiPages/useGetMembersForAssignees": { useGetAllMembersForAssign: () => ({}) },
  "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
  "../AssigneesContainer": { default: marker("assignees") },
  "@/components/Common/Tooltip": { default: () => null },
  "@/components/Modals/TaskPriority/PriorityLabelComponent": { default: marker("priority") },
  "@/components/Modals/CreateLabel/TaskLabelComponent": { default: marker("tag") },
  "./RelatedTaskLabel": { default: marker("related") },
  "lucide-react": Object.fromEntries(["ArrowRight", "CornerLeftUp", "GitMerge", "GitPullRequest", "TriangleAlert"].map((name) => [name, () => null])),
  "@/components/Labels/DueDateLabel": { default: ({ dueDate }) => React.createElement("time", null, String(dueDate)) },
  "@/lib/constants/constants": { EstimateConstants: estimates },
  "@/lib/configs/taskDetail.config": { default: {} },
  "./TaskTime": { default: () => null, useTimerNow: () => 0 },
  "@/lib/staleness": { daysSince: () => 0, stalenessLevel: () => "none" },
  "@/store": { showCommandsAtom: {} },
  "@/models/enums": { CommandMode: {} },
  "@/lib/recurrence": { RECURRENCE_LABELS: {} },
  "@/components/Modals/CyclePicker": { default: () => null },
  "@/lib/waitingOn": { formatWaitingOnAge: () => null, WAITING_ON_OVERDUE_MS: 1000 },
  "@/lib/pullRequests/githubPullRequests": { derivePullRequestDisplayState: () => "merged" },
  "@/components/PageComponents/TaskDetail/pullRequestBadge": { pullRequestBadgeByState: {} },
  "@prisma/client": { CustomFieldType: {} },
}).default;

let modalForm = {};
const modal = load("src/components/Modals/CreateTaskGloballyModal/TaskInfoColumnGloballyCreate.tsx", {
  "@/hooks/useFlag": useFlag,
  ...flagDefinition,
  "@/components/Common/Tooltip": { default: () => null },
  "@/components/PageComponents/TaskDetail/MainPageComponents": sharedRows,
  "@/lib/contexts/mobileContext": { MobileViewContext: mobile },
  "@/lib/contexts/Multipages/CreateTaskGloballyContexts/useContextCreateTaskGloballyInfoColumn": {
    useContextCreateTaskInfoColumn: () => ({ toggleMoveModal: noop, showMoveModal: false, setShowMoveModal: noop, showPriorityModal: false, togglePriorityModal: noop, toggleShowSizeModal: noop, showSizeModal: false, toggleDueDateModal: noop, showDueDateModal: false, toggleShowTagsModal: noop, showTagsModal: false, showProjectsModal: false, toggleProjectsModal: noop }),
  },
  "@/lib/contexts/Multipages/CreateTaskGloballyContexts/useContextCreateTaskModal": {
    useContextCreateTaskModal: () => ({ formValues: modalForm, handleChange: noop, allProjects: [], handleProjectChange: noop, showAssignModal: false, setShowAssignModal: noop, setEditMode: noop }),
  },
  "@/models/model": {},
  "@/store": { currentProjectAtom: {}, showCreateTaskModalAtom: {} },
  "@/lib/state": { useRecoilState: () => [{}, noop] },
  "../commands/moveToColumn": { default: marker("move") },
  "../TaskPriority/PriorityLabelComponent": { default: marker("priority") },
  "@/lib/constants/constants": { EstimateConstants: estimates },
  "../TaskPriority": { default: marker("priority-modal") },
  "../TaskEstimate/TaskEstimate": { default: marker("estimate-modal") },
  "@/components/Labels/DueDateLabel": { default: ({ dueDate }) => React.createElement("time", null, String(dueDate)) },
  "../DueDate": { default: marker("due-modal") },
  "../StartDate": { default: marker("start-modal") },
  "../CreateLabel/TaskLabelComponent": { default: marker("tag") },
  "../CreateLabel/CreateLabel": { default: marker("label-modal") },
  "../SetProjectModal/SetProjectModal": { default: marker("project-modal") },
  "./AssigneesTaskGlobal/AssigneesContainerCreateTaskGlobally": { default: marker("assignees") },
}).default;

const clickable = load("src/components/PageComponents/TaskDetail/MainPageComponents/index.tsx", {
  "@/lib/flags/definitions/htpr-8054-graphite-2": { HTPR_8054_GRAPHITE_2_FLAG: "htpr-8054-graphite-2" },
  "@/hooks/useFlag": useFlag,
  "@/components/Common/Tooltip": { default: () => null },
  "@/lib/contexts/mobileContext": { MobileViewContext: mobile },
  "@/models/model": {},
  "./TaskInfoLabel": { TaskInfoLabel: () => null },
  "./TaskInfoColumnContainer": { TaskInfoColumnContainer: () => null },
  "./TaskInfoValue": { TaskInfoValue: () => null },
  "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
  "@/components/Common/UserAvatar": { default: () => null },
  "@/components/Common/PersonHovercard": { ParentPersonHovercard: () => null },
}).ClickableSpan;

const render = (Component, props = {}, isMobile = false) =>
  renderToStaticMarkup(React.createElement(mobile.Provider, { value: isMobile }, React.createElement(Component, props)));
const emptyTask = { id: 42, projectId: 15, title: "Empty", section: "Bugs", project: { title: "Board" } };
const panelProps = (currentTask, estimate_) => ({ currentTask, _parsedTask: currentTask, followers: [], sectionsForProjectTQ: [], labelsFromTQ: [], estimate_, removeRelationHandler: noop });

test("flag is an improvement that defaults to Everyone", () => {
  assert.equal(flagModule.HTPR_7868_EMPTY_FIELD_LABELS_FLAG, FLAG);
  assert.equal(flagModule.default.key, FLAG);
  assert.equal(flagModule.default.kind, "improvement");
  assert.equal(flagModule.default.defaultMode, "EVERYONE");
});

test("ticket panel says No due date and No size when both are empty", () => {
  flagOn = true;
  const html = render(panel, panelProps(emptyTask));
  assert.match(html, /<span data-empty="No due date">No due date<\/span>/);
  assert.match(html, /<span data-empty="No size">No size<\/span>/);
  assert.doesNotMatch(html, /data-empty="-"/);
});

test("ticket panel keeps the dash with the flag off", () => {
  flagOn = false;
  const html = render(panel, panelProps(emptyTask));
  assert.doesNotMatch(html, /No due date|No size/);
  assert.match(html, /<div>-<\/div>/);
  assert.match(html, /<span data-empty="-">-<\/span>/);
});

test("ticket panel shows real values untouched with the flag on", () => {
  flagOn = true;
  const html = render(panel, panelProps({ ...emptyTask, dueDate: "2026-12-01" }, { estimate_index: 3 }));
  assert.match(html, /<time>2026-12-01<\/time>/);
  assert.match(html, /<span data-empty="Medium">Medium<\/span>/);
  assert.doesNotMatch(html, /No due date|No size/);
});

test("new task window says No due date and No size when both are empty", () => {
  flagOn = true;
  modalForm = {};
  const html = render(modal);
  assert.match(html, /<span data-empty="No due date">No due date<\/span>/);
  assert.match(html, /<span data-empty="No size">No size<\/span>/);
  assert.doesNotMatch(html, /data-empty="-"/);
});

test("new task window keeps the dash with the flag off and real values with it on", () => {
  flagOn = false;
  modalForm = {};
  const off = render(modal);
  assert.doesNotMatch(off, /No due date|No size/);
  assert.equal(off.match(/data-empty="-"/g).length, 2);
  flagOn = true;
  modalForm = { dueDate: new Date("2026-12-01T00:00:00Z"), estimate: { estimate_index: 3 } };
  const on = render(modal);
  assert.doesNotMatch(on, /No due date|No size/);
  assert.match(on, /<span data-empty="Medium">Medium<\/span>/);
});

test("the new empty labels use the same muted style as No Priority on phones", () => {
  const phone = (title) => render(clickable, { title }, true);
  const priority = phone("No Priority");
  assert.doesNotMatch(priority, /bg-label-span/);
  for (const title of ["No due date", "No size"]) {
    assert.equal(phone(title).replace(title, "No Priority"), priority);
  }
  assert.match(phone("Medium"), /bg-label-span/);
  assert.equal(render(clickable, { title: "No size" }), render(clickable, { title: "No Priority" }).replace("No Priority", "No size"));
});
