const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const mobile = React.createContext(false);
let cachedLayout = true;
let secondaryPanelsReady = false;
let late = false;
let commentCount = 0;
const noop = () => {};
const marker = (name) => () => React.createElement("div", { "data-part": name }, name);
const task = { id: 42, projectId: 15, title: "Instant title", subTasks: [], description_: { content: "Cached body" } };
const context = () => ({
  cachedLayout, secondaryPanelsReady, currentTask: late ? { ...task, Task_Summary: [{ content: "Late summary" }] } : task,
  hasDraft: false, allowPerks: true, uploadingComments: [], draftsFromTQ: [], visibleFeedItems: Array.from({ length: commentCount }, (_, commentIndex) => ({ kind: "comment", commentIndex })),
  virtualizeIndexes: { taskInfoVirtualIndex: 0, descriptionVirtualIndex: 1, descriptionBottomVirtualIndex: 2, commentsStartVirtualIndex: 3, numberOfComments: commentCount, uploadingCommentsStartVirtualIndex: 3 + commentCount, numberOfUploadingComments: 0 },
  virtualizer: { getVirtualItems: () => [{ index: 0, key: "info", start: 0 }, { index: 1, key: "description", start: 500 }, { index: 2, key: "bottom", start: 1000 }, ...Array.from({ length: commentCount }, (_, i) => ({ index: 3 + i, key: `comment-${i}`, start: 1500 + 500 * i }))], getTotalSize: () => 1500 + 500 * commentCount, measureElement: noop },
});

function load(relative, mocks) {
  const source = fs.readFileSync(path.join(process.env.STABLE_LAYOUT_SOURCE_ROOT || root, relative), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports = {};
  for (const mock of Object.values(mocks)) if ("default" in mock) mock.__esModule = true;
  new Function("require", "exports", js)((name) => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return require(name);
    assert.ok(name in mocks, `Unexpected dependency in ${relative}: ${name}`);
    return mocks[name];
  }, exports);
  return exports;
}
const common = {
  "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: context },
  "@/lib/contexts/mobileContext": { MobileViewContext: mobile },
  "@/hooks/useFlag": { useFlag: () => cachedLayout },
  "@/lib/flags/keys": { HTPR_6752_INSTANT_TICKET_OPEN_FLAG: "instant", HTPR_6967_TYPED_TASK_READS_FLAG: "htpr-6967-typed-task-reads" },
  "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
};
const title = load("src/components/PageComponents/TaskDetail/TopRow/TaskDetailTitleContainer.tsx", {
  ...common,
  "../TaskOptions/TaskOptions": { default: marker("options") },
  "./TaskTitle": { default: marker("title") },
  "./TaskSummary": { default: marker("summary") },
  "@/components/Modals/Sheets/SummarySheet": { TaskSummaryMobile: marker("summary") },
  "./SubtaskLink": { default: marker("parent") },
  "./BaseTitleContainer": { default: ({ hasSummary, children }) => React.createElement("header", { "data-summary-space": String(hasSummary) }, children) },
  "./MobileTaskDueDate": { default: marker("due") },
}).default;
const info = marker("info");
const lateInfo = marker("late-info");
const thread = load("src/components/PageComponents/TaskDetail/CommentAndDescription/index.tsx", {
  ...common,
  "@/hooks/General/useHydrated": { useHydrated: () => true },
  "next/dynamic": { default: () => marker("reactions") },
  "./DescriptionContainer": { default: ({ children }) => React.createElement("article", { "data-part": "description" }, children) },
  "./DescriptionContainer/TopRow/DescriptionTopRow": { default: marker("author") },
  "@/lib/contexts/TaskDetail/DescriptionProvider": { useDescriptionAndCommentsContext: () => ({ comments: Array.from({ length: commentCount }, (_, i) => ({ id: String(i + 1) })), stacked: {} }) },
  "./UploadingDescription/UploadingDescriptionContainer": { default: marker("upload-description") },
  "./DescriptionContainer/DescriptionSubTasks/DescriptionSubTasks": { default: marker("subtasks") },
  "./DescriptionContainer/DescriptionSubTasks/DescriptionPages": { default: marker("pages") },
  "./DescriptionContainer/DescriptionSubTasks/TaskPagesContext": { TaskPagesProvider: ({ children }) => children },
  "@/lib/contexts/CommentsContext": { CommentsProvider: ({ children }) => children },
  "./CommentContainer/CommentsContainer": { default: marker("comment") },
  "./UploadingComment/UploadingCommentContainer": { default: marker("upload-comment") },
  "./CommentContainer/NewCommentComponent": { default: marker("composer") },
  "./DescriptionContainer/DescriptonBody": { default: marker("body") },
  "../TaskInfoColumn/TaskInfo": { default: info, TaskInfoLateDetails: lateInfo },
  "@/lib/configs/taskDetail.config": { taskDetailSpacing: { mobile: { descriptionContainer: "" } } },
  "./BaseCommentAndDescriptionContainer": { default: ({ children }) => React.createElement("main", null, children) },
  "@/components/Common/RichTextPersonHovercards": { default: marker("hovercards") },
  "./AgentRunActivityRow": { default: marker("activity") },
}).default;

