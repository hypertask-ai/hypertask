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

const highlightedContent = '<html><head></head><body><p>Synthetic <mark data-color="#b89bdd" style="background-color: rgb(184, 155, 221); color: inherit;">highlight</mark> sample</p></body></html>';

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

    HTPR_7091_STATIC_DESCRIPTION_FIRST_FLAG: "static",
    HTPR_7110_APP_SAVED_STATIC_DESCRIPTION_FLAG: "saved",
    HTPR_7009_DEDUPE_TASK_DETAIL_READS_FLAG: "dedupe",
  };
  const flagHooks = { useFlagReady: () => true, useFlag: key => key === flag ? enabled : key === "stable" ? stable : (["static", "saved"].includes(key) && legacyStatic) };
  const common = {
    "@/hooks/useFlag": flagHooks,
    "@/lib/flags/keys": flags,
    "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext },
    "@/lib/contexts/mobileContext": { MobileViewContext },
    "@/lib/contexts/TaskDetail/DescriptionProvider": { useDescriptionAndCommentsContext: () => description },
  };
  const jiti = require("jiti").createJiti(__filename, { fsCache: false, alias: { "@": path.join(root, "src") } });
  const { isPlainDescriptionHtml, toEditorHtml } = jiti(path.join(root, dir, "staticDescriptionHtml.ts"));
  const sanitizeHtml = jiti(path.join(root, "src/utils/helperFunctions/sanitizeHtml.ts"));
  const styles = new Proxy({}, { get: (_, key) => String(key) });
  const shell = load(dir + "StaticDescriptionShell.tsx", {
    "next/navigation": { useRouter: () => ({ push: noop }), useSearchParams: () => null },
    "@/styles/tiptap.module.scss": { default: styles },
    "@/styles/FileDragAndDrop.module.scss": { default: styles },
    "@/lib/configs/taskDetail.config": { taskDetailSpacing: { mobile: { descriptionContainer: "phone-description" } } },
    "@/lib/taskDetailInboxFlow": {},
    "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
    "./staticDescriptionHtml": { toEditorHtml },
    "@/utils/helperFunctions/sanitizeHtml": sanitizeHtml,
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
    if (name === "@/hooks/useFlag") return flagHooks;
    if (name === "@/lib/flags/keys") return flags;
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
    "@/lib/taskDetailReads": { ...require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true })(path.join(root, "src/lib/taskDetailReads.ts")), fetchScopedTaskDetail: () => new Promise(noop) },
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

