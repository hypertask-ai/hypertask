const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { renderToStaticMarkup } = require("react-dom/server");
const { QueryClient } = require("@tanstack/react-query");
const { loader, React, root } = require("./helpers/htpr-7260-ui.cjs");
const { loadModule } = require("./helpers/loadModule.cjs");

const flagKey = "htpr-8971-card-settings";
const flag = loader()(`src/lib/flags/definitions/${flagKey}.ts`);
const parts = loader()("src/lib/kanban/cardParts.ts");
const { CommandMode } = require("jiti")(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } })(path.join(root, "src/models/enums.ts"));
const cn = loader({
  "@/lib/constants/APIRouteConstants": {},
  "@/lib/realtime/client": {},
  "../api/global": {},
})("src/utils/undoActions/helperFuncs.ts").cn;
const empty = () => null;
const partKeys = ["ticketNumber", "inboxIcon", "comments", "subTasks", "priority", "size", "dueDate", "tags", "staleness", "blockedEdge"];

test("the flag ships at Owner + QA as a feature with small risk", () => {
  const { key, kind, defaultMode, releaseRisk } = flag.default;
  assert.deepEqual([key, kind, defaultMode, releaseRisk.risk], [flagKey, "feature", "OWNER_AND_QA", "small"]);
});

test("no saved setting, or junk, means the empty card: every part off", () => {
  assert.deepEqual(parts.CARD_PARTS.map(({ key }) => key), partKeys);
  for (const raw of [undefined, null, "all", [], 3, {}]) {
    assert.ok(Object.values(parts.parseCardParts(raw)).every((shown) => shown === false), `raw ${JSON.stringify(raw)}`);
  }
  const saved = parts.parseCardParts({ priority: true, size: "yes", name: true });
  assert.deepEqual(Object.keys(saved), partKeys, "only known parts survive the parse");
  assert.equal(saved.priority, true);
  assert.equal(saved.size, false);
});

function renderCard({ enabled, saved }) {
  const seen = {};
  const capture = (name) => (props) => {
    seen[name] = props;
    return React.createElement("section", { "data-part": name }, props.staleClock ?? props.children);
  };
  const Card = loader({
    "@/hooks/useFlag": { useFlag: (key) => key === flagKey && enabled },
    "@/hooks/General/useCardParts": { useCardParts: () => parts.parseCardParts(saved) },
    "@/utils/undoActions/helperFuncs": { cn },
    "@/lib/flags/keys": {},
    "@/lib/firstScreen/SurfaceContext": { useFirstScreenSurface: () => null },
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": { getActiveStalenessFromProject: () => true },
    "./TaskDraggableContainer": { default: capture("container") },
    "./TaskTopRow": { default: capture("top") },
    "./TaskTagsRow": { default: capture("tags") },
    "./CardSubTasks": { default: capture("subTasks") },
    "./FlattenedParentTask": { default: empty },
  })("src/components/PageComponents/Kanban/KanbanTaskComponents/KanbanTaskCard.tsx").default;
  const task = {
    id: 1, projectId: 15, uniqueIndex: 1, title: "Name stays", ticketNumber: "HTPR-1",
    priority: { id: 1 }, estimate: { id: 2 }, dueDate: "2026-11-12", taskLabels: [{ id: 3, label: { value: "BUG" } }],
    subTasks: [{ id: 4 }], totalComments: 5, notifications: [{ seen: false }], _count: { notifications: 1 },
    blockingTasks: [{ id: 6 }], customFieldValues: [{ fieldId: "f", value: "3" }],
  };
  const blocker = { id: 9, displayName: "Valentin" };
  const html = renderToStaticMarkup(React.createElement(Card, {
    task, project: {}, currentSetting: "Card", assignedUsers: [{ id: 7 }], agentAssignees: [], blockingUser: blocker,
    active: false, hover: false, hasDraft: false,
  }));
  return { html, seen, task, blocker };
}

