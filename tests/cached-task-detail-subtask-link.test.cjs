const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const { QueryClient } = require("@tanstack/react-query");
const root = path.resolve(__dirname, "..");
const cache = require("jiti").createJiti(__filename, { alias: { "@": path.join(root, "src") } })(path.join(root, "src/lib/navigation/cachedTaskDetail.ts"));
const flags = require("jiti").createJiti(__filename)(path.join(root, "src/lib/flags/keys.ts"));
const { HTPR_6972_SUBTASK_LINK_FLAG: fixFlag } = flags;

for (const enabled of [true, false]) {
  test(`Next task-to-task navigation updates cached content and Back with subtask-link flag ${enabled ? "on" : "off"}`, async (t) => {
    const dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/project?id=6859" });
    const names = ["window", "document", "Event", "IS_REACT_ACT_ENVIRONMENT"];
    const previous = Object.fromEntries(names.map(name => [name, global[name]]));
    Object.assign(global, { window: dom.window, document: dom.window.document, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true });
    window.scrollTo = () => {};
    window.requestAnimationFrame = () => 1;
    window.cancelAnimationFrame = () => {};
    const client = new QueryClient();
    const renderer = createRoot(document.getElementById("root"));
    const originalPush = window.history.pushState;
    const originalReplace = window.history.replaceState;
    t.after(async () => {
      await React.act(async () => renderer.unmount());
      assert.equal(window.history.pushState, originalPush);
      assert.equal(window.history.replaceState, originalReplace);
      client.clear();
      dom.window.close();
      for (const name of names) global[name] = previous[name];
    });
    const parent = { id: 42, projectId: 6859, uniqueIndex: 43, title: "Parent title", description_: { content: "Parent description" }, comments: "Parent comments" };
    const child = { ...parent, id: 44, uniqueIndex: 45, title: "Child title", description_: { content: "Child description" }, comments: "Child comments" };
    const related = { ...child, id: 46, uniqueIndex: 47, title: "Related title" };
    const href = task => `/detail/project-${task.projectId}/${task.uniqueIndex}`;
    const Detail = ({ initialTask }) => React.createElement("article", null, initialTask.title, initialTask.description_.content, initialTask.comments);
    let nextPath = "/project";
    // Next's route boundary reads current router context, not a frozen task view.
    const ServerDetail = () => React.createElement(Detail, { initialTask: nextPath === href(parent) ? parent : nextPath === href(related) ? related : child });
    let serverChildren = React.createElement("div", null, "Board");
    const router = { replace: () => assert.fail("a task-page navigation must not replace the parent's history entry"), refresh: () => assert.fail("task Back must not refresh the board") };
    const relativePath = "src/components/PageComponents/TaskDetail/CachedTaskDetailNavigation.tsx";
    const baseline = process.env.SUBTASK_LINK_BASELINE === "1" ? "origin/production" : process.env.SUBTASK_LINK_BASELINE;
    const source = baseline
      ? execFileSync("git", ["show", `${baseline}:${relativePath}`], { cwd: root, encoding: "utf8" })
      : fs.readFileSync(path.join(root, relativePath), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
    const mocks = {
      react: React,
      "react/jsx-runtime": require("react/jsx-runtime"),
      "next/navigation": { usePathname: () => nextPath, useRouter: () => router },
      "@tanstack/react-query": { useQueryClient: () => client },
      "@/lib/state": { useRecoilValue: () => ({ id: 2343 }) },
      "@/store": { currentUserAtom: {} },
      "@/hooks/useFlag": { useFlag: key => key === fixFlag ? enabled : true },
      "@/lib/flags/keys": flags,
      "@/lib/navigation/cachedTaskDetail": cache,
      "@/components/Modals/SwipeUnread/EmbeddedTaskDetail": { __esModule: true, default: Detail },
    };
    const exports = {};
    new Function("require", "exports", compiled)(name => {
      assert.ok(name in mocks, `Unexpected dependency: ${name}`);
      return mocks[name];
    }, exports);
    const render = () => renderer.render(React.createElement(React.StrictMode, null,
      React.createElement(exports.default, { accountId: 2343 }, serverChildren)));
    const assertContent = task => {
      assert.equal(document.querySelector("article").textContent, task.title + task.description_.content + task.comments);
      assert.equal(window.location.pathname, href(task));
    };
    await React.act(async () => render());
    // Board opens publish the custom event and keep the board's Next tree.
    await React.act(async () => {
      cache.openCachedTaskDetail({ queryClient: client, accountId: 2343, projectId: parent.projectId, uniqueIndex: parent.uniqueIndex, href: href(parent), task: parent });
      nextPath = href(parent);
      render();
    });
    assertContent(parent);
    const traverse = method => React.act(async () => {
      await new Promise(resolve => {
        window.addEventListener("popstate", () => setImmediate(resolve), { once: true });
        window.history[method]();
      });
    });
    let followHistory = true;
    window.addEventListener("popstate", () => {
      if (!followHistory) return;
      nextPath = window.location.pathname;
      serverChildren = React.createElement(ServerDetail);
      render();
    });
    // Next Link/router.push commits the new pathname and children, without
    // emitting popstate or the cached navigator's custom event.
    for (const target of [child, parent, related]) {
      const sourceTask = target === parent ? child : parent;
      await React.act(async () => {
        cache.openCachedTaskDetail({ queryClient: client, accountId: 2343, projectId: sourceTask.projectId, uniqueIndex: sourceTask.uniqueIndex, href: href(sourceTask), task: sourceTask });
        nextPath = href(sourceTask);
        render();
      });
      assertContent(sourceTask);
      await React.act(async () => {
        nextPath = href(target);
        serverChildren = React.createElement(ServerDetail);
        render();
      });
      if (enabled) {
        assert.equal(document.querySelector("article").textContent, target.title + target.description_.content + target.comments, "Next's new route must retire the cached overlay before its history insertion effect runs");
        assert.equal(window.history.pushState, originalPush, "subscribing must not wrap Next's history methods");
        assert.equal(window.history.replaceState, originalReplace);
      }
      await React.act(async () => window.history[target === related ? "replaceState" : "pushState"](window.history.state, "", href(target)));
      if (enabled) assertContent(target);
      else {
        assert.equal(window.location.pathname, href(target));
        assert.equal(document.querySelector("article").textContent, sourceTask.title + sourceTask.description_.content + sourceTask.comments, "flag off preserves today's stale cached overlay");
      }
      if (target === child) {
        await traverse("back");
        assertContent(parent);
        await traverse("forward");
        assertContent(child);
      }
    }
    // Cached playlist opens publish native events without changing Next's route.
    const sourcePath = nextPath;
    for (const task of [parent, child, parent]) {
      await React.act(async () => cache.openCachedTaskDetail({ queryClient: client, accountId: 2343, projectId: task.projectId, uniqueIndex: task.uniqueIndex, href: href(task), task }));
      assertContent(task);
      assert.equal(nextPath, sourcePath);
    }
    if (enabled) {
      await React.act(async () => {
        nextPath = href(child);
        serverChildren = React.createElement(ServerDetail);
        render();
      });
      assert.equal(document.querySelector("article").textContent, child.title + child.description_.content + child.comments, "a new Next route must invalidate the last native-event override");
      await React.act(async () => window.history.pushState(window.history.state, "", href(child)));
      assertContent(child);
      await traverse("back");
      assertContent(parent);
      await traverse("forward");
      assertContent(child);
      // Keep both markers intact to isolate a stale Next update from RSC views.
      for (const target of [parent, child]) {
        await React.act(async () => {
          cache.openCachedTaskDetail({ queryClient: client, accountId: 2343, projectId: target.projectId, uniqueIndex: target.uniqueIndex, href: href(target), task: target });
          nextPath = href(target);
          serverChildren = React.createElement(ServerDetail);
          render();
        });
      }
      followHistory = false;
      await traverse("back");
      assertContent(parent);
      await traverse("forward");
      assertContent(child);
      await React.act(async () => {
        nextPath = href(parent);
        serverChildren = React.createElement(ServerDetail);
        render();
      });
      assert.equal(document.querySelector("article").textContent, child.title + child.description_.content + child.comments, "a Next update older than Forward must keep the child in the address");
      await React.act(async () => {
        nextPath = href(child);
        serverChildren = React.createElement(ServerDetail);
        render();
      });
      assertContent(child);
      followHistory = true;
      // Next may also strip the marker while history waits for new RSC children.
      await React.act(async () => {
        cache.openCachedTaskDetail({ queryClient: client, accountId: 2343, projectId: parent.projectId, uniqueIndex: parent.uniqueIndex, href: href(parent), task: parent });
        nextPath = href(parent);
        serverChildren = React.createElement(ServerDetail);
        render();
      });
      await React.act(async () => {
        window.history.replaceState({ ...window.history.state, cachedTaskDetail: undefined }, "", href(parent));
        nextPath = href(child);
        serverChildren = React.createElement(ServerDetail);
        render();
      });
      assert.equal(document.querySelector("article").textContent, child.title + child.description_.content + child.comments, "Next Link renders before pushState even after native opens");
      await React.act(async () => window.history.pushState(window.history.state, "", href(child)));
      assertContent(child);
      followHistory = false;
      await traverse("back");
      assertContent(parent);
      await traverse("forward");
      assertContent(child);
      await React.act(async () => {
        nextPath = href(parent);
        serverChildren = React.createElement(ServerDetail);
        render();
      });
      assertContent(child);
      await React.act(async () => {
        nextPath = href(child);
        serverChildren = React.createElement(ServerDetail);
        render();
      });
      assertContent(child);
      // Acknowledgement releases history precedence for the next ordinary Link.
      await React.act(async () => {
        nextPath = href(related);
        serverChildren = React.createElement(ServerDetail);
        render();
      });
      assert.equal(document.querySelector("article").textContent, related.title + related.description_.content + related.comments);
      await React.act(async () => window.history.pushState(window.history.state, "", href(related)));
      assertContent(related);
      await traverse("back");
      assertContent(child);
      await React.act(async () => {
        cache.openCachedTaskDetail({ queryClient: client, accountId: 2343, projectId: parent.projectId, uniqueIndex: parent.uniqueIndex, href: href(parent), task: parent });
        nextPath = href(child);
        serverChildren = React.createElement(ServerDetail);
        render();
      });
      assertContent(parent);
      await React.act(async () => {
        nextPath = href(parent);
        serverChildren = React.createElement(ServerDetail);
        render();
      });
      assertContent(parent);
      await traverse("back");
      assertContent(child);
      await React.act(async () => {
        nextPath = href(related);
        serverChildren = React.createElement(ServerDetail);
        render();
      });
      assertContent(child);
    }
  });
}
