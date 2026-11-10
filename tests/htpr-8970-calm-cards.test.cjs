const assert = require("node:assert/strict");
const test = require("node:test");
const { renderToStaticMarkup } = require("react-dom/server");
const { loader, React } = require("./helpers/htpr-7260-ui.cjs");

const flagKey = "htpr-8970-calm-cards";
const flag = loader()(`src/lib/flags/definitions/${flagKey}.ts`);
const { cardLabels } = loader()("src/lib/kanban/cardLabels.ts");
const cn = loader({
  "@/lib/constants/APIRouteConstants": {},
  "@/lib/realtime/client": {},
  "../api/global": {},
})("src/utils/undoActions/helperFuncs.ts").cn;
const NOW = Date.parse("2026-11-10T12:00:00.000Z");
const daysAgo = (days) => new Date(NOW - days * 86_400_000).toISOString();
const empty = () => null;

function load(file, enabled, mocks = {}) {
  return loader({
    "@/hooks/useFlag": { useFlag: (key) => key === flagKey && enabled },
    "@/utils/undoActions/helperFuncs": { cn },
    ...mocks,
  })(`src/components/PageComponents/Kanban/KanbanTaskComponents/${file}`).default;
}

test("the flag ships at Owner + QA as an improvement with small risk", () => {
  const { key, kind, defaultMode, releaseRisk } = flag.default;
  assert.deepEqual([key, kind, defaultMode, releaseRisk.risk], [flagKey, "improvement", "OWNER_AND_QA", "small"]);
});

test("cards hide routing tags, put the type tag first and show at most two", () => {
  const values = ["brain-medium", "🗺️ MOBILE", "IMPROVEMENT ⚒️", "design-pass", "DESIGN 🎨", "AI CHAT 💬"];
  const { shown, more } = cardLabels(values, (value) => value);
  assert.deepEqual(shown, ["IMPROVEMENT ⚒️", "🗺️ MOBILE"]);
  assert.equal(more, 2, "only hidden human tags count toward +N");
  assert.deepEqual(cardLabels(["brain-hard", "design-pass"], (value) => value), { shown: [], more: 0 });
  assert.deepEqual(cardLabels(["bugfix-notes", "BUG 🐛"], (value) => value).shown, ["BUG 🐛", "bugfix-notes"]);
});

function topRow(enabled, props) {
  const TaskTopRow = load("TaskTopRow.tsx", enabled, {
    "@/lib/state": { useRecoilState: () => [null, empty] },
    "@/store": {},
    "next/dynamic": { default: () => empty },
    "../../TaskDetail/TaskOptions/HTCButton": { default: empty },
    "@/components/Common/UserAvatar": { default: ({ title, className }) => React.createElement("img", { "data-face": title, className }) },
  });
  return renderToStaticMarkup(React.createElement(TaskTopRow, {
    task: { sectionId: 2, agentStatus: { agentName: "HT Design Builder", at: new Date().toISOString() } },
    project: { sections: [{ id: 2, section_title: "In Progress" }] },
    ticketNumber: "HTPR-8056", countSubtasks: 0, subTaskSetting: "None", hover: false,
    assignees: [{ id: 1, displayName: "Valentin" }],
    agentAssignees: [{ id: "a", displayName: "HT Design Builder" }, { id: "b", displayName: "HT Design Lead" }],
    countNotifications: 1, notifications: [{ seen: false }],
    ...props,
  }));
}

test("flag on: one inbox icon, blue when unread and grey when read, and a stack with the working dot last", () => {
  const unread = topRow(true, {});
  assert.ok(!unread.includes("In inbox"));
  assert.match(unread, /title="New in your inbox"[^>]*color-rich-text-link/);
  assert.equal((unread.match(/w-new-notification/g) ?? []).length, 0, "the blue dot merges into the inbox icon");
  const read = topRow(true, { notifications: [{ seen: true }] });
  assert.match(read, /title="Also in your inbox"[^>]*text-text-light-gray/);
  const faces = [...unread.matchAll(/data-face="([^"]*)"/g)].map((match) => match[1]);
  assert.deepEqual(faces.slice(0, 2), ["Valentin", "HT Design Lead"]);
  assert.match(faces[2], /^HT Design Builder: working, /);
  assert.match(unread, /data-step="working"[^>]*color-pull-request-green/);
  const review = topRow(true, { project: { sections: [{ id: 2, section_title: "AI Review" }] } });
  assert.match(review, /data-step="in review"[^>]*color-card-age-warn/);
});

test("flag off: the top row keeps the In inbox pill, the blue dot and the old stack", () => {
  const html = topRow(false, {});
  for (const kept of ["In inbox", "w-new-notification", "ml-[-14px]"]) assert.ok(html.includes(kept), kept);
  assert.ok(!html.includes("card-inbox-flag"));
});

function card(enabled, task) {
  const Card = load("KanbanTaskCard.tsx", enabled, {
    "@/lib/firstScreen/SurfaceContext": { useFirstScreenSurface: () => ({ now: new Date(NOW).toISOString() }) },
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": { getActiveStalenessFromProject: () => true },
    "@/lib/flags/keys": {},
    "@/hooks/General/useCardParts": { useCardParts: () => ({}) },
    "./TaskDraggableContainer": { default: ({ children }) => React.createElement("div", null, children) },
    "./TaskTopRow": { default: ({ staleClock }) => React.createElement("header", null, staleClock) },
    "./TaskTagsRow": { default: empty },
    "./CardSubTasks": { default: empty },
    "./FlattenedParentTask": { default: empty },
  });
  return renderToStaticMarkup(React.createElement(Card, {
    task: { id: 1, projectId: 15, title: "Card", createdAt: daysAgo(30), ...task },
    project: { staleWarnDays: 7, staleHotDays: 20 }, currentSetting: "None",
    assignedUsers: [], agentAssignees: [], active: false, hover: false, hasDraft: false,
  }));
}

test("flag on: stale cards show a clock and the worst day count, fresh cards show nothing", () => {
  const warn = card(true, { sectionChangedAt: daysAgo(9), lastCommentAt: daysAgo(3) });
  assert.match(warn, /data-level="warn"[^>]*title="On board 30d\nIn this column 9d\nLast comment 3d ago"[^>]*color-card-age-warn/);
  assert.match(warn, /<\/svg>9d<\/span>/);
  assert.ok(!warn.includes("in column"), "the bottom age line is gone");
  const hot = card(true, { sectionChangedAt: daysAgo(2), lastCommentAt: daysAgo(25) });
  assert.match(hot, /data-level="hot"[^>]*color-card-age-hot[\s\S]*25d<\/span>/);
  assert.ok(!card(true, { sectionChangedAt: daysAgo(1), lastCommentAt: daysAgo(1) }).includes("card-stale-clock"));
  const off = card(false, { sectionChangedAt: daysAgo(9), lastCommentAt: daysAgo(3) });
  assert.ok(off.includes("9d in column") && !off.includes("card-stale-clock"), "flag off keeps the age line");
});
