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

function load(relative, mocks, globals = {}) {
  const source = fs.readFileSync(path.join(process.env.STABLE_LAYOUT_SOURCE_ROOT || root, relative), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports = {};
  for (const mock of Object.values(mocks)) if ("default" in mock) mock.__esModule = true;
  new Function("require", "exports", ...Object.keys(globals), js)((name) => {
    if (name === "react") return mocks.react || React;
    if (name === "react/jsx-runtime") return require(name);
    assert.ok(name in mocks, `Unexpected dependency in ${relative}: ${name}`);
    return mocks[name];
  }, exports, ...Object.values(globals));
  return exports;
}
const common = {
  "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: context },
  "@/lib/contexts/mobileContext": { MobileViewContext: mobile },
  "@/hooks/useFlag": { useFlag: () => cachedLayout },
  "@/lib/flags/keys": { HTPR_6752_INSTANT_TICKET_OPEN_FLAG: "instant", HTPR_6899_STABLE_LAYOUT_FLAG: "stable", HTPR_6967_TYPED_TASK_READS_FLAG: "htpr-6967-typed-task-reads" },
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
  "@/hooks/Task Detail/useThreadSettled": { useThreadSettled: () => true },
  "./SettledComposerSlot": { SettledComposerSlot: ({ children }) => children },
  "@/components/PageComponents/TaskDetail/CommentAndDescription/SettledComposerSlot": { SettledComposerSlot: ({ children }) => children },
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

test("the desktop composer follows all comments exactly once and empty cached threads have no estimated-height gap", () => {
  const { JSDOM } = require("jsdom");
  cachedLayout = true;
  secondaryPanelsReady = true;
  commentCount = 0;
  const output = html(thread, false);
  const document = new JSDOM(output).window.document;
  const slot = document.querySelector("[data-task-composer-slot]");
  assert.equal(slot.parentElement.tagName, "MAIN", "the composer slot must be outside the virtualized list");
  assert.equal(slot.previousElementSibling.querySelector('[id="bottom-description"]').parentElement.dataset.index, "2");
  assert.equal(slot.querySelector('[data-part="composer"]').parentElement, slot, "the composer belongs to the trailing slot, not a virtual row");
  assert.equal((output.match(/data-part="composer"/g) || []).length, 1);
  assert.doesNotMatch(output, /height:1500px/, "an empty cached thread must use its real top-row height");
  assert.ok(output.indexOf('data-part="pages"') > output.indexOf('data-part="composer"'));
  for (commentCount of [1, 3]) {
    const afterComments = html(thread, false);
    assert.equal((afterComments.match(/data-part="comment"/g) || []).length, commentCount);
    assert.ok(afterComments.includes(`min-height:${1500 + 500 * commentCount}px`), "desktop reserves thread space without pushing the composer a screen down");
    assert.doesNotMatch(afterComments, /max\(100svh/, "desktop composer must not sit a full screen below short threads");
    assert.ok(afterComments.indexOf('data-part="composer"') > afterComments.lastIndexOf('data-part="comment"'));
    assert.ok(afterComments.indexOf('data-part="pages"') > afterComments.indexOf('data-part="composer"'));
    assert.equal((afterComments.match(/data-part="composer"/g) || []).length, 1);
  }
  commentCount = 0;
  cachedLayout = true;
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
      assert.match(output, cached ? /<\/div><div data-task-composer-slot/ : /<\/div><div data-part="composer">/, "composer must be outside the virtualized height wrapper, not inside a row");
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
  const flag = hook.body.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.initializer?.getText(hookSource) === "useFlag(HTPR_6899_STABLE_LAYOUT_FLAG)"));
  assert.ok(flag, "stable layout must read its own ticket-specific flag");
  assert.equal(flag.declarationList.declarations[0].initializer.getText(hookSource), "useFlag(HTPR_6899_STABLE_LAYOUT_FLAG)");
  const initializer = statement.declarationList.declarations[0].initializer.getText(hookSource);
  const js = ts.transpileModule(`return ${initializer};`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const initialize = new Function("instantTicketOpen", flag.declarationList.declarations[0].name.getText(hookSource), "cachedNavigation", "initialCommentsPayload", "useState", js);
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
      assert.deepEqual(scrolls, cached && !isMobile ? [] : [[24, { align: cached ? "center" : "end" }]], "desktop quoting waits for the real insertion effect instead of starting virtualizer retries");
      assert.deepEqual(quotes, ["<blockquote>Quoted text</blockquote>"]);
      assert.deepEqual(modes, ["comment"]);
      assert.deepEqual(focuses, [["comment-input", false]]);
      assert.equal(timers.length, 1);
      timers[0]();
      assert.deepEqual(quotes, ["<blockquote>Quoted text</blockquote>", ""]);
    }
  }
});