test("flag on with no saved setting: the card keeps name and people and drops every part", () => {
  const { html, seen, blocker } = renderCard({ enabled: true });
  assert.ok(html.includes("Name stays"));
  assert.deepEqual(seen.top.assignees, [{ id: 7 }]);
  assert.equal(seen.top.ticketNumber, "");
  assert.equal(seen.top.countNotifications, 0);
  assert.deepEqual(seen.top.notifications, []);
  assert.equal(seen.top._count, undefined);
  assert.equal(seen.top.countSubtasks, 0);
  assert.equal(seen.subTasks.subTasks, undefined);
  assert.equal(seen.tags.priority, undefined);
  assert.equal(seen.tags.estimate, undefined);
  assert.equal(seen.tags.dueDate, undefined);
  assert.deepEqual(seen.tags.taskLabels, []);
  assert.deepEqual(seen.tags.task.blockingTasks, []);
  assert.deepEqual(seen.tags.task.customFieldValues, []);
  assert.notEqual(seen.tags.blockingUser, blocker);
  assert.equal(seen.container.blocked, false);
  assert.ok(!html.includes("in column"), "no staleness line");
});

test("flag on: switching a part on shows only that part", () => {
  const { seen, task } = renderCard({ enabled: true, saved: { priority: true, ticketNumber: true, blockedEdge: true } });
  assert.equal(seen.tags.priority, task.priority);
  assert.equal(seen.top.ticketNumber, "HTPR-1");
  assert.equal(seen.container.blocked, true);
  assert.deepEqual(seen.tags.task.blockingTasks, task.blockingTasks);
  assert.equal(seen.tags.estimate, undefined);
  assert.deepEqual(seen.tags.taskLabels, []);
});

test("flag off: the card is exactly today's full card whatever is saved", () => {
  const { seen, task, blocker } = renderCard({ enabled: false, saved: {} });
  assert.equal(seen.top.ticketNumber, "HTPR-1");
  assert.equal(seen.top.countNotifications, 1);
  assert.equal(seen.top.notifications, task.notifications);
  assert.equal(seen.top._count, 5);
  assert.equal(seen.top.countSubtasks, 1);
  assert.equal(seen.subTasks.subTasks, task.subTasks);
  assert.equal(seen.tags.task, task, "same task object, nothing cloned");
  assert.equal(seen.tags.priority, task.priority);
  assert.equal(seen.tags.estimate, task.estimate);
  assert.equal(seen.tags.dueDate, task.dueDate);
  assert.equal(seen.tags.taskLabels, task.taskLabels);
  assert.equal(seen.tags.blockingUser, blocker);
  assert.equal(seen.container.blocked, true);
});

const jiti = require("jiti")(path.join(root, "tests/board-menu-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const commands = () => ({
  ...jiti(path.join(root, "src/components/Modals/commands/HTC/AllCommands.ts")),
  ...jiti(path.join(root, "src/components/Modals/commands/HTC/cardSettingsCommand.ts")),
});
const names = (group) => group.commandLists.map((command) => command.name);

test("Ctrl+K on the board: Card settings sits right under Board settings with no typing", () => {
  const { getAllCommands, getBoardMenuCommands, withCardSettingsCommand } = commands();
  const groups = getAllCommands({ context: "Kanban" });
  assert.equal(withCardSettingsCommand(groups, null), groups, "flag off leaves the palette untouched");
  const kanban = withCardSettingsCommand(groups, "Kanban");
  const board = kanban.find((group) => group.group === "Board");
  assert.deepEqual(names(board).slice(0, 2), ["Board settings", "Card settings"]);
  assert.equal(kanban.flatMap((group) => group.commandLists).filter((command) => command.key === "boardSettings").length, 1);
  const menu = getBoardMenuCommands(kanban)[0];
  assert.deepEqual(names(menu).slice(0, 2), ["Board settings", "Card settings"]);
  const card = board.commandLists[1];
  assert.deepEqual([card.commandMode, card.payload], [CommandMode.Setting, "card-settings"]);
  assert.deepEqual(names(getBoardMenuCommands(groups)[0]).slice(0, 2), ["Board settings", "Sort board"], "flag off board menu unchanged");
  const elsewhere = withCardSettingsCommand(getAllCommands({ context: "Others" }), "Others").flatMap(names);
  assert.equal(elsewhere[elsewhere.indexOf("Board settings") + 1], "Card settings");
});

