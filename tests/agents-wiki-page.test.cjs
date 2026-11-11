const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const guide = fs.readFileSync(path.join(root, "src/app/wiki/agents/agents.md"), "utf8");

test("the public page renders the bundled guide dynamically without static prerendering", async () => {
  const load = require("jiti")(__filename, {
    alias: { "@": path.join(root, "src") },
    jsx: { runtime: "automatic" },
  });
  const { default: AgentsWikiPage, dynamic } = load(path.join(root, "src/app/wiki/agents/page.tsx"));
  assert.equal(dynamic, "force-dynamic");
  const { markdownToHtml } = load(path.join(root, "src/utils/helperFunctions/markdownToHtml.ts"));
  const page = await AgentsWikiPage();
  assert.equal(page.type, "main");
  const html = page.props.children.props.dangerouslySetInnerHTML.__html;
  assert.equal(html, markdownToHtml(guide));
  assert.match(html, /<h1>Universal agent onboarding<\/h1>/);
  assert.match(html, /<h2>QA lane<\/h2>/);
  assert.match(html, /https:\/\/app\.hypertask\.ai\/wiki\/agents/);
});

test("the server build includes the route-local onboarding markdown", () => {
  const config = require(path.join(root, "next.config.js"));
  assert.deepEqual(config.outputFileTracingIncludes["/wiki/agents"], [
    "./src/app/wiki/agents/agents.md",
  ]);
  for (const asset of config.outputFileTracingIncludes["/wiki/agents"]) {
    assert.ok(fs.statSync(path.join(root, asset)).isFile());
  }
});

function renderedHtml() {
  const load = require("jiti")(__filename, {
    alias: { "@": path.join(root, "src") },
    jsx: { runtime: "automatic" },
  });
  return load(path.join(root, "src/app/wiki/agents/page.tsx")).default().then(
    (page) => page.props.children.props.dangerouslySetInnerHTML.__html,
  );
}

function namedColumns(text) {
  const named = new Set();
  const flowLine = text.split("\n").find((line) => line.includes("\u2192"));
  if (flowLine) {
    for (const part of flowLine.split("\u2192")) {
      for (const piece of part.split("/")) if (piece.trim()) named.add(piece.trim());
    }
  }
  for (const match of text.matchAll(/moves? the ticket (?:back )?to ([A-Z][^.,]*)/g)) named.add(match[1].trim());
  for (const match of text.matchAll(/Move the board 15 ticket to ([A-Z][^.,]*)/g)) named.add(match[1].trim());
  return [...named];
}

test("the rendered onboarding page sends a ticket only to board 15 columns that exist", async () => {
  const { sections } = JSON.parse(
    fs.readFileSync(path.join(root, "tests/fixtures/board-15-sections.json"), "utf8"),
  );
  const columns = sections.map((section) => section.section_title);
  const text = (await renderedHtml()).replace(/<[^>]+>/g, "").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const named = namedColumns(text);
  assert.ok(named.length > 0, "the page names no board column at all");
  for (const column of named) {
    assert.ok(
      columns.includes(column),
      `the page sends a ticket to "${column}", which is not a board 15 column`,
    );
  }
  assert.ok(!text.includes("DeepSeek PRs on Hold"), "the page still sends lower-trust work to a column that does not exist");
});
