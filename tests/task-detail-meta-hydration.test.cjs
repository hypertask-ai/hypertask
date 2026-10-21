const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { hydrateRoot } = require("react-dom/client");
const { renderToString } = require("react-dom/server");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function load(relativePath, mocks) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, relativePath), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)((name) => (name in mocks ? { __esModule: true, ...mocks[name] } : require(name)), exports);
  return exports;
}

const hydrated = load("src/hooks/General/useHydrated.ts", {});
const { useTaskDetailMetaField } = load("src/lib/useTaskDetailMetaField.ts", {
  "@/hooks/General/useAuth": { useAuth: () => ({ authenticatedUserId: 985 }) },
  "@/hooks/General/useHydrated": hydrated,
  "@/hooks/useFlag": { useFlag: () => false, useFlagReady: () => true },
  "@/lib/flags/keys": { HTPR_7009_DEDUPE_TASK_DETAIL_READS_FLAG: "htpr-7009" },
  "@/lib/taskDetailReads": { fetchTaskDetailMeta: async () => ({}), shouldRefetchDetailOnMount: true },
});
const { shouldDehydratePersistedQuery } = load("src/utils/queryPersistence.ts", {});

const TASK_ID = 64911;
const serverLabels = [{ id: "bug", name: "Bug" }];
const savedLabels = [{ id: "bug", name: "Bug" }, { id: "p1", name: "P1" }];

function Labels() {
  const { data } = useTaskDetailMetaField("labels", ["taskLabels", TASK_ID], TASK_ID, async () => serverLabels, serverLabels);
  return React.createElement("ul", null, (data ?? []).map((label) => React.createElement("li", { key: label.id }, label.name)));
}

test("ticket labels hydrate from the server copy even when the saved browser cache holds an older list", async (t) => {
  const previous = new Map(["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  t.after(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  });
  delete global.window;
  delete global.document;
  const serverClient = new QueryClient();
  const serverHtml = renderToString(React.createElement(QueryClientProvider, { client: serverClient }, React.createElement(Labels)));
  assert.equal(serverHtml, "<ul><li>Bug</li></ul>");

  const dom = new JSDOM(`<div id="root">${serverHtml}</div>`, { url: "https://app.hypertask.ai/detail/project-15/7382" });
  t.after(() => dom.window.close());
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const restoredClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  restoredClient.setQueryData(["taskLabels", TASK_ID], savedLabels, { updatedAt: Date.now() - 60_000 });

  const hydrationErrors = [];
  let reactRoot;
  await React.act(async () => {
    reactRoot = hydrateRoot(document.getElementById("root"), React.createElement(QueryClientProvider, { client: restoredClient }, React.createElement(Labels)), {
      onRecoverableError: (error) => hydrationErrors.push(error.message.split("\n")[0]),
    });
  });
  const hydratedText = document.getElementById("root").textContent;
  await React.act(async () => reactRoot.unmount());
  restoredClient.clear();

  assert.deepEqual(hydrationErrors, []);
  assert.ok(hydratedText.startsWith("Bug"), hydratedText);
});

test("the server copy used during hydration is never saved to the browser cache", () => {
  const client = new QueryClient();
  client.setQueryData(["taskLabels", TASK_ID, "hydrating"], serverLabels);
  client.setQueryData(["taskLabels", TASK_ID], savedLabels);
  const [hydrating, live] = ["hydrating", "live"].map((kind) =>
    client.getQueryCache().find({ queryKey: kind === "hydrating" ? ["taskLabels", TASK_ID, "hydrating"] : ["taskLabels", TASK_ID], exact: true }),
  );
  assert.equal(shouldDehydratePersistedQuery(hydrating), false);
  assert.equal(shouldDehydratePersistedQuery(live), true);
});
