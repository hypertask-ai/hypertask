const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { generateHTML, generateJSON } = require("@tiptap/core");
const StarterKit = require("@tiptap/starter-kit").default;

const root = path.resolve(__dirname, "..");
const dom = new JSDOM("<!doctype html>");
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;

const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { LinkableMention } = jiti(
  path.join(root, "src/components/RTE/Extensions/LinkableMention.ts"),
);
const extensions = [
  StarterKit,
  LinkableMention.configure({ HTMLAttributes: { class: "mention" } }),
];

function roundTrip(html) {
  const json = generateJSON(html, extensions);
  return { json, html: generateHTML(json, extensions) };
}

test("task mention anchors remain mention nodes while editing", () => {
  const result = roundTrip(
    '<p><a href="https://app.hypertask.ai/detail/project-15/6009" data-type="mention" class="mention" data-id="HTPR-6009" data-label="task" projectid="15" uniqueindex="6009">HTPR-6009</a></p>',
  );

  assert.equal(result.json.content[0].content[0].type, "mention");
  assert.match(
    result.html,
    /<a href="https:\/\/app\.hypertask\.ai\/detail\/project-15\/6009"[^>]*data-type="mention"/,
  );
  assert.ok(!result.html.includes("<span"));
});

test("page mentions render as links and person mentions remain spans", () => {
  const page = roundTrip(
    '<p><a href="https://app.hypertask.ai/page/page_abc" data-type="mention" class="mention" data-id="page_abc" data-label="page">Roadmap</a></p>',
  );
  assert.match(page.html, /<a href="https:\/\/app\.hypertask\.ai\/page\/page_abc"/);

  const person = roundTrip(
    '<p><span data-type="mention" class="mention" data-id="Valentin Yeo" data-label="name-6">Valentin Yeo</span></p>',
  );
  assert.match(person.html, /<span[^>]*data-type="mention"/);
  assert.ok(!person.html.includes("href="));
});
