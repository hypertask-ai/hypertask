const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const React = require("react");
const { renderToString } = require("react-dom/server");
const query = require("@tanstack/react-query");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const task = { id: 42, projectId: 6859, uniqueIndex: 43, title: "Cached title", description_: { content: "<p>Cached description</p>" } };
let providerPayload;
let stableLayoutEnabled = true;
const mocks = {
  "react": React,
  "react/jsx-runtime": require("react/jsx-runtime"),
  "@tanstack/react-query": query,
  "@/lib/state": { useRecoilValue: () => ({ id: 2343 }) },
  "@/store": { currentUserAtom: {} },
  "@/hooks/General/useGetUserPreferences": { useGetUserPreferences: () => ({ data: { commentsStacked: false, scrollSetting: "Bottom" } }) },
  "@/hooks/useFlag": { useFlagReady: () => true, useFlag: (key) => { if (["htpr-7009-dedupe-task-detail-reads", "htpr-6962-keep-assignee", "htpr-7004-no-loading-flash"].includes(key)) return false; assert.equal(key, "htpr-6899-stable-layout"); return stableLayoutEnabled; } },
  "@/lib/flags/keys": { HTPR_7009_DEDUPE_TASK_DETAIL_READS_FLAG: "htpr-7009-dedupe-task-detail-reads", HTPR_6899_STABLE_LAYOUT_FLAG: "htpr-6899-stable-layout", HTPR_6962_KEEP_ASSIGNEE_FLAG: "htpr-6962-keep-assignee", HTPR_7004_NO_LOADING_FLASH_FLAG: "htpr-7004-no-loading-flash" },
  "@/lib/taskDetailReads": require("jiti").createJiti(__filename, {
    alias: { "@": path.join(root, "src") },
  })(path.join(root, "src/lib/taskDetailReads.ts")),
  "@/lib/constants": { default: { CommentsTQPrefixKey: "comments" } },
  "@/lib/contexts/TaskDetail/FollowersProvider": { FollowersProvider: ({ children }) => children },
  "@/lib/contexts/TaskDetail/TaskProvider": { TasksProvider: ({ children, parsedTask, _comments, cachedNavigation }) => { providerPayload = { parsedTask, _comments, cachedNavigation }; return children; }, useTaskContext: () => ({}) },
  "@/lib/navigation/cachedTaskDetail": require("jiti").createJiti(__filename, {
    alias: { "@": path.join(root, "src") },
  })(path.join(root, "src/lib/navigation/cachedTaskDetail.ts")),
  "@/lib/realtime/taskDetailRefresh": { shouldPreserveTaskEditorContent: () => false },
  "@/app/unauthorized/page": { default: () => React.createElement("div", null, "No access") },
  "@/utils/api/Task Detail": { fetchCommentsHelper: () => assert.fail("render must not await comments") },
  "@/app/detail/[...slug]/TaskDetailComp": { default: () => {
    const data = JSON.parse(providerPayload.parsedTask);
    assert.equal(JSON.parse(providerPayload._comments).pending, true, "unknown comments must not be mistaken for an empty read snapshot");
    return React.createElement("article", null, React.createElement("h1", null, data.title), React.createElement("div", { dangerouslySetInnerHTML: { __html: data.description_.content } }));
  } },
};
for (const mock of Object.values(mocks)) {
  if ("default" in mock) mock.__esModule = true;
}
const relativePath = "src/components/Modals/SwipeUnread/EmbeddedTaskDetail.tsx";
const source = process.env.CACHED_DETAIL_BASELINE
  ? execFileSync("git", ["show", `origin/production:${relativePath}`], { cwd: root, encoding: "utf8" })
  : fs.readFileSync(path.join(root, relativePath), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
const exportsObject = {};
new Function("require", "exports", compiled)((name) => {
  if (name === "@/lib/taskDetailReads") return mocks[name];
  if (name === "@/hooks/useFlag") return { ...mocks[name], useFlagReady: () => true, useFlag: key => key === "htpr-7009-dedupe-task-detail-reads" ? false : mocks[name].useFlag(key) };
  if (name === "@/lib/flags/keys") return { ...mocks[name], HTPR_7009_DEDUPE_TASK_DETAIL_READS_FLAG: "htpr-7009-dedupe-task-detail-reads" };
  assert.ok(name in mocks, `Unexpected dependency: ${name}`);
  return mocks[name];
}, exportsObject);
const Detail = exportsObject.default;

test("existing client detail renders cached title and body before task, preferences or comments responses", () => {
  const client = new query.QueryClient();
  const html = renderToString(React.createElement(query.QueryClientProvider, { client }, React.createElement(Detail, { taskId: 42, projectId: 6859, uniqueIndex: 43, initialTask: task, embedded: false })));
  assert.match(html, /Cached title/);
  assert.match(html, /Cached description/);
  assert.doesNotMatch(html, /Loading|spinner/);
  assert.equal(providerPayload.cachedNavigation, true, "cached layout must not depend on whether comments are already in the query cache");
  client.clear();
});

test("stable-layout flag off keeps cached content available without opting into the stable layout", (t) => {
  stableLayoutEnabled = false;
  const client = new query.QueryClient();
  t.after(() => { stableLayoutEnabled = true; client.clear(); });
  const html = renderToString(React.createElement(query.QueryClientProvider, { client }, React.createElement(Detail, { taskId: 42, projectId: 6859, uniqueIndex: 43, initialTask: task, embedded: false })));
  assert.match(html, /Cached title/);
  assert.match(html, /Cached description/);
  assert.equal(providerPayload.cachedNavigation, false);
});

test("server permission denials remove cached content, while a network outage retains it", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  for (const response of [
    { status: 401, ok: false, json: async () => ({}) },
    { status: 403, ok: false, json: async () => ({}) },
    { status: 404, ok: false, json: async () => ({}) },
    { status: 200, ok: true, json: async () => null },
    { status: 200, ok: true, json: async () => ({ ...task, id: 99 }) },
    { status: 200, ok: true, json: async () => ({ ...task, projectId: 15 }) },
    { status: 200, ok: true, json: async () => ({ ...task, status: "Deleted" }) },
    { status: 500, ok: false, json: async () => null },
    { status: 500, ok: false, json: async () => ({ message: "Transient outage" }) },
  ]) {
    const client = new query.QueryClient();
    const render = () => renderToString(React.createElement(query.QueryClientProvider, { client }, React.createElement(Detail, { taskId: 42, projectId: 6859, uniqueIndex: 43, initialTask: task, embedded: false })));
    render();
    const key = ["cached-task-detail", 2343, 42];
    const queryFn = client.getQueryCache().find({ queryKey: key }).options.queryFn;
    global.fetch = async () => response;
    await assert.rejects(client.fetchQuery({ queryKey: key, queryFn, retry: false }));
    const html = render();
    if (response.status === 500) {
      assert.match(html, /Cached title/);
    } else {
      assert.match(html, /No access/);
      assert.doesNotMatch(html, /Cached title|Cached description/);
    }
    client.clear();
  }
});

