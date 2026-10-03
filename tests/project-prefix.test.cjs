const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
function load(file, stubs = {}) {
  const filename = path.join(root, file);
  const javascript = ts.transpileModule(read(file), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const mod = new Module(filename);
  mod.filename = filename;
  mod.require = request => {
    if (Object.hasOwn(stubs, request)) return stubs[request];
    if (["@prisma/client", "react", "react/jsx-runtime"].includes(request)) return require(request);
    throw new Error(`Unexpected import ${request} in ${file}`);
  };
  mod._compile(javascript, filename);
  return mod.exports;
}
const jiti = require("jiti")(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });
const { getSequentialLetters } = jiti(path.join(root, "src/utils/helperFunctions/helperFunctions.ts"));
const prefix = load("src/lib/projectPrefix.ts", {
  "@/utils/helperFunctions/helperFunctions": { getSequentialLetters },
});
const flagKey = "htpr-6868-ticket-prefix";
function matches(row, where) {
  if (!row) return false;
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some(part => matches(row, part));
    if (key === "AND") return (Array.isArray(value) ? value : [value]).every(part => matches(row, part));
    if (value && typeof value === "object") {
      if (Object.hasOwn(value, "not")) return row[key] !== value.not;
      if (Object.hasOwn(value, "equals")) return value.mode === "insensitive" ? row[key]?.toUpperCase() === value.equals.toUpperCase() : row[key] === value.equals;
      if (value.in) return value.in.includes(row[key]);
      if (value.some) return (row[key] ?? []).some(part => matches(part, value.some));
      return matches(row[key], value);
    }
    return row[key] === value;
  });
}
const access = { taskWriteAccessWhere: userId => ({ OR: [{ ownerId: userId }, { members: { some: { userId, agentId: null } } }] }) };
function writes({ enabled = true, ownerId = 6, boards = [], failSql = false, loseAccess = false } = {}) {
  const board = { id: 15, teamId: "team-1", title: "Board", uniqueIdentifier: "OLD", ownerId, members: [], status: "Normal", tasks: [] };
  const rows = [board, ...boards];
  const aliases = [];
  const sql = [];
  const events = [];
  let transactions = 0;
  const prisma = {
    project: {
      findFirst: async ({ where }) => rows.find(row => matches(row, where)) ?? null,
      findUnique: async () => board,
      update: async ({ where, data }) => {
        assert.ok(matches(board, where));
        events.push("project");
        Object.assign(board, Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)));
        return board;
      },
    },
    projectPrefixAlias: {
      upsert: async args => {
        events.push("alias");
        assert.deepEqual(args.where.projectId_prefix, { projectId: 15, prefix: board.uniqueIdentifier.toUpperCase() });
        if (!aliases.some(a => a.prefix === args.create.prefix)) aliases.push(args.create);
      },
    },
    $executeRaw: async (strings, ...values) => {
      const text = strings.join("?");
      sql.push({ text, values });
      if (text.startsWith("UPDATE")) {
        events.push("sql");
        if (failSql) throw new Error("SQL failed");
        board.tasks.forEach(task => { task.ticketNumber = `${values[0]}-${task.uniqueIndex}`; });
      }
    },
    $transaction: async callback => {
      transactions++;
      const before = structuredClone(board);
      const aliasCount = aliases.length;
      if (loseAccess) board.ownerId = 9;
      try { return await callback(prisma); } catch (error) {
        Object.assign(board, before);
        aliases.length = aliasCount;
        throw error;
      }
    },
  };
  const controller = load("src/utils/controllers/projects/update.ts", {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/projectPrefix": prefix,
    "@/lib/flags": { HTPR_6868_TICKET_PREFIX_FLAG: flagKey, isFeatureEnabled: async (key, id) => { assert.equal(key, flagKey); assert.equal(id, 6); return enabled; } },
    "./getAllIncludes": access,
  });
  return { board, aliases, sql, events, prisma, controller, transactions: () => transactions, update: value => controller.default(15, "Board", undefined, value, { id: 6 }) };
}

