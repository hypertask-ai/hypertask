const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const query = require("@tanstack/react-query");

const root = path.resolve(__dirname, "..");
const dir = "src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/";
const base = process.env.HTPR7395_BASELINE || process.env.HTPR7395_COMPARE_BASELINE;
const flag = "htpr-7395-cached-static-first";
const noop = () => {};
const childrenOnly = ({ children }) => children;
const task = { id: 42, projectId: 6859, uniqueIndex: 43, title: "Cached title", user: { displayName: "QA" }, description_: { content: "<html><head></head><body><p>Cached description</p></body></html>" } };

function load(relative, mocks, baseline = false) {
  const source = (baseline && process.env.HTPR7395_COMPARE_BASELINE) || process.env.HTPR7395_BASELINE
    ? execFileSync("git", ["show", `${base}:${relative}`], { cwd: root, encoding: "utf8" })
    : fs.readFileSync(path.join(root, relative), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)((name) => {
    if (name in mocks) return { __esModule: true, ...mocks[name] };
    if (["react", "react/jsx-runtime", "@tanstack/react-query"].includes(name)) return require(name);
    assert.fail(`Unexpected dependency in ${relative}: ${name}`);
  }, exports);
  return exports;
}

async function fixture(t, { enabled = true, stable = false, legacyStatic = false, baseline = false, content = task.description_.content, editMode = null, draft = null, embedded = false } = {}) {
  const dom = new JSDOM("<div id=root></div>", { url: "https://app.hypertask.ai/detail/project-6859/43" });
  const globals = { window: dom.window, document: dom.window.document, Element: dom.window.Element, DOMParser: dom.window.DOMParser, IS_REACT_ACT_ENVIRONMENT: true };
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(global, name, { configurable: true, writable: true, value });
  }
  const frames = new Map();
  let nextFrame = 0;
  dom.window.requestAnimationFrame = (run) => { frames.set(++nextFrame, run); return nextFrame; };
  dom.window.cancelAnimationFrame = (id) => frames.delete(id);
  const Context = React.createContext(null);
  const MobileViewContext = React.createContext(true);
  const useTaskContext = () => React.useContext(Context);
  const description = { description: content, descriptionAttachments: [], setDescriptionAttachments: noop };
  const flags = {
    HTPR_7395_CACHED_STATIC_FIRST_FLAG: flag,
    HTPR_6899_STABLE_LAYOUT_FLAG: "stable",
    HTPR_6752_INSTANT_TICKET_OPEN_FLAG: "instant",
    HTPR_7091_STATIC_DESCRIPTION_FIRST_FLAG: "static",
    HTPR_7110_APP_SAVED_STATIC_DESCRIPTION_FLAG: "saved",
    HTPR_7009_DEDUPE_TASK_DETAIL_READS_FLAG: "dedupe",
  };
  const flagHooks = { useFlagReady: () => true, useFlag: key => key === flag ? enabled : key === "stable" ? stable : key === "instant" || (["static", "saved"].includes(key) && legacyStatic) };
  const common = {
    "@/hooks/useFlag": flagHooks,
    "@/lib/flags/keys": flags,
    "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext },
    "@/lib/contexts/mobileContext": { MobileViewContext },
    "@/lib/contexts/TaskDetail/DescriptionProvider": { useDescriptionAndCommentsContext: () => description },
  };
  const { isPlainDescriptionHtml, toEditorHtml } = require("jiti").createJiti(__filename, { fsCache: false, alias: { "@": path.join(root, "src") } })(path.join(root, dir, "staticDescriptionHtml.ts"));
  const styles = new Proxy({}, { get: (_, key) => String(key) });
  const shell = load(dir + "StaticDescriptionShell.tsx", {
    "next/navigation": { useRouter: () => ({ push: noop }), useSearchParams: () => null },
    "@/styles/tiptap.module.scss": { default: styles },
    "@/styles/FileDragAndDrop.module.scss": { default: styles },
    "@/lib/configs/taskDetail.config": { taskDetailSpacing: { mobile: { descriptionContainer: "phone-description" } } },
    "@/lib/taskDetailInboxFlow": {},
    "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
    "./staticDescriptionHtml": { toEditorHtml },
  }, baseline);
  let resolveModule;
  const editorModule = new Promise(resolve => { resolveModule = resolve; });
  editorModule.__esModule = true;
  let imports = 0, mounts = 0;
  let suspendEditor = false, releaseChild;
  const childModule = new Promise(resolve => { releaseChild = resolve; });
  function Editor(props) {
    if (suspendEditor) throw childModule;
    React.useEffect(() => { mounts++; }, []);
    return React.createElement("section", { "data-live-editor": true }, React.createElement(shell.StaticDescriptionFrame, { html: props.defaultContent, isMbl: props.isMbl }));
  }
  const slotSource = (baseline && process.env.HTPR7395_COMPARE_BASELINE) || process.env.HTPR7395_BASELINE
    ? execFileSync("git", ["show", `${base}:${dir}DescriptionEditorSlot.tsx`], { cwd: root, encoding: "utf8" })
    : fs.readFileSync(path.join(root, dir + "DescriptionEditorSlot.tsx"), "utf8");
  const compiledSlot = ts.transpileModule(slotSource, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const controlledSlot = {};
  new Function("require", "exports", compiledSlot)(name => {
    if (name === "@/components/RTE/TipTapTaskDetail") { imports++; return editorModule; }
    if (name === "next/dynamic") return { __esModule: true, default: importer => React.lazy(importer) };
    if (name === "./StaticDescriptionShell") return { __esModule: true, ...shell };
    if (name === "./StaticDescriptionPlaceholder") return load(dir + "StaticDescriptionPlaceholder.ts", {}, baseline);
    return require(name);
  }, controlledSlot);
  const Body = load(dir + "DescriptonBody.tsx", {
    ...common,
    "@/components/Common/AttachmentsView": { default: () => null },
    "@/hooks/Task Detail/CommentAndDescriptionHooks/useSaveContent": { default: () => ({ redirectAPI: noop }) },
    "@/hooks/General/useHasDrafts": { isMeaningfulDescriptionDraft: d => Boolean(d.content) },
    "./InnerHtmlDescription": { default: ({ descriptionText }) => React.createElement("div", { id: "description-input", dangerouslySetInnerHTML: { __html: descriptionText } }) },
    "../ContextMenu": { HighlightMenu: () => null },
    "../ContextMenu/QuoteButton": { default: () => null },
    "./DescriptionEditorSlot": controlledSlot,
    "./staticDescriptionHtml": { isPlainDescriptionHtml },
    "../BackgroundTaskAttachments": { default: () => null },
    "@/utils/helperFunctions/linkifyHtml": { linkifyHtml: html => html },
  }, baseline).default;
  const client = new query.QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const initialTask = { ...task, description_: { content } };
  const Detail = load("src/components/Modals/SwipeUnread/EmbeddedTaskDetail.tsx", {
    ...common,
    "@/app/unauthorized/page": { default: () => null },
    "@/lib/navigation/cachedTaskDetail": { cachedTaskDetailKey: (...ids) => ["cached-task-detail", ...ids], TaskAccessDeniedError: class extends Error {} },
    "@/lib/realtime/taskDetailRefresh": { shouldPreserveTaskEditorContent: () => false },
    "@/hooks/General/useGetUserPreferences": { useGetUserPreferences: () => ({ data: { commentsStacked: false, scrollSetting: "Top" } }) },
    "@/lib/contexts/TaskDetail/FollowersProvider": { FollowersProvider: childrenOnly },
    "@/lib/contexts/TaskDetail/TaskProvider": {
      useTaskContext,
      TasksProvider: ({ children, ...props }) => React.createElement(Context.Provider, { value: { ...props, secondaryPanelsReady: true, cachedLayout: stable, currentTask: initialTask, currentId: "", editMode, hasDraft: Boolean(draft), hasDraftInit: false, draftsFromTQ: draft ? [draft] : [] } }, children),
    },
    "@/lib/state": { useRecoilValue: () => ({ id: 2343 }) },
    "@/store": { currentUserAtom: {} },
    "@/lib/constants": { default: { CommentsTQPrefixKey: "comments" } },
    "@/utils/api/Task Detail": { fetchCommentsHelper: () => new Promise(noop) },
    "@/lib/taskDetailReads": { fetchScopedTaskDetail: () => new Promise(noop) },
    "@/app/detail/[...slug]/TaskDetailComp": { default: () => React.createElement("article", null, React.createElement("h1", { id: "title-input" }, initialTask.title), React.createElement(Body, { draftTQ: draft ? [draft] : [] })) },
  }, baseline).default;
  const container = document.getElementById("root");
  const reactRoot = createRoot(container);
  let unmounted = false;
  const unmount = async () => { if (!unmounted) { await React.act(async () => reactRoot.unmount()); unmounted = true; } };
  t.after(async () => { await unmount(); client.clear(); dom.window.close(); });
  return {
    container,
    imports: () => imports,
    mounts: () => mounts,
    frames: () => frames.size,
    unmount,
    async render() { await React.act(async () => reactRoot.render(React.createElement(query.QueryClientProvider, { client }, React.createElement(React.Suspense, { fallback: React.createElement("p", null, "Board fallback") }, React.createElement(Detail, { taskId: 42, projectId: 6859, uniqueIndex: 43, initialTask, embedded }))))); },
    async frame() { await React.act(async () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(run => run(0)); }); },
    async resolve() { await React.act(async () => { resolveModule({ default: Editor }); await editorModule; }); },
    async prime() { const pending = controlledSlot.preloadDescriptionEditor(); await this.resolve(); await pending; },
    suspendChild() { suspendEditor = true; },
    async releaseChild() { await React.act(async () => { suspendEditor = false; releaseChild(); await childModule; }); },
  };
}