test("a denied or moved cached ticket re-enters the normal server route without displaying its body", (t) => {
  const previousWindow = global.window;
  t.after(() => { global.window = previousWindow; });
  const replacements = [];
  const href = "https://app.hypertask.ai/detail/project-6859/43?inboxFlow=true#comment-12";
  global.window = { location: { href, replace: (url) => replacements.push(url) } };
  const effects = [];
  const error = new mocks["@/lib/navigation/cachedTaskDetail"].TaskAccessDeniedError();
  const dependencies = {
    ...mocks,
    react: { ...React, useRef: (initial) => ({ current: initial }), useEffect: (effect) => effects.push(effect) },
    "@tanstack/react-query": {
      useQueryClient: () => ({}),
      useQuery: ({ queryKey }) => queryKey[0] === "cached-task-detail" ? { data: task, error } : {},
    },
  };
  const loaded = {};
  new Function("require", "exports", compiled)((name) => dependencies[name], loaded);
  const provider = loaded.default({ taskId: 42, projectId: 6859, uniqueIndex: 43, initialTask: task, embedded: false });
  const child = provider.props.children;
  const result = child.type(child.props);
  assert.equal(result.type, mocks["@/app/unauthorized/page"].default);
  effects.forEach((effect) => effect());
  assert.deepEqual(replacements, [href], "the server must resolve permissions and board-move aliases, preserving inbox/hash context");
});

test("the original embedded SwipeUnread flow still waits for its complete payload", () => {
  const client = new query.QueryClient();
  const html = renderToString(React.createElement(query.QueryClientProvider, { client }, React.createElement(Detail, { taskId: 42, projectId: 6859, uniqueIndex: 43 })));
  assert.match(html, /Loading task/);
  assert.doesNotMatch(html, /Cached title/);
  client.clear();
});

