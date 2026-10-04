const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, { alias: { "@": path.join(root, "src") } });

function load(file, stubs) {
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", source)(mod, mod.exports, (request) => {
    assert.ok(request in stubs, `Unexpected import: ${request}`);
    return stubs[request];
  });
  return mod.exports;
}

const canvas = jiti(path.join(root, "src/utils/controllers/pages/htmlCanvas.ts"));
const { sanitizeRichHtml } = jiti(path.join(root, "src/utils/helperFunctions/sanitizeRichHtml.ts"));
const { markdownToHtml } = jiti(path.join(root, "src/utils/helperFunctions/markdownToHtml.ts"));
const fieldError = jiti(path.join(root, "src/lib/mcp/fieldError.ts"));
const routeUtils = load("src/lib/mcp/operations/pages/helpers.ts", {
  "@/lib/mcp/fieldError": fieldError,
  "@/lib/mcp/tasks/services": { validateProjectAccess: async () => ({ error: null }) },
});
const original = '<style>body { color: red }</style><h1>Old canvas</h1>';
const incoming = '<style>body { color: blue }</style><h1>New canvas</h1><script>run()</script>';

function harness(contentHtml, { authorized = true, accessible = true } = {}) {
  let page = {
    id: 1, publicId: "canvas-page", title: "Page", projectId: 15, version: 2,
    contentHtml, contentText: "Old content", task: { id: 20 }, subPages: [],
  };
  const snapshots = [];
  const indexed = [];
  const tx = {
    page: {
      findUnique: async () => ({ ...page }),
      updateMany: async ({ where, data }) => {
        assert.equal(where.version, page.version);
        page = { ...page, ...data, version: page.version + data.version.increment };
        return { count: 1 };
      },
    },
    docVersion: { create: async ({ data }) => { snapshots.push(data); return data; } },
  };
  const service = load("src/utils/controllers/pages/pageService.ts", {
    "@/lib/prisma": { $transaction: async (callback) => callback(tx), page: tx.page },
    "@/utils/controllers/turbopuffer/turbopufferHelper": {
      convertToPlain: (html) => require("node-html-parser").parse(html).text,
      upsertPageToTurbopuffer: async (id) => { indexed.push(id); },
    },
    "@/utils/helperFunctions/markdownToHtml": { markdownToHtml },
    "@/utils/helperFunctions/sanitizeRichHtml": { sanitizeRichHtml },
    "./htmlCanvas": canvas,
  });
  const stubs = {
    "next/server": require("next/server"),
    "@/lib/mcp/fieldError": fieldError,
    "@/lib/mcp/auth": {
      validateMcpAuth: async () => authorized ? { user: { id: 99 }, agentId: "test-agent" } : null,
      checkMcpRateLimit: async () => null,
    },
    "@/utils/controllers/pages/pageService": service,
    "@/utils/controllers/pages/htmlCanvas": canvas,
    "@/utils/controllers/pages/htmlToMarkdown": jiti(path.join(root, "src/utils/controllers/pages/htmlToMarkdown.ts")),
    "@/lib/mcp/operations/pages/helpers": { ...routeUtils, canAccessProject: async () => accessible },
  };
  const { POST } = load("src/lib/mcp/operations/pages/update/operation.ts", stubs);
  const { GET } = load("src/lib/mcp/operations/pages/get/operation.ts", stubs);
  return {
    service, snapshots, indexed, page: () => page,
    post: (body) => POST(new Request("https://app.hypertask.ai/api/mcp/pages/update", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: 1, ...body }),
    })),
    get: () => GET({ nextUrl: new URL("https://app.hypertask.ai/api/mcp/pages/get?id=1") }),
  };
}