function html(Component, isMobile, props = {}) {
  return renderToStaticMarkup(React.createElement(mobile.Provider, { value: isMobile }, React.createElement(Component, props)));
}

test("cached mobile summary fills its existing slot without changing its geometry", () => {
  cachedLayout = true;
  late = false;
  const before = html(title, true, { toggleDueDate: noop });
  late = true;
  const after = html(title, true, { toggleDueDate: noop });
  assert.match(before, /data-summary-space="true"/);
  const slot = /<div[^>]*data-task-summary-slot[^>]*>/;
  assert.match(before, slot);
  assert.equal(before.match(slot)[0], after.match(slot)[0]);
  assert.match(after, /data-part="summary"/);
});

test("cached desktop title reserves a summary row only when the ticket has a summary", () => {
  for (const summaryPresent of [false, true]) {
    late = summaryPresent;
    cachedLayout = false;
    const legacy = html(title, false, { toggleDueDate: noop });
    cachedLayout = true;
    const cached = html(title, false, { toggleDueDate: noop });
    const padding = /data-summary-space="[^"]+"/;
    assert.equal(cached.match(padding)[0], legacy.match(padding)[0]);
    if (summaryPresent) {
      assert.match(cached, /data-task-summary-slot[^>]*h-\[21px\]/);
      assert.match(cached, /data-part="summary"/);
    } else {
      assert.doesNotMatch(cached, /data-task-summary-slot/);
    }
  }
  late = false;
});

test("cached mobile property and description rows paint in normal flow without the virtualizer's 500px estimate", () => {
  cachedLayout = true;
  secondaryPanelsReady = false;
  const output = html(thread, true);
  assert.match(output, /data-part="info"/, "cached properties must be present before secondary editors mount");
  const row = output.match(/<div[^>]*data-index="1"[^>]*>/)?.[0];
  assert.ok(row, "description row exists immediately");
  assert.doesNotMatch(row, /position:absolute|translateY/, "an unmeasured mobile row must not position the description");
  assert.match(row, /position:relative/);
});

test("late pages and mobile property relations are outside the painted description and below the thread", () => {
  cachedLayout = true;
  secondaryPanelsReady = true;
  const output = html(thread, true);
  const description = output.match(/<article[^>]*data-part="description"[^>]*>(.*?)<\/article>/)?.[1];
  assert.ok(description);
  assert.doesNotMatch(description, /data-part="pages"/);
  assert.ok(output.indexOf('data-part="pages"') > output.indexOf('id="bottom-description"'));
  assert.ok(output.indexOf('data-part="late-info"') > output.indexOf('id="bottom-description"'));
});

