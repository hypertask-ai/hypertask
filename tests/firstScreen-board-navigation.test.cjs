const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { createRefactoredModuleRequire } = require("./refactored-module-require.cjs");

for (const seeded of [true, false]) {
  test(`${seeded ? "server-seeded" : "unseeded"} board retains its client owner while a table chunk and RSC navigation settle`, async () => {
    const dom = new JSDOM("<div id='root'></div>", { url: "https://app.hypertask.ai/project?id=15&surface=board" });
    const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
    const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(global, key)]));
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(global, key, { configurable: true, writable: true, value });
    const user = { id: 985 };
    let firstScreen = seeded ? { data: { projectId: 15, user } } : null;
    let layout = "board", mounts = 0, releaseTable;
    const pendingTable = new Promise(resolve => { releaseTable = resolve; });
    const Table = React.lazy(() => pendingTable);
    function LandingPage() {
      const [owner] = React.useState(() => ++mounts);
      return React.createElement("main", { "data-client-board": owner },
        React.createElement("nav", null, "Existing board controls"),
        React.createElement(React.Suspense, { fallback: "Loading table view" },
          layout === "table" ? React.createElement(Table) : React.createElement("a", { href: "/detail/project-15/1" }, "Server board card")));
    }
    const noop = () => {};
    const load = createRefactoredModuleRequire(path.join(__dirname, ".."), {
      "@/lib/firstScreen/serverBoardDocument": { getServerBoardDocument: async () => firstScreen },
      "next/headers": { cookies: async () => ({ get: key => key === "nookies_user" ? { value: JSON.stringify(user) } : undefined }) },
      "next/navigation": { notFound: () => { throw Error("Unexpected not found"); }, redirect: () => { throw Error("Unexpected redirect"); } },
      "./LandingPage": { __esModule: true, default: LandingPage },
      "./NoBoardsEmptyState": { __esModule: true, default: noop },
      "../unauthorized/page": { __esModule: true, default: noop },
      "@/utils/controllers/projects/getFirst": { __esModule: true, default: async () => ({ json: { id: 15 } }) },
      "@/lib/boardBootstrap/earlyBoardBootstrap": { buildEarlyBoardBootstrapScript: () => "void 0" },
      "@/lib/auth/session": { SESSION_COOKIE: "ht_session", verifySession: () => user },
      "@/lib/boardRouteTitle": { resolveBoardRouteTitleRequest: () => ({ projectId: 15 }), buildBoardRouteTitle: noop },
      "@/lib/boardRouteMetadata": { getProjectForValidation: async () => ({ success: true, project: { id: 15 } }) },
      "@/lib/boardRoutePath": { resolveBoardRoutePath: () => ({ kind: "render" }), buildCanonicalBoardUrl: noop },
    });
    const Page = load("./src/app/[...boardURL]/page.tsx").default;
    const request = surface => Page({ params: Promise.resolve({ boardURL: ["project"] }), searchParams: Promise.resolve({ id: "15", surface }) });
    const root = createRoot(document.getElementById("root"));
    try {
      const documentTree = await request("board");
      await React.act(async () => root.render(documentTree));
      const boardOwner = document.querySelector("[data-client-board]");
      const controls = boardOwner.querySelector("nav");
      assert.equal(mounts, 1);
      layout = "table";
      await React.act(async () => root.render(await request("table")));
      assert.match(document.body.textContent, /Loading table view/);

      // RSC requests intentionally have no document seed and add the early bootstrap sibling.
      firstScreen = null;
      await React.act(async () => root.render(await request("table")));
      assert.ok(document.querySelector("[data-client-board]") === boardOwner, "RSC must not replace the adopted board's client owner");
      assert.equal(document.querySelector("nav"), controls);
      assert.equal(mounts, 1, "surface navigation must not restart board initialization");
      await React.act(async () => {
        releaseTable({ default: () => React.createElement("div", { className: "table-view-row" }, "Server board card") });
        await pendingTable;
      });
      assert.equal(document.querySelector(".table-view-row")?.textContent, "Server board card");
      layout = "board";
      await React.act(async () => root.render(await request("board")));
      assert.equal(document.querySelector("[data-client-board]"), boardOwner);
      assert.equal(document.querySelector("a")?.textContent, "Server board card");
    } finally {
      releaseTable({ default: () => null });
      await React.act(async () => root.unmount());
      dom.window.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(global, key, descriptor);
        else delete global[key];
      }
    }
  });
}