for (const input of ["", "A", "ABCDEF", "1AB", "A-B", "A B", "ÉB", "AB_", 42, {}, null]) {
  test(`validation rejects ${JSON.stringify(input)}`, () => assert.throws(() => prefix.normalizeProjectPrefix(input), /2 to 5/));
}
test("validation uppercases and trims valid prefixes", () => {
  for (const [input, expected] of [[" ab ", "AB"], ["a1234", "A1234"], ["a9", "A9"]]) assert.equal(prefix.normalizeProjectPrefix(input), expected);
});
test("suggestion uses the automatic generation algorithm and always validates", () => {
  for (const title of ["Release Plan", "Project Roadmap", "qa-2026-08-30-exploratory"]) assert.equal(prefix.suggestProjectPrefix(title), getSequentialLetters(title));
  for (const title of ["", "A", "1234", "---", "12", "Release Plan"]) assert.equal(prefix.normalizeProjectPrefix(prefix.suggestProjectPrefix(title)), prefix.suggestProjectPrefix(title));
});
test("unique prefix rejects another non-deleted board in the team", async () => {
  const f = writes({ boards: [{ id: 16, teamId: "team-1", uniqueIdentifier: "NEW", status: "Archived" }] });
  assert.equal((await f.update("NEW")).status, 400);
  assert.equal(f.board.uniqueIdentifier, "OLD");
  assert.deepEqual(f.aliases, []);
});
test("unique prefix rejects legacy lowercase and mixed-case board prefixes", async () => {
  for (const uniqueIdentifier of ["new", "NeW"]) {
    const f = writes({ boards: [{ id: 16, teamId: "team-1", uniqueIdentifier, status: "Normal" }] });
    assert.equal((await f.update("NEW")).status, 400);
    assert.equal(f.board.uniqueIdentifier, "OLD");
    assert.deepEqual(f.aliases, []);
  }
});
test("unique prefix permits deleted boards, other teams and the same board", async () => {
  const f = writes({ boards: [{ id: 16, teamId: "team-1", uniqueIdentifier: "NEW", status: "Deleted" }, { id: 17, teamId: "team-2", uniqueIdentifier: "NEW", status: "Normal" }] });
  assert.equal((await f.update("NEW")).status, 200);
  assert.equal((await f.update("NEW")).status, 200);
  assert.equal(f.aliases.length, 1);
});
test("permission rejection and changed access write nothing", async () => {
  for (const options of [{ ownerId: 9 }, { loseAccess: true }]) {
    const f = writes(options);
    assert.equal((await f.update("NEW")).status, 403);
    assert.deepEqual(f.aliases, []);
    assert.ok(!f.events.includes("project"));
  }
});
test("flag off rejects prefix changes but still permits an ordinary rename", async () => {
  const f = writes({ enabled: false });
  assert.equal((await f.update("NEW")).status, 403);
  assert.equal(f.transactions(), 0);
  assert.equal((await f.update(undefined)).status, 200);
  assert.equal((await f.update("OLD")).status, 200);
  assert.equal(f.board.uniqueIdentifier, "OLD");
});
test("transaction writes an alias then the project then one SQL ticket rewrite", async () => {
  const f = writes();
  f.board.tasks = [{ uniqueIndex: 1, ticketNumber: "OLD-1" }, { uniqueIndex: 99, ticketNumber: "OLD-99", status: "Deleted" }];
  const result = await f.update(" new ");
  assert.equal(result.status, 200);
  assert.equal(f.transactions(), 1);
  assert.deepEqual(f.events, ["alias", "project", "sql"]);
  assert.deepEqual(f.aliases, [{ projectId: 15, prefix: "OLD" }]);
  assert.deepEqual(f.board.tasks.map(t => t.ticketNumber), ["NEW-1", "NEW-99"]);
  const updates = f.sql.filter(s => s.text.startsWith("UPDATE"));
  assert.equal(updates.length, 1);
  assert.match(updates[0].text, /"ticketNumber" = \? \|\| '-' \|\| "uniqueIndex" WHERE "projectId" = \?/);
  assert.deepEqual(updates[0].values, ["NEW", 15]);
  assert.match(f.sql[0].text, /9428471/);
  assert.match(f.sql[1].text, /hashtext/);
});
test("transaction rolls back the alias and project on SQL failure", async () => {
  const f = writes({ failSql: true });
  assert.equal((await f.update("NEW")).status, 400);
  assert.equal(f.board.uniqueIdentifier, "OLD");
  assert.deepEqual(f.aliases, []);
});
test("transaction retains every historical prefix through repeated changes", async () => {
  const f = writes();
  for (const value of ["NEW", "ABC", "OLD", "NEW"]) assert.equal((await f.update(value)).status, 200);
  assert.deepEqual(f.aliases.map(a => a.prefix), ["OLD", "NEW", "ABC"]);
});
test("migration provides cascade, per-board uniqueness and indexed historical prefixes", () => {
  const sql = read("src/prisma/migrations/20261003150000_add_project_prefix_aliases/migration.sql");
  assert.match(sql, /CREATE TABLE "ProjectPrefixAlias"/);
  assert.match(sql, /CREATE UNIQUE INDEX.*\("projectId", "prefix"\)/);
  assert.match(sql, /CREATE INDEX.*\("prefix"\)/);
  assert.match(sql, /REFERENCES "Project"\("id"\) ON DELETE CASCADE/);
  assert.match(read("src/prisma/schema.prisma"), /prefixAliases\s+ProjectPrefixAlias\[\]/);
});
test("update route uses the safe controller with the authenticated caller", async () => {
  const f = writes();
  const route = load("src/pages/api/projects/update.ts", {
    "@/utils/controllers/projects/update": f.controller,
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 6 }) },
    "@/lib/auth/sessionUserRecord": { loadSessionUserRecord: async id => ({ id }) },
  }).default;
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await route({ method: "POST", headers: {}, body: { projectId: 15, title: "Board", uniqueIdentifier: "NEW", userId: 99 } }, res);
  assert.equal(res.code, 200);
  assert.equal(f.aliases.length, 1);
});

