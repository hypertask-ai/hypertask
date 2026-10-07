const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const { QueryClient } = require("@tanstack/react-query");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti").createJiti(__filename, { alias: { "@": path.join(root, "src") } });
const cache = jiti(path.join(root, "src/lib/navigation/cachedTaskDetail.ts"));
const flags = jiti(path.join(root, "src/lib/flags/keys.ts"));
const { HTPR_6752_INSTANT_TICKET_OPEN_FLAG, HTPR_6972_SUBTASK_LINK_FLAG, HTPR_6991_BACK_FIRST_OPEN_FLAG, HTPR_7000_INBOX_NEXT_OPEN_FLAG } = flags;
const parent = { id: 42, projectId: 6859, uniqueIndex: 43, status: "Normal", title: "Parent title", description_: { content: "Parent body" } };
const child = { ...parent, id: 44, uniqueIndex: 45, title: "Child title", description_: { content: "Child body" }, parentTask: parent };
const href = task => `/detail/project-${task.projectId}/${task.uniqueIndex}`;

function fixture(t, enabled, sourcePath = "/inbox") {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai" + sourcePath });
  const names = ["window", "document", "Event", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = Object.fromEntries(names.map(name => [name, global[name]]));
  Object.assign(global, { window: dom.window, document: dom.window.document, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true });
  window.scrollTo = () => {};
  window.requestAnimationFrame = () => 1;
  window.cancelAnimationFrame = () => {};
  let settleTraversal;
  window.addEventListener("popstate", () => {
    if (settleTraversal) { const resolve = settleTraversal; settleTraversal = undefined; setImmediate(resolve); }
  }, true);
  const historyBootScript = fs.readFileSync(path.join(root, "src/app/layout.tsx"), "utf8").match(/id="ht-cached-task-history"\s+dangerouslySetInnerHTML=\{\{\s+__html: "([^"]+)"/)?.[1];
  assert.ok(historyBootScript);
  new Function("window", "CustomEvent", historyBootScript)(window, window.CustomEvent);
  const client = new QueryClient();
  const renderer = createRoot(document.getElementById("root"));
  t.after(async () => {
    await React.act(async () => renderer.unmount());
    client.clear();
    dom.window.close();
    for (const name of names) global[name] = previous[name];
  });
  let nextPath = sourcePath;
  let commit;
  let children = React.createElement("p", null, "Source rows");
  const Detail = ({ initialTask }) => React.createElement("article", { "data-task-id": initialTask.id }, initialTask.title, React.createElement("textarea"));
  const mocks = {
    react: React,
    "react-dom": require("react-dom"),
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/navigation": { usePathname: () => nextPath, useRouter: () => ({ replace: () => assert.fail("cached open must not fetch RSC") }) },
    "@tanstack/react-query": { useQueryClient: () => client },
    "@/lib/state": { useRecoilValue: () => ({ id: 2343 }) },
    "@/store": { currentUserAtom: {} },
    "@/hooks/useFlag": { useFlag: key => {
      if (key === HTPR_7000_INBOX_NEXT_OPEN_FLAG) return enabled;
      if (key === flags.HTPR_7002_INBOX_E_FIRST_PRESS_FLAG) return false;
      assert.ok([HTPR_6752_INSTANT_TICKET_OPEN_FLAG, HTPR_6972_SUBTASK_LINK_FLAG, HTPR_6991_BACK_FIRST_OPEN_FLAG].includes(key));
      return true;
    } },
    "@/lib/flags/keys": flags,
    "@/lib/navigation/cachedTaskDetail": cache,
    "@/utils/helperFunctions/helperFunctions": { returnIfModalOrInputActive: () => false },
    "@/lib/constants/constants": { REACT_QUERY_KEYS: { uploadStates: ["Uploading_States"] } },
    "@/components/Modals/SwipeUnread/EmbeddedTaskDetail": { __esModule: true, default: Detail },
  };
  const source = fs.readFileSync(path.join(root, "src/components/PageComponents/TaskDetail/CachedTaskDetailNavigation.tsx"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)(name => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, exports);
  const Navigation = exports.default;
  function RouterCommit() {
    // Next's HistoryUpdater writes the URL in insertion effect, after rendering.
    React.useInsertionEffect(() => { commit?.(); }, [nextPath]);
    return React.createElement(Navigation, { accountId: 2343 }, children);
  }
  const render = () => renderer.render(React.createElement(RouterCommit));
  const open = task => cache.openCachedTaskDetail({ queryClient: client, accountId: 2343, projectId: task.projectId, uniqueIndex: task.uniqueIndex, href: href(task) + "?inboxFlow=true", task });
  return {
    render, open,
    traverse: method => React.act(async () => {
      await new Promise(resolve => { settleTraversal = resolve; window.history[method](); });
    }),
    navigate(method, state) {
      nextPath = href(child);
      children = React.createElement("article", { "data-task-id": child.id }, child.title);
      commit = () => window.history[method](state, "", nextPath + "?inboxFlow=true");
      render();
    },
    settle(task) { nextPath = href(task); commit = undefined; render(); },
  };
}

for (const method of ["pushState", "replaceState"]) {
  for (const preserveMarker of [false, true]) {
    for (const enabled of [false, true]) {
      test(`router ${method} after render ${preserveMarker ? "retains" : "strips"} the marker: bugfix ${enabled ? "on yields to the next task" : "off retains old behavior"}`, async t => {
        const f = fixture(t, enabled);
        await React.act(async () => f.render());
        await React.act(async () => { assert.equal(f.open(parent), true); f.settle(parent); });
        assert.equal(document.querySelector("article").dataset.taskId, String(parent.id));
        const state = preserveMarker ? window.history.state : { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ["next-task"] };
        let notifications = 0;
        window.addEventListener("cached-task-detail-navigation", () => notifications++);
        await React.act(async () => f.navigate(method, state));
        assert.equal(window.location.pathname, href(child));
        assert.equal(document.querySelector("article").dataset.taskId, String(enabled ? child.id : parent.id));
        assert.equal(document.querySelector("article").textContent, enabled ? child.title : parent.title);
        assert.equal(notifications > 0, enabled, "only the new flag publishes committed router paths");
        if (!enabled) {
          await React.act(async () => window.dispatchEvent(new Event("cached-task-detail-navigation")));
          assert.equal(document.querySelector("article").dataset.taskId, String(child.id), "the old behavior needs an explicit location notification");
        }
      });
    }
  }
}

for (const enabled of [false, true]) {
  test(`cached board and subtask opens, same-path refresh and Back/Forward remain intact with bugfix ${enabled ? "on" : "off"}`, async t => {
    const f = fixture(t, enabled, "/project");
    await React.act(async () => f.render());
    await React.act(async () => { assert.equal(f.open(parent), true); f.settle(parent); });
    const composer = document.querySelector("textarea");
    composer.value = "Unsent draft";
    await React.act(async () => { window.history.replaceState({}, "", window.location.href); f.render(); });
    assert.equal(document.querySelector("textarea"), composer);
    assert.equal(composer.value, "Unsent draft");
    await React.act(async () => { assert.equal(f.open(child), true); f.settle(child); });
    assert.equal(document.querySelector("article").dataset.taskId, String(child.id));
    const { traverse } = f;
    await traverse("back");
    assert.equal(window.location.pathname, href(parent));
    assert.equal(document.querySelector("article").dataset.taskId, String(parent.id));
    await traverse("forward");
    assert.equal(window.location.pathname, href(child));
    assert.equal(document.querySelector("article").dataset.taskId, String(child.id));
    await traverse("back");
    await traverse("back");
    assert.equal(window.location.pathname, "/project");
    assert.equal(document.querySelector("article"), null);
    assert.equal(document.body.textContent, "Source rows");
  });
}