test("a cold editor waits for paint and a suspending descendant cannot blank the ticket", async t => {
  const expected = await settled(t, { enabled: false, legacyStatic: true });
  const f = await fixture(t, { legacyStatic: true });
  await f.render();
  assert.equal(f.mounts(), 0, "cold module must not construct an editor in the first commit");
  assert.match(f.container.textContent, /Cached title.*Cached description/);
  f.suspendChild();
  await f.frame();
  await f.frame();
  await f.resolve();
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
    "@/lib/flags/definitions/htpr-8173-description-inline-drafts": { HTPR_8173_DESCRIPTION_INLINE_DRAFTS_FLAG: "htpr-8173-description-inline-drafts" },
    "@/lib/flags/keys": { HTPR_7395_CACHED_STATIC_FIRST_FLAG: flag },
    "@/hooks/useFlag": { useFlag: key => (key === flag && enabled) },
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


test("highlighted saved descriptions paint before a cold editor and use the existing warm path", async t => {
  for (const warm of [false, true]) {
    const f = await fixture(t, { content: highlightedContent });
    if (warm) await f.prime();
    await f.render();
    assert.equal(f.container.querySelector("#title-input")?.textContent, "Cached title");
    const mark = f.container.querySelector("#description-input mark");
    assert.ok(mark, "highlight is present before editor initialization");
    const first = mark.outerHTML;
    assert.equal(f.mounts(), warm ? 1 : 0);
    assert.equal(f.imports(), warm ? 2 : 0);
    await f.frame();
    assert.equal(f.mounts(), warm ? 1 : 0);
    await f.frame();
    await f.resolve();
    assert.equal(f.mounts(), 1);
    assert.equal(f.container.querySelector("mark").outerHTML, first);
    await f.unmount();
  }
});

test("static marks match real Tiptap renderHTML and inherit the same colour and size rules", async t => {
  const f = await fixture(t, { content: highlightedContent });
  await f.render();
  const { Editor } = require("@tiptap/core");
  const Highlight = require("@tiptap/extension-highlight").default;
  const StarterKit = require("@tiptap/starter-kit").default;
  const editor = new Editor({
    extensions: [StarterKit, Highlight.configure({ multicolor: true })],
    content: highlightedContent,
    editable: false,
  });
  t.after(() => editor.destroy());
  const editorWrapper = document.createElement("div");
  editorWrapper.className = "hellow editorContainer readOnlyDescription";
  editorWrapper.append(editor.view.dom);
  f.container.append(editorWrapper);
  const actual = f.container.querySelector("#description-input mark");
  const expected = editor.view.dom.querySelector("mark");
  assert.ok(actual, "static highlight must exist");
  const normalise = node => {
    const clone = node.cloneNode(true);
    for (const name of clone.getAttributeNames()) clone.removeAttribute(name);
    for (const name of node.getAttributeNames().sort()) clone.setAttribute(name, node.getAttribute(name));
    return clone.outerHTML;
  };
  const serialized = document.createElement("div");
  serialized.innerHTML = editor.getHTML();
  assert.equal(normalise(actual), normalise(serialized.querySelector("mark")));
  assert.equal(normalise(actual), normalise(expected));
  assert.equal(actual.className, expected.className);
  assert.equal(actual.style.cssText, expected.style.cssText);
  const moduleScss = fs.readFileSync(path.join(root, "src/styles/tiptap.module.scss"), "utf8");
  const globalScss = fs.readFileSync(path.join(root, "src/styles/globals.scss"), "utf8");
  const moduleMark = moduleScss.slice(moduleScss.indexOf(".hellow {")).match(/mark\s*\{([^}]+)\}/)[1];
  const globalMark = globalScss.slice(globalScss.indexOf(".tiptap {")).match(/mark\s*\{([^}]+)\}/)[1];
  const style = document.createElement("style");
  style.textContent = require("sass").compileString(`.tiptap { mark { ${globalMark} } } .hellow { mark { ${moduleMark} } }`).css;
  document.head.append(style);
  for (const node of [actual, expected]) {
    assert.ok(node.closest(".tiptap.ProseMirror"));
    assert.ok(node.closest(".hellow"));
    assert.ok(node.closest(".editorContainer"));
  }
  const properties = ["backgroundColor", "color", "padding", "borderRadius", "boxDecorationBreak", "fontSize", "lineHeight"];
  const staticStyle = window.getComputedStyle(actual);
  const editorStyle = window.getComputedStyle(expected);
  for (const property of properties) assert.equal(staticStyle[property], editorStyle[property], property);
  assert.equal(staticStyle.backgroundColor, "rgb(184, 155, 221)");
  assert.equal(staticStyle.padding, "2px");
  assert.equal(staticStyle.borderRadius, "0.25em");
});

