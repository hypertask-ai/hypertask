const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToString } = require("react-dom/server");
const { loadModule } = require("./helpers/loadModule.cjs");

function loadTitleContainer({ mobile = false } = {}) {
  const MobileViewContext = React.createContext(mobile);
  return loadModule("src/components/PageComponents/TaskDetail/TopRow/BaseTitleContainer.tsx", {
    react: React,
    "@/utils/undoActions/helperFuncs": { cn: (...parts) => parts.flat().filter(Boolean).join(" ") },
    "@/lib/contexts/mobileContext": { MobileViewContext },
    "@/hooks/useFlag": { useFlag: () => false },
    "@/lib/flags/definitions/htpr-8955-chat-over-title": { HTPR_8955_CHAT_OVER_TITLE_FLAG: "htpr-8955-chat-over-title" },
    "@/lib/flags/definitions/htpr-8992-sticky-title": { HTPR_8992_STICKY_TITLE_FLAG: "htpr-8992-sticky-title" },
  }).default;
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