test("new-comment scrolling targets the trailing desktop composer instead of the description spacer", () => {
  const declaration = hook.body.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(hookSource) === "scrollVirtualize")).declarationList.declarations[0];
  const js = ts.transpileModule(`return ${declaration.initializer.getText(hookSource)};`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  for (const cached of [false, true]) for (const isMobile of [false, true]) {
    const scrolls = [];
    const domScrolls = [];
    const scroll = new Function("cachedLayout", "_mbl", "virtualizer", "virtualizeIndexes", "_count", "document", js)(
      cached, isMobile, { scrollToIndex: (...args) => scrolls.push(args) }, { descriptionBottomVirtualIndex: 2 }, 25,
      { getElementById: id => { assert.equal(id, "comment"); return { scrollIntoView: options => domScrolls.push(options) }; } },
    );
    scroll("new-comment");
    assert.deepEqual(scrolls, cached && !isMobile ? [] : [[24, { align: "center" }]]);
    assert.deepEqual(domScrolls, cached && !isMobile ? [{ behavior: "auto", block: "center" }] : []);
  }
});

const config = load("src/lib/configs/taskDetail.config.ts", { "@/utils/htmlEscape": { escapeHtml: value => value } }).default;

test("only cached stable instant opens skip automatic late scrolls; ordinary opens retain saved positioning", () => {
  for (const instant of [false, true]) for (const stable of [false, true]) {
    for (const isMobile of [false, true]) for (const unread of [false, true]) {
      for (const scrollSetting of ["None", "Bottom"]) for (const embedded of [false, true]) for (const cached of [false, true]) {
        const effects = [];
        const timers = [];
        const frames = [];
        const movement = [];
        let clock = 0;
        const scrollTarget = { scrollHeight: 6000, scrollTo: value => movement.push(["bottom", value]), scrollBy: value => movement.push(["offset", value]) };
        const useScroll = load("src/app/detail/[...slug]/useTaskDetailInitialScroll.tsx", {
          react: { useEffect: callback => effects.push(callback), useLayoutEffect: noop, useCallback: callback => callback },
          "@/hooks/useFlag": { useFlag: key => key === "instant" ? instant : stable },
          "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => ({ cachedLayout: cached }) },
          "@/lib/flags/keys": common["@/lib/flags/keys"],
          "@/lib/configs/taskDetail.config": { default: config },
          "@/lib/constants/TaskDetail": { descriptionContainerId: "description-container" },
        }, {
          window: { ...scrollTarget, location: { hash: "" }, history: {}, innerHeight: 844 },
          document: { documentElement: scrollTarget },
          setTimeout: callback => timers.push(callback), clearTimeout: noop,
          requestAnimationFrame: callback => frames.push(callback), performance: { now: () => clock += 1000 },
        }).useTaskDetailInitialScroll;
        const ctx = {
          _parsedTask: task, _mbl: isMobile, scrollSetting, scrollElementRef: embedded ? { current: scrollTarget } : undefined,
          bottomScrollCancelRef: { current: null }, hasBottomScrolledRef: { current: false }, hasScrolledToUnreadRef: { current: false },
          initialScrollGenerationRef: { current: 1 }, initialScrollGuard: { allows: () => true, run: (_, callback) => callback() },
          initialScrollViewportRef: { current: {} }, newCommentsSnapshotReady: false, newCommentIds: [], comments: [], visibleCommentIndices: [],
          virtualizeIndexes: { commentsStartVirtualIndex: isMobile ? 3 : 2 },
          virtualizer: { scrollToIndex: (...args) => movement.push(["index", ...args]) },
          searchParams: new URLSearchParams(embedded ? "inboxFlow=true" : ""),
          focusOn: (...args) => movement.push(["focus", ...args]), defaultCommentFocus: () => movement.push(["composer"]),
          setPriority_: noop, setEstimate_: noop, showCreateTaskModal: { show: false },
        };
        useScroll(ctx);
        assert.equal(effects.length, 5);
        effects[3]();
        effects[4]();
        effects.length = 0;
        ctx.newCommentsSnapshotReady = true;
        ctx.comments = [{ id: "77" }];
        ctx.visibleCommentIndices = [0];
        ctx.newCommentIds = unread ? [77] : [];
        useScroll(ctx);
        effects[4]();
        for (let i = 0; timers.length || frames.length; i++) {
          assert.ok(i < 20, "settling must be bounded");
          timers.splice(0).forEach(callback => callback());
          frames.splice(0).forEach(callback => callback());
        }
        if (instant && stable && cached) {
          assert.deepEqual(movement, [], "late data must not move the first paint or collapse the mobile header");
          assert.equal(ctx.hasBottomScrolledRef.current, false);
          assert.equal(ctx.hasScrolledToUnreadRef.current, false);
        } else {
          assert.ok(movement.length > 0, "ordinary opens or either flag off must retain production's initial positioning");
        }
      }
    }
  }
});

