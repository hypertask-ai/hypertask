const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToString } = require("react-dom/server");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function loadTitleContainer({ mobile = false, flags = [] } = {}) {
  const js = ts.transpileModule(read("src/components/PageComponents/TaskDetail/TopRow/BaseTitleContainer.tsx"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const MobileViewContext = React.createContext(mobile);
  const loaded = { exports: {} };
  new Function("require", "module", "exports", js)((name) => {
    if (name === "react") return React;
    if (name === "@/utils/undoActions/helperFuncs") return { cn: (...parts) => parts.flat().filter(Boolean).join(" ") };
    if (name === "@/lib/contexts/mobileContext") return { MobileViewContext };
    if (name === "@/hooks/useFlag") return { useFlag: (key) => flags.includes(key) };
    if (name === "@/lib/flags/definitions/htpr-8955-chat-over-title") return { HTPR_8955_CHAT_OVER_TITLE_FLAG: "htpr-8955-chat-over-title" };
    if (name === "@/lib/flags/definitions/htpr-8992-sticky-title") return { HTPR_8992_STICKY_TITLE_FLAG: "htpr-8992-sticky-title" };
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

const DIVIDER = "shadow-[0_1px_0_0_var(--border-light-gray-thin)]";
const stickyLine = { flags: ["htpr-8992-sticky-title"] };

test("HTPR-8992: a scrolled desktop ticket header draws the divider line under the full bar", () => {
  assert.ok(containerClasses({ showScrollDivider: true }, stickyLine).includes(DIVIDER), "line shows once scrolled");
  assert.ok(!containerClasses({ showScrollDivider: false }, stickyLine).includes(DIVIDER), "no line at the top of the page");
  assert.ok(containerClasses({ showScrollDivider: true }, stickyLine).includes("bg-inherit"), "header keeps its opaque inherited background");
});

test("HTPR-8992: the phone ticket header border uses the theme thin border colour", () => {
  const classes = containerClasses({}, { mobile: true, ...stickyLine });
  assert.ok(classes.includes("border-border-light-gray-thin"));
  assert.ok(!classes.includes("border-light-black-border-1"));
  assert.ok(!classes.includes(DIVIDER), "phone keeps its border and gets no extra line");
});

test("still allowed: flag off keeps today's header", () => {
  assert.ok(!containerClasses({ showScrollDivider: true }).includes(DIVIDER));
  assert.ok(containerClasses({}, { mobile: true }).includes("border-light-black-border-1"));
});

test("still allowed: the onboarding header keeps its border with the flag on", () => {
  const BaseTitleContainer = loadTitleContainer({ mobile: true, ...stickyLine });
  const html = renderToString(React.createElement(BaseTitleContainer, { dataAttribute: "onboarding", titleRowContent: "Title" }));
  assert.match(html, /border-light-black-border-1/);
  assert.doesNotMatch(html, /border-border-light-gray-thin/);
});
