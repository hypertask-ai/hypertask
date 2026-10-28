const { readAgentChatSource } = require("./helpers/agent-chat-source.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

const chat = readAgentChatSource();
const sendButton = fs.readFileSync(
  path.join(root, "src/components/AI_CHAT/SendMessageButton.tsx"),
  "utf8",
);
const actionRow = fs.readFileSync(
  path.join(root, "src/components/AI_CHAT/AiChatComposerActionRow.tsx"),
  "utf8",
);
const tipTap = fs.readFileSync(
  path.join(root, "src/components/AI_CHAT/AI_Tiptap_Container.tsx"),
  "utf8",
);
const controlledEditor = fs.readFileSync(
  path.join(root, "src/lib/controlledComposerEditor.tsx"),
  "utf8",
);
const viewport = fs.readFileSync(
  path.join(root, "src/lib/mobileCommentViewport.ts"),
  "utf8",
);

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
    isMbl: true, mobileLayoutEnabled: false, teamId: "qa-team",
    setAgentChatMobileFullscreen: (value) => fullscreen.push(value),
    setMobileTopBarTitle: (value) => titles.push(value), setTeamId() {},
    search: "", liveSortEnabled: false, ...overrides,
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
  const view = navigation({ selectedId: null, mobileLayoutEnabled: true });
  assert.equal(view.value.selectedAgent, null);
  assert.equal(view.value.mobileFullscreenChrome, false);
  assert.equal(view.value.reuseAiComposer, true);
  assert.deepEqual(view.fullscreen, [false]);
  assert.deepEqual(view.titles, ["Agents"]);
  view.cleanup.forEach((cleanup) => cleanup());
  assert.deepEqual(view.fullscreen, [false, false]);
  assert.deepEqual(view.titles, ["Agents", null]);
});

test("mobile fullscreen renders the AI chat composer component itself", () => {
  assert.match(sendButton, /export function SendMessageButton/);
  assert.match(tipTap, /from "\.\/SendMessageButton"/);
  assert.match(
    chat,
    /import \{ AI_Tiptap_Container \} from "@\/components\/AI_CHAT\/AI_Tiptap_Container"/,
  );

  const flaggedStart = chat.indexOf("reuseAiComposer ? (");
  const flaggedEnd = chat.indexOf(") : (", flaggedStart);
  assert.ok(flaggedStart > 0 && flaggedEnd > flaggedStart);
  const flaggedComposer = chat.slice(flaggedStart, flaggedEnd);
  assert.match(flaggedComposer, /<AI_Tiptap_Container/);
  assert.doesNotMatch(flaggedComposer, /<textarea/);
  assert.doesNotMatch(flaggedComposer, /<AiChatComposerActionRow/);
  assert.doesNotMatch(flaggedComposer, /<AudioButton/);
  assert.doesNotMatch(flaggedComposer, /<SendMessageButton/);
  assert.match(tipTap, /<ControlledComposerEditor/);
  assert.match(tipTap, /from "@\/lib\/controlledComposerEditor"/);
  assert.match(controlledEditor, /<EditorContent editor=\{editor\}/);
  assert.match(tipTap, /useTiptapEditor/);
  assert.match(chat, /useTiptapEditor: true/);
});

test("action row skips empty mobile overflow menus", () => {
  assert.match(actionRow, /hasMobileOverflow/);
  assert.match(actionRow, /attachmentControl \|\| contextControl \|\| screenshotControl/);
});

test("hideDock drops tab-bar pad; keyboard still clears inset", () => {
  assert.match(
    viewport,
    /if \(hideDock\) return 0;/,
  );
  assert.match(chat, /pb-\[env\(safe-area-inset-bottom\)\]/);
  assert.match(chat, /hideDock:\s*hideDockInset/);
});

test("6476 fullscreen chrome applies only while an agent is open", () => {
  assert.match(chat, /mobileFullscreenChrome/);
  assert.match(chat, /const mobileChromeAwareHeight = isMbl;/);
  assert.match(
    chat,
    /\(mobileLayoutEnabled \|\| mobileFullscreenChrome\) &&\s*\n\s*"mobile-agent-chat/,
  );
});

test("slim header keeps back + name only when fullscreen", () => {
  assert.match(chat, /!mobileFullscreenChrome && \(/);
  assert.match(chat, /isNarrow && !mobileFullscreenChrome/);
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