async function settled(t, options) {
  const f = await fixture(t, options);
  await f.render();
  await f.frame();
  await f.frame();
  await f.resolve();
  const html = f.container.innerHTML;
  await f.unmount();
  return html;
}

test("cached flag on paints title and saved description before the editor resolves, then matches flag off", async t => {
  const expected = await settled(t, { enabled: false });
  const f = await fixture(t);
  await f.render();
  assert.equal(f.container.querySelector("#title-input")?.textContent, "Cached title");
  assert.match(f.container.querySelector("#description-input")?.textContent ?? "", /Cached description/);
  assert.equal(f.mounts(), 0);
  assert.equal(f.imports(), 0, "editor initialization waits for a paint opportunity");
  await f.frame();
  assert.equal(f.mounts(), 0);
  await f.frame();
  assert.equal(f.imports(), 1);
  assert.match(f.container.textContent, /Cached title.*Cached description/);
  await f.resolve();
  assert.equal(f.mounts(), 1);
  assert.equal(f.container.innerHTML, expected);
});

test("flag off keeps the production cold-editor path and identical settled markup", async t => {
  const expected = await settled(t, { enabled: false, baseline: true });
  const f = await fixture(t, { enabled: false });
  await f.render();
  assert.equal(f.imports(), 1);
  assert.equal(f.container.querySelector("#title-input"), null);
  assert.match(f.container.textContent, /Board fallback/);
  await f.resolve();
  assert.equal(f.container.innerHTML, expected);
});

