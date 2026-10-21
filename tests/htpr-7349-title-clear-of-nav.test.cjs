const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToString } = require("react-dom/server");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function loadTitleContainer({ mobile = false } = {}) {
  const js = ts.transpileModule(read("src/components/PageComponents/TaskDetail/TopRow/BaseTitleContainer.tsx"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const MobileViewContext = React.createContext(mobile);
  const loaded = { exports: {} };
  new Function("require", "module", "exports", js)((name) => {
    if (name === "react") return React;
    if (name === "@/utils/undoActions/helperFuncs") return { cn: (...parts) => parts.flat().filter(Boolean).join(" ") };
    if (name === "@/lib/contexts/mobileContext") return { MobileViewContext };
    throw new Error(`Unexpected dependency ${name}`);
  }, loaded, loaded.exports);
  return loaded.exports.default;
}

function containerClasses(props, options) {
  const BaseTitleContainer = loadTitleContainer(options);
  const html = renderToString(React.createElement(BaseTitleContainer, { dataAttribute: "task-detail", titleRowContent: "Title", ...props }));
  const match = html.match(/data-title-container="task-detail"[^>]*class="([^"]*)"|class="([^"]*)"[^>]*data-title-container="task-detail"/);
  assert.ok(match, "title container rendered");
  return (match[1] ?? match[2]).split(/\s+/);
}

test("a desktop ticket with the back and up/down buttons keeps the title clear of them at every column width", () => {
  const classes = containerClasses({ clearDesktopNavigation: true });
  assert.ok(!classes.includes("task-detail-horizontal-title-container"), "the narrow 18px left padding no longer applies");
  const leftPaddings = classes.filter((c) => /(^|:)(pl|px|p)-/.test(c));
  assert.deepEqual(leftPaddings, ["@xs:pl-[5.125rem]"], "one left padding, wide enough to clear the 104px navigation from the smallest column up");
});

test("still allowed: without the navigation the title keeps today's padding", () => {
  assert.ok(containerClasses({}).includes("task-detail-horizontal-title-container"), "flag Off, phone, embedded and shared tickets");
  assert.ok(containerClasses({}, { mobile: true }).includes("task-detail-horizontal-title-container"));
  assert.ok(!containerClasses({ clearDesktopNavigation: true, useHorizontalPadding: false }).some((c) => c.startsWith("task-detail-")), "callers that opt out of padding stay unpadded");
});