test("flag-off title and mobile virtual rows retain the original layout and page placement", () => {
  cachedLayout = false;
  secondaryPanelsReady = true;
  late = false;
  const heading = html(title, true, { toggleDueDate: noop });
  assert.match(heading, /data-summary-space="false"/);
  assert.doesNotMatch(heading, /data-task-summary-slot/);
  const output = html(thread, true);
  assert.match(output, /data-index="1"[^>]*translateY\(500px\)/);
  assert.match(output, /<article[^>]*>.*data-part="pages".*<\/article>/);
  assert.doesNotMatch(output, /data-part="late-info"/);
});

const rail = load("src/components/PageComponents/TaskDetail/TaskInfoColumn/TaskInfo.tsx", {
  ...common,
  "@/lib/api/typedClient": { getTaskCycle: noop },
  axios: { default: {} },
  "react-hot-toast": { default: {} },
  "@tanstack/react-query": { useQueryClient: () => ({}) },
  "@/lib/state": { useRecoilState: () => [{}, noop] },
  "@/components/PageComponents/TaskDetail/MainPageComponents": {
    AssigneeCard: marker("assignee"),
    ClickableSpan: ({ title }) => React.createElement("span", null, title),
    LocalRightSideInfo: ({ title }) => React.createElement("label", null, title),
    TaskInfoColumnContainer: ({ children }) => React.createElement("aside", null, children),
    TaskInfoLabel: ({ children }) => React.createElement("label", null, children),
    TaskInfoRow: ({ children }) => React.createElement("section", null, children),
    TaskInfoValue: ({ children }) => React.createElement("div", null, children),
  },
  "@/hooks/General/useCopyURL": { default: () => ({ copyTicketNumber: noop }) },
  "@/hooks/General/useProjectQuery": { useProjectQuery: () => ({ goToProjectShortcut: noop }) },
  "@/hooks/MultiPages/useGetMembersForAssignees": { useGetAllMembersForAssign: () => ({}) },
  "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
  "../AssigneesContainer": { default: marker("assignees") },
  "@/components/Common/Tooltip": { default: () => null },
  "@/components/Modals/TaskPriority/PriorityLabelComponent": { default: marker("priority") },
  "@/components/Modals/CreateLabel/TaskLabelComponent": { default: marker("tag") },
  "./RelatedTaskLabel": { default: ({ relationInfo }) => React.createElement("a", { href: relationInfo.route }, relationInfo.title) },
  "lucide-react": Object.fromEntries(["ArrowRight", "CornerLeftUp", "GitMerge", "GitPullRequest", "TriangleAlert"].map(name => [name, () => null])),
  "@/components/Labels/DueDateLabel": { default: marker("date") },
  "@/lib/constants/constants": { EstimateConstants: [] },
  "@/lib/configs/taskDetail.config": { default: {} },
  "./TaskTime": { default: () => null },
  "@/lib/staleness": { daysSince: () => 0, stalenessLevel: () => "none" },
  "@/store": { showCommandsAtom: {} },
  "@/models/enums": { CommandMode: {} },
  "@/lib/recurrence": { RECURRENCE_LABELS: {} },
  "@/components/Modals/CyclePicker": { default: () => null },
  "@/lib/waitingOn": { formatWaitingOnAge: () => null, WAITING_ON_OVERDUE_MS: 1000 },
  "@/lib/pullRequests/githubPullRequests": { derivePullRequestDisplayState: () => "merged" },
  "@/components/PageComponents/TaskDetail/pullRequestBadge": { pullRequestBadgeByState: { merged: { color: "purple", label: "Merged" } } },
  "@prisma/client": { CustomFieldType: {} },
});
const fullTask = {
  ...task, ticketNumber: "HTPR-42", section: "Bugs", project: { title: "Board" },
  pullRequests: [{ id: 1, number: 99, repositoryName: "app", url: "https://example.invalid/pull/99", lifecycle: "merged" }],
  relatedFromTasks: [{ id: 2, relationType: "Related", targetTask: { id: 43, projectId: 15, uniqueIndex: 43, ticketNumber: "HTPR-43", title: "Related ticket" } }],
};
const railProps = currentTask => ({ currentTask, _parsedTask: currentTask, followers: [], sectionsForProjectTQ: [], labelsFromTQ: [], removeRelationHandler: noop });