test("already-static cached stable layout stays unchanged without loading an editor", async t => {
  const expected = await settled(t, { enabled: false, stable: true });
  const f = await fixture(t, { stable: true });
  await f.render();
  assert.match(f.container.textContent, /Cached title.*Cached description/);
  await f.frame();
  await f.frame();
  assert.equal(f.imports(), 0);
  assert.equal(f.container.innerHTML, expected);
});

test("a warm editor still waits for paint and a suspending descendant cannot blank the ticket", async t => {
  const expected = await settled(t, { enabled: false, legacyStatic: true });
  const f = await fixture(t, { legacyStatic: true });
  await f.prime();
  await f.render();
  assert.equal(f.mounts(), 0, "warm module must not construct an editor in the first commit");
  assert.match(f.container.textContent, /Cached title.*Cached description/);
  f.suspendChild();
  await f.frame();
  await f.frame();
  assert.match(f.container.textContent, /Cached title.*Cached description/);
  assert.doesNotMatch(f.container.textContent, /Board fallback/);
  assert.notEqual(f.container.querySelector("article")?.style.display, "none");
  await f.releaseChild();
  assert.equal(f.mounts(), 1);
  assert.equal(f.container.innerHTML, expected);
});

test("unsupported rich content and editing keep the editor-first path", async t => {
  for (const options of [{ content: '<p><img src="x.png"></p>' }, { editMode: "description" }, { editMode: "description-ai" }]) {
    const expected = await settled(t, { ...options, enabled: false });
    const f = await fixture(t, options);
    await f.render();
    assert.equal(f.imports(), 1);
    assert.equal(f.container.querySelector("#title-input"), null);
    await f.resolve();
    assert.equal(f.container.innerHTML, expected);
    await f.unmount();
  }
});

