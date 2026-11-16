const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const React = require("react");
globalThis.React = React;
const { renderToStaticMarkup } = require("react-dom/server");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") }, jsx: { runtime: "automatic" } });
const { InboxSelectedCount } = jiti(path.join(root, "src/app/inbox/InboxSelectedCount.tsx"));
const html = (count) =>
  renderToStaticMarkup(React.createElement(InboxSelectedCount, { count }));

test("shows N selected for any count above zero without a flag", () => {
  assert.match(html(1), />1 selected</);
  assert.match(html(12), />12 selected</);
  assert.match(html(3), /whitespace-nowrap/);
});

test("nothing shows with zero selected", () => {
  assert.equal(html(0), "");
});