test("both flags preserve comment URL/hash links, reply focus and audio entry without competing unread scrolls", () => {
  const declaration = name => hook.body.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(hookSource) === name)).declarationList.declarations[0];
  const actionsJS = ts.transpileModule(`const ${declaration("focusOn").getText(hookSource)}; const ${declaration("defaultCommentFocus").getText(hookSource)}; const ${declaration("scrollVirtualize").getText(hookSource)}; return { focusOn, scrollVirtualize };`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  for (const isMobile of [false, true]) {
    for (const action of ["commentId", "hash", "reply", "audio"]) for (const cached of [false, true]) {
      const effects = [];
      const timers = [];
      const movement = [];
      const clicks = [];
      const actualScrolls = [];
      const document = { getElementById: id => ({
        click: () => clicks.push(id), focus: noop,
        scrollIntoView: options => actualScrolls.push([id, options]),
      }) };
      const actions = new Function("cachedLayout", "_mbl", "document", "setCurrentId", "virtualizer", "virtualizeIndexes", "comments", "visibleFeedItems", actionsJS)(
        cached, isMobile, document, noop, { scrollToIndex: (...args) => actualScrolls.push(["index", ...args]) },
        { commentsStartVirtualIndex: 3 }, [{ id: "77" }], [{ kind: "comment", commentIndex: 0 }],
      );
      const params = new URLSearchParams();
      if (action !== "hash") params.set(config.searchParams[action], action === "commentId" ? "comment-77" : "true");
      const useScroll = load("src/app/detail/[...slug]/useTaskDetailInitialScroll.tsx", {
        react: { useEffect: callback => effects.push(callback), useLayoutEffect: noop, useCallback: callback => callback },
        "@/hooks/useFlag": { useFlag: () => true },
        "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => ({ cachedLayout: cached }) },
        "@/lib/flags/keys": common["@/lib/flags/keys"],
        "@/lib/configs/taskDetail.config": { default: config },
        "@/lib/constants/TaskDetail": { descriptionContainerId: "description-container" },
      }, {
        window: { location: { hash: action === "hash" ? "#comment-77" : "" }, history: {} },
        document,
        setTimeout: callback => { timers.push(callback); return timers.length; }, clearTimeout: noop,
      }).useTaskDetailInitialScroll;
      useScroll({
        _parsedTask: task, _mbl: isMobile, searchParams: params, scrollSetting: "Bottom", showCreateTaskModal: { show: false },
        bottomScrollCancelRef: { current: null }, hasBottomScrolledRef: { current: false }, hasScrolledToUnreadRef: { current: false },
        initialScrollGenerationRef: { current: 1 }, initialScrollGuard: { allows: () => true, run: (_, callback) => callback() },
        initialScrollViewportRef: { current: {} }, newCommentsSnapshotReady: true, newCommentIds: [77],
        comments: [{ id: "77" }], visibleCommentIndices: [0], virtualizeIndexes: { commentsStartVirtualIndex: 3 },
        virtualizer: { scrollToIndex: (...args) => movement.push(["unread", ...args]) },
        scrollVirtualize: (...args) => { movement.push(["deep-link", ...args]); actions.scrollVirtualize(...args); },
        focusOn: (...args) => { movement.push(["focus", ...args]); actions.focusOn(...args); }, defaultCommentFocus: () => movement.push(["automatic"]),
      });
      const cleanup = effects[3]();
      effects[4]();
      assert.equal(timers.length, 1, `${action} must schedule its explicit action`);
      timers[0]();
      assert.deepEqual(movement, action === "commentId" || action === "hash"
        ? [["deep-link", config.elementIds.comment, 77, undefined, true]]
        : [["focus", config.elementIds.commentInput]]);
      assert.deepEqual(actualScrolls, action === "commentId" || action === "hash"
        ? [["index", 3, { align: "center", behavior: "auto" }]]
        : [[config.elementIds.commentInput, { behavior: "smooth", block: "center" }]], "the real actions must scroll, not just select a comment/composer");
      assert.deepEqual(clicks, action === "audio" ? [`${config.audioButtons.createComment}-${config.audioButtons.suffix}`] : []);
      assert.equal(typeof cleanup, "function", "explicit action timeout is cancelled on cleanup");
    }
  }
});

