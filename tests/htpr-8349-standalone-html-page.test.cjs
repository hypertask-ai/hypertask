const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const KEY = "htpr-8349-standalone-html-page";
const FULL_DOCUMENT = '<!doctype html><html><head><style>body{color:#eee}</style></head><body><h1>Report</h1></body></html>';
const PIXEL = '<img src="data:image/png;base64,iVBORw0KGgo=" alt="px">';

function loadStandalone({ enabled = true, calls = [] } = {}) {
  return loadModule("src/utils/controllers/pages/standaloneContent.ts", {
    "@/lib/flags": {
      isFeatureEnabled: async (key, userId) => {
        calls.push([key, userId]);
        return enabled;
      },
    },
    "@/lib/flags/definitions/htpr-8349-standalone-html-page": {
      HTPR_8349_STANDALONE_HTML_PAGE_FLAG: KEY,
    },
  });
}

test("a self-contained HTML page is stored as an isolated document", async () => {
  const calls = [];
  const { storedPageContentType } = loadStandalone({ calls });
  assert.equal(
    await storedPageContentType({ content: FULL_DOCUMENT, contentType: "html", userId: 7 }),
    "html_canvas",
  );
  assert.deepEqual(calls, [[KEY, 7]]);
});

test("an inline data image alone is enough to keep the page intact", async () => {
  const { storedPageContentType } = loadStandalone();
  assert.equal(
    await storedPageContentType({ content: `<p>chart</p>${PIXEL}`, contentType: "html", userId: 7 }),
    "html_canvas",
  );
});

test("a plain HTML snippet keeps the page's current appearance", async () => {
  const calls = [];
  const { storedPageContentType, isSelfContainedDocument } = loadStandalone({ calls });
  assert.equal(isSelfContainedDocument("<p>Just <strong>words</strong> and <a href=\"/x\">a link</a></p>"), false);
  assert.equal(
    await storedPageContentType({ content: "<h1>Plain</h1><p>words</p>", contentType: "html", userId: 7 }),
    "html",
  );
  assert.deepEqual(calls, []);
});

test("markdown and explicit canvas content are left alone", async () => {
  const { storedPageContentType } = loadStandalone();
  assert.equal(
    await storedPageContentType({ content: FULL_DOCUMENT, contentType: "markdown", userId: 7 }),
    "markdown",
  );
  assert.equal(
    await storedPageContentType({ content: FULL_DOCUMENT, contentType: "html_canvas", userId: 7 }),
    "html_canvas",
  );
});

test("flag off restores the previous flattened rendering", async () => {
  const { storedPageContentType } = loadStandalone({ enabled: false });
  assert.equal(
    await storedPageContentType({ content: FULL_DOCUMENT, contentType: "html", userId: 7 }),
    "html",
  );
});

test("every page writer asks for the stored content type with the acting user", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.resolve(__dirname, "..");
  for (const file of [
    "src/lib/mcp/operations/pages/create/operation.ts",
    "src/lib/mcp/operations/pages/update/operation.ts",
    "src/app/api/pages/create/route.ts",
    "src/app/api/pages/[publicId]/route.ts",
    "src/lib/ai/tools/createPage.ts",
    "src/lib/ai/tools/updatePage.ts",
  ]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(source, /import \{ storedPageContentType \} from ["']@\/utils\/controllers\/pages\/standaloneContent["']/, file);
    assert.match(source, /await storedPageContentType\(\{[\s\S]{0,200}userId/, file);
  }
});

test("the flag is a bugfix that ships to Everyone", () => {
  const { default: flag, HTPR_8349_STANDALONE_HTML_PAGE_FLAG: key } =
    loadModule("src/lib/flags/definitions/htpr-8349-standalone-html-page.ts");
  assert.equal(key, KEY);
  assert.equal(flag.key, KEY);
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
});