test("a frequently used Board settings does not move or duplicate Card settings", () => {
  const { getAllCommands, withCardSettingsCommand } = commands();
  const groups = getAllCommands({ context: "Kanban" });
  const boardSettings = groups.flatMap((group) => group.commandLists).find((command) => command.key === "boardSettings");
  const frequent = { group: "Frequently used", commandLists: [{ ...boardSettings, frequency: 4 }] };
  const kanban = withCardSettingsCommand([frequent, ...groups], "Kanban");
  assert.deepEqual(names(kanban[0]), ["Board settings"], "shortcut group untouched");
  assert.deepEqual(names(kanban.find((group) => group.group === "Board")).slice(0, 2), ["Board settings", "Card settings"]);
  assert.ok(!names(kanban.find((group) => group.group === "Help")).includes("Board settings"));
  const others = withCardSettingsCommand([frequent, ...getAllCommands({ context: "Others" })], "Others");
  assert.deepEqual(names(others[0]), ["Board settings"]);
  assert.equal(others.flatMap(names).filter((name) => name === "Card settings").length, 1);
});

test("Card settings is a Profile section made only of switches, one per part", () => {
  const nav = loader({
    "next/navigation": {}, nookies: {}, "@/lib/state": {}, "@/store": {}, "@/lib/demo/isGuestClient": {},
    "@tanstack/react-query": {}, "react-hot-toast": {}, "@/lib/searchArchive": {},
    "@/utils/api/global/apiHelpers/getAllProjectsMinimal": {},
  })("src/components/Modals/Settings/settingsNavigation.ts");
  assert.equal(nav.getSettingsTabForSection("card-settings").id, "profile");
  const section = (enabled) => {
    const Section = loader({
      "@/hooks/useFlag": { useFlag: (key) => key === flagKey && enabled },
      "@/hooks/General/useCardParts": { useCardParts: () => parts.parseCardParts({ tags: true }), useSetCardPart: () => () => {} },
      "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
      "@/utils/undoActions/helperFuncs": { cn },
    })("src/components/Modals/Settings/CardSettingsSection.tsx").default;
    return renderToStaticMarkup(React.createElement(Section));
  };
  const html = section(true);
  assert.ok(html.includes("Only affects you. Every board."));
  const switches = [...html.matchAll(/<button[^>]*role="switch"[^>]*>/g)].map(([tag]) => tag);
  assert.equal(switches.length, 12);
  assert.ok(switches.slice(0, 2).every((tag) => / disabled=""/.test(tag)), "name and people are always shown");
  const states = [...html.matchAll(/aria-checked="(true|false)"[^>]*aria-label="([^"]+)"/g)].map(([, on, label]) => [label, on]);
  assert.deepEqual(states.slice(2).filter(([, on]) => on === "true"), [["Tags", "true"]]);
  assert.equal(section(false), "");
});

