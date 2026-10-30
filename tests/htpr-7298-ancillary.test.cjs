const { withStubs } = require("./helpers/stub-map.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const noop = () => {};
function load(file, mocks = {}, runtime = {}) {
  mocks = withStubs({ "@/lib/auth/agentScope": require("./helpers/agent-board-scope.cjs").enforcedScope }, mocks);
  const target = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function("require", "module", "exports", "process", "fetch", compiled)((id) => {
    if (id === "@/lib/planLimits") return { isPlanLimitReachedError: () => false, isPlanLimitsEnabled: async () => false, assertTaskCountTransition: async () => {}, assertTicketRoom: async () => {}, assertProjectTicketRoom: async () => {}, assertBoardRoom: async () => {} };
    if (id === "@/lib/storage/verifyTaskAttachmentLinks") return { verifyTaskAttachmentLinks: async () => new Map() };
    if (id in mocks) return { __esModule: true, ...mocks[id] };
    assert.ok(!id.startsWith("@/") && !id.startsWith("."), `Unexpected import: ${id}`);
    return require(id);
  }, target, target.exports, { env: runtime.env ?? {} }, runtime.fetch ?? (() => { throw new Error("Unexpected network request"); }));
  return target.exports;
}

const access = load("src/utils/controllers/projects/getAllIncludes.ts", {
  "@/lib/agents/publicAgent": {}, "@/lib/cycles": {}, "@/lib/agents/visibility": {},
  "@/lib/auth/crossTeamContext": require("./task-route-loader.cjs").load("src/lib/auth/crossTeamContext.ts", {}),
  "@/utils/controllers/notifications/visibleInboxScope": {},
});
const boards = [
  { id: 10, ownerId: 1, status: "Normal", teamId: "team", members: [{ userId: 3, agentId: null }] },
  { id: 20, ownerId: 2, status: "Normal", teamId: "team", members: [] },
];
function matches(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some((part) => matches(row, part));
    if (key === "AND") return value.every((part) => matches(row, part));
    if (value && typeof value === "object") {
      if ("contains" in value) return typeof row[key] === "string" && row[key].toLowerCase().includes(value.contains.toLowerCase());
      if ("not" in value) return row[key] !== value.not;
      if ("in" in value) return value.in.includes(row[key]);
      if ("some" in value) return row[key].some((part) => matches(part, value.some));
      return row[key] != null && matches(row[key], value);
    }
    return row[key] === value;
  });
}
const task = { id: 987654, projectId: 20, title: "HIDDEN-TICKET-TITLE", ticketNumber: "SECRET-987654", uniqueIndex: 987654 };
const page = { id: 11, publicId: "page-fixture", title: "Page", contentHtml: "", version: 1, projectId: 10, taskId: task.id, task, subPages: [] };

function pageService(fixture = page) {
  return load("src/utils/controllers/pages/pageService.ts", {
    "@/lib/prisma": { default: { page: { findUnique: async ({ where, include }) => {
      if (!matches({ ...fixture, project: boards[0] }, where)) return null;
      const visibleTask = fixture.task && matches({ status: "Normal", ...fixture.task, project: boards.find((board) => board.id === fixture.task.projectId) }, include.task.where)
        ? fixture.task : null;
      const allLinks = fixture.links ?? (fixture.task ? [{ task: fixture.task, removedAt: null }] : []);
      const links = allLinks.filter((link) => link.removedAt == null && matches({ status: "Normal", ...link.task, project: boards.find((board) => board.id === link.task.projectId) }, include.links.where.task))
        .map(({ task }) => ({ task }));
      return { ...fixture, task: visibleTask, links, _count: { links: allLinks.length },
        subPages: [
          { id: 12, publicId: "same-board", title: "Visible child", projectId: 10 },
          { id: 13, publicId: "hidden-child", title: "HIDDEN-CHILD-TITLE", projectId: 20 },
        ],
      };
    } } } },
    "@/utils/controllers/projects/getAllIncludes": access,
    "@/utils/controllers/turbopuffer/turbopufferHelper": {},
    "@/utils/helperFunctions/markdownToHtml": {},
    "@/utils/helperFunctions/sanitizeRichHtml": {}, "./htmlCanvas": {},
  });
}