test("only exact native highlighted markup enters the static-safe path", async t => {
  const f = await fixture(t);
  const { isPlainDescriptionHtml } = require("jiti").createJiti(__filename, { fsCache: false, alias: { "@": path.join(root, "src") } })(path.join(root, dir, "staticDescriptionHtml.ts"));
  assert.equal(isPlainDescriptionHtml(highlightedContent, true, true), true);
  assert.equal(isPlainDescriptionHtml(highlightedContent, true), false);
  assert.equal(isPlainDescriptionHtml(highlightedContent), false);
  assert.equal(isPlainDescriptionHtml('<p><mark>Default highlight</mark></p>', true, true), true);
  for (const content of [
    highlightedContent.replace('data-color=', 'class="custom" data-color='),
    highlightedContent.replace('data-color=', 'onclick="alert(1)" data-color='),
    highlightedContent.replace('color: inherit;', 'color: red;'),
    highlightedContent.replace('color: inherit;', 'color: inherit; font-size: 40px;'),
    highlightedContent.replace('rgb(184, 155, 221)', 'rgb(1, 2, 3)'),
    highlightedContent.replace('data-color="#b89bdd" ', ''),
    highlightedContent.replace('highlight</mark>', '<span>highlight</span></mark>'),
    highlightedContent.replace('highlight</mark>', '<img src="x.png"></mark>'),
    '<p><mark id="custom">Other attribute</mark></p>',
    '<p><mark style="background-color: red">Style only</mark></p>',
    '<p><mark><mark>Nested highlight</mark></mark></p>',
    highlightedContent.replace('rgb(184, 155, 221)', 'rgb(184, 154, 477)'),
    highlightedContent.replace('</mark>', '</mark class="custom">'),
  ]) {
    assert.equal(isPlainDescriptionHtml(content, true, true), false, content);
    const rejected = await fixture(t, { content });
    await rejected.render();
    assert.equal(rejected.imports(), 1);
    assert.equal(rejected.container.querySelector("#title-input"), null);
    await rejected.unmount();
  }
  await f.unmount();
});

test("highlight support does not change flag-off behavior even with legacy static flags on", async t => {
  for (const legacyStatic of [false, true]) {
    const f = await fixture(t, { content: highlightedContent, enabled: false, legacyStatic });
    await f.render();
    assert.equal(f.imports(), 1);
    assert.equal(f.frames(), 0);
    assert.equal(f.container.querySelector("#title-input"), null);
    await f.resolve();
    assert.equal(f.mounts(), 1);
    assert.match(f.container.querySelector("mark").textContent, /highlight/);
    await f.unmount();
  }
});


test("highlighted bare list items use the existing editor path instead of inserting a line break", async t => {
  const { isPlainDescriptionHtml } = require("jiti").createJiti(__filename, { fsCache: false, alias: { "@": path.join(root, "src") } })(path.join(root, dir, "staticDescriptionHtml.ts"));
  for (const body of [
    "<ul><li>One <mark>two</mark> three</li></ul>",
    "<ol><li><strong>One <mark>two</mark> three</strong></li></ol>",
  ]) {
    for (const content of [body, `<html><head></head><body>${body}</body></html>`]) {
      assert.equal(isPlainDescriptionHtml(content, true, true), false, content);
      for (const enabled of [false, true]) {
        const f = await fixture(t, { content, enabled });
        await f.render();
        assert.equal(f.imports(), 1, "unsafe list markup must use the pre-existing editor path");
        assert.equal(f.frames(), 0);
        assert.equal(f.container.querySelector("#title-input"), null);
        await f.unmount();
      }
    }
  }
  assert.equal(isPlainDescriptionHtml("<ul><li><p>One <mark>two</mark> three</p></li></ul>", true, true), true);
});

test("warm modules never swap out focused links, activated links or selected description text", async t => {
  for (const legacyStatic of [false, true]) {
    const f = await fixture(t, { legacyStatic, content: '<p>One <a href="https://example.com/">two</a> three</p>' });
    await f.prime();
    await f.render();
    const description = f.container.querySelector("#description-input");
    const link = description.querySelector("a");
    let activated = 0;
    link.addEventListener("click", event => { event.preventDefault(); activated++; });
    await React.act(async () => link.focus());
    assert.equal(document.activeElement, link);
    await f.frame();
    await f.frame();
    assert.equal(f.container.querySelector("#description-input"), description);
    assert.equal(document.activeElement, link, "no warm static-to-editor swap may drop link focus");
    await React.act(async () => link.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await React.act(async () => link.click());
    assert.equal(activated, 1);
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(description.querySelector("p"));
    await React.act(async () => {
      description.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true }));
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new window.Event("selectionchange"));
    });
    await f.frame();
    assert.equal(selection.toString(), "One two three");
    assert.equal(selection.anchorNode, range.startContainer);
    assert.equal(f.container.querySelector("#description-input"), description);
    assert.equal(f.mounts(), 1);
    await f.unmount();
  }
});

