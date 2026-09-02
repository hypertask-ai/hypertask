const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const sass = require("sass");
const { JSDOM } = require("jsdom");

const commentStyles = sass.compile(
  path.join(__dirname, "../src/styles/tiptap.module.scss"),
).css;

function renderComment(html) {
  return new JSDOM(`
    <style>ol, ul { list-style: none; list-style-type: none; margin: 0; padding: 0; }</style>
    <style>${commentStyles}</style>
    <div class="hellow"><div class="editorContainer">${html}</div></div>
  `);
}

test("read-only comments keep ordered and bullet markers after the Tailwind reset", () => {
  const dom = renderComment(`
    <ol><li><p>First</p><ol><li><p>Nested</p></li></ol></li></ol>
    <ul><li><p>Bullet</p></li></ul>
  `);
  const [ordered, nested] = dom.window.document.querySelectorAll("ol");
  const bullet = dom.window.document.querySelector("ul");

  assert.equal(dom.window.getComputedStyle(ordered).listStyleType, "decimal");
  assert.equal(dom.window.getComputedStyle(nested).listStyleType, "decimal");
  assert.equal(dom.window.getComputedStyle(bullet).listStyleType, "disc");
  assert.equal(dom.window.getComputedStyle(ordered).listStylePosition, "outside");
});