test("description paints cached content and drafts before constructing the rich editor", () => {
  const relativePath = "src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/DescriptonBody.tsx";
  const source = process.env.CACHED_DETAIL_BASELINE
    ? execFileSync("git", ["show", `origin/production:${relativePath}`], { cwd: root, encoding: "utf8" })
    : fs.readFileSync(path.join(root, relativePath), "utf8");
  const noop = () => null;
  let secondaryPanelsReady = false;
  let editorMounts = 0;
  const mocks = {
    "react": React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "@/components/Common/AttachmentsView": { __esModule: true, default: noop },
    "@/hooks/Task Detail/CommentAndDescriptionHooks/useSaveContent": { __esModule: true, default: () => ({ redirectAPI: noop }) },
    "@/lib/contexts/TaskDetail/DescriptionProvider": { useDescriptionAndCommentsContext: () => ({ description: task.description_.content, descriptionAttachments: [], setDescriptionAttachments: noop }) },
    "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => ({ secondaryPanelsReady, currentTask: task, parsedTask: JSON.stringify(task), editMode: null, currentId: "description", allowPerks: true, hasDraft: false, hasDraftInit: false, setCarousalItems: noop }) },
    "@/hooks/useFlag": { useFlag: () => true },
    "@/lib/flags/keys": { HTPR_6752_INSTANT_TICKET_OPEN_FLAG: "htpr-6752-instant-ticket-open" },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "@/hooks/General/useHasDrafts": { isMeaningfulDescriptionDraft: (draft) => Boolean(draft.content) },
    "../ContextMenu": { HighlightMenu: noop },
    "../ContextMenu/QuoteButton": { __esModule: true, default: noop },
    "@/components/RTE/TipTapTaskDetail": { __esModule: true, default: () => { editorMounts++; return React.createElement("div", null, "Editor ready"); } },
    "../BackgroundTaskAttachments": { __esModule: true, default: noop },
    "@/utils/helperFunctions/linkifyHtml": { linkifyHtml: (content) => content },
    "./InnerHtmlDescription": { __esModule: true, default: ({ id, descriptionText }) => React.createElement("div", { id, dangerouslySetInnerHTML: { __html: descriptionText } }) },
  };
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const exportsObject = {};
  new Function("require", "exports", compiled)((name) => {
    if (name === "@/lib/taskDetailReads" && !(name in mocks)) return {};
    if (name === "@/hooks/useFlag" && name in mocks) return { ...mocks[name], useFlagReady: () => true, useFlag: key => key === "htpr-7009-dedupe-task-detail-reads" ? false : mocks[name].useFlag(key) };
    if (name === "@/lib/flags/keys") return { ...mocks[name], HTPR_7009_DEDUPE_TASK_DETAIL_READS_FLAG: "htpr-7009-dedupe-task-detail-reads" };
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, exportsObject);
  const Body = exportsObject.default;
  assert.match(renderToString(React.createElement(Body, { draftTQ: [] })), /id="description-input"[^>]*><p>Cached description/);
  assert.match(renderToString(React.createElement(Body, { draftTQ: [{ content: "<p>Unsaved description draft</p>" }] })), /Unsaved description draft/);
  assert.equal(editorMounts, 0, "first paint must not construct the rich editor");
  secondaryPanelsReady = true;
  assert.match(renderToString(React.createElement(Body, { draftTQ: [] })), /Editor ready/);
  assert.equal(editorMounts, 1, "the existing editor mounts after the cached body paints");
});

test("pending cached details paint property geometry immediately but defer editors until after first paint", () => {
  const state = fs.readFileSync(path.join(root, "src/hooks/Task Detail/useTaskDetailGlobalStates.ts"), "utf8");
  const panels = fs.readFileSync(path.join(root, "src/app/detail/[...slug]/TaskDetailPanels.tsx"), "utf8");
  const thread = fs.readFileSync(path.join(root, "src/components/PageComponents/TaskDetail/CommentAndDescription/index.tsx"), "utf8");
  assert.match(state, /useState\(!instantTicketOpen \|\| !initialCommentsPayload\.pending\)/);
  assert.match(state, /requestAnimationFrame\(\(\) => \{\s*frame = requestAnimationFrame\(\(\) => setSecondaryPanelsReady\(true\)\)/);
  assert.match(state, /return \(\) => cancelAnimationFrame\(frame\)/);
  assert.match(panels, /const stableLayoutFlag = useFlag\(HTPR_6899_STABLE_LAYOUT_FLAG\)/);
  assert.match(panels, /!_mbl && \(\(stableLayoutFlag && cachedLayout\) \|\| secondaryPanelsReady !== false\) && \(\s*<TaskInfo/);
  assert.match(panels, /_mbl && !embedded && secondaryPanelsReady !== false && \(instantTicketOpen \? <Suspense fallback=\{null\}><NewCommentComponent/);
  assert.match(thread, /taskInfoVirtualIndex && _mbl && \(cachedLayout \|\| secondaryPanelsReady !== false\)/);
  assert.match(thread, /!_mbl && secondaryPanelsReady !== false && \(instantTicketOpen \? <Suspense fallback=\{null\}><NewCommentComponent/);
});
