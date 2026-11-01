const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

const { load } = require("./task-route-loader.cjs");

function navigation(overrides = {}) {
  const effects = [];
  const fullscreen = [];
  const titles = [];
  const dictationCalls = [];
  const selectedAgent = {
    id: "agent", displayName: "QA agent", runtimeType: "EXTERNAL",
    revokedAt: null, archivedAt: null, boards: [],
  };
  const { useAgentChatNavigation } = load("src/app/agents/chat/useAgentChatNavigation.ts", {
    react: {
      useMemo: (fn) => fn(), useCallback: (fn) => fn,
      useRef: (value) => ({ current: value }), useEffect: (fn) => effects.push(fn),
    },
    "@/lib/agents/registerView": { listTeams: () => [] },
    "@/lib/lastBoardTeam": { setLastBoardTeam() {} },
    "@/lib/state": { useRecoilValue: () => null },
    "@/store": { agentChatTeamCycleAtom: "cycle" },
    "./AgentChatFeedItems": { agentDictationProjectId: (...args) => {
      dictationCalls.push(args);
      return 7049;
    } },
    "@/hooks/useFlag": { useFlag: () => false },
  });
  const value = useAgentChatNavigation({
    embedded: undefined, agents: [selectedAgent], selectedId: selectedAgent.id,
    isMbl: true, teamId: "qa-team",
    setAgentChatMobileFullscreen: (value) => fullscreen.push(value),
    setMobileTopBarTitle: (value) => titles.push(value), setTeamId() {},
    search: "", ...overrides,
  });
  return { value, fullscreen, titles, selectedAgent, dictationCalls,
    cleanup: effects.map((effect) => effect()).filter(Boolean) };
}

test("mobile fullscreen and composer no longer depend on a rollout switch", () => {
  const view = navigation();
  assert.equal(view.value.mobileFullscreenChrome, true);
  assert.equal(view.value.reuseAiComposer, true);
  assert.equal(view.value.dictationProjectId, 7049);
  assert.deepEqual(view.dictationCalls, [[view.selectedAgent, "qa-team"]]);
  assert.deepEqual(view.fullscreen, [true]);
  assert.deepEqual(view.titles, []);
  view.cleanup.forEach((cleanup) => cleanup());
  assert.deepEqual(view.fullscreen, [true, false]);
});

test("desktop and embedded chat keep their existing composer and shell behavior", () => {
  const desktop = navigation({ isMbl: false });
  assert.equal(desktop.value.mobileFullscreenChrome, false);
  assert.equal(desktop.value.reuseAiComposer, false);
  assert.equal(desktop.value.dictationProjectId, null);
  assert.deepEqual(desktop.dictationCalls, []);
  assert.deepEqual(desktop.fullscreen, [false]);
  const embedded = navigation({ embedded: { projectId: 42 }, isMbl: false });
  assert.equal(embedded.value.mobileFullscreenChrome, false);
  assert.equal(embedded.value.reuseAiComposer, true);
  assert.equal(embedded.value.dictationProjectId, 42);
  assert.deepEqual(embedded.fullscreen, []);
});

test("mobile roster keeps its normal shell when no agent is selected", () => {
  const view = navigation({ selectedId: null });
  assert.equal(view.value.selectedAgent, null);
  assert.equal(view.value.mobileFullscreenChrome, false);
  assert.equal(view.value.reuseAiComposer, true);
  assert.deepEqual(view.fullscreen, [false]);
  assert.deepEqual(view.titles, ["Agents"]);
  view.cleanup.forEach((cleanup) => cleanup());
  assert.deepEqual(view.fullscreen, [false, false]);
  assert.deepEqual(view.titles, ["Agents", null]);
});

test("first-screen chrome hides during fullscreen and returns afterwards", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const ts = require("typescript");
  let fullscreen = false;
  let snapshot = { scope: { route: "/project" } };
  const source = fs.readFileSync(path.join(root, "src/components/Global/FirstScreenMobileChrome.tsx"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const exports = {};
  const mocks = {
    "next/dynamic": { default: () => () => React.createElement("nav", null, "Mobile navigation") },
    "@/lib/firstScreen/SurfaceContext": { useFirstScreenSurface: () => snapshot },
    "@/lib/state": { useRecoilValue: (atom) => atom === "fullscreen" ? fullscreen : false },
    "@/store": { agentChatMobileFullscreenAtom: "fullscreen", mobileCommentComposerOpenAtom: "composer" },
    "@/hooks/useFlag": { useFlag: () => false },
    "@/lib/flags/keys": {},
  };
  new Function("require", "module", "exports", compiled)(
    (name) => mocks[name] ? { __esModule: true, ...mocks[name] } : require(name),
    { exports }, exports,
  );
  const render = () => renderToStaticMarkup(React.createElement(exports.default, { currentUser: { id: 985 } }));
  const normal = render();
  assert.equal(normal, "<nav>Mobile navigation</nav><nav>Mobile navigation</nav>");
  fullscreen = true;
  assert.equal(render(), "");
  fullscreen = false;
  assert.equal(render(), normal);
  snapshot = null;
  assert.equal(render(), "");
});
