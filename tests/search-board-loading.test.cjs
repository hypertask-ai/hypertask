const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { QueryClient, QueryClientProvider, useQuery } = require("@tanstack/react-query");

const root = path.resolve(__dirname, "..");

for (const scenario of [
  { name: "desktop", width: 1440 },
  { name: "phone", width: 390 },
  { name: "desktop chips and URL navigation", width: 1440, modern: true },
  { name: "phone chips and URL navigation", width: 390, modern: true },
  { name: "legacy board filter", width: 1440, legacy: true, term: "login board:Visible" },
  { name: "no accessible boards", width: 390, empty: true },
  { name: "boards query fails", width: 1440, error: true },
  { name: "newer submission while waiting", width: 390, newer: true },
]) {
  test(`early Enter waits for boards: ${scenario.name}`, async () => {
    const dom = new JSDOM('<div id="root"></div>', { url: "https://example.test/search" });
    Object.defineProperty(dom.window, "innerWidth", { value: scenario.width });
    const globals = ["window", "document", "navigator", "HTMLElement", "localStorage", "IS_REACT_ACT_ENVIRONMENT"];
    const previous = globals.map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]);
    Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(global, "navigator", { configurable: true, value: dom.window.navigator });
    dom.window.HTMLElement.prototype.attachEvent = () => {};
    dom.window.HTMLElement.prototype.detachEvent = () => {};
    dom.window.HTMLElement.prototype.scrollIntoView = () => {};
    const stubs = [];
    const stub = (filename, exports) => {
      stubs.push([filename, require.cache[filename]]);
      require.cache[filename] = { id: filename, filename, loaded: true, exports };
    };
    const source = (file, exports) => stub(path.join(root, file), exports);
    const projects = [{ id: 7, title: "Visible" }, { id: 9, title: "Other" }];
    let resolveBoards;
    let rejectBoards;
    const boardsPromise = new Promise((resolve, reject) => { resolveBoards = resolve; rejectBoards = reject; });
    const requests = [];
    const errors = [];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let state;
    let navigate;
    let reactRoot;
    try {
      source("src/utils/index.ts", { taskBaseUri: "/detail/" });
      source("src/utils/undoActions/helperFuncs.ts", { cn: (...values) => values.filter(Boolean).join(" ") });
      source("src/hooks/useFlag.tsx", { useFlag: (key) => !scenario.legacy && (key === "htpr-6369-search-operators" || (scenario.modern && ["htpr-6370-search-chips", "htpr-6688-search-autocomplete", "htpr-6865-search-layout"].includes(key))) });
      source("src/lib/contexts/deviceContext.tsx", { useDeviceContext: () => false });
      source("src/hooks/MultiPages/useGetAllProjectsMinimal.ts", { useGetAllProjectsMinimal: (queryKey) => useQuery({ queryKey, initialData: [], queryFn: () => boardsPromise }) });
      source("src/hooks/RecoilRoot/useHypertasksRecoilStates.ts", { default: () => ({ toggleShowCommands() {} }) });
      const SearchTaskIndexAtom = {};
      source("src/lib/state.tsx", { useRecoilState: (atom) => [atom === SearchTaskIndexAtom ? null : { show: false }, () => {}] });
      source("src/store/index.ts", { inViewObjectAtom: {}, SearchTaskIndexAtom, showCommandsAtom: {}, tasksPlayListAtom: {} });
      const searchCache = { history: [], results: [] };
      source("src/hooks/Search/useSearchCache.ts", { useGetSearchCache: () => ({ data: searchCache }) });
      source("src/lib/constants/index.ts", { default: { multipleKeys: {}, gThenKeyDelay: 500 } });
      source("src/lib/constants/APIRouteConstants.ts", { searchDocumentsRoute: "/api/search/document" });
      source("src/lib/constants/keyboard-handler.ts", { KeyCodes: { ENTER: 13, ESCAPE: 27 } });
      const post = async (_url, body) => {
        requests.push(body);
        assert.ok(body.projectIds.length > 0, "never send an empty search scope");
        const task = { taskId: 1, projectId: 7, uniqueIndex: 1, taskTitle: body.searchQuery };
        return { status: 200, data: { processedData: { All: [task], Visible: [task] }, tabs: ["All", "Visible"] } };
      };
      stub(require.resolve("axios"), { default: { post }, post });
      stub(require.resolve("next/navigation"), { useRouter: () => ({ replace(url) { if (scenario.modern) navigate(new URL(url, dom.window.location.href).searchParams.get("searchTerm") ?? ""); }, push() {}, back() {} }) });
      const toast = { error: (message) => errors.push(message) };
      stub(require.resolve("react-hot-toast"), { default: toast, ...toast });
      const hookPath = path.join(root, "src/hooks/Search/useSearch.ts");
      stubs.push([hookPath, require.cache[hookPath]]);
      delete require.cache[hookPath];
      const inputPath = path.join(root, "src/app/search/SearchChipsInput.tsx");
      stubs.push([inputPath, require.cache[inputPath]]);
      delete require.cache[inputPath];
      const jiti = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true, fsCache: false, jsx: { runtime: "automatic" } });
      const { useSearch } = jiti(hookPath);
      const SearchChipsInput = scenario.modern ? jiti(inputPath).default : null;
      const Harness = () => {
        const [urlTerm, setUrlTerm] = React.useState("");
        navigate = setUrlTerm;
        state = useSearch(urlTerm);
        return scenario.modern
          ? React.createElement(SearchChipsInput, { value: state.inputValue, onChange: state.setInputValue, onRun: state.updateSearchHistory, recentSearches: [], boardId: null, inputRef: state.tasksInputRef, autocompleteEnabled: true })
          : React.createElement("input", { id: "search-input", ref: state.tasksInputRef, value: state.inputValue, onChange: () => {} });
      };
      reactRoot = require("react-dom/client").createRoot(document.getElementById("root"));
      await React.act(async () => reactRoot.render(React.createElement(QueryClientProvider, { client }, React.createElement(Harness))));
      const submit = async (term) => {
        await React.act(async () => state.setInputValue(term));
        await React.act(async () => {
          document.getElementById("search-input").focus();
          document.getElementById("search-input").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
        });
      };
      await submit(scenario.term ?? "login");
      assert.equal(requests.length, 0, "Enter must wait instead of posting projectIds []");
      if (scenario.newer) await submit("newer login");
      await React.act(async () => {
        if (scenario.error) rejectBoards(new Error("Boards unavailable"));
        else resolveBoards(scenario.empty ? [] : projects);
        await boardsPromise.catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      if (scenario.empty || scenario.error) {
        assert.equal(requests.length, 0, "no boards or failed loading must not send an invalid request");
        assert.equal(state.typedTasks.length, 0);
        assert.ok(state.responseMessage);
      } else {
        assert.equal(requests.length, 1, "one submitted search resumes when boards arrive");
        assert.deepEqual(requests[0].projectIds, scenario.legacy ? [7] : [7, 9]);
        assert.equal(requests[0].searchQuery, scenario.newer ? "newer login" : "login");
        assert.deepEqual(state.tabs, ["All", "Visible"], "results create the existing tabs");
        assert.equal(state.typedTasks[0].taskTitle, requests[0].searchQuery);
      }
    } finally {
      if (reactRoot) await React.act(async () => reactRoot.unmount());
      client.clear();
      for (const [filename, prior] of stubs.reverse()) {
        if (prior === undefined) delete require.cache[filename];
        else require.cache[filename] = prior;
      }
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(global, key, descriptor);
        else delete global[key];
      }
      dom.window.close();
    }
  });
}
