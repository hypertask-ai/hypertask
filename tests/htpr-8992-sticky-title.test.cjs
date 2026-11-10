const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToString } = require("react-dom/server");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const cn = (...parts) => parts.flat().filter(Boolean).join(" ");
const stickyTitleKey = "htpr-8992-sticky-title";
const DIVIDER = "shadow-[0_1px_0_0_var(--border-light-gray-thin)]";

function loadHeader({ mobile = false, flagOn = true } = {}) {
  return loadModule("src/components/PageComponents/TaskDetail/TopRow/BaseTitleContainer.tsx", {
    "@/utils/undoActions/helperFuncs": { cn },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(mobile) },
    "@/hooks/useFlag": { useFlag: (key) => key === stickyTitleKey && flagOn },
    "@/lib/flags/definitions/htpr-8955-chat-over-title": { HTPR_8955_CHAT_OVER_TITLE_FLAG: "htpr-8955-chat-over-title" },
    "@/lib/flags/definitions/htpr-8992-sticky-title": { HTPR_8992_STICKY_TITLE_FLAG: stickyTitleKey },
  }).default;
}

function headerClasses(props, options) {
  const BaseTitleContainer = loadHeader(options);
  const html = renderToString(React.createElement(BaseTitleContainer, { dataAttribute: "task-detail", titleRowContent: "Title", ...props }));
  const match = html.match(/class="([^"]*)"/);
  assert.ok(match, "header rendered");
  return match[1].split(/\s+/);
}

test("the flag is a feature that starts at Owner + QA", () => {
  const { default: flag, HTPR_8992_STICKY_TITLE_FLAG: exported } = require("jiti").createJiti(__filename)(path.join(root, "src/lib/flags/definitions/htpr-8992-sticky-title.ts"));
  assert.equal(exported, stickyTitleKey);
  assert.equal(flag.key, stickyTitleKey);
  assert.equal(flag.kind, "feature");
  assert.equal(flag.defaultMode, "OWNER_AND_QA");
  assert.equal(flag.releaseRisk.risk, "new");
});

test("a scrolled desktop ticket header draws the divider line under the full bar", () => {
  assert.ok(headerClasses({ showScrollDivider: true }).includes(DIVIDER), "line shows once scrolled");
  assert.ok(!headerClasses({ showScrollDivider: false }).includes(DIVIDER), "no line at the top of the page");
  assert.ok(headerClasses({ showScrollDivider: true }).includes("bg-inherit"), "header keeps its opaque inherited background");
});

test("the phone ticket header border uses the theme thin border colour", () => {
  const classes = headerClasses({}, { mobile: true });
  assert.ok(classes.includes("border-border-light-gray-thin"));
  assert.ok(!classes.includes("border-light-black-border-1"));
  assert.ok(!classes.includes(DIVIDER), "phone keeps its border and gets no extra line");
});

test("still allowed: flag off keeps today's header", () => {
  assert.ok(!headerClasses({ showScrollDivider: true }, { flagOn: false }).includes(DIVIDER));
  assert.ok(headerClasses({}, { mobile: true, flagOn: false }).includes("border-light-black-border-1"));
});

test("still allowed: the onboarding header keeps its border with the flag on", () => {
  const classes = headerClasses({ dataAttribute: "onboarding" }, { mobile: true });
  assert.ok(classes.includes("border-light-black-border-1"));
  assert.ok(!classes.includes("border-border-light-gray-thin"));
});
