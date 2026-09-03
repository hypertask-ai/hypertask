const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
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
  assert.equal(page.json.content[0].content[0].type, "mention");
  assert.equal(page.json.content[0].content[0].attrs.text, "Roadmap");
  assert.match(page.html, /<a href="https:\/\/app\.hypertask\.ai\/page\/page_abc"/);
  assert.match(page.html, />Roadmap<\/a>/);

  const person = roundTrip(
    '<p><span data-type="mention" class="mention" data-id="Valentin Yeo" data-label="name-6">Valentin Yeo</span></p>',
  );
  assert.match(person.html, /<span[^>]*data-type="mention"/);
  assert.ok(!person.html.includes("href="));
});

test("mention links use the shared token in every theme", () => {
  const globals = fs.readFileSync(path.join(root, "src/styles/globals.scss"), "utf8");
  assert.match(globals, /color: var\(--color-rich-text-link\) !important/);

  const themeColors = {
    amoled: "#5896f1",
    dark: "#5896f1",
    dia: "#3e6b4f",
    graphite: "#5896f1",
    light: "#1365a3",
    porcelain: "#1365a3",
  };
  for (const [theme, color] of Object.entries(themeColors)) {
    const css = fs.readFileSync(
      path.join(root, `src/styles/tailwindThemes/${theme}.css`),
      "utf8",
    );
    assert.ok(css.includes(`--color-rich-text-link: ${color}`));
  }
});