test("empty saved descriptions keep the existing editor path and real phone and desktop editing hints", async t => {
  const content = "<html><head></head><body><p></p></body></html>";
  for (const enabled of [false, true]) {
    const f = await fixture(t, { content, enabled });
    await f.render();
    assert.equal(f.imports(), 1, "empty content must not enter the static-first path");
    assert.equal(f.frames(), 0);
    assert.equal(f.container.querySelector("#title-input"), null);
    await f.unmount();
  }
  await fixture(t);
  const { renderToStaticMarkup } = require("react-dom/server");
  const { Editor } = require("@tiptap/core");
  const StarterKit = require("@tiptap/starter-kit").default;
  const editor = new Editor({ extensions: [StarterKit], content, editable: false });
  t.after(() => editor.destroy());
  assert.equal(editor.isEmpty, true);
  const MobileViewContext = React.createContext(true);
  const styles = new Proxy({}, { get: (_, key) => String(key) });
  for (const enabled of [false, true]) {
    const TiptapEditor = load("src/components/RTE/Components/TiptapEditor.tsx", {
      "@/lib/contexts/TaskDetail/TiptapProvider": { useTiptapGlobalContext: () => ({ mode: "read-edit-description", id: "description", editor, isEditable: false }) },
      "@/styles/tiptap.module.scss": { default: styles },
      "@tiptap/react": require("@tiptap/react"),
      "@/lib/contexts/mobileContext": { MobileViewContext },
      "./DragHandleTiptap": { default: () => null },
      "@/hooks/useFlag": { useFlag: () => enabled },
      "@/lib/flags/keys": {},
    }).default;
    for (const isMbl of [true, false]) {
      const html = renderToStaticMarkup(React.createElement(MobileViewContext.Provider, { value: isMbl }, React.createElement(TiptapEditor)));
      assert.match(html, /Add Description/);
      assert.ok(html.includes(isMbl ? "Tip: Double tap to edit" : "Tip: Hit ENTER to edit mode or CTRL+D to jump here"));
    }
  }
});


test("static eligibility requires validated text while flag off retains empty markup eligibility", async t => {
  await fixture(t);
  const { isPlainDescriptionHtml } = require("jiti").createJiti(__filename, { fsCache: false, alias: { "@": path.join(root, "src") } })(path.join(root, dir, "staticDescriptionHtml.ts"));
  for (const body of ["<p></p>", "<p><strong></strong></p>"]) {
    for (const content of [body, `<html><head></head><body>${body}</body></html>`]) {
      assert.equal(isPlainDescriptionHtml(content, true, false), true, "legacy eligibility is unchanged");
      assert.equal(isPlainDescriptionHtml(content, true, true), false, "empty markup must use the existing editor path");
    }
  }
  for (const content of ["<p>Text</p>", "<p><strong>Text</strong></p>", '<p><a href="https://example.com/">Text</a></p>']) {
    for (const enabled of [false, true]) assert.equal(isPlainDescriptionHtml(content, true, enabled), true, content);
  }
  for (const content of ["<p><mark></mark></p>", "<p><<strong>Text</strong></p>", "<p><strong>Text</strong>></p>", '<p><img src="x.png">Text</p>']) {
    assert.equal(isPlainDescriptionHtml(content, true, true), false, content);
  }
});