test("stable-layout flag imports do not collide with production's independent useFlag import", () => {
  const source = fs.readFileSync(path.join(process.env.STABLE_LAYOUT_SOURCE_ROOT || root, "src/components/RTE/useTaskDetailEditorEvents.tsx"), "utf8");
  const productionImport = 'import { useFlag } from "@/hooks/useFlag";';
  const combined = ts.createSourceFile("events.tsx", source.startsWith(productionImport) ? source : `${productionImport}\n${source}`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bindings = combined.statements.filter(ts.isImportDeclaration).flatMap(statement => {
    const clause = statement.importClause;
    return [...(clause?.name ? [clause.name.text] : []), ...(clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
      ? clause.namedBindings.elements.map(element => element.name.text) : [])];
  });
  assert.equal(new Set(bindings).size, bindings.length, "combined PR builds must not redeclare production import bindings");
});

test("late composer and reaction controls fill reserved space and pages start below the first viewport", () => {
  cachedLayout = true;
  for (commentCount of [0, 3]) for (const isMobile of [false, true]) {
    secondaryPanelsReady = false;
    const before = html(thread, isMobile);
    secondaryPanelsReady = true;
    const after = html(thread, isMobile);
    if (isMobile) assert.ok(before.includes(`min-height:max(100svh, ${commentCount ? 1500 + 500 * commentCount : 0}px)`));
    else assert.doesNotMatch(before, /max\(100svh/);
    assert.match(before, /data-task-reactions-slot="true" class="flow-root min-h-\[38px\]"/);
    if (!isMobile) {
      const slot = /<div[^>]*data-task-composer-slot[^>]*>/;
      assert.equal((before.match(/data-task-composer-slot/g) || []).length, 1);
      assert.equal((after.match(/data-task-composer-slot/g) || []).length, 1);
      assert.equal(before.match(slot)[0], after.match(slot)[0]);
      assert.match(before.match(slot)[0], /min-h-\[168px\]/);
      assert.doesNotMatch(before, /data-part="composer"/);
      assert.equal((after.match(/data-part="composer"/g) || []).length, 1);
      const beforeSlot = before.indexOf(before.match(slot)[0]);
      const afterSlot = after.indexOf(after.match(slot)[0]);
      assert.equal(before.slice(0, beforeSlot), after.slice(0, afterSlot), "mounting the composer cannot change upstream rows or reserved thread height");
      if (commentCount) {
        assert.ok(beforeSlot > before.lastIndexOf('data-part="comment"'));
        assert.ok(afterSlot > after.lastIndexOf('data-part="comment"'));
      }
      assert.ok(after.indexOf('data-part="pages"') > afterSlot);
    } else {
      assert.doesNotMatch(before + after, /data-task-composer-slot|data-part="composer"/, "mobile keeps its separate composer");
      assert.equal(before, after);
    }
  }
  commentCount = 0;
  cachedLayout = false;
  const original = html(thread, false);
  assert.doesNotMatch(original, /data-task-(composer|reactions)-slot|max\(100svh/);
});

test("the real quote insertion effect fills the composer before centering it clear of the sticky header", () => {
  for (const instant of [false, true]) for (const stable of [false, true]) {
    const effects = [];
    const events = [];
    let html = "";
    const editor = { state: { selection: { $from: { parent: { textBetween: () => "" }, parentOffset: 0 } } }, commands: { insertContent: content => { html += content; events.push("insert"); } } };
    const useEvents = load("src/components/RTE/useTaskDetailEditorEvents.tsx", {
      react: { useEffect: callback => effects.push(callback), useLayoutEffect: noop },
      "@/hooks/useFlag": { useFlag: key => key === "instant" ? instant : key === "stable" && stable },
      "@/lib/flags/keys": { ...common["@/lib/flags/keys"], HTPR_6929_COMPOSE_TASK_WRITER_FLAG: "compose", HTPR_6937_NEW_TASK_WINDOW_FLAG: "new-task-window" },
      "@/lib/state": { useSetRecoilState: () => noop },
      "@/store": { showCommandsAtom: {} },
      "@/models/enums": { CommandMode: {} },
      "react-hot-toast": { default: {} }, axios: { default: {} },
      "@/hooks/MultiPages/useClickOutside": { default: noop },
      "../PageComponents/TaskDetail/TopRow/CreateSummaryButton": {},
      "@/lib/constants/aiEvents": {}, "./Components/EmojiGifPicker": {},
    }, { document: { getElementById: id => {
      assert.equal(id, "comment-input");
      return { scrollIntoView: options => events.push(options) };
    } } }).useTaskDetailEditorEvents;
    useEvents({ editor, mode: "create-comment", reply: "<blockquote>Quoted text</blockquote>", isSelected: true, isMbl: false,
      handleFocus: () => events.push("focus"), divIds: {} });
    effects[1]();
    assert.equal(html, "<blockquote>Quoted text</blockquote><p></p>");
    assert.deepEqual(events, ["insert", { behavior: instant && stable ? "auto" : "smooth", block: instant && stable ? "center" : "start" }, "focus"]);
  }
});

test("the desktop Quote popover accepts pointer events despite a contact hovercard blocking body, only with both flags on", () => {
  const { JSDOM } = require("jsdom");
  const source = ts.createSourceFile("highlight.tsx", fs.readFileSync(path.join(process.env.STABLE_LAYOUT_SOURCE_ROOT || root, "src/components/PageComponents/TaskDetail/CommentAndDescription/ContextMenu/HighlightMenu.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let style;
  const visit = node => {
    if (ts.isJsxOpeningElement(node) && node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "className" && attribute.initializer?.getText(source).includes("Popover"))) {
      style = node.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "style")?.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(style && ts.isJsxExpression(style));
  const js = ts.transpileModule(`return ${style.expression.getText(source)};`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const styles = new Function("instantTicketOpen", "stableLayout", "getFloatingStylesOverride", js);
  const originalStyle = { position: "fixed", top: "40px", left: "20px", zIndex: 999999999 };
  const dom = new JSDOM('<body style="pointer-events: none"><div id="popover" class="Popover">Quote</div></body>');
  try {
    const popover = dom.window.document.getElementById("popover");
    for (const instant of [false, true]) for (const stable of [false, true]) {
      const result = styles(instant, stable, () => originalStyle);
      assert.deepEqual(result, instant && stable ? { ...originalStyle, pointerEvents: "auto" } : originalStyle);
      popover.style.cssText = "";
      Object.assign(popover.style, result);
      assert.equal(dom.window.getComputedStyle(popover).pointerEvents, instant && stable ? "auto" : "none");
      assert.equal(dom.window.document.body.style.pointerEvents, "none", "contact hovercard behavior is untouched");
    }
  } finally {
    dom.window.close();
  }
});