test("real cached property rail keeps late PRs below regular desktop rows and out of the mobile top card", () => {
  cachedLayout = true;
  const desktop = html(rail.default, false, railProps(fullTask));
  assert.ok(desktop.indexOf("Pull requests") > desktop.indexOf("Tags"), "a PR response must not insert rows above Due date, Project, Priority, Task size or Tags");
  assert.match(desktop, /https:\/\/example.invalid\/pull\/99/);
  const phone = html(rail.default, true, railProps(fullTask));
  assert.doesNotMatch(phone, /Pull requests|Related ticket/);
  assert.match(phone, /Due date/);
  assert.equal(typeof rail.TaskInfoLateDetails, "function");
  const trailing = html(rail.TaskInfoLateDetails, true, railProps(fullTask));
  assert.match(trailing, /Pull requests/);
  assert.match(trailing, /Related ticket/);
  assert.equal(html(rail.TaskInfoLateDetails, true, railProps(task)), "", "no empty late-properties card");
});

test("real flag-off property rail keeps PRs in their existing location above Due date", () => {
  cachedLayout = false;
  for (const isMobile of [false, true]) {
    const output = html(rail.default, isMobile, railProps(fullTask));
    assert.ok(output.indexOf("Pull requests") < output.indexOf("Due date"));
    assert.match(output, /Related ticket/);
  }
});

