const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const sass = require("sass");
const { chromium } = require("@playwright/test");

const root = path.resolve(__dirname, "..");
const css = sass.compile(path.join(root, "src/styles/globals.scss"), {
  loadPaths: [path.join(root, "src/styles"), path.join(root, "node_modules")],
  silenceDeprecations: ["import"],
}).css;

const comment = (id, attributes) => `<div id="${id}" data-task-comment-box ${attributes}>comment</div>`;
const page = (outlinesFlag) => `<!doctype html><html ${outlinesFlag ? "data-task-box-outlines" : ""}><head><style>
:root { --border-light-gray-thin: rgb(226, 226, 230); --border-active: rgb(10, 20, 30); --border-pinned: rgb(255, 185, 128); }
${css}</style></head><body><div data-task-detail-path>
${comment("collapsed", "data-task-comment-collapsed")}
${comment("collapsedActive", 'data-task-comment-collapsed data-task-comment-state="active"')}
${comment("open", "")}
${comment("openActive", 'data-task-comment-state="active"')}
${comment("pinned", 'data-task-comment-state="pinned"')}
</div></body></html>`;

async function outlines(outlinesFlag) {
  const browser = await chromium.launch();
  try {
    const tab = await browser.newPage();
    await tab.setContent(page(outlinesFlag));
    return await tab.$$eval("[data-task-comment-box]", (boxes) =>
      Object.fromEntries(boxes.map((box) => {
        const style = getComputedStyle(box);
        return [box.id, style.outlineStyle === "none" ? "none" : style.outlineColor];
      }))
    );
  } finally {
    await browser.close();
  }
}

test("collapsed comments have no outline at rest; active, open and pinned comments keep theirs", async () => {
  assert.deepEqual(await outlines(true), {
    collapsed: "rgba(0, 0, 0, 0)",
    collapsedActive: "rgb(10, 20, 30)",
    open: "rgb(226, 226, 230)",
    openActive: "rgb(10, 20, 30)",
    pinned: "rgb(255, 185, 128)",
  });
});

test("with the outline flag off no comment gets the HTPR-7194 outline", async () => {
  const flagOff = await outlines(false);
  assert.ok(Object.values(flagOff).every((outline) => outline === "none"), JSON.stringify(flagOff));
});
