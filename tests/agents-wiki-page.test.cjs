const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const route = fs.readFileSync(
  path.join(root, "src/app/wiki/agents/page.tsx"),
  "utf8",
);
const guide = fs.readFileSync(path.join(root, "src/app/wiki/agents/agents.md"), "utf8");

test("the public agents wiki page renders the shared QA-lane guide", () => {
  assert.match(route, /"src", "app", "wiki", "agents", "agents\.md"/);
  assert.match(route, /markdownToHtml/);
  assert.match(guide, /## QA lane/);
  assert.match(guide, /Bugs → In Progress → AI Review → QA → Done/);
  assert.match(guide, /Nothing moves to \*\*Done\*\* without QA evidence/);
});

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