const hookSource = ts.createSourceFile("state.ts", fs.readFileSync(path.join(process.env.STABLE_LAYOUT_SOURCE_ROOT || root, "src/hooks/Task Detail/useTaskDetailGlobalStates.ts"), "utf8"), ts.ScriptTarget.Latest, true);
const hook = hookSource.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(hookSource) === "useTaskDetailGlobalStates")).declarationList.declarations[0].initializer;
const options = hook.body.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(hookSource) === "virtualizerOptions")).declarationList.declarations[0].initializer;
const extractor = options.properties.find(node => node.name?.getText(hookSource) === "rangeExtractor");
const extractorJS = ts.transpileModule(`return (${extractor.initializer.getText(hookSource)});`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

test("real cached range extractor pins every natural-flow top row even after scrolling out of the initial viewport", () => {
  const extract = new Function("cachedLayout", "virtualizeIndexes", "defaultRangeExtractor", extractorJS)(true, { descriptionVirtualIndex: 1, commentsStartVirtualIndex: 3 }, () => [20, 21]);
  assert.deepEqual(extract({}), [0, 1, 2, 20, 21], "removing a natural-flow property row would move the description while scrolling");
  const original = new Function("cachedLayout", "virtualizeIndexes", "defaultRangeExtractor", extractorJS)(false, { descriptionVirtualIndex: 1, commentsStartVirtualIndex: 3 }, () => [20, 21]);
  assert.deepEqual(original({}), [1, 20, 21], "flag-off still pins only the existing description row");
});

test("desktop composer follows the entire virtualized thread with stable layout on and off", () => {
  secondaryPanelsReady = true;
  for (const cached of [true, false]) {
    cachedLayout = cached;
    for (const count of [0, 1, 30]) {
      commentCount = count;
      const output = html(thread, false);
      assert.equal((output.match(/data-part="composer"/g) || []).length, 1);
      assert.ok(output.indexOf('data-part="composer"') > output.lastIndexOf('data-part="comment"'));
      assert.match(output, /<\/div><div data-part="composer">/, "composer must be outside the virtualized height wrapper, not inside a row");
      if (cached && !count) {
        assert.doesNotMatch(output, /min-height:/, "empty cached threads use their real top-row height, not estimates");
      } else {
        assert.match(output, new RegExp(`<div style="min-height:${context().virtualizer.getTotalSize()}px;`), "reserve the full virtualized height for absolutely positioned comments");
      }
      if (cached) {
        assert.match(output, /data-index="2"[^>]*position:relative/, "stable-layout top rows retain natural flow");
        assert.ok(output.indexOf('data-part="pages"') > output.indexOf('data-part="composer"'));
      }
      assert.doesNotMatch(html(thread, true), /data-part="composer"/, "mobile keeps its separate composer");
    }
  }
  commentCount = 0;
  cachedLayout = true;
});

let editMode = null;
let editorMounts = 0;
const body = load("src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/DescriptonBody.tsx", {
  ...common,
  "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => ({ ...context(), parsedTask: JSON.stringify(task), editMode, setCarousalItems: noop }) },
  "@/lib/contexts/TaskDetail/DescriptionProvider": { useDescriptionAndCommentsContext: () => ({ description: "<p>Cached body</p>", descriptionAttachments: [], setDescriptionAttachments: noop }) },
  "@/components/Common/AttachmentsView": { default: () => null },
  "@/hooks/Task Detail/CommentAndDescriptionHooks/useSaveContent": { default: () => ({ redirectAPI: noop }) },
  "@/hooks/General/useHasDrafts": { isMeaningfulDescriptionDraft: () => false },
  "./InnerHtmlDescription": { default: ({ id, descriptionText, setCarousalItems, className }) => {
    assert.equal(setCarousalItems, cachedLayout ? noop : undefined, "only cached static images add the attachment-gallery action");
    return React.createElement("div", { id, className, dangerouslySetInnerHTML: { __html: descriptionText } });
  } },
  "../ContextMenu": { HighlightMenu: () => null },
  "../ContextMenu/QuoteButton": { default: () => null },
  "@/components/RTE/TipTapTaskDetail": { default: () => { editorMounts++; return React.createElement("div", null, "Rich editor"); } },
  "../BackgroundTaskAttachments": { default: () => null },
  "@/utils/helperFunctions/linkifyHtml": { linkifyHtml: content => content },
}).default;

const author = load("src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/TopRow/DescriptionTopRow.tsx", {
  ...common,
  "./DescriptionTopRight": { default: marker("author-actions") },
  "../../Common/CreatedBy": { default: marker("creator") },
  "@/lib/configs/taskDetail.config": { taskDetailSpacing: { mobile: { descriptionContainer: "" } } },
}).default;

test("cached desktop author uses the settled row height without changing mobile", () => {
  cachedLayout = true;
  assert.match(html(author, false), /h-\[21px\]/);
  assert.doesNotMatch(html(author, false), /h-6/);
  assert.match(html(author, true), /h-6/);
  cachedLayout = false;
  assert.doesNotMatch(html(author, false), /h-\[21px\]|h-6/);
});

test("cached desktop static body uses the settled editor height and margin without changing mobile", () => {
  cachedLayout = true;
  secondaryPanelsReady = true;
  editMode = null;
  assert.match(html(body, false, { draftTQ: [] }), /class="!min-h-\[80px\] !mb-0"/);
  assert.doesNotMatch(html(body, true, { draftTQ: [] }), /!min-h|!mb-0/);
  cachedLayout = false;
  secondaryPanelsReady = false;
  assert.doesNotMatch(html(body, false, { draftTQ: [] }), /!min-h|!mb-0/);
});

test("real cached description retains its first-painted HTML until editing starts, not just until secondary panels settle", () => {
  cachedLayout = true;
  editMode = null;
  editorMounts = 0;
  secondaryPanelsReady = false;
  const before = html(body, false, { draftTQ: [] });
  secondaryPanelsReady = true;
  assert.equal(html(body, false, { draftTQ: [] }), before);
  assert.equal(editorMounts, 0);
  editMode = "description";
  assert.match(html(body, false, { draftTQ: [] }), /Rich editor/);
  assert.equal(editorMounts, 1);
  editMode = null;
  cachedLayout = false;
  assert.match(html(body, false, { draftTQ: [] }), /Rich editor/, "flag-off editor mounting is unchanged");
});

test("cached layout requires both flags and flag-off keeps the production layout", () => {
  const statement = hook.body.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(hookSource) === "[cachedLayout]"));
  assert.ok(statement, "the real hook must declare its cached-layout state");
  const flag = hook.body.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(hookSource) === "stableLayoutFlag"));
  assert.ok(flag, "stable layout must read its own ticket-specific flag");
  assert.equal(flag.declarationList.declarations[0].initializer.getText(hookSource), "useFlag(HTPR_6899_STABLE_LAYOUT_FLAG)");
  const initializer = statement.declarationList.declarations[0].initializer.getText(hookSource);
  const js = ts.transpileModule(`return ${initializer};`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const initialize = new Function("instantTicketOpen", "stableLayoutFlag", "cachedNavigation", "initialCommentsPayload", "useState", js);
  const state = (value) => [value];
  for (const instant of [false, true]) {
    for (const stable of [false, true]) {
      for (const navigation of [false, true]) {
        for (const pending of [false, true]) {
          assert.deepEqual(initialize(instant, stable, navigation, { pending }, state), [instant && stable && (navigation || pending)]);
        }
      }
    }
  }
  commentCount = 1;
  secondaryPanelsReady = true;
  late = false;
  for (const [instant, stable] of [[true, false], [false, true], [false, false]]) {
    [cachedLayout] = initialize(instant, stable, true, { pending: true }, state);
    for (const isMobile of [false, true]) {
      const output = html(thread, isMobile);
      const row = output.match(/<div[^>]*data-index="1"[^>]*>/)?.[0];
      if (isMobile) {
        assert.match(row, /position:absolute.*translateY\(500px\)/);
        assert.match(output, /<div style="height:2000px;/);
      } else {
        assert.match(row, /position:relative/);
        assert.doesNotMatch(row, /translateY/);
        assert.match(output, /<div style="min-height:2000px;/, "production reserves desktop space without fixing its height");
        assert.ok(output.indexOf('data-part="composer"') > output.indexOf('data-part="comment"'), "flag-off retains the composer after comments");
        assert.equal((output.match(/data-part="composer"/g) || []).length, 1);
      }
      assert.match(output, /<article[^>]*>.*data-part="pages".*<\/article>/);
      assert.doesNotMatch(output, /data-part="late-info"/);
      assert.doesNotMatch(html(title, isMobile, { toggleDueDate: noop }), /data-task-summary-slot/);
    }
  }
  commentCount = 0;
});

test("quote scroll targets the composer under cached layout and retains legacy scrolling otherwise", () => {
  const declaration = name => hook.body.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(hookSource) === name)).declarationList.declarations[0];
  const source = `const ${declaration("scrollVirtualize").getText(hookSource)}; const ${declaration("InsertContentInCommentInput").getText(hookSource)}; return InsertContentInCommentInput;`;
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  for (const cached of [false, true]) {
    for (const isMobile of [false, true]) {
      const scrolls = [];
      const quotes = [];
      const modes = [];
      const focuses = [];
      const timers = [];
      const insert = new Function("cachedLayout", "_mbl", "virtualizer", "virtualizeIndexes", "_count", "wrapBlockQuote", "selectPElementWithDataPlaceholderInDiv", "setReplyQuote", "focusOn", "setEditMode", "setTimeout", js)(
        cached, isMobile, { scrollToIndex: (...args) => scrolls.push(args) }, { descriptionBottomVirtualIndex: 2 }, 25,
        content => `<blockquote>${content}</blockquote>`, () => ({}), value => quotes.push(value), (...args) => focuses.push(args), value => modes.push(value), callback => timers.push(callback),
      );
      insert("Quoted text", {});
      assert.deepEqual(scrolls, [[cached && !isMobile ? 2 : 24, { align: cached ? "center" : "end" }]]);
      assert.deepEqual(quotes, ["<blockquote>Quoted text</blockquote>"]);
      assert.deepEqual(modes, ["comment"]);
      assert.deepEqual(focuses, [["comment-input", false]]);
      assert.equal(timers.length, 1);
      timers[0]();
      assert.deepEqual(quotes, ["<blockquote>Quoted text</blockquote>", ""]);
    }
  }
});