function lookups({ visible = true, live = false, liveAccess = true, deleted = false, deletedBoard = false, agentId = null, ambiguous = false, prefixAliases = [{ prefix: "OLD", projectId: 15 }] } = {}) {
  const board = { id: 15, ownerId: visible ? 6 : 9, members: [], status: deletedBoard ? "Deleted" : "Normal", teamId: "team-1" };
  const current = { id: 101, projectId: 15, uniqueIndex: 123, ticketNumber: "NEW-123", status: deleted ? "Deleted" : "Normal", project: board };
  const tasks = [current];
  if (live) tasks.push({ ...current, id: 202, projectId: 16, ticketNumber: "OLD-123", project: { ...board, id: 16, ownerId: liveAccess ? 6 : 9 } });
  const aliases = prefixAliases.map(alias => ({ ...alias, project: board }));
  if (ambiguous) {
    tasks.push({ ...current, id: 303, projectId: 17 });
    aliases.push({ prefix: "OLD", projectId: 17, project: board });
  }
  let aliasQueries = 0;
  const prisma = {
    task: {
      findFirst: async ({ where }) => tasks.find(row => matches(row, where)) ?? null,
      findMany: async ({ where, take }) => tasks.filter(row => matches(row, where)).slice(0, take ?? tasks.length),
    },
    projectPrefixAlias: { findMany: async ({ where }) => { aliasQueries++; return aliases.filter(row => matches(row, where)); } },
    taskNumberAlias: { findMany: async () => [] },
  };
  const base = {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: (id, actualAgent) => { assert.equal(actualAgent ?? null, agentId); return { ownerId: id }; } },
  };
  base["@/utils/controllers/projects/findPrefixAliasTasks"] = load("src/utils/controllers/projects/findPrefixAliasTasks.ts", base);
  const resolver = load("src/lib/mcp/tasks/resolveTask.ts", base);
  const detail = load("src/utils/controllers/taskDetail/load.ts", {
    ...base, "@vercel/functions": {}, "@/lib/realtime/server": {}, "@/lib/cycles": {}, "@/lib/pullRequests/taskPullRequests": {}, "@/lib/agents/publicAgent": {}, "@/lib/flags": {}, "@/lib/agents/visibility": {}, "@/utils/controllers/notifications/visibleInboxScope": {},
  });
  const route = load("src/app/api/mcp/tasks/route.ts", {
    ...base,
    "next/server": { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } },
    "@/lib/mcp/auth": { checkMcpRateLimit: async () => null, validateMcpAuth: async () => ({ user: { id: 6 }, agentId }) },
    "@/lib/mcp/agents": {}, "@/lib/agents/visibility": {},
    "@/lib/mcp/tasks/mappers": { taskMcpGetInclude: () => ({}), mapTaskToMcpGetResponse: task => ({ id: task.id, ticketNumber: task.ticketNumber }) },
    "@/lib/mcp/tasks/resolveTask": resolver, "@/lib/mcp/pagination/cursor": {}, "@/lib/flags": {}, "@/lib/mcp/listQuery": {}, "@/lib/mcp/readListQuery": {}, "@/lib/mcp/priorityFilter": {},
  });
  return { resolver, detail, aliasQueries: () => aliasQueries, get: query => route.GET({ nextUrl: { searchParams: new URLSearchParams(query) } }) };
}
test("old prefix alias lookup resolves in MCP, CLI batch and detail", async () => {
  const f = lookups();
  assert.equal((await f.resolver.findTaskByIdentifier({ id: 6 }, { ticket_number: "OLD-123" })).id, 101);
  assert.equal((await f.detail.findTaskByTicketNumber("OLD-123", 6)).id, 101);
  const result = await f.get({ ticket_number: "OLD-123" });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.tasks, [{ id: 101, ticketNumber: "NEW-123" }]);
  const batch = await f.get({ ticket_number: "OLD-123,NEW-123" });
  assert.equal(batch.body.tasks.length, 1);
});
test("transaction alias lookup preserves uppercase IDs from legacy lowercase prefixes", async () => {
  for (const oldPrefix of ["old", "OlD"]) {
    const write = writes();
    write.board.uniqueIdentifier = oldPrefix;
    write.board.tasks = [{ uniqueIndex: 123, ticketNumber: "OLD-123" }];
    assert.equal((await write.update("NEW")).status, 200);
    assert.deepEqual(write.aliases, [{ projectId: 15, prefix: "OLD" }]);
    assert.equal(write.board.tasks[0].ticketNumber, "NEW-123");
    const f = lookups({ prefixAliases: write.aliases });
    assert.equal((await f.resolver.findTaskByIdentifier({ id: 6 }, { ticket_number: "OLD-123" })).id, 101);
    assert.equal((await f.detail.findTaskByTicketNumber("OLD-123", 6)).id, 101);
    assert.equal((await f.get({ ticket_number: "OLD-123" })).body.tasks[0].id, 101);
    assert.equal((await f.get({ ticket_number: "OLD-123,NEW-123" })).body.tasks.length, 1);
  }
});
test("a live ticket wins without consulting any prefix alias", async () => {
  const f = lookups({ live: true });
  assert.equal((await f.resolver.findTaskByIdentifier({ id: 6 }, { ticket_number: "OLD-123" })).id, 202);
  assert.equal((await f.detail.findTaskByTicketNumber("OLD-123", 6)).projectId, 16);
  assert.equal((await f.get({ ticket_number: "OLD-123" })).body.tasks[0].id, 202);
  assert.equal(f.aliasQueries(), 0);
});
for (const [name, options] of [["no access", { visible: false }], ["inaccessible live ticket", { live: true, liveAccess: false }], ["deleted task", { deleted: true }], ["deleted board", { deletedBoard: true }]]) {
  test(`prefix alias lookup rejects ${name}`, async () => {
    const f = lookups(options);
    assert.equal(await f.resolver.findTaskByIdentifier({ id: 6 }, { ticket_number: "OLD-123" }), null);
    assert.equal(await f.detail.findTaskByTicketNumber("OLD-123", 6), null);
    assert.equal((await f.get({ ticket_number: "OLD-123" })).status, 404);
  });
}
test("alias lookup respects project scope, agent access and unknown identifiers", async () => {
  const f = lookups({ agentId: "agent-1" });
  assert.equal((await f.resolver.findTaskByIdentifier({ id: 6 }, { ticket_number: "OLD-123", project_id: 15 }, "agent-1")).id, 101);
  for (const number of ["OLD-124", "UNKNOWN-123", "OLD-0", "OLD-9007199254740992"]) assert.equal(await f.resolver.findTaskByIdentifier({ id: 6 }, { ticket_number: number }, "agent-1"), null);
  assert.equal(await f.resolver.findTaskByIdentifier({ id: 6 }, { ticket_number: "OLD-123", project_id: 16 }, "agent-1"), null);
});
test("ambiguous prefix aliases fail closed until scoped", async () => {
  const f = lookups({ ambiguous: true });
  await assert.rejects(f.resolver.findTaskByIdentifier({ id: 6 }, { ticket_number: "OLD-123" }), /ambiguous/);
  assert.equal(await f.detail.findTaskByTicketNumber("OLD-123", 6), null);
  assert.equal((await f.get({ ticket_number: "OLD-123" })).status, 400);
  assert.equal((await f.resolver.findTaskByIdentifier({ id: 6 }, { ticket_number: "OLD-123", project_id: 15 })).id, 101);
});
test("detail lookup is wired before numeric parsing and canonicalizes ticket URLs", () => {
  const source = read("src/utils/controllers/taskDetail/load.ts");
  assert.match(source, /await findTaskByTicketNumber\(ticketNumber, userId, parseProjectSlug\(projectSlug\)\)/);
  const page = read("src/app/detail/[...slug]/page.tsx");
  assert.ok(page.indexOf("await findTaskByTicketNumber") < page.indexOf("const detailSlug = parseDetailSlug"));
  assert.match(page, /redirect\(`\/detail\/project-\$\{task.projectId\}\/\$\{task.uniqueIndex\}`\)/);
});

