const test = require("node:test");
const assert = require("node:assert/strict");
const { renderToStaticMarkup } = require("react-dom/server");
const { loadModule } = require("./helpers/loadModule.cjs");

const NOW = Date.parse("2026-10-29T12:00:00Z");
const agent = {
  id: "agent", displayName: "Ada", runtimeType: "EXTERNAL", revokedAt: null,
  heartbeatAt: new Date(NOW - 5 * 60_000).toISOString(), lastPostedAt: null,
  working: null, outOfTokens: false, unreadCount: 3,
};

const { RosterRow } = loadModule("src/app/agents/chat/AgentChatFeedItems.tsx", {
  "@/components/Agents/AgentAvatar": { default: () => null },
  "@/hooks/useFlag": { useFlag: () => false },
  "@/lib/agents/chatTicketProposal": {},
  "@/lib/agents/messageLinks": {},
  "@/utils/generateTime": {},
  "@/utils/helperFunctions/markdownToHtml": {},
  "@/utils/helperFunctions/messageHtmlLinks": {},
  "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
  "next/navigation": {},
});

for (const [name, changes, text, color] of [
  ["active", { working: { ticket: "HTPR-8158", expiresAt: new Date(NOW + 60_000).toISOString() } }, "External · HTPR-8158", "bg-green-500"],
  ["out of tokens", { outOfTokens: true }, "External · Out of tokens", "bg-amber-500"],
  ["idle", {}, "External · Idle 5 min", "bg-gray-400"],
  ["inactive", { heartbeatAt: null }, "External · Inactive", "bg-gray-500 opacity-50"],
  ["expired work", { working: { ticket: "HTPR-8158", expiresAt: new Date(NOW - 1).toISOString() } }, "External · Idle 5 min", "bg-gray-400"],
  ["native", { runtimeType: "NATIVE" }, "Native · Idle 5 min", "bg-gray-400"],
]) {
  test(`roster renders permanent ${name} status without a flag`, () => {
    const row = RosterRow({ agent: { ...agent, ...changes }, selected: false, onSelect() {}, now: NOW });
    const html = renderToStaticMarkup(row);
    assert.ok(html.includes(text), html);
    assert.ok(html.includes(color), html);
    assert.match(html, /aria-pressed="false"/);
    assert.match(html, /aria-label="3 unread"/);
  });
}

test("selection calls back with the original agent and hides the unread badge", () => {
  let selected;
  const row = RosterRow({ agent, selected: true, onSelect: (value) => { selected = value; }, now: NOW });
  row.props.onClick();
  assert.equal(selected, agent);
  const html = renderToStaticMarkup(row);
  assert.match(html, /aria-pressed="true"/);
  assert.doesNotMatch(html, /unread/);
});

test("roster clock updates every thirty seconds and clears on unmount without a status flag", (t) => {
  const effects = [];
  const updates = [];
  let tick;
  const cleared = [];
  t.mock.method(Date, "now", () => NOW);
  t.mock.method(global, "setInterval", (callback, delay) => {
    assert.equal(delay, 30_000);
    tick = callback;
    return 123;
  });
  t.mock.method(global, "clearInterval", (id) => cleared.push(id));
  const { useAgentChatState } = loadModule("src/app/agents/chat/useAgentChatState.ts", {
    react: {
      useState: (value) => [typeof value === "function" ? value() : value, (next) => updates.push(next)],
      useEffect: (effect) => effects.push(effect), useContext: () => false, useRef: (value) => ({ current: value }),
    },
    "@/hooks/General/useMobileVisualViewport": { useMobileVisualViewport: () => null },
    "@/hooks/useFlag": { useFlag: () => false },
    "@/lib/contexts/mobileContext": {},
    "@/lib/flags/keys": {},
    "@/lib/state": { useRecoilValue: () => false, useSetRecoilState: () => () => {} },
    "@/store": {},
    "next/navigation": { useRouter: () => ({}), useSearchParams: () => ({}) },
  });
  const state = useAgentChatState({ currentUser: { id: 2343 }, roomsEnabled: false, embedded: false });
  assert.equal(state.rosterNow, NOW);
  const cleanups = effects.map((effect) => effect());
  assert.equal(typeof tick, "function");
  t.mock.method(Date, "now", () => NOW + 30_000);
  tick();
  assert.deepEqual(updates, [NOW + 30_000]);
  cleanups.forEach((cleanup) => cleanup?.());
  assert.deepEqual(cleared, [123]);
});
