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

test("fetched help article HTML is stripped and collapsed in full", async () => {
  const calls = [];
  const body = "documentation ".repeat(200);
  const html = `<h1>Start&nbsp;here</h1><p>${body}</p>`;
  const fetchImpl = async (url) => {
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

  const result = await searchHelpDocs(
    { query: "keyboard shortcuts", limit: 4 },
    fetchImpl,
  );

  assert.equal(result.success, true);
  assert.equal(result.total, 1);
  assert.equal(result.articles[0].title, "Keyboard shortcuts");
  assert.equal(
    result.articles[0].url,
    `${HELP_DOCS_BASE_URL}/help/keyboard-shortcuts`,
  );
  const expected = `Start here ${body}`.replace(/\s+/g, " ").trim();
  assert.equal(result.articles[0].content, expected);
  assert.ok(expected.length > 1500);
  assert.match(result.articles[0].content, /^Start here documentation/);
  assert.match(result.articles[0].content, /documentation$/);
  assert.doesNotMatch(result.articles[0].content, /<[^>]+>|&nbsp;|\s{2,}/);
  assert.deepEqual(calls, [
    `${HELP_DOCS_BASE_URL}/api/articles/search/keyboard%20shortcuts`,
    `${HELP_DOCS_BASE_URL}/api/articles/keyboard-shortcuts`,
  ]);
});

test("docs-api-tools-reference returns its last section from the live help API", async () => {
  const slug = "docs-api-tools-reference";
  const articleUrl = `${HELP_DOCS_BASE_URL}/api/articles/${slug}`;
  const fetchImpl = async (url, init) => {
    if (String(url).includes("/api/articles/search/")) {
      return new Response(
        JSON.stringify([
          {
            title: "MCP Tools Reference",
            slug,
            excerpt: "excerpt",
          },
        ]),
        { status: 200 },
      );
    }
    return fetch(url, init);
  };

  const result = await searchHelpDocs({ query: "MCP tools reference", limit: 1 }, fetchImpl);
  assert.equal(result.success, true);
  assert.equal(result.articles[0].url, `${HELP_DOCS_BASE_URL}/help/${slug}`);

  const live = await fetch(articleUrl, { signal: AbortSignal.timeout(8000) });
  assert.equal(live.ok, true);
  const doc = await live.json();
  const html = doc.content;
  assert.equal(typeof html, "string");
  const full = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const lastHeading = html
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^#{1,3} /.test(line))
    .at(-1);
  assert.equal(typeof lastHeading, "string");
  assert.ok(full.indexOf(lastHeading) > 1500);
  assert.equal(result.articles[0].content, full);
  assert.ok(result.articles[0].content.includes(lastHeading));
  assert.ok(result.articles[0].content.length > 1500);
});