for (const boundary of ["route", "service"]) {
  test(`${boundary}: omitted type preserves a canvas and its exact raw payload`, async () => {
    const h = harness(canvas.wrapHtmlCanvas(original));
    if (boundary === "route") assert.equal((await h.post({ content: incoming })).status, 200);
    else await h.service.updatePage({ id: 1, content: incoming, userId: 99 });
    assert.equal(canvas.decodeHtmlCanvas(h.page().contentHtml), incoming);
    assert.equal(h.page().contentText, "New canvas");
    const response = await (await h.get()).json();
    assert.equal(response.page.content_type, "html_canvas");
    assert.equal(response.page.content, incoming);
    assert.equal(h.page().version, 3);
    assert.equal(h.snapshots.length, 1);
    assert.equal(h.snapshots[0].contentHtml, canvas.wrapHtmlCanvas(original));
    assert.deepEqual(h.indexed, [1]);
  });

  test(`${boundary}: omitted type keeps Markdown conversion for ordinary pages`, async () => {
    const h = harness("<p>Old Markdown</p>");
    const content = "# Heading\n\n**bold**";
    if (boundary === "route") assert.equal((await h.post({ content })).status, 200);
    else await h.service.updatePage({ id: 1, content, userId: 99 });
    assert.equal(h.page().contentHtml, markdownToHtml(content));
    assert.equal(canvas.decodeHtmlCanvas(h.page().contentHtml), null);
    assert.equal((await (await h.get()).json()).page.content_type, "markdown");
  });

  for (const contentType of ["markdown", "html", "html_canvas"]) {
    test(`${boundary}: explicit ${contentType} wins over the existing canvas`, async () => {
      const h = harness(canvas.wrapHtmlCanvas(original));
      if (boundary === "route") {
        assert.equal((await h.post({ content: incoming, content_type: contentType })).status, 200);
      } else {
        await h.service.updatePage({ id: 1, content: incoming, contentType, userId: 99 });
      }
      const expected = contentType === "html_canvas" ? canvas.wrapHtmlCanvas(incoming)
        : contentType === "markdown" ? markdownToHtml(incoming) : sanitizeRichHtml(incoming);
      assert.equal(h.page().contentHtml, expected);
    });
  }
}

for (const mode of ["append", "prepend"]) {
  test(`omitted canvas type uses the existing ${mode} block ordering`, async () => {
    const h = harness(canvas.wrapHtmlCanvas(original));
    assert.equal((await h.post({ content: incoming, mode })).status, 200);
    const blocks = require("node-html-parser").parse(h.page().contentHtml).querySelectorAll("[data-html-block]");
    assert.deepEqual(blocks.map((block) => canvas.decodeHtmlPayloadServer(block.getAttribute("data-html"))),
      mode === "append" ? [original, incoming] : [incoming, original]);
  });
}

test("title-only updates leave the canvas untouched", async () => {
  const h = harness(canvas.wrapHtmlCanvas(original));
  assert.equal((await h.post({ title: "Renamed" })).status, 200);
  assert.equal(h.page().title, "Renamed");
  assert.equal(canvas.decodeHtmlCanvas(h.page().contentHtml), original);
});

test("invalid explicit types and modes are rejected without mutations", async () => {
  const h = harness(canvas.wrapHtmlCanvas(original));
  for (const body of [{ content_type: "invalid" }, { mode: "invalid" }]) {
    assert.equal((await h.post({ content: incoming, ...body })).status, 400);
  }
  assert.equal(h.snapshots.length, 0);
});

test("version conflicts and access failures do not mutate a canvas", async () => {
  const h = harness(canvas.wrapHtmlCanvas(original));
  assert.equal((await h.post({ content: incoming, if_version: 1 })).status, 409);
  assert.equal(h.snapshots.length, 0);
  for (const [options, status] of [[{ authorized: false }, 401], [{ accessible: false }, 404]]) {
    const denied = harness(canvas.wrapHtmlCanvas(original), options);
    assert.equal((await denied.post({ content: incoming })).status, status);
    assert.equal(denied.snapshots.length, 0);
  }
});
