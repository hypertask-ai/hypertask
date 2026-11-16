const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/loadModule.cjs");

function load(flagOn) {
  return loadModule("src/lib/help-docs/searchHelpDocs.ts", {
    "@/lib/flags": { isFeatureEnabled: async () => flagOn },
  });
}

function stubFetch(urls) {
  return async (url) => {
    urls.push(String(url));
    if (String(url).includes("/api/articles/search/")) {
      return new Response(
        JSON.stringify([
          { title: "Broken article", slug: "broken-article", excerpt: "Short stub" },
          { title: "Working article", slug: "working-article", excerpt: "Working stub" },
        ]),
        { status: 200 },
      );
    }
    if (String(url).endsWith("/api/articles/broken-article")) {
      throw new Error("article request timed out");
    }
    return new Response(
      JSON.stringify({ content: "<p>Working article body</p>" }),
      { status: 200 },
    );
  };
}

async function captureWarnings(run) {
  const lines = [];
  const original = console.warn;
  console.warn = (...args) => lines.push(args.join(" "));
  try {
    const result = await run();
    return { result, lines };
  } finally {
    console.warn = original;
  }
}

test("a failed help article is named in a warning and the other articles still load", async () => {
  const { searchHelpDocs } = load(true);
  const urls = [];
  const { result, lines } = await captureWarnings(() =>
    searchHelpDocs(
      { query: "broken article", limit: 4 },
      stubFetch(urls),
      { featureFlag: { findUnique: async () => null } },
    ),
  );

  assert.equal(result.success, true);
  assert.equal(result.total, 2);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /broken-article/);
  assert.doesNotMatch(lines[0], /working-article/);
  assert.equal(result.articles[0].content, "Short stub");
  assert.equal(result.articles[1].content, "Working article body");
});

test("a help article that answers with an error status is named in a warning", async () => {
  const { searchHelpDocs } = load(true);
  const lines = [];
  const original = console.warn;
  console.warn = (...args) => lines.push(args.join(" "));
  try {
    const result = await searchHelpDocs(
      { query: "broken article", limit: 1 },
      async (url) => {
        if (String(url).includes("/api/articles/search/")) {
          return new Response(
            JSON.stringify([{ title: "Missing", slug: "missing-article", excerpt: "Stub" }]),
            { status: 200 },
          );
        }
        return new Response("gone", { status: 404 });
      },
      { featureFlag: { findUnique: async () => null } },
    );
    assert.equal(result.success, true);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /missing-article/);
    assert.equal(result.articles[0].content, "Stub");
  } finally {
    console.warn = original;
  }
});

test("no warning is written when the logging switch is off", async () => {
  const { searchHelpDocs } = load(false);
  const { result, lines } = await captureWarnings(() =>
    searchHelpDocs(
      { query: "broken article", limit: 4 },
      stubFetch([]),
      { featureFlag: { findUnique: async () => null } },
    ),
  );

  assert.equal(result.success, true);
  assert.equal(result.total, 2);
  assert.deepEqual(lines, []);
  assert.equal(result.articles[0].content, "Short stub");
  assert.equal(result.articles[1].content, "Working article body");
});