test("unmount cancels the deferred editor mount", async t => {
  const f = await fixture(t);
  await f.render();
  assert.equal(f.frames(), 1);
  await f.unmount();
  assert.equal(f.frames(), 0);
  await f.frame();
  await f.resolve();
  assert.equal(f.imports(), 0);
  assert.equal(f.mounts(), 0);
});


test("a compatible saved phone draft is the first and settled description, not the published body", async t => {
  const draft = { content: "<p>Unsaved phone draft</p>" };
  const expected = await settled(t, { enabled: false, draft });
  const f = await fixture(t, { draft });
  await f.render();
  assert.match(f.container.textContent, /Unsaved phone draft/);
  assert.doesNotMatch(f.container.textContent, /Cached description/);
  await f.frame();
  await f.frame();
  await f.resolve();
  assert.equal(f.container.innerHTML, expected);
});

test("the loaded client flag is true on the very first consumer render", async t => {
  const dom = new JSDOM("<div id=root></div>");
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const flags = load("src/hooks/useFlag.tsx", {
    "@tanstack/react-query": { useQueryClient: () => ({}), useQuery: () => ({ data: { [flag]: true }, isError: false }) },
    "@/lib/realtime/client": { connectRealtimeClient: async () => null },
    "@/lib/realtime/shared": {},
    "@/hooks/General/useHydrated": load("src/hooks/General/useHydrated.ts", {}),
  });
  const observations = [];
  function Consumer() {
    observations.push([flags.useFlag(flag), flags.useFlagReady(flag)]);
    return null;
  }
  const reactRoot = createRoot(document.getElementById("root"));
  t.after(async () => { await React.act(async () => reactRoot.unmount()); dom.window.close(); });
  await React.act(async () => reactRoot.render(React.createElement(flags.FeatureFlagProvider, { userId: 2343 }, React.createElement(Consumer))));
  assert.deepEqual(observations[0], [true, true]);
});

test("the editor's initial null-editor render retains the static geometry under the new flag alone", () => {
  const { renderToString } = require("react-dom/server");
  const Placeholder = React.createContext(null);
  let enabled = true;
  const panels = load("src/components/RTE/TaskDetailEditorPanels.tsx", {
    "@/lib/flags/keys": { HTPR_7395_CACHED_STATIC_FIRST_FLAG: flag, HTPR_6752_INSTANT_TICKET_OPEN_FLAG: "instant" },
    "@/hooks/useFlag": { useFlag: key => key === "instant" || (key === flag && enabled) },
    "@/lib/state": { useRecoilValue: () => false, useSetRecoilState: () => noop },
    "@/store": {},
    "@/models/enums": {},
    "react-dom": require("react-dom"),
    "../PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/StaticDescriptionPlaceholder": { StaticDescriptionPlaceholderContext: Placeholder },
    "@/lib/contexts/TaskDetail/TiptapProvider": { default: childrenOnly },
    "./Components/TiptapBubbleMenu": { default: () => null },
    "./Components/TiptapMainContainer": { default: () => React.createElement("p", null, "live") },
    "../PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/InnerHtmlDescription": { default: () => React.createElement("p", null, "legacy geometry") },
    "../PageComponents/TaskDetail/AI Task Writer/AITaskWriterContainer": {},
    "next/dynamic": { default: () => () => null },
    "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
    "@/lib/configs/taskDetail.config": { taskDetailSpacing: { mobile: { descriptionContainer: "phone-description" } } },
    "./Components/EmojiGifPicker": { default: () => null },
  }).TaskDetailEditorPanels;
  const context = { divIds: {}, mode: "read-edit-description", id: "description", isMbl: true, editor: null, inViewObject: {}, currentTask: task };
  function Render() { return panels(context); }
  const render = () => renderToString(React.createElement(Placeholder.Provider, { value: React.createElement("div", { id: "static-geometry" }, "static") }, React.createElement(Render)));
  assert.match(render(), /id="static-geometry"/);
  enabled = false;
  assert.match(render(), /legacy geometry/);
  assert.doesNotMatch(render(), /id="static-geometry"/);
});

test("the ticket-specific improvement flag defaults to Everyone with release risk and the requested ship date", () => {
  const definition = require("jiti").createJiti(__filename, { fsCache: false })(path.join(root, "src/lib/flags/definitions/htpr-7395-cached-static-first.ts")).default;
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.shippedOn, "2026-10-22");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason);
});