for (const userId of [1, 2, 3]) {
  for (const taskless of [false, true]) {
    test(`server screen authorizes the page board, not the ticket board (viewer ${userId}, taskless ${taskless})`, async () => {
      let pageArgs;
      let boardQuery;
      const Screen = load("src/app/page/[publicId]/page.tsx", {
        "next/navigation": { redirect: (href) => { throw new Error(`redirect:${href}`); } },
        "./PageEditor": { default: () => null },
        "@/lib/flags": { isFeatureEnabled: async () => true },
        "@/lib/flags/keys": { HTPR_7298_STANDALONE_PAGES_FLAG: "htpr-7298-standalone-pages" },
        "@/lib/auth/serverUser": { requireServerCookieUser: async () => ({ id: userId }) },
        "@/lib/prisma": { default: { page: { findUnique: async (query) => {
          assert.deepEqual(query, { where: { id: page.id }, select: { taskId: true } });
          return { taskId: taskless ? null : task.id };
        } }, project: { findFirst: async (query) => {
          boardQuery = query;
          return boards.find((board) => matches(board, query.where)) ?? null;
        } } } },
        "@/utils/controllers/projects/getAllIncludes": access,
        "@/utils/controllers/pages/pageService": { getPage: async (args) => {
          pageArgs = args;
          return pageService(taskless ? { ...page, task: null, taskId: null } : page).getPage(args);
        } },
      }).default;
      if (userId === 2) {
        await assert.rejects(Screen({ params: Promise.resolve({ publicId: page.publicId }) }), /redirect:\//);
      } else {
        const rendered = await Screen({ params: Promise.resolve({ publicId: page.publicId }) });
        const payload = JSON.parse(rendered.props._page);
        assert.equal(payload.task, null);
        assert.equal(payload.taskId, null);
        assert.doesNotMatch(rendered.props._page, /HIDDEN-TICKET-TITLE|SECRET-987654|987654|HIDDEN-CHILD-TITLE|hidden-child/);
        assert.deepEqual(payload.subPages, [{ id: 12, publicId: "same-board", title: "Visible child" }]);
      }
      assert.deepEqual(pageArgs, { publicId: page.publicId, userId, standalonePagesEnabled: true });
      if (userId !== 2) {
        assert.equal(boardQuery.where.id, 10);
        assert.equal(boardQuery.where.status, "Normal");
      }
    });
  }
}

test("server screen preserves a visible task and redirects a missing page", async () => {
  let missing = false;
  let originReads = 0;
  const Screen = load("src/app/page/[publicId]/page.tsx", {
    "next/navigation": { redirect: () => { throw new Error("redirect"); } },
    "./PageEditor": { default: () => null },
    "@/lib/flags": { isFeatureEnabled: async () => true },
    "@/lib/flags/keys": { HTPR_7298_STANDALONE_PAGES_FLAG: "htpr-7298-standalone-pages" },
    "@/lib/auth/serverUser": { requireServerCookieUser: async () => ({ id: 1 }) },
    "@/lib/prisma": { default: { page: { findUnique: async (query) => {
      originReads++;
      assert.deepEqual(query, { where: { id: page.id }, select: { taskId: true } });
      return { taskId: task.id };
    } }, project: { findFirst: async () => ({ id: 10 }) } } },
    "@/utils/controllers/projects/getAllIncludes": access,
    "@/utils/controllers/pages/pageService": { getPage: async ({ userId }) => {
      assert.equal(userId, 1);
      return missing ? null : pageService({ ...page, task: { ...task, projectId: 10 } }).getPage({ publicId: page.publicId, userId });
    } },
  }).default;
  const rendered = await Screen({ params: Promise.resolve({ publicId: page.publicId }) });
  assert.equal(JSON.parse(rendered.props._page).task.id, task.id);
  missing = true;
  await assert.rejects(Screen({ params: Promise.resolve({ publicId: page.publicId }) }), /redirect/);
  assert.equal(originReads, 1, "missing pages redirect before the raw origin lookup");
});

for (const enabled of [false, true]) {
  for (const [kind, fixture, visibleTask] of [
    ["visible ticket", { ...page, task: { ...task, projectId: 10 } }, true],
    ["soft-deleted ticket", { ...page, task: { ...task, projectId: 10, status: "Deleted" } }, false],
    ["raw taskId null", { ...page, task: null, taskId: null }, false],
  ]) {
    const redirects = !enabled && fixture.taskId === null;
    test(`server screen flag ${enabled}: ${kind} ${redirects ? "redirects" : "renders"}`, async () => {
      let boardReads = 0;
      let originReads = 0;
      let flagReads = 0;
      const Screen = load("src/app/page/[publicId]/page.tsx", {
        "next/navigation": { redirect: (href) => { throw new Error(`redirect:${href}`); } },
        "./PageEditor": { default: () => null },
        "@/lib/auth/serverUser": { requireServerCookieUser: async () => ({ id: 1 }) },
        "@/lib/flags": { isFeatureEnabled: async (key, userId) => {
          flagReads++;
          assert.equal(key, "htpr-7298-standalone-pages");
          assert.equal(userId, 1);
          return enabled;
        } },
        "@/lib/flags/keys": { HTPR_7298_STANDALONE_PAGES_FLAG: "htpr-7298-standalone-pages" },
        "@/lib/prisma": { default: {
          page: { findUnique: async (query) => {
            originReads++;
            assert.deepEqual(query, { where: { id: page.id }, select: { taskId: true } });
            return { taskId: fixture.taskId };
          } },
          project: { findFirst: async (query) => {
            boardReads++;
            return boards.find((board) => matches(board, query.where)) ?? null;
          } },
        } },
        "@/utils/controllers/projects/getAllIncludes": access,
        "@/utils/controllers/pages/pageService": { getPage: async (args) => {
          assert.deepEqual(args, { publicId: page.publicId, userId: 1, standalonePagesEnabled: enabled });
          const result = await pageService(fixture).getPage(args);
          if (!enabled && fixture.taskId === null) {
            assert.equal(result, null);
            return result;
          }
          assert.equal(result.task?.id ?? null, visibleTask ? task.id : null);
          assert.equal(result.taskId, visibleTask ? task.id : null);
          return result;
        } },
      }).default;
      const render = () => Screen({ params: Promise.resolve({ publicId: page.publicId }) });
      if (redirects) {
        await assert.rejects(render, { message: "redirect:/" });
        assert.equal(boardReads, 0);
      } else {
        const rendered = await render();
        const payload = JSON.parse(rendered.props._page);
        assert.equal(payload.task?.id ?? null, visibleTask ? task.id : null);
        assert.equal(payload.taskId, visibleTask ? task.id : null);
        if (!visibleTask) assert.doesNotMatch(rendered.props._page, /HIDDEN-TICKET-TITLE|SECRET-987654|987654/);
        assert.equal(boardReads, 1);
      }
      assert.equal(originReads, redirects ? 0 : 1);
      assert.equal(flagReads, 1);
    });
  }
}

const parser = require("node-html-parser");
const canvas = load("src/utils/controllers/pages/htmlCanvas.ts", { "node-html-parser": parser });
const urls = load("src/utils/controllers/urls/extractUrlsFromContent.ts", {
  "node-html-parser": parser,
  "@/lib/prisma": {},
  "@/lib/mcp/tasks/agentMutationFence": {},
  "@/utils/controllers/projects/getAllIncludes": access,
  "@/utils/controllers/urls/addIntoTask": {}, "@/utils/controllers/urls/addIntoTaskDesc": {},
});
const fileSource = "https://files.example.test/uploads/private.png";
const key = "uploads/private.png";
const storage = { parseHypertasksStorageKeyFromUrl: (url) => {
  try { const parsed = new URL(url); return parsed.hostname === "files.example.test" ? parsed.pathname.slice(1) : null; } catch { return null; }
} };
for (const userId of [1, 2, 3]) {
  for (const wrapped of [false, true]) {
    test(`taskless page images use page ownership and exact keys (viewer ${userId}, canvas ${wrapped})`, async () => {
      let content = `<img src="${fileSource}">`;
      let query;
      const images = load("src/utils/controllers/tasks/getAccessibleAttachmentKey.ts", {
        "@/lib/prisma": { default: {
          attachment: { findMany: async () => [] }, description: { findMany: async () => [] }, comment: { findMany: async () => [] },
          page: { findMany: async (args) => {
            query = args;
            return matches(boards[0], args.where.project) ? [{ contentHtml: wrapped ? canvas.wrapHtmlCanvas(content) : content }] : [];
          } },
        } },
        "node-html-parser": parser,
        "@/lib/storage/hypertasksS3": storage,
        "@/utils/controllers/projects/getAllIncludes": access,
        "@/utils/controllers/urls/extractUrlsFromContent": urls,
        "@/utils/controllers/pages/htmlCanvas": canvas,
      });
      assert.equal(await images.getAccessibleAttachmentKey(fileSource, userId), userId === 2 ? null : key);
      assert.equal(query.where.task, undefined);
      assert.deepEqual(query.where.project, access.projectContentAccessWhere(userId));
      content = `<img src="${fileSource}.other">`;
      assert.equal(await images.getAccessibleAttachmentKey(fileSource, userId), null);
      content = `<p>${key}</p>`;
      assert.equal(await images.getAccessibleAttachmentKey(fileSource, userId), null);
    });
  }
}

for (const userId of [1, 2, 3]) {
  test(`page mentions use page board and omit ticket metadata (viewer ${userId})`, async () => {
    let query;
    const mentions = load("src/utils/controllers/tasks/taskSearchByParam.ts", {
      "@/app/api/ai/_lib/planGate": { haiku55ModelEnabled: async () => false },
      "@/utils/controllers/projects/getAllIncludes": access,
      "@/lib/prisma": { default: {
        project: {
          findMany: async ({ where, select }) => boards.filter((board) => matches(board, where)).map((board) => select ? { id: board.id } : board),
          findFirst: async () => ({ owner: { id: userId }, members: [] }),
        },
        user: { findFirst: async () => ({ id: 332 }) },
        page: { findMany: async (args) => {
          query = args;
          return page.projectId === args.where.projectId && matches(boards[0], args.where.project) ? [page, { ...page, publicId: "taskless", task: null, taskId: null }] : [];
        } },
      } },
      "@/lib/aiModelOptions": { aiModelDefinitions: [], aiImageModelDefinitions: [] },
      "@/utils/controllers/agents/boardMembers": { getBoardAgentMembers: async () => [] },
      "../search/document": { turbopufferFetchMentionTasks: async () => [] },
      "@/utils/controllers/pages/standalonePagesEnabled": { standalonePagesEnabled: async () => true },
      "@/lib/flags/definitions/htpr-7859-remove-image-generation": { HTPR_7859_REMOVE_IMAGE_GENERATION_FLAG: "htpr-7859-remove-image-generation" },
      "@/lib/flags": { isFeatureEnabled: async () => false },
      "@/utils/helperFunctions/mentionSearch": { matchesMentionName: () => true, selectMentionAgents: () => [] },
    }).default;
    const result = await mentions("Page", userId, 10);
    if (userId === 2) {
      assert.equal(result.status, 404);
      assert.deepEqual(result.json, []);
      assert.equal(query, undefined);
    } else {
      assert.equal(result.status, 200);
      const pages = result.json.filter((row) => row.type === "page");
      assert.equal(pages.length, 2);
      assert.equal(result.json.find((row) => row.type === "pageHeading").count, pages.length);
      assert.deepEqual(pages[0], { id: page.publicId, name: "Page", type: "page" });
      assert.doesNotMatch(JSON.stringify(pages), /ticketNumber|987654|HIDDEN/);
      assert.equal(query.where.projectId, 10);
      assert.equal(query.where.task, undefined);
      assert.equal(query.select.task, undefined);
    }
  });
}

test("page index includes, rows, schema and namespace contain only page-owned metadata", async () => {
  let query;
  const writes = [];
  const namespaces = load("src/lib/turbopuffer.js", {
    "@turbopuffer/turbopuffer": { default: class {} },
    "./configs/search.config": { searchConfig: { collections: { task: {}, comment: {} } } },
  }).turbopufferNamespaces;
  const index = load("src/utils/controllers/turbopuffer/turbopufferHelper.ts", {
    "@/app/api/ai/_lib/aiUsage": { logAiUsage: async () => {} },
    "@/lib/prisma": { default: { page: { findFirst: async (args) => {
      query = args;
      return { ...page, contentText: "Page text", project: { title: "Page board" }, task: null, taskId: null };
    } }, project: { findUnique: async () => ({ teamId: null }) } } },
    "@/lib/turbopuffer": { default: { namespace: (name) => ({ write: async (body) => { writes.push({ name, body }); } }) }, turbopufferNamespaces: namespaces },
    "@/utils/controllers/search/rankHits": {}, "@/app/api/ai/_lib/boardMemoryContract": {},
    "@/lib/ai/teamAiFunding": require("./helpers/team-ai-funding-stub.cjs"),
    "./embedRowsForWrite": load("src/utils/controllers/turbopuffer/embedRowsForWrite.ts", {
      "@/lib/prisma": { default: { project: { findUnique: async () => ({ teamId: "fixture-team" }) } } },
      "@/lib/ai/teamAiFunding": require("./helpers/team-ai-funding-stub.cjs"),
    }),
  }, {
    env: { TURBOPUFFER_EMBEDDINGS_API_KEY: "synthetic-test-key" },
    fetch: async (_url, options) => {
      assert.deepEqual(JSON.parse(options.body).input, ["Page Page text"]);
      return { ok: true, json: async () => ({ data: [{ index: 0, embedding: Array(1536).fill(0) }] }) };
    },
  });
  assert.deepEqual(index.turbopufferPageInclude, { project: { select: { title: true } } });
  for (const origin of [task, null]) {
    const row = index.buildTurbopufferPageRow({ ...page, contentText: "Page text", project: { title: "Page board" }, task: origin, taskId: origin?.id ?? null });
    assert.equal(row.projectId, 10);
    assert.equal(row.projectTitle, "Page board");
    assert.equal(row.searchText, "Page Page text");
    assert.doesNotMatch(JSON.stringify(row), /task|HIDDEN|987654|SECRET/);
    assert.doesNotMatch(JSON.stringify(index.pageNamespaceSchema), /task/);
  }
  await index.upsertPageToTurbopuffer(11);
  assert.deepEqual(query.include, index.turbopufferPageInclude);
  assert.deepEqual(query.where, { id: 11, archived: false });
  assert.equal(namespaces.page.name, "pages-v2");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].name, namespaces.page.name);
  assert.equal(writes[0].body.upsert_rows[0].projectId, 10);
  assert.equal(writes[0].body.upsert_rows[0].vector.length, 1536);
  assert.doesNotMatch(JSON.stringify(writes), /task|HIDDEN|SECRET|987654/);
  await index.ensureTurbopufferSchema();
  const pageSeed = writes.find((write) => write.name === namespaces.page.name && write.body.upsert_rows?.[0].id === "__schema__");
  assert.ok(pageSeed);
  assert.doesNotMatch(JSON.stringify(pageSeed), /task/);
});