function preferencesApi(cardSettings = true) {
  const saved = {};
  const writes = [];
  const cache = new Map();
  const prisma = { userSetting: {
    findUnique: async ({ select }) => {
      assert.equal(select.cardParts, true);
      return { ...saved };
    },
    update: async (args) => {
      writes.push(args);
      assert.equal(args.select.cardParts, true);
      Object.assign(saved, args.data);
      return { ...saved };
    },
    updateMany: async () => ({ count: 0 }),
  } };
  const redis = { getRedis: async () => ({ get: async (key) => cache.get(key) ?? null, setex: async (key, _ttl, value) => { cache.set(key, value); } }) };
  const controller = loadModule("src/utils/controllers/users/fetch_preferences.ts", {
    "@/lib/ai/htpr7038ModelReset": { ensureHtpr7038ModelReset: async () => "disabled" },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/redis": redis,
  });
  const route = loadModule("src/app/api/users/preferences/route.ts", {
    "@/lib/flags/definitions/htpr-7650-ai-chat-open-switches": {},
    "@/lib/aiChat/autoOpenPreferences": { AI_CHAT_AUTO_OPEN_KEYS: [] },
    "@/lib/ai/htpr7038ModelReset": { ensureHtpr7038ModelReset: async () => "disabled" },
    "@/lib/mcp/readJsonBody": { readJsonBody: async (request) => ({ ok: true, body: await request.json() }) },
    "@/lib/auth/currentUser": { loadCurrentUser: async () => null },
    "@/lib/flags": { isFeatureEnabled: async (key) => cardSettings && key === "htpr-8971-card-settings" },
    "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    "next/headers": { cookies: async () => ({ get: () => ({ value: '{"id":7}' }) }) },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@prisma/client": {},
    "@/utils/controllers/users/fetch_preferences": controller,
    "@/lib/aiModelPreferences": {},
    "@/lib/aiModelOptions": {},
    "@/utils/helperFunctions/sanitizeRichHtml": {},
    "@/lib/dictationProvider": {},
    "@/lib/configs/boardSortMode.config": {},
    "@/lib/flags/definitions/htpr-7649-sidebar-view-saved": {},
    "@/lib/flags/definitions/htpr-8971-card-settings": { HTPR_8971_CARD_SETTINGS_FLAG: "htpr-8971-card-settings" },
    "@/lib/configs/allTasks.config": {},
    "@/models/Calendar/model": {},
  });
  return { writes, post: (body) => route.POST({ json: async () => body }), get: () => route.GET({}) };
}

test("a switched part persists: POST saves it and a fresh read brings it back", async () => {
  const api = preferencesApi();
  const before = await api.get();
  assert.ok(Object.values(parts.parseCardParts(before.body.settings.cardParts)).every((shown) => !shown));
  const next = { ...parts.EMPTY_CARD_PARTS, comments: true };
  const saved = await api.post({ cardParts: next });
  assert.equal(saved.status, 200);
  assert.deepEqual(api.writes[0].data, { cardParts: next });
  const after = await api.get();
  assert.equal(parts.parseCardParts(after.body.settings.cardParts).comments, true);
  for (const bad of ["all", [], { comments: "yes" }, null]) {
    assert.equal((await api.post({ cardParts: bad })).status, 400);
  }
  assert.equal(api.writes.length, 1);
});

test("flag off: POST ignores card parts and saves nothing", async () => {
  const api = preferencesApi(false);
  const saved = await api.post({ cardParts: { ...parts.EMPTY_CARD_PARTS, comments: true } });
  assert.equal(saved.status, 200);
  assert.ok(api.writes.every((write) => write.data.cardParts === undefined));
});

test("toggling a switch updates the board at once and posts the whole card setting", async () => {
  const client = new QueryClient();
  client.setQueryData(["user-preferences"], { playGifs: true });
  const posts = [];
  const { useSetCardPart } = loader({
    "@tanstack/react-query": { useQueryClient: () => client },
    axios: { __esModule: true, default: { post: async (url, body) => { posts.push([url, body]); } } },
    "@/hooks/General/useGetUserPreferences": { USER_PREFERENCES_QUERY_KEY: ["user-preferences"], useGetUserPreferences: () => ({}) },
  })("src/hooks/General/useCardParts.ts");
  const pending = useSetCardPart()("dueDate", true);
  assert.equal(client.getQueryData(["user-preferences"]).cardParts.dueDate, true, "optimistic before the save returns");
  await pending;
  assert.deepEqual(posts, [["/api/users/preferences", { cardParts: { ...parts.EMPTY_CARD_PARTS, dueDate: true } }]]);
});
