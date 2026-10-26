const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(
  path.join(root, "tests/mcp-search-help-docs-entry.cjs"),
  {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
    cache: false,
  },
);

const { SearchHelpDocsInputSchema } = jiti(
  path.join(
    root,
    "src/lib/mcp-server/validations/help-docs.validation.ts",
  ),
);
const { MCP_TOOLS } = jiti(
  path.join(root, "src/lib/mcp-server/tools/index.ts"),
);
const { HELP_DOCS_BASE_URL, searchHelpDocs } = jiti(
  path.join(root, "src/lib/help-docs/searchHelpDocs.ts"),
);

test("help-doc schema accepts a query and constrains limit to 1..6", () => {
  assert.deepEqual(SearchHelpDocsInputSchema.parse({ query: "shortcuts" }), {
    query: "shortcuts",
    limit: 4,
  });
  assert.deepEqual(
    SearchHelpDocsInputSchema.parse({ query: "shortcuts", limit: "6" }),
    { query: "shortcuts", limit: 6 },
  );
  assert.equal(
    SearchHelpDocsInputSchema.safeParse({ query: "shortcuts", limit: 0 })
      .success,
    false,
  );
  assert.equal(
    SearchHelpDocsInputSchema.safeParse({ query: "shortcuts", limit: 7 })
      .success,
    false,
  );
});

test("search_help_docs is registered in MCP_TOOLS", () => {
  assert.ok(
    MCP_TOOLS.some((tool) => tool.name === "hypertask_search_help_docs"),
  );
});

const LAST_SECTION = "Time tracking hypertask_time";

function flagDb(mode) {
  return {
    featureFlag: {
      findUnique: async () => ({ mode }),
    },
    user: { findUnique: async () => null },
  };
}

function articleFetch(html, calls) {
  return async (url) => {
    calls.push(String(url));
    if (String(url).includes("/api/articles/search/")) {
      return new Response(
        JSON.stringify([
          {
            title: "Keyboard shortcuts",
            slug: "keyboard-shortcuts",
            excerpt: "Fallback excerpt",
          },
        ]),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ content: html }), { status: 200 });
  };
}

test("fetched help article HTML is stripped and returned in full when the flag is on", async () => {
  const calls = [];
  const body = "documentation ".repeat(200);
  const html = `<h1>Start&nbsp;here</h1><p>${body}</p><h2>${LAST_SECTION}</h2>`;
  const result = await searchHelpDocs(
    { query: "keyboard shortcuts", limit: 4 },
    articleFetch(html, calls),
    flagDb("EVERYONE"),
  );

  assert.equal(result.success, true);
  assert.equal(result.total, 1);
  assert.equal(result.articles[0].title, "Keyboard shortcuts");
  assert.equal(
    result.articles[0].url,
    `${HELP_DOCS_BASE_URL}/help/keyboard-shortcuts`,
  );
  const expected = `Start here ${body} ${LAST_SECTION}`.replace(/\s+/g, " ").trim();
  assert.ok(expected.indexOf(LAST_SECTION) > 1500);
  assert.equal(result.articles[0].content, expected);
  assert.match(result.articles[0].content, /^Start here documentation/);
  assert.match(result.articles[0].content, /Time tracking hypertask_time$/);
  assert.doesNotMatch(result.articles[0].content, /<[^>]+>|&nbsp;|\s{2,}/);
  assert.deepEqual(calls, [
    `${HELP_DOCS_BASE_URL}/api/articles/search/keyboard%20shortcuts`,
    `${HELP_DOCS_BASE_URL}/api/articles/keyboard-shortcuts`,
  ]);
});

test("help article stays at 1500 characters when the flag is off", async () => {
  const body = "documentation ".repeat(200);
  const html = `<h1>Start&nbsp;here</h1><p>${body}</p><h2>${LAST_SECTION}</h2>`;
  const result = await searchHelpDocs(
    { query: "keyboard shortcuts", limit: 1 },
    articleFetch(html, []),
    flagDb("OFF"),
  );

  assert.equal(result.success, true);
  assert.equal(result.articles[0].content.length, 1500);
  assert.match(result.articles[0].content, /^Start here documentation/);
  assert.doesNotMatch(result.articles[0].content, /Time tracking/);
});