function mobileBottomScroll({ enabled = true, afterPaint = true, cachedLayout = false, embedded = false } = {}) {
  const relative = "src/app/detail/[...slug]/useTaskDetailInitialScroll.tsx";
  const source = process.env.HTPR7395_BASELINE
    ? execFileSync("git", ["show", `${base}:${relative}`], { cwd: root, encoding: "utf8" })
    : fs.readFileSync(path.join(root, relative), "utf8");
  const file = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  const helpers = [];
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === "scrollWindowToBottomMobile") {
      callback = node.initializer.arguments[0].getText(file);
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === "deferredDescriptionEditorSettled") helpers.push(node.getText(file));
    if (ts.isVariableStatement(node) && node.getText(file).includes("deferredEditorReadyCheck =")) helpers.push(node.getText(file));
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(callback, "exercise the production mobile bottom-scroll callback");
  const readyCheck = helpers.length === 2
    ? `${helpers.join("\n")}\nconst deferredEditorReady = deferredEditorReadyCheck(cachedStaticFirst && cachedEditorAfterPaint && !cachedLayout);`
    : "const deferredEditorReady = null;";
  const compiled = ts.transpileModule(`${readyCheck}\nconst start = ${callback};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const { createTaskDetailInitialScrollGuard } = require("jiti").createJiti(__filename, { fsCache: false })(path.join(root, "src/lib/taskDetailInitialScroll.ts"));
  const guard = createTaskDetailInitialScrollGuard(noop);
  const generation = { current: guard.reset() };
  let now = 0, height = 900, scrollTop = 0;
  let mounted = false, composerSettled = false, registered = false;
  const editor = { isDestroyed: false, view: { dom: {} } };
  const frames = [];
  const trace = [];
  const queries = [];
  const scope = {
    get scrollHeight() { return height; },
    querySelector(selector) {
      queries.push(selector);
      if (selector === "#description-input") return { contains: node => mounted && node === editor.view.dom };
      if (selector === '[data-composer-slot-settled="false"]') return composerSettled ? null : {};
      assert.fail(`Unexpected settling selector: ${selector}`);
    },
    scrollTo(options) {
      assert.equal(options.behavior, "auto");
      scrollTop = Math.max(0, Math.min(options.top, height - 844));
      trace.push({ now, height, scrollTop });
    },
  };
  const env = {
    cachedStaticFirst: enabled, cachedEditorAfterPaint: afterPaint, cachedLayout,
    initialScrollGuard: guard, initialScrollGenerationRef: generation,
    scrollElementRef: embedded ? { current: scope } : undefined,
    performance: { now: () => now }, document: { ...scope, documentElement: scope }, window: scope,
    requestAnimationFrame: run => frames.push(run),
    getTiptapEditorForMode: mode => { assert.equal(mode, "read-edit-description"); return registered ? editor : null; },
  };
  const start = new Function("env", `const { ${Object.keys(env).join(", ")} } = env;\n${compiled}\nreturn start;`)(env);
  const cancel = start();
  return {
    guard, generation, cancel, editor, trace, queries,
    top: () => scrollTop,
    pending: () => frames.length,
    frame(time, nextHeight = height, state = {}) {
      now = time;
      height = nextHeight;
      mounted = state.mounted ?? mounted;
      registered = state.registered ?? registered;
      composerSettled = state.composerSettled ?? composerSettled;
      const pending = frames.splice(0);
      pending.forEach(run => run(now));
    },
  };
}

test("flag-on mobile bottom scroll follows stepped height growth beyond 2.5 seconds until editor and composer settle", () => {
  const f = mobileBottomScroll();
  const steps = [[0, 900], [700, 923], [1500, 1011], [2200, 1129], [2900, 1179], [3500, 1269]];
  for (let now = 16; now <= 4500; now += 16) {
    const height = steps.filter(([time]) => time <= now).at(-1)[1];
    f.frame(now, height, { registered: now >= 3000, mounted: now >= 3300, composerSettled: now >= 3900 });
  }
  assert.equal(f.top(), 425);
  assert.equal(f.pending(), 0);
  assert.ok(f.trace.at(-1).now >= 3900 + 300 - 16, "settling starts after replacement and composer readiness, not at static paint");
  for (const [, height] of steps) assert.ok(f.trace.some(frame => frame.height === height));
});

test("flag-off mobile bottom scroll keeps the three-equal-frame exit and 2.5-second cap without readiness queries", () => {
  const stable = mobileBottomScroll({ enabled: false });
  for (let now = 16; now <= 4000; now += 16) stable.frame(now, now < 1000 ? 900 : 1269);
  assert.deepEqual(stable.trace.map(frame => frame.now), [16, 32, 48, 64]);
  assert.equal(stable.top(), 56);
  assert.equal(stable.pending(), 0);
  assert.deepEqual(stable.queries, []);
  const growing = mobileBottomScroll({ enabled: false });
  for (let now = 100; now <= 4000; now += 100) growing.frame(now, 900 + now);
  assert.equal(growing.trace.at(-1).now, 2500);
  assert.equal(growing.trace.length, 25);
  assert.equal(growing.pending(), 0);
  assert.deepEqual(growing.queries, []);
});

test("flag-on mobile scrolling requires a mounted editor, not a stale registration or the static shell", () => {
  const f = mobileBottomScroll();
  for (let now = 16; now <= 4000; now += 16) {
    f.frame(now, now < 3000 ? 900 : 1269, { registered: true, mounted: now >= 3000, composerSettled: true });
  }
  assert.equal(f.top(), 425);
  assert.ok(f.trace.at(-1).now >= 3300);
  assert.equal(f.pending(), 0);
});

test("flag-on mobile bottom scrolling keeps its hard cap when the editor never mounts or height never stabilizes", () => {
  for (const growing of [false, true]) {
    const f = mobileBottomScroll();
    for (let now = 100; now <= 12000; now += 100) {
      f.frame(now, growing ? 900 + now : 900, { registered: growing, mounted: growing, composerSettled: growing });
    }
    assert.equal(f.trace.at(-1).now, 10000);
    assert.equal(f.trace.length, 100);
    assert.equal(f.pending(), 0);
  }
});

test("user gestures, task invalidation and cleanup cancel flag-on mobile bottom following", () => {
  for (const interruption of ["touchmove", "wheel", "navigation", "cleanup"]) {
    const f = mobileBottomScroll();
    const target = new EventTarget();
    const unlisten = f.guard.listen(target);
    f.frame(16);
    if (interruption === "navigation") f.guard.invalidate(f.generation.current);
    else if (interruption === "cleanup") f.cancel();
    else target.dispatchEvent(new Event(interruption));
    f.frame(3000, 1269, { registered: true, mounted: true, composerSettled: true });
    assert.equal(f.trace.length, 1, interruption);
    assert.equal(f.top(), 56, interruption);
    assert.equal(f.pending(), 0, interruption);
    unlisten();
  }
});

test("non-deferred and permanently static tickets retain legacy mobile scroll timing with the flag on", () => {
  for (const options of [{ afterPaint: false }, { cachedLayout: true }]) {
    const f = mobileBottomScroll(options);
    for (let now = 16; now <= 1000; now += 16) f.frame(now);
    assert.deepEqual(f.trace.map(frame => frame.now), [16, 32, 48, 64]);
    assert.deepEqual(f.queries, []);
    assert.equal(f.pending(), 0);
  }
});

test("deferred mobile bottom following scopes editor readiness and scrolling to an embedded scroll target", () => {
  const f = mobileBottomScroll({ embedded: true });
  for (let now = 16; now <= 4000; now += 16) {
    f.frame(now, now < 3000 ? 900 : 1269, { registered: now >= 3000, mounted: now >= 3000, composerSettled: now >= 3000 });
  }
  assert.equal(f.top(), 425);
  assert.equal(f.pending(), 0);
});