for (const flagsEnabled of [false, true]) {
  for (const [scenario, origin, linkedTask] of [
    ["standalone linked B", null, task],
    ["standalone unlinked B", null, null],
    ["origin A active", task, task],
    ["origin A unlinked", task, null],
    ["origin A unlinked and C active", task, { ...task, id: 123, projectId: 10, uniqueIndex: 123 }],
  ]) {
    for (const mobile of [false, true]) {
      test(`editor back and gallery are safe (${scenario}, flags ${flagsEnabled}, mobile ${mobile})`, async () => {
        const dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/page/page-fixture" });
        const globals = ["window", "document", "Element", "HTMLImageElement", "HTMLIFrameElement", "DOMParser", "IS_REACT_ACT_ENVIRONMENT"];
        const previous = globals.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]);
        for (const name of globals) Object.defineProperty(global, name, { configurable: true, value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[name] });
        const calls = [];
        let gallery;
        const PageEditor = load("src/app/page/[publicId]/PageEditor.tsx", {
          "lucide-react": { ArrowLeft: () => null, ChevronLeft: () => null, Trash2: () => null },
          "next/navigation": { useRouter: () => ({ replace: (href) => calls.push(href) }) },
          "next/dynamic": { default: (loader) => loader.toString().includes("AttachmentsCarousel") ? (props) => { gallery = props; return null; } : () => null },
          "react-hot-toast": { default: { error: noop } },
          "@/hooks/useFlag": { useFlag: (key) => key === "htpr-6872-page-image-gallery" && flagsEnabled },
          "@/hooks/General/useContentZoom": { useContentZoom: () => ({ zoom: 1 }) },
          "@/hooks/General/useDebounceWithCancel": { default: () => [noop, noop, noop] },
          "@/lib/flags/keys": { HTPR_6872_PAGE_IMAGE_GALLERY_FLAG: "htpr-6872-page-image-gallery" },
          "@/lib/configs/general.config": {}, "@/utils/undoActions/helperFuncs": { cn: noop },
          "@/lib/constants/APIRouteConstants": { pageRoute: noop },
          "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(mobile) },
          "@/lib/navigation/pageReturn": load("src/lib/navigation/pageReturn.ts"),
          "@/lib/state": { useRecoilValue: () => ({ show: false }), useSetRecoilState: () => noop },
          "@/store": {}, "@/store/currentPageActions": {}, "@/styles/tiptap.module.scss": { default: {} },
          "@/components/PageComponents/Kanban/HeaderComponents/AppShellRail": { default: () => null },
          "@/components/RTE/Components/DragHandleTiptap": { default: () => null },
          "@/components/RTE/Components/TiptapBubbleMenu": { default: () => null },
          "@/components/RTE/Tiptap": { default: () => ({ editor: { on: noop, off: noop, registerPlugin: noop, unregisterPlugin: noop, commands: { focus: noop } } }) },
          "@/utils/helperFunctions/isContentCarouselImage": load("src/utils/helperFunctions/isContentCarouselImage.ts"),
          "@tiptap/react": { EditorContent: () => React.createElement("div", { className: "ProseMirror" }, React.createElement("img", { src: fileSource })) },
        }).default;
        const reactRoot = createRoot(document.getElementById("root"));
        try {
          const serialized = await pageService({
            ...page, task: origin, taskId: origin?.id ?? null,
            links: [
              ...(linkedTask ? [{ task: linkedTask, removedAt: null }] : []),
              { task, removedAt: new Date() },
            ],
          }).getPage({ publicId: page.publicId, standalonePagesEnabled: true });
          assert.equal(serialized.task?.id ?? null, linkedTask?.id ?? null);
          await React.act(async () => reactRoot.render(React.createElement(PageEditor, {
            _page: JSON.stringify(serialized),
            _user: JSON.stringify({ id: 1 }),
          })));
          const back = [...document.querySelectorAll("button")].find((button) => button.textContent.includes("Back to"));
          assert.equal(back.textContent.trim(), linkedTask ? "Back to task" : "Back to board");
          await React.act(async () => document.querySelector("img").dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true })));
          if (flagsEnabled) {
            assert.equal(gallery.attachments.length, 1);
            assert.equal(gallery.attachments[0].taskId, origin?.id ?? undefined);
            assert.equal(gallery.attachments[0].fileSource, fileSource);
          } else assert.equal(gallery, undefined);
          await React.act(async () => back.click());
          assert.deepEqual(calls, [linkedTask ? `/detail/project-${linkedTask.projectId}/${linkedTask.uniqueIndex}` : "/project?id=10"]);
        } finally {
          await React.act(async () => reactRoot.unmount());
          dom.window.close();
          for (const [name, descriptor] of previous) {
            if (descriptor) Object.defineProperty(global, name, descriptor);
            else delete global[name];
          }
        }
      });
    }
  }
}
