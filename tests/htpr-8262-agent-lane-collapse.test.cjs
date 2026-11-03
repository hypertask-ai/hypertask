const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const ts = require("typescript");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const flagKey = "htpr-8262-agent-lane-collapse";

const thought = {
  id: "activity-1",
  runId: "run-1",
  type: "thought",
  text: "Read the ticket and the two comments before touching the lane spacing.",
  createdAt: "2026-11-03T10:00:00.000Z",
  selectedOption: null,
};

function render({ flagEnabled, stacked = { 0: true, 1: true } }) {
  const source = fs.readFileSync(
    path.join(root, "src/components/PageComponents/TaskDetail/CommentAndDescription/AgentRunActivityRow.tsx"),
    "utf8",
  );
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const icon = () => React.createElement("i", null);
  const stubs = {
    react: React,
    "lucide-react": { Activity: icon, CircleAlert: icon, CircleHelp: icon, ExternalLink: icon, Lightbulb: icon },
    "react-hot-toast": { default: { error() {} } },
    "@tanstack/react-query": { useQueryClient: () => ({}) },
    "@/components/Common/RelativeTime": { default: () => React.createElement("time", null, "2h") },
    "@/hooks/useFlag": { useFlag: () => flagEnabled },
    "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => ({ stacked }) },
    "@/lib/agentRuns/model": {},
    "@/lib/agentRuns/taskActivityFeed": { safeAgentRunActivityLink: () => null },
    "@/lib/flags/definitions/htpr-8262-agent-lane-collapse": { HTPR_8262_AGENT_LANE_COLLAPSE_FLAG: flagKey },
    "@/lib/realtime/taskCommentsRefresh": { refreshTaskComments: async () => {} },
    "@/utils/undoActions/helperFuncs": { cn: (...parts) => parts.filter(Boolean).join(" ") },
  };
  for (const stub of Object.values(stubs)) {
    if (stub && typeof stub === "object" && !React.isValidElement(stub)) {
      if ("default" in stub) stub.__esModule = true;
    }
  }
  const exports = {};
  new Function("require", "module", "exports", js)(
    (name) => {
      if (name === "react/jsx-runtime") return require(name);
      assert.ok(name in stubs, `Unexpected dependency: ${name}`);
      return stubs[name];
    },
    { exports },
    exports,
  );
  const Row = exports.default;
  return renderToStaticMarkup(React.createElement(Row, { activity: thought, taskId: 15 }));
}

const isCollapsedRow = (html) => html.includes("text-ellipsis");

test("the lane row keeps today's inset and card with the flag off, even when every comment is folded", () => {
  const html = render({ flagEnabled: false, stacked: { 0: true, 1: true } });
  assert.equal(isCollapsedRow(html), false);
  assert.match(html, /role="group"/);
  assert.match(html, /px-3 py-1/);
  assert.match(html, /px-3 py-2/);
  assert.doesNotMatch(html, /px-4 py-5/);
});

test("folded comments fold the lane rows onto the one-line comment row", () => {
  const html = render({ flagEnabled: true, stacked: { 0: true, 1: true } });
  assert.equal(isCollapsedRow(html), true);
  assert.match(html, /my-\[4px\]/);
  assert.match(html, /whitespace-nowrap/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /Read the ticket and the two comments/);
});

test("one open comment keeps the lane row open, in step with the comments", () => {
  const html = render({ flagEnabled: true, stacked: { 0: true, 1: false } });
  assert.equal(isCollapsedRow(html), false);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /my-\[8px\]/);
  assert.match(html, /px-4 py-5/);
});

test("a thread with no comments leaves the lane row open", () => {
  const html = render({ flagEnabled: true, stacked: {} });
  assert.equal(isCollapsedRow(html), false);
  assert.match(html, /aria-expanded="true"/);
});

test("the folded row is keyboard operable and avoids the bright secondary focus ring", () => {
  const html = render({ flagEnabled: true, stacked: { 0: true } });
  assert.match(html, /tabindex="0"/);
  assert.match(html, /focus-visible:bg-hover-active/);
  assert.doesNotMatch(html, /focus-visible:ring-white-black/);
});

test("the flag is a reversible low-risk improvement for everyone", () => {
  const { default: flag } = loadModule("src/lib/flags/definitions/htpr-8262-agent-lane-collapse.ts");
  assert.equal(flag.key, flagKey);
  assert.equal(flag.kind, "improvement");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
  assert.ok(flag.releaseRisk.reason);
  assert.equal(flag.releaseRisk.highRisk, undefined);
});