function creation({ enabled = true, clash = false, boards = [] } = {}) {
  let created = null;
  const prisma = {
    user: { findUnique: async () => ({ id: 6 }) },
    project: {
      findFirst: async ({ where }) => clash ? { id: 99 } : boards.find(board => matches(board, where)) ?? null,
      create: async ({ data }) => { created = { ...data, id: 15 }; return created; },
      update: async ({ data }) => ({ ...created, ...data, owner: { displayName: "User" }, team: { title: "Team" } }),
    },
    project_View: { upsert: async () => ({ default_view_id: 1 }) },
    $executeRaw: async () => {},
    $transaction: async callback => callback(prisma),
  };
  const controller = load("src/utils/controllers/projects/create.ts", {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "../logs/createLog": { __esModule: true, default: () => {} },
    "@/lib/projectPrefix": prefix,
    "@/lib/flags": { HTPR_6868_TICKET_PREFIX_FLAG: flagKey, isFeatureEnabled: async (_key, id) => { assert.equal(id, 6); return enabled; } },
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": {}, "@/utils/helperFunctions/Views/FilterHelperFunctions": {},
    "./boardQuota": { isBoardLimitReached: async () => false },
  });
  return { controller, created: () => created };
}
test("create uses a supplied validated unique prefix", async () => {
  const f = creation();
  const result = await f.controller.default(6, "Release Plan", "team-1", "account-1", " ab ");
  assert.equal(result.status, 200);
  assert.equal(result.json.uniqueIdentifier, "AB");
  assert.equal(f.created().uniqueIdentifier, "AB");
});
test("create with prefix rejects flag off, invalid prefixes and uniqueness conflicts before creation", async () => {
  for (const [options, input, status] of [[{ enabled: false }, "NEW", 403], [{}, "1AB", 400], [{}, null, 400], [{ clash: true }, "NEW", 400]]) {
    const f = creation(options);
    assert.equal((await f.controller.default(6, "Release Plan", "team-1", "account-1", input)).status, status);
    assert.equal(f.created(), null);
  }
});
test("create unique prefix rejects legacy lowercase and mixed-case board prefixes", async () => {
  for (const uniqueIdentifier of ["new", "NeW"]) {
    const f = creation({ boards: [{ id: 99, teamId: "team-1", uniqueIdentifier, status: "Normal" }] });
    assert.equal((await f.controller.default(6, "Board", "team-1", "account-1", "NEW")).status, 400);
    assert.equal(f.created(), null);
  }
});
test("create route cannot spoof an enabled user's identity to bypass the flag", async () => {
  const calls = [];
  const route = load("src/pages/api/projects/create.ts", {
    "@/utils/controllers/projects/create": { __esModule: true, default: async (...args) => { calls.push(args); return { status: 200, json: {} }; } },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 2343 }) },
  }).default;
  const res = { status() { return this; }, json() {} };
  await route({ method: "POST", headers: {}, body: { userId: 6, title: "Board", teamId: "team", googleAccountId: "account", ticketPrefix: "NEW" } }, res);
  assert.deepEqual(calls[0], [2343, "Board", "team", "account", "NEW"]);
});
test("move numbering after permanent deletion uses MAX plus one, not count", async () => {
  const next = load("src/utils/controllers/tasks/getNextUniqueTaskIndex.ts", { "@/lib/prisma": {} }).getNextUniqueTaskIndex;
  const surviving = [1, 3, 4];
  const db = { task: { aggregate: async () => ({ _max: { uniqueIndex: Math.max(...surviving) } }) } };
  assert.equal(await next(15, db), 5);
  assert.ok(surviving.includes(surviving.length + 1), "positive control: count plus one collides");
  const source = read("src/utils/controllers/tasks/moveToDifferentBoard.ts");
  assert.match(source, /getNextUniqueTaskIndex\(projectId\)/);
  assert.match(source, /uniqueIndex: nextUniqueIndex/);
  assert.match(source, /ticketNumber: `\$\{projectIdentifier\}-\$\{nextUniqueIndex\}`/);
  assert.doesNotMatch(source, /taskCount|getUniqueTaskCount/);
});
test("transaction locks and fresh prefix reads protect concurrent create and move writes", () => {
  for (const file of ["src/utils/controllers/tasks/create.ts", "src/pages/api/tasks/createGlobally.ts"]) {
    const source = read(file);
    assert.ok(source.indexOf("pg_advisory_xact_lock") < source.indexOf("await tx.project.findUnique"));
    assert.match(source, /await tx.project.findUnique/);
  }
  const single = read("src/utils/controllers/tasks/single.ts");
  assert.ok(single.indexOf("pg_advisory_xact_lock(9428471") < single.indexOf("await assertAgentAssignmentChangeAllowed"));
  assert.match(single, /requestedMutation.ticketNumber = `\$\{destination.uniqueIdentifier\}-/);
  assert.doesNotMatch(single, /ticketNumber: currentState.ticketNumber,\s+parentTaskId/);
});

function ui({ enabled = true, ownerId = 6, members = [] } = {}) {
  const project = { id: 15, title: "Hypertask", uniqueIdentifier: "HTPR", ownerId, members };
  const shell = load("src/components/Modals/Settings/SettingsSectionShell.tsx", {
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
  });
  const stubs = {
    axios: { post: async () => ({ data: { uniqueIdentifier: "NEW" } }), isAxiosError: () => false },
    "@tanstack/react-query": { useQueryClient: () => ({ invalidateQueries: async () => {} }), useQuery: () => ({ data: {}, isLoading: false }), useMutation: () => ({ isPending: false, mutate: () => {} }) },
    "react-hot-toast": { error: () => {} },
    "@/hooks/useFlag": { useFlag: key => { assert.equal(key, flagKey); return enabled; } },
    "@/lib/flags/keys": { HTPR_6868_TICKET_PREFIX_FLAG: flagKey },
    "@/lib/state": { useRecoilValue: () => ({ id: 6 }), useSetRecoilState: () => () => {} },
    "@/store": {}, "./SettingsSectionShell": shell,
    "./SettingsToggle": { __esModule: true, default: () => null },
    "./BoardLifecycleSettings": { __esModule: true, default: () => null },
    "./useSettingsTeam": { useSettingsTeam: () => ({ project }) },
    "@/components/Modals/AssignToUser/AssignToUser": {},
    "@/hooks/MultiPages/useGetMembersForAssignees": { useGetAllMembersForAssign: () => ({ data: {} }) },
    "@/lib/sectionAutoAssign": {},
  };
  const Board = load("src/components/Modals/Settings/BoardGeneralSection.tsx", stubs).default;
  return renderToStaticMarkup(React.createElement(Board));
}
test("UI settings row is first, uses the source input pattern and mirrors edit permission", () => {
  const html = ui();
  assert.ok(html.indexOf("Ticket prefix") < html.indexOf("Receive inbox"));
  assert.match(html, /Tickets will read HTPR-123. Old IDs like HTPR-123 keep working/);
  assert.ok(!/id="settings-ticket-prefix"[^>]*disabled/.test(html));
  assert.match(ui({ ownerId: 99 }), /id="settings-ticket-prefix"[^>]*disabled/);
  assert.ok(!/id="settings-ticket-prefix"[^>]*disabled/.test(ui({ ownerId: 99, members: [{ userId: 6, agentId: null }] })));
  assert.match(ui({ ownerId: 99, members: [{ userId: 6, agentId: "agent-1" }] }), /id="settings-ticket-prefix"[^>]*disabled/);
  const settings = read("src/components/Modals/Settings/BoardGeneralSection.tsx");
  const source = read("src/components/Modals/Settings/GeneralSection.tsx");
  const inputClass = source.match(/id="settings-display-name"\s+className="([^"]+)"/)[1];
  assert.ok(settings.includes(`className="${inputClass}"`));
  assert.match(settings, /onBlur=\{savePrefix\}/);
  assert.match(settings, /event.key === "Enter"\) event.currentTarget.blur/);
  assert.match(settings, /toast.error/);
});
test("UI hides the new settings control when the flag is off", () => assert.ok(!ui({ enabled: false }).includes("Ticket prefix")));
test("UI create reuses ModalInput, keeps manual edits and threads the prefix through both create paths", () => {
  const source = read("src/components/Modals/commands/createBoard.tsx");
  assert.match(source, /prefixDraft \?\? suggestProjectPrefix\(title\)/);
  assert.match(source, /ticketPrefixEnabled &&/);
  assert.match(source, /<ModalInput\s+aria-label="Ticket prefix"/);
  assert.match(source, /setPrefixDraft\(event.target.value.toUpperCase\(\)\)/);
  assert.equal((source.match(/ticketPrefixEnabled \? ticketPrefix : undefined/g) ?? []).length, 3);
  const actions = read("src/components/generalCommandActions.ts");
  assert.equal((actions.match(/ticketPrefix !== undefined \? \{ ticketPrefix \} : \{\}/g) ?? []).length, 2);
});
test("UI create updates the automatic suggestion until edited and submits the override", async () => {
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
  const previous = { window: global.window, document: global.document, navigator: Object.getOwnPropertyDescriptor(global, "navigator"), act: global.IS_REACT_ACT_ENVIRONMENT };
  global.window = dom.window;
  global.document = dom.window.document;
  Object.defineProperty(global, "navigator", { configurable: true, value: dom.window.navigator });
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const calls = [];
  const teams = [{ id: "team-1", googleAccountId: "account-1", title: "Team" }];
  const helpers = load("src/utils/undoActions/helperFuncs.ts", {
    "@/lib/constants/APIRouteConstants": {}, "@/lib/realtime/client": {},
    clsx: require("clsx"), "tailwind-merge": require("tailwind-merge"),
    axios: {}, "../api/global": {},
  });
  const Common = load("src/components/Common/CommonModalComponents/index.tsx", {
    "@/utils/undoActions/helperFuncs": helpers,
    reactstrap: {
      Modal: React.forwardRef(({ children }, ref) => React.createElement("div", { ref }, children)),
      ModalHeader: ({ children, className }) => React.createElement("div", { className }, children),
      ModalFooter: "div",
    },
    "@/styles/linksModal.module.scss": {},
    "@/hooks/MultiPages/useClickOutside": { __esModule: true, default: () => {} },
  });
  const Create = load("src/components/Modals/commands/createBoard.tsx", {
    "@/components/Common/CommonModalComponents": Common,
    "@/hooks/MultiPages/useGetAllTeamsMinimal": { useGetAllTeamsMinimal: () => ({ data: teams }) },
    "@/lib/state": { useRecoilValue: () => ({ id: 6 }) },
    "@/store": {},
    "@/lib/constants/keyboard-handler": { KeyCodes: { ENTER: 13, TAB: 9, J: 74, K: 75, ARROW_DOWN: 40, ARROW_UP: 38 } },
    "react-hot-toast": { error: message => { throw new Error(message); } },
    "@/hooks/useFlag": { useFlag: () => true },
    "@/lib/flags/keys": { HTPR_6868_TICKET_PREFIX_FLAG: flagKey },
    "@/lib/projectPrefix": prefix,
    "./createBoardStatus": { getCreateBoardPendingHeader: title => `Creating ${title}` },
  }).default;
  const { createRoot } = require("react-dom/client");
  const reactRoot = createRoot(document.getElementById("root"));
  async function type(input, value) {
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, value);
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  }
  try {
    await React.act(async () => reactRoot.render(React.createElement(Create, { payload: { teamId: teams[0].id, googleAccountId: teams[0].googleAccountId }, createBoard: (...args) => calls.push(args) })));
    const name = document.querySelector('[placeholder="Board name"]');
    const field = document.querySelector('[aria-label="Ticket prefix"]');
    await type(name, "Release Plan");
    assert.equal(field.value, "REPL");
    await type(field, "ship");
    assert.equal(field.value, "SHIP");
    await type(name, "Project Roadmap");
    assert.equal(field.value, "SHIP");
    await React.act(async () => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true })));
    assert.deepEqual(calls[0], ["Create Board", "Project Roadmap", "team-1", "account-1", undefined, "SHIP"]);
  } finally {
    await React.act(async () => reactRoot.unmount());
    global.window = previous.window;
    global.document = previous.document;
    if (previous.navigator) Object.defineProperty(global, "navigator", previous.navigator);
    else delete global.navigator;
    global.IS_REACT_ACT_ENVIRONMENT = previous.act;
    dom.window.close();
  }
});

test("registry defines one ticket-specific flag with Owner + QA default", () => {
  const keys = load("src/lib/flags/keys.ts");
  assert.equal(keys.HTPR_6868_TICKET_PREFIX_FLAG, flagKey);
  const registry = read("src/lib/flags.ts");
  assert.equal((registry.match(/key: HTPR_6868_TICKET_PREFIX_FLAG/g) ?? []).length, 1);
  assert.match(registry, /DEFAULT_FEATURE_FLAG_MODE: FeatureFlagMode = "OWNER_AND_QA"/);
});
