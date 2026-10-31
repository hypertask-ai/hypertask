const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const flag = "htpr-7686-free-plan-limits";
const MiB = 1024 * 1024;
const actor = { actorUserId: 985, agentId: "agent-owned", entryPoint: "test.quota" };
const teamScope = { kind: "team", teamId: "destination" };
const personalScope = { kind: "personal", ownerId: 7 };
const messages = {
  boards: "This team's Free plan allows 2 boards. Upgrade to add more, or archive a board you no longer use.",
  tickets: "This team's Free plan allows 250 open tickets. Upgrade to add more, or archive tickets you're done with.",
  file_size: "Files on the Free plan can be up to 25 MB. Upgrade to upload bigger files.",
};
const maxima = { boards: 2, tickets: 250, file_size: 25 * MiB };
const plain = (value) => JSON.parse(JSON.stringify(value));
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const sourceModules = [
  "src/lib/planLimits.ts",
  "src/lib/freePlanLimits.ts",
  "src/lib/flags/definitions/htpr-7923-unlimited-free-tickets.ts",
  "src/lib/flags/definitions/htpr-7922-unlimited-free-boards.ts",
  "src/lib/flags/definitions/htpr-7982-cancelled-free.ts",
  "src/lib/freeTier.ts",
  "src/app/api/ai/_lib/planGate.ts",
  "src/lib/subscriptionAccess.ts",
  "src/lib/planFromStripePriceId.ts",
  "src/lib/teamComp.ts",
  "src/lib/internalCompTeams.ts",
  "src/lib/flags/definitions/htpr-7686-free-plan-limits.ts",
  "src/lib/flags/definitions/htpr-7924-free-file-25mb.ts",
  "src/lib/flags/definitions/htpr-7924-free-storage-2gb.ts",
  "src/utils/controllers/projects/boardQuota.ts",
  "src/utils/controllers/projects/createProjectWithStableName.ts",
  "src/utils/controllers/projects/archiveProject.ts",
  "src/lib/mcp/webhooks/taskEvents.ts",
];

function loader(stubs, logger) {
  const cache = new Map();
  const allowed = new Set(sourceModules.map((file) => path.join(root, file)));
  function load(file) {
    const filename = path.isAbsolute(file) ? file : path.join(root, file);
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = { exports: {} };
    cache.set(filename, mod);
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: filename,
    }).outputText;
    vm.runInNewContext(code, {
      module: mod, exports: mod.exports, console: logger, Error, Date, Object, Set, Map,
      Response, Headers, Request, Buffer, URL, TextEncoder, TextDecoder,
      require(id) {
        if (id === "@/lib/agents/writing") return require("./task-route-loader.cjs").load("src/lib/agents/writing.ts", {});
        if (id === "@/lib/agents/writingEnforcement") return require("./helpers/stub-map.cjs").enforcementFor(require("./task-route-loader.cjs").load("src/lib/agents/writing.ts", {}));
        if (Object.hasOwn(stubs, id)) return { __esModule: true, ...stubs[id] };
        if (id === "crypto" || id.startsWith("node:")) return require(id);
        const base = id.startsWith("@/")
          ? path.join(root, "src", id.slice(2))
          : path.resolve(path.dirname(filename), id);
        const resolved = `${base}.ts`;
        if (allowed.has(resolved)) return load(resolved);
        throw new Error(`Unstubbed ${path.relative(root, filename)}: ${id}`);
      },
    }, { filename });
    return mod.exports;
  }
  return load;
}

function fixture(options = {}) {
  const calls = [], logs = [], writes = [], effects = [];
  const projects = [
    { id: 15, teamId: "destination", ownerId: 7, status: "Normal" },
    { id: 16, teamId: "destination", ownerId: 8, status: options.oneBoard ? "Archive" : "Normal" },
    { id: 17, teamId: "destination", ownerId: 7, status: "Archive" },
    { id: 18, teamId: "destination", ownerId: 7, status: "Deleted" },
    { id: 20, teamId: "source", ownerId: 7, status: "Normal" },
    { id: 30, teamId: null, ownerId: 7, status: "Normal" },
    { id: 31, teamId: null, ownerId: 7, status: "Normal" },
    { id: 32, teamId: null, ownerId: 8, status: "Normal" },
    { id: 33, teamId: null, ownerId: 8, status: "Normal" },
    { id: 34, teamId: null, ownerId: 9, status: "Normal" },
  ].map((p) => ({ ...p, name: `project-${p.id}`, title: "Board", uniqueIdentifier: "TEST" }));
  const tasks = Array.from({ length: options.tickets ?? 250 }, (_, i) => ({
    id: i + 1, projectId: 15, status: "Normal", parentTaskId: i === 0 ? null : 1,
  }));
  tasks.push(
    { id: 501, projectId: 15, status: "Archive" },
    { id: 502, projectId: 15, status: "Deleted" },
    { id: 503, projectId: 17, status: "Normal" },
    { id: 504, projectId: 18, status: "Normal" },
    { id: 505, projectId: 20, status: "Normal" },
    { id: 506, projectId: 32, status: "Normal" },
  );
  const projectMatches = (project, where) => Object.entries(where).every(([key, value]) => project[key] === value);
  const taskMatches = (task, where) => Object.entries(where).every(([key, value]) => {
    if (key === "project") return projectMatches(projects.find((p) => p.id === task.projectId), value);
    if (value && typeof value === "object" && "in" in value) return value.in.includes(task[key]);
    return task[key] === value;
  });
  const getProject = async (query) => {
    calls.push(["project.read", plain(query)]);
    const project = projects.find((p) => p.id === query.where.id);
    if (!project) throw new Error("Project not found");
    return { ...project };
  };
  const db = {
    $executeRaw: async (strings, ...values) => { calls.push(["scope.lock", strings.join("?"), ...values]); },
    $queryRaw: async (...args) => {
      if (args[0]?.strings?.join("?").includes('"Attachment"')) {
        calls.push(["storage.used", plain(args)]);
        return [{ bytes: BigInt(options.usedBytes ?? 0) }];
      }
      calls.push(["row.lock", plain(args)]);
      return [];
    },
    project: {
      count: async (query) => {
        calls.push(["project.count", plain(query)]);
        return projects.filter((p) => projectMatches(p, query.where)).length;
      },
      findUniqueOrThrow: getProject,
      findUnique: getProject,
      findFirst: getProject,
      create: async ({ data }) => {
        calls.push(["project.create"]);
        const project = { id: 100 + projects.length, ...data };
        projects.push(project);
        writes.push(["project.create", plain(data)]);
        return project;
      },
      update: async ({ where, data }) => {
        const project = projects.find((p) => p.id === where.id);
        Object.assign(project, data);
        writes.push(["project.update", plain(data)]);
        return { ...project };
      },
      updateMany: async () => { effects.push("first-real-task"); return { count: 1 }; },
    },
    task: {
      count: async (query) => {
        calls.push(["task.count", plain(query)]);
        return tasks.filter((task) => taskMatches(task, query.where)).length;
      },
      findUniqueOrThrow: async ({ where }) => ({ ...tasks.find((t) => t.id === where.id) }),
    },
    team: {
      findUnique: async (query) => {
        calls.push(["team.read", plain(query)]);
        const paid = options.entitlement === "paid" || options.entitlement === "past_due";
        return {
          id: query.where.id,
          compedUntil: options.entitlement === "comped" ? new Date(Date.now() + 86_400_000) : null,
          compedPlan: "Pro",
          subscriptionPlan: paid ? [{
            subscriptionId: "subscription", subscriptionStatus: options.entitlement === "past_due" ? "past_due" : "active",
            priceId: "price_1QjJeDIhmcH60VcciHzZ3mTJ",
          }] : [],
        };
      },
      findMany: async (query) => {
        calls.push(["legacy.teams", plain(query)]);
        return options.legacyTeams ?? [];
      },
    },
    notification: { updateMany: async () => ({ count: 0 }) },
    favorites: { deleteMany: async () => ({ count: 0 }) },
  };
  let transactionActive = false;
  db.$transaction = async (callback) => {
    calls.push(["transaction"]);
    assert.equal(transactionActive, false);
    transactionActive = true;
    const snapshot = plain(projects);
    const writeCount = writes.length;
    try { return await callback(db); }
    catch (error) {
      projects.splice(0, projects.length, ...snapshot);
      writes.splice(writeCount);
      throw error;
    } finally { transactionActive = false; }
  };
  const stubs = {
    "@/lib/prisma": { default: db },
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => {
      calls.push(["flag", key, userId]);
      if (key === "htpr-7924-free-file-25mb") return options.raisedFile !== false;
      if (key === "htpr-7924-free-storage-2gb") return options.storageCap === true;
      return key === "htpr-7982-cancelled-free"
        ? options.cancelledFree === true
        : key === flag && options.enabled !== false;
    } },
    "@/lib/subscriptionPlans": { allMonthlyPrices: [], allYearlyPrices: [] },
    "@/lib/flags/keys": {},
    "@/lib/aiModelOptions": {},
    "@prisma/client": { Status: { Normal: "Normal", Archive: "Archive", Deleted: "Deleted" }, Prisma: {
      sql: (strings, ...values) => ({ strings: [...strings], values }),
      join: (values) => values,
      PrismaClientKnownRequestError: class extends Error {},
    } },
    "./getFirst": { default: async () => ({ json: { id: 15 } }) },
    "./isProjectAdmin": { default: async () => true },
    "./outbox": { persistBoardWebhookEvent: async () => { effects.push("webhook"); return ["delivery"]; } },
    "../../telemetry/savedWork": {
      enqueueTaskCreated: async () => { effects.push("analytics"); return "intent"; },
      processAnalyticsIntentSoon: () => { effects.push("dispatch"); },
    },
  };
  const logger = {
    log() {}, error() {},
    warn(...args) { logs.push(plain(args)); if (options.loggerThrows) throw new Error("logger unavailable"); },
  };
  const load = loader(stubs, logger);
  const policy = load("src/lib/planLimits.ts");
  const boards = load("src/utils/controllers/projects/boardQuota.ts");
  return { calls, logs, writes, effects, projects, tasks, db, stubs, load, policy, boards };
}

function responseBody(limit, message = messages[limit]) {
  return { success: false, error: message, message, code: "PLAN_LIMIT_REACHED", limit, max: maxima[limit] };
}

async function refused(h, promise, limit, scope = teamScope, amount = { delta: 1 }) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.name, "PlanLimitReachedError");
    assert.equal(error.status, 402);
    assert.equal(error.code, "PLAN_LIMIT_REACHED");
    assert.equal(error.limit, limit);
    assert.equal(error.max, maxima[limit]);
    assert.deepEqual(plain(error.scope), scope);
    const expectedMessage = scope.kind === "personal" && limit !== "file_size"
      ? messages[limit].replace("This team's", "Your personal boards") : messages[limit];
    assert.equal(error.message, expectedMessage);
    assert.deepEqual(plain(h.policy.planLimitResponse(error)), { status: 402, body: responseBody(limit, expectedMessage) });
    return true;
  });
  assert.deepEqual(h.logs, [["[plan-limit] refused", { ...actor, scope, resource: limit, ...amount, max: maxima[limit] }]]);
}

function assertLockBeforeCount(h, resource, scope = "team:destination") {
  const lock = h.calls.findIndex(([kind]) => kind === "scope.lock");
  const count = h.calls.findIndex(([kind]) => kind === `${resource}.count`);
  assert.ok(lock >= 0 && count > lock, "the scope advisory lock precedes the count");
  assert.match(h.calls[lock][1], /pg_advisory_xact_lock\(hashtext\(/);
  assert.equal(h.calls[lock][2], `plan-limit:${scope}`);
}

function assertNoQuotaQueries(h) {
  assert.deepEqual(h.calls.filter(([kind]) => ["scope.lock", "project.read", "project.count", "task.count", "team.read"].includes(kind)), []);
  assert.deepEqual(h.logs, []);
}

test("named limits and rollout flag match the approved Free plan", () => {
  const h = fixture();
  assert.equal(h.policy.FREE_PLAN_MAX_BOARDS, 2);
  assert.equal(h.policy.FREE_PLAN_MAX_TICKETS, 250);
  assert.equal(h.policy.FREE_PLAN_MAX_FILE_BYTES, 10 * MiB);
  assert.equal(h.policy.FREE_PLAN_MAX_FILE_BYTES_RAISED, 25 * MiB);
  const definition = h.load("src/lib/flags/definitions/htpr-7686-free-plan-limits.ts");
  assert.equal(definition.HTPR_7686_FREE_PLAN_LIMITS_FLAG, flag);
  assert.equal(definition.default.defaultMode, "OWNER_AND_QA");
  assert.equal(definition.default.releaseRisk.highRisk, "money");
});

test("third Free board is refused across owners; only Normal boards in the destination team count", async () => {
  const h = fixture();
  await refused(h, h.policy.assertBoardRoom(h.db, teamScope, 1, actor), "boards");
  assert.deepEqual(h.calls.find(([kind]) => kind === "project.count")[1], { where: { teamId: "destination", status: "Normal" } });
  assertLockBeforeCount(h, "project");
  assert.deepEqual(h.calls.filter(([kind]) => kind === "flag").map((call) => call.slice(1)), [[flag, actor.actorUserId], ["htpr-7922-unlimited-free-boards", actor.actorUserId]]);
});

test("251st Free ticket is refused; subtasks count, archived/deleted tickets and boards do not", async () => {
  const h = fixture();
  await refused(h, h.policy.assertTicketRoom(h.db, teamScope, 1, actor), "tickets");
  assert.deepEqual(h.calls.find(([kind]) => kind === "task.count")[1], {
    where: { status: "Normal", project: { teamId: "destination", status: "Normal" } },
  });
  assertLockBeforeCount(h, "task");
});

test("the second board, 250th ticket, and exactly 25 MiB file are allowed", async () => {
  const h = fixture({ oneBoard: true, tickets: 249 });
  await h.policy.assertBoardRoom(h.db, teamScope, 1, actor);
  await h.policy.assertTicketRoom(h.db, teamScope, 1, actor);
  await h.policy.assertFileSizeForProject(15, 25 * MiB, actor);
  assert.deepEqual(h.logs, []);
});

for (const entitlement of ["paid", "comped", "past_due"]) {
  test(`${entitlement} uses real isPaidTeam and allows boards, tickets and 26 MiB files`, async () => {
    const h = fixture({ entitlement });
    assert.equal(await h.policy.isFreeScope(teamScope), false);
    await h.policy.assertBoardRoom(h.db, teamScope, 10, actor);
    await h.policy.assertTicketRoom(h.db, teamScope, 500, actor);
    await h.policy.assertFileSizeForProject(15, 26 * MiB, actor);
    assert.deepEqual(h.logs, []);
    assert.deepEqual(h.calls.filter(([kind]) => kind === "scope.lock" || kind.endsWith(".count")), []);
    assert.ok(h.calls.filter(([kind]) => kind === "team.read").every(([, query]) => query.where.id === "destination"));
  });
}

test("personal scope stays Free even when its owner belongs to a paid team; owners never pool", async () => {
  const h = fixture({ entitlement: "paid" });
  assert.equal(await h.policy.isFreeScope(personalScope), true);
  await refused(h, h.policy.assertBoardRoom(h.db, personalScope, 1, actor), "boards", personalScope);
  assert.deepEqual(h.calls.find(([kind]) => kind === "project.count")[1], { where: { teamId: null, ownerId: 7, status: "Normal" } });
  assert.equal(h.calls.some(([kind]) => kind === "team.read"), false);
  assertLockBeforeCount(h, "project", "personal:7");
  const other = fixture();
  await other.policy.assertBoardRoom(other.db, { kind: "personal", ownerId: 9 }, 1, actor);
  assert.deepEqual(other.logs, []);
});

test("personal ticket counts include only that owner's Normal tasks on Normal personal boards", async () => {
  const h = fixture();
  h.tasks.push(...Array.from({ length: 250 }, (_, i) => ({ id: 1000 + i, projectId: 30, status: "Normal" })));
  await refused(h, h.policy.assertTicketRoom(h.db, personalScope, 1, actor), "tickets", personalScope);
  assert.deepEqual(h.calls.find(([kind]) => kind === "task.count")[1], {
    where: { status: "Normal", project: { teamId: null, ownerId: 7, status: "Normal" } },
  });
});

test("26 MiB is refused with one safe structured log; a throwing logger cannot replace the 402", async () => {
  for (const loggerThrows of [false, true]) {
    const h = fixture({ loggerThrows });
    await refused(h, h.policy.assertFileSizeForProject(15, 26 * MiB, actor), "file_size", teamScope, { bytes: 26 * MiB });
    assert.deepEqual(h.calls.find(([kind]) => kind === "project.read")[1], {
      where: { id: 15 }, select: { teamId: true, ownerId: true },
    });
  }
});

for (const limit of ["boards", "tickets"]) {
  test(`${limit} logger failure still throws the original plan refusal exactly once`, async () => {
    const h = fixture({ loggerThrows: true });
    const guard = limit === "boards" ? h.policy.assertBoardRoom : h.policy.assertTicketRoom;
    await refused(h, guard(h.db, teamScope, 1, actor), limit);
  });
}

test("flag Off adds no scope, plan, count or locking queries on any shared guard", async () => {
  const h = fixture({ enabled: false });
  await h.policy.assertBoardRoom(h.db, teamScope, 1, actor);
  await h.policy.assertTicketRoom(h.db, teamScope, 1, actor);
  await h.policy.assertProjectTicketRoom(h.db, 15, 1, actor);
  await h.policy.assertTaskCountTransition(h.db, { projectId: 20, status: "Normal" }, { projectId: 15, status: "Normal" }, actor);
  await h.policy.assertFileSizeForProject(15, 26 * MiB, actor);
  assertNoQuotaQueries(h);
});

test("file flag Off keeps the 10 MiB Free limit and its message; flag On refuses only above 25 MiB", async () => {
  const off = fixture({ raisedFile: false });
  await off.policy.assertFileSizeForProject(15, 10 * MiB, actor);
  await assert.rejects(off.policy.assertFileSizeForProject(15, 11 * MiB, actor), (error) => {
    assert.equal(error.limit, "file_size");
    assert.equal(error.max, 10 * MiB);
    assert.equal(error.message, "Files on the Free plan can be up to 10 MB. Upgrade to upload bigger files.");
    return true;
  });
  const on = fixture();
  await on.policy.assertFileSizeForProject(15, 25 * MiB, actor);
  await refused(on, on.policy.assertFileSizeForProject(15, 26 * MiB, actor), "file_size", teamScope, { bytes: 26 * MiB });
});

test("storage cap refuses an upload that would pass 2 GiB and allows one that lands exactly on it", async () => {
  const GiB = 1024 * MiB;
  const h = fixture({ storageCap: true, usedBytes: 2 * GiB - 5 * MiB });
  await h.policy.assertUploadAllowedForProject(15, 5 * MiB, actor);
  await assert.rejects(h.policy.assertUploadAllowedForProject(15, 5 * MiB + 1, actor), (error) => {
    assert.equal(error.limit, "storage");
    assert.equal(error.max, 2 * GiB);
    assert.equal(error.status, 402);
    assert.equal(error.message, "Your team has used its 2 GB of free storage. Upgrade to Pro to upload more.");
    return true;
  });
});

test("storage cap is skipped with its flag Off, for a paid team and for a file already stored", async () => {
  const GiB = 1024 * MiB;
  const off = fixture({ storageCap: false, usedBytes: 2 * GiB });
  await off.policy.assertUploadAllowedForProject(15, MiB, actor);
  const paid = fixture({ storageCap: true, usedBytes: 2 * GiB, entitlement: "paid" });
  await paid.policy.assertUploadAllowedForProject(15, MiB, actor);
  const stored = fixture({ storageCap: true, usedBytes: 2 * GiB });
  await stored.policy.assertUploadAllowedForProject(15, MiB, actor, { alreadyStored: true });
  await assert.rejects(stored.policy.assertUploadAllowedForProject(15, MiB, actor), (error) => error.limit === "storage");
});

test("storage cap counts bytes already pending in the same batch and locks the team before reading usage", async () => {
  const GiB = 1024 * MiB;
  const h = fixture({ storageCap: true, usedBytes: 2 * GiB - 5 * MiB });
  await h.policy.assertUploadAllowedForProject(15, 4 * MiB, actor, { pendingBytes: 0 });
  await assert.rejects(
    h.policy.assertUploadAllowedForProject(15, 4 * MiB, actor, { pendingBytes: 4 * MiB }),
    (error) => error.limit === "storage",
  );
  const order = [];
  const tx = {
    $queryRaw: async (query) => {
      const text = query.strings.join("?");
      order.push(text.includes("pg_advisory_xact_lock") ? "lock" : "usage");
      return text.includes('"Attachment"') ? [{ bytes: BigInt(0) }] : [];
    },
  };
  await h.policy.assertUploadAllowedForProject(15, MiB, actor, { tx });
  assert.deepEqual(order, ["lock", "usage"]);
});

test("the per-file limit still wins over the storage cap and the storage query names only attachments", async () => {
  const h = fixture({ storageCap: true, usedBytes: 0 });
  await assert.rejects(h.policy.assertUploadAllowedForProject(15, 26 * MiB, actor), (error) => error.limit === "file_size");
  await h.policy.assertUploadAllowedForProject(15, 1, actor);
  const used = h.calls.find((call) => call[0] === "storage.used");
  assert.ok(used, "storage usage was read");
  assert.match(JSON.stringify(used[1]), /teamId/);
});

test("zero/negative deltas and grandfathered edits/archives do not inspect quotas", async () => {
  const h = fixture({ tickets: 600 });
  for (const delta of [0, -1]) {
    await h.policy.assertBoardRoom(h.db, teamScope, delta, actor);
    await h.policy.assertTicketRoom(h.db, teamScope, delta, actor);
  }
  for (const after of [{ projectId: 15, status: "Normal" }, { projectId: 15, status: "Archive" }, { projectId: 15, status: "Deleted" }]) {
    await h.policy.assertTaskCountTransition(h.db, { projectId: 15, status: "Normal" }, after, actor);
  }
  assertNoQuotaQueries(h);
});

for (const status of ["Archive", "Deleted"]) {
  test(`${status} to Normal task restore is refused at 250`, async () => {
    const h = fixture();
    await refused(h, h.policy.assertTaskCountTransition(h.db, { projectId: 15, status }, { projectId: 15, status: "Normal" }, actor), "tickets");
  });
}

for (const [name, before, after, rejects] of [
  ["cross-team move", { projectId: 20, status: "Normal" }, { projectId: 15, status: "Normal" }, true],
  ["archived-board to Normal-board within one team", { projectId: 17, status: "Normal" }, { projectId: 15, status: "Normal" }, true],
  ["same-scope Normal-board move", { projectId: 16, status: "Normal" }, { projectId: 15, status: "Normal" }, false],
  ["move into an archived board", { projectId: 20, status: "Normal" }, { projectId: 17, status: "Normal" }, false],
  ["move an archived task", { projectId: 20, status: "Archive" }, { projectId: 15, status: "Archive" }, false],
]) {
  test(`${name} ${rejects ? "adds a counted ticket and is refused" : "is zero delta and allowed"}`, async () => {
    const h = fixture({ tickets: 600 });
    const result = h.policy.assertTaskCountTransition(h.db, before, after, actor);
    if (rejects) await refused(h, result, "tickets");
    else {
      await result;
      assert.equal(h.calls.some(([kind]) => kind === "task.count"), false);
      assert.deepEqual(h.logs, []);
    }
  });
}

test("moving between different personal owners is not a zero-delta null-team move", async () => {
  const h = fixture();
  h.tasks.push(...Array.from({ length: 250 }, (_, i) => ({ id: 1000 + i, projectId: 30, status: "Normal" })));
  await refused(h, h.policy.assertTaskCountTransition(h.db, { projectId: 32, status: "Normal" }, { projectId: 30, status: "Normal" }, actor), "tickets", personalScope);
});

test("ticket creation on an archived board does not consume the Normal-board allowance", async () => {
  const h = fixture();
  await h.policy.assertProjectTicketRoom(h.db, 17, 1, actor);
  assert.equal(h.calls.some(([kind]) => kind === "task.count"), false);
  assert.deepEqual(h.logs, []);
});

test("board unarchive is refused for the third board before changing status", async () => {
  const h = fixture();
  await refused(h, h.boards.updateProjectStatus(17, "Normal", actor), "boards");
  assert.deepEqual(h.writes, []);
  assert.equal(h.projects.find((p) => p.id === 17).status, "Archive");
});

test("board unarchive charges all its Normal tickets, not archived/deleted tickets", async () => {
  const h = fixture({ oneBoard: true, tickets: 249 });
  h.tasks.push({ id: 507, projectId: 17, status: "Normal" }, { id: 508, projectId: 17, status: "Archive" }, { id: 509, projectId: 17, status: "Deleted" });
  await refused(h, h.boards.updateProjectStatus(17, "Normal", actor), "tickets", teamScope, { delta: 2 });
  assert.deepEqual(h.writes, []);
});

test("board unarchive exactly to both limits succeeds", async () => {
  const h = fixture({ oneBoard: true, tickets: 249 });
  await h.boards.updateProjectStatus(17, "Normal", actor);
  assert.equal(h.projects.find((p) => p.id === 17).status, "Normal");
  assert.deepEqual(h.logs, []);
});

test("board archive and already-Normal board edits remain possible when grandfathered over limits", async () => {
  const h = fixture({ tickets: 600 });
  await h.boards.updateProjectStatus(15, "Normal", actor);
  await h.boards.updateProjectStatus(16, "Archive", actor);
  assert.equal(h.writes.length, 2);
  assert.equal(h.calls.some(([kind]) => kind === "task.count" || kind === "project.count"), false);
  assert.deepEqual(h.logs, []);
});

test("board restore controller preserves the exact 402 HTTP JSON contract with one guard log", async () => {
  const h = fixture();
  const archive = h.load("src/utils/controllers/projects/archiveProject.ts").default;
  const result = await archive(17, actor.actorUserId);
  assert.equal(result.status, 402);
  assert.deepEqual(plain(result.json), responseBody("boards"));
  assert.equal(h.logs.length, 1);
  assert.equal(h.logs[0][0], "[plan-limit] refused");
  assert.equal(h.logs[0][1].actorUserId, actor.actorUserId);
  assert.deepEqual(h.writes, []);
});

function createdTask(h, projectId = 15) {
  return async () => {
    h.effects.push("insert");
    const task = { id: 900, projectId, title: "New task", status: "Normal", ticketNumber: "TEST-900", dueDate: null, startDate: null, sectionId: null, section: "", priority: null };
    return { taskId: task.id, result: task, webhookTask: task, firstTaskPointerTaskId: null };
  };
}

test("ordinary task constructor refuses before insert, webhook and analytics in its transaction", async () => {
  const h = fixture();
  const events = h.load("src/lib/mcp/webhooks/taskEvents.ts");
  await assert.rejects(events.createTaskWithBoardWebhookOutbox(h.db, { userId: actor.actorUserId, agentId: actor.agentId }, createdTask(h), "app", null, 15), (error) => {
    assert.deepEqual(plain(h.policy.planLimitResponse(error)), { status: 402, body: responseBody("tickets") });
    return true;
  });
  assert.deepEqual(h.effects, []);
  assert.equal(h.logs.length, 1);
  assert.equal(h.logs[0][1].actorUserId, actor.actorUserId);
  assert.equal(h.logs[0][1].agentId, actor.agentId);
  assert.ok(h.calls.findIndex(([kind]) => kind === "transaction") < h.calls.findIndex(([kind]) => kind === "scope.lock"));
  assertLockBeforeCount(h, "task");
});

test("ordinary constructor cannot omit the destination to bypass quota", async () => {
  const h = fixture();
  const events = h.load("src/lib/mcp/webhooks/taskEvents.ts");
  await assert.rejects(events.createTaskWithBoardWebhookOutbox(h.db, { userId: 985, agentId: null }, createdTask(h), "app"), /destination is required/i);
  assert.deepEqual(h.effects, []);
});

test("signup uses a distinct trusted provisioning constructor and can create starter tickets at quota", async () => {
  const h = fixture();
  const events = h.load("src/lib/mcp/webhooks/taskEvents.ts");
  const result = await events.createProvisionedTaskWithBoardWebhookOutbox(h.db, { userId: 985, agentId: null }, createdTask(h), "app", null, 15);
  assert.equal(result.result.id, 900);
  assert.deepEqual(h.effects, ["insert", "webhook", "analytics", "dispatch"]);
  assertNoQuotaQueries(h);
});

for (const options of [{ tickets: 249 }, { entitlement: "paid" }, { entitlement: "comped" }, { entitlement: "past_due" }, { enabled: false }]) {
  test(`ordinary constructor still creates atomically with ${JSON.stringify(options)}`, async () => {
    const h = fixture(options);
    const events = h.load("src/lib/mcp/webhooks/taskEvents.ts");
    const result = await events.createTaskWithBoardWebhookOutbox(h.db, { userId: 985, agentId: null }, createdTask(h), "app", null, 15);
    assert.equal(result.result.id, 900);
    assert.deepEqual(h.effects, ["insert", "webhook", "analytics", "dispatch"]);
    assert.deepEqual(h.logs, []);
    if (options.enabled === false) assertNoQuotaQueries(h);
  });
}

test("flag Off board restore is the legacy direct update with no new transaction or reads", async () => {
  const h = fixture({ enabled: false });
  await h.boards.updateProjectStatus(17, "Normal", actor);
  assert.equal(h.writes.length, 1);
  assertNoQuotaQueries(h);
  assert.equal(h.calls.some(([kind]) => kind === "transaction"), false);
});

test("flag Off keeps the exact three-owned-Normal-boards legacy quota and query scope", async () => {
  const h = fixture({ enabled: false });
  for (const project of h.projects) if ([30, 31].includes(project.id)) project.status = "Archive";
  await h.boards.assertBoardQuota(7);
  assert.deepEqual(h.calls.find(([kind]) => kind === "project.count")[1], { where: { ownerId: 7, status: "Normal" } });
  assert.deepEqual(h.calls.find(([kind]) => kind === "legacy.teams")[1].where, {
    OR: [{ googleAccount: { userId: 7 } }, { members: { some: { userId: 7 } } }],
  });
  h.projects.push({ id: 99, ownerId: 7, teamId: "another", status: "Normal" });
  await assert.rejects(h.boards.assertBoardQuota(7), (error) => error.name === "BoardLimitReachedError" && error.message === "Free plan includes 3 boards. Upgrade to create more.");
  assert.deepEqual(h.logs, []);
});

test("enabled legacy precheck makes no old owner-quota or unrelated-membership queries", async () => {
  const h = fixture();
  await h.boards.assertBoardQuota(7);
  assertNoQuotaQueries(h);
  assert.equal(h.calls.some(([kind]) => kind === "legacy.teams"), false);
});

test("ordinary board constructor refuses the third board before any insert", async () => {
  const h = fixture();
  const { createProjectWithStableName } = h.load("src/utils/controllers/projects/createProjectWithStableName.ts");
  await refused(h, createProjectWithStableName({ title: "Third", ownerId: 7, teamId: "destination", status: "Normal" }, actor), "boards");
  assert.deepEqual(h.writes, []);
  assertLockBeforeCount(h, "project");
});

test("trusted board provisioning is separate and allowed at quota", async () => {
  const h = fixture();
  const { createProvisionedProjectWithStableName } = h.load("src/utils/controllers/projects/createProjectWithStableName.ts");
  const board = await createProvisionedProjectWithStableName({ title: "Signup", ownerId: 7, teamId: "destination", status: "Normal" });
  assert.equal(board.name, `project-${board.id}`);
  assert.equal(h.writes.length, 2);
  assertNoQuotaQueries(h);
});

for (const options of [{ oneBoard: true }, { entitlement: "paid" }, { entitlement: "comped" }, { entitlement: "past_due" }]) {
  test(`ordinary board constructor allows ${JSON.stringify(options)}`, async () => {
    const h = fixture(options);
    const { createProjectWithStableName } = h.load("src/utils/controllers/projects/createProjectWithStableName.ts");
    const board = await createProjectWithStableName({ title: "New board", ownerId: 7, teamId: "destination", status: "Normal" }, actor);
    assert.equal(board.name, `project-${board.id}`);
    assert.equal(h.writes.length, 2);
    assert.deepEqual(h.logs, []);
  });
}

function recoveryFixture(options = {}) {
  const h = fixture({ tickets: 248, ...options });
  const tree = [
    { id: 800, projectId: 15, status: "Deleted", parentTaskId: null },
    { id: 801, projectId: 15, status: "Deleted", parentTaskId: 800 },
    { id: 802, projectId: 15, status: "Normal", parentTaskId: 800 },
  ].map((task) => ({ sectionId: 1, hardDeleteProcessingAt: null, ...task }));
  h.tasks.push(...tree);
  h.db.$queryRaw = async (strings) => {
    const sql = strings.join("?");
    h.calls.push(["tree.lock", sql]);
    if (/WITH RECURSIVE/.test(sql)) return tree.map(({ id }) => ({ id }));
    if (/FOR UPDATE/.test(sql)) return tree.map((task) => ({ ...task }));
    throw new Error(`Unexpected tree query: ${sql}`);
  };
  h.db.task.findMany = async ({ where }) => {
    h.calls.push(["tree.restoring", plain(where)]);
    return tree.filter((task) => where.id.in.includes(task.id) && task.status !== where.status.not);
  };
  h.db.task.updateMany = async ({ data }) => { h.effects.push("tree.update"); for (const task of tree) Object.assign(task, data); return { count: tree.length }; };
  h.db.task.update = async () => { h.effects.push("tree.detach"); return tree[0]; };
  h.db.notification.deleteMany = async () => { h.effects.push("notifications"); };
  Object.assign(h.stubs, {
    "@/lib/auth/agentScope": { withAgentScopeRequest: (_request, run) => run(), prepareAgentScope: async () => {} },
    "date-fns": { subMinutes: (date) => date },
    "../taskDeleteQueue": { scheduleTaskDeleteJob: async () => {} },
    sugar: {},
    "@/lib/tasks/sameBoardRelations": { stripForeignTaskRelations: (task) => task },
    "@/lib/constants": { default: {} },
    "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere: () => ({}) },
    "@/lib/mcp/tasks/agentMutationFence": {
      AgentMutationLeaseConflictError: class extends Error {},
      assertAgentAssignmentChangeAllowed: async () => {},
      cancelAgentMutationLeaseForHumanOverride: async () => {},
    },
    "@/lib/mcp/tasks/agentDoneLifecycle": { AgentDoneLifecycleDeniedError: class extends Error {}, assertAgentMayLeaveDoneForTasks: async () => {} },
    "@/lib/auth/getSessionUser": {},
    "@/lib/auth/session": {},
    "@/lib/auth/resolveActingAgent": {},
  });
  const controller = h.load("src/pages/api/queues/tasks/taskDeleteReminder.ts");
  return { ...h, controller, tree };
}

test("recover preflights the whole deleted tree, charging only tasks not already Normal", async () => {
  const h = recoveryFixture();
  await assert.rejects(h.controller.updateTaskAndSubtasks({ id: 800 }, "Normal", null, null, 985, actor.agentId), (error) => {
    assert.deepEqual(plain(h.policy.planLimitResponse(error)), { status: 402, body: responseBody("tickets") });
    return true;
  });
  assert.deepEqual(h.effects, []);
  assert.deepEqual(h.tree.map(({ status }) => status), ["Deleted", "Deleted", "Normal"]);
  assert.equal(h.logs.length, 1);
  assert.equal(h.logs[0][1].delta, 2);
  assert.equal(h.logs[0][1].actorUserId, 985);
});

for (const options of [{ tickets: 247 }, { enabled: false }, { entitlement: "comped" }, { entitlement: "past_due" }]) {
  test(`recover permits the full tree with ${JSON.stringify(options)}`, async () => {
    const h = recoveryFixture(options);
    await h.controller.updateTaskAndSubtasks({ id: 800 }, "Normal", null, null, 985, actor.agentId);
    assert.deepEqual(h.tree.map(({ status }) => status), ["Normal", "Normal", "Normal"]);
    assert.deepEqual(h.effects, ["tree.update", "tree.detach", "notifications"]);
    assert.deepEqual(h.logs, []);
    if (options.enabled === false) {
      assertNoQuotaQueries(h);
      assert.equal(h.calls.some(([kind]) => kind === "tree.restoring"), false);
    }
  });
}

function attachmentFixture(options = {}) {
  const h = fixture(options);
  const stored = [];
  const key = "tasks/attachments/large.bin";
  h.db.task.findFirst = async (query) => {
    h.calls.push(["attachment.access", plain(query)]);
    return options.denied ? null : { id: 900, projectId: 15, description_: { id: "description" } };
  };
  h.db.attachment = {
    findFirst: async () => options.existing ? { id: 1, taskId: 900, descriptionId: "description", commentId: null } : null,
    findFirstOrThrow: async () => ({ id: 1, ...stored[0] }),
  };
  Object.assign(h.stubs, {
    "@/lib/mcp/attachments/persistBatch": { persistAttachmentRows: async (_tx, uploads) => { stored.push(...plain(uploads)); h.effects.push("attachment.persist"); } },
    "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere: (userId) => ({ authorizedUserId: userId }) },
    "@/lib/storage/hypertasksS3": {
      HYPERTASKS_S3_BUCKET: "bucket",
      getHypertasksStoragePublicUrl: (objectKey) => `https://files.invalid/${objectKey}`,
      getHypertasksS3Client: () => ({
        headObject: () => ({ promise: async () => { h.effects.push("attachment.head"); return { ContentLength: options.bytes ?? 26 * MiB }; } }),
        deleteObject: ({ Key }) => ({ promise: async () => {
          h.effects.push(["attachment.delete", Key]);
          if (options.cleanupThrows) throw new Error("cleanup unavailable");
        } }),
      }),
    },
    "@/lib/storage/uploadTaskAttachmentToS3": { TASK_ATTACHMENT_PREFIX: "tasks/attachments" },
  });
  const controller = h.load("src/lib/storage/linkTaskAttachment.ts");
  const receipt = { userId: 985, key, fileName: "large.bin", contentType: "application/octet-stream", fileSize: 1 };
  return { ...h, controller, receipt, stored, key };
}

test("authorized attachment linking uses HEAD bytes, ignores forged tiny receipt size, cleans up and refuses 26 MiB", async () => {
  const h = attachmentFixture();
  await assert.rejects(h.controller.linkTaskAttachment(900, 985, h.receipt), (error) => {
    assert.deepEqual(plain(h.policy.planLimitResponse(error)), { status: 402, body: responseBody("file_size") });
    return true;
  });
  assert.deepEqual(h.stored, []);
  assert.deepEqual(h.effects, ["attachment.head", ["attachment.delete", h.key]]);
  assert.equal(h.logs.length, 1);
  assert.equal(h.logs[0][1].bytes, 26 * MiB);
  assert.equal(h.logs[0][1].actorUserId, 985);
  assert.deepEqual(h.logs[0][1].scope, teamScope);
  assert.equal(h.calls.find(([kind]) => kind === "attachment.access")[1].where.project.authorizedUserId, 985);
});

test("attachment cleanup failure does not replace the original 402 or duplicate the refusal log", async () => {
  const h = attachmentFixture({ cleanupThrows: true });
  await assert.rejects(h.controller.linkTaskAttachment(900, 985, h.receipt), (error) => error.code === "PLAN_LIMIT_REACHED" && error.status === 402);
  assert.equal(h.logs.length, 1);
  assert.deepEqual(h.stored, []);
});

for (const options of [{ bytes: 25 * MiB }, { entitlement: "paid" }, { entitlement: "comped" }, { entitlement: "past_due" }, { enabled: false }]) {
  test(`attachment linking allows ${JSON.stringify(options)} within existing transport limits`, async () => {
    const h = attachmentFixture(options);
    await h.controller.linkTaskAttachment(900, 985, h.receipt);
    assert.equal(h.stored.length, 1);
    assert.equal(h.stored[0].fileSize, options.enabled === false ? 1 : options.bytes ?? 26 * MiB);
    assert.deepEqual(h.effects, ["attachment.head", "attachment.persist"]);
    assert.deepEqual(h.logs, []);
    if (options.enabled === false) assertNoQuotaQueries(h);
  });
}

test("already-linked grandfathered attachment remains editable without a new size refusal", async () => {
  const h = attachmentFixture({ existing: true });
  const attachment = await h.controller.linkTaskAttachment(900, 985, h.receipt);
  assert.equal(attachment.id, 1);
  assert.deepEqual(h.effects, []);
  assertNoQuotaQueries(h);
});

test("attachment authorization is checked before plan resolution, HEAD, cleanup or persistence", async () => {
  const h = attachmentFixture({ denied: true });
  await assert.rejects(h.controller.linkTaskAttachment(900, 985, h.receipt), (error) => error.status === 404);
  assert.deepEqual(h.effects, []);
  assertNoQuotaQueries(h);
});

function moveFixture(options = {}) {
  const h = fixture({ tickets: 248, ...options });
  const sourceId = options.sourceId ?? 20;
  const moving = [
    { id: 800, status: "Normal", parentTaskId: null },
    { id: 801, status: "Normal", parentTaskId: 800 },
    { id: 802, status: "Archive", parentTaskId: 800 },
    { id: 803, status: "Normal", parentTaskId: 801 },
  ].map((task) => ({ projectId: sourceId, userId: 985, ...task }));
  h.tasks.push(...moving);
  h.db.task.findUnique = async ({ where }) => {
    const task = moving.find((task) => task.id === where.id);
    return task ? { ...task, subTasks: moving.filter((child) => child.parentTaskId === task.id) } : null;
  };
  h.db.task.findFirst = async () => null;
  h.db.task.findMany = async ({ where }) => {
    h.calls.push(["tree.incoming", plain(where)]);
    return moving.filter((task) => where.id.in.includes(task.id) && task.status === where.status)
      .map((task) => ({ ...task, project: h.projects.find((project) => project.id === task.projectId) }));
  };
  h.db.section = { findUnique: async () => ({ id: 9, projectId: options.targetId ?? 15, section_title: "Todo" }) };
  h.db.page = { findMany: async () => [] };
  h.db.member_Team = { findFirst: async () => ({ id: 1 }) };
  for (const name of ["estimate", "priority", "savedContent", "drafts", "reminder", "notification", "assignees", "follower", "taskLabel"]) {
    h.db[name] = { findMany: async () => [], updateMany: async () => {}, deleteMany: async () => {} };
  }
  Object.assign(h.stubs, {
    "@/utils/controllers/getMemberAndOwnerForBoard": { default: async () => [985] },
    "@/utils/generateRank": { default: () => "a" },
    "./getNextUniqueTaskIndex": { getNextUniqueTaskIndex: async () => 999 },
    "@/pages/api/queues/duedateQueue": { cancelDueDateJob: async () => {}, scheduleDueDateJob: async () => {} },
    "date-fns": { subMinutes: (date) => date },
    "@/models/model": {},
    "@/lib/api/errorMessage": { toErrorMessage: (body, fallback) => body?.message ?? body?.error ?? fallback },
    "@/utils/controllers/assignees/autoAssignForSection": { autoAssignForSection: async () => "ready" },
    "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere: () => ({}) },
    "../turbopuffer/turbopufferHelper": { upsertPageToTurbopuffer: async () => {} },
    "@/utils/controllers/tasks/single": {
      TASK_IDENTITY_CONFLICT_CODE: "TASK_IDENTITY_CONFLICT",
      updateTaskSingle: async (mutation) => {
        h.effects.push(["move", mutation.id]);
        return { status: 200, json: { ...moving.find((task) => task.id === mutation.id), ...mutation } };
      },
    },
  });
  const controller = h.load("src/utils/controllers/tasks/moveToDifferentBoard.ts");
  const params = { taskId: 800, targetProjectId: options.targetId ?? 15, targetSectionId: 9,
    currentProjectId: options.claimedSourceId ?? sourceId, currentUser: { id: 985 }, agentId: actor.agentId };
  return { ...h, controller, params };
}

test("cross-scope move preflights every Normal descendant before the first tree mutation", async () => {
  const h = moveFixture();
  await assert.rejects(h.controller.moveTaskToDifferentBoard(h.params), (error) => {
    assert.deepEqual(plain(h.policy.planLimitResponse(error)), { status: 402, body: responseBody("tickets") });
    return true;
  });
  assert.deepEqual(h.effects, []);
  assert.equal(h.logs.length, 1);
  assert.equal(h.logs[0][1].delta, 3);
  assert.equal(h.logs[0][1].entryPoint, "task.move.tree");
});

test("spoofing currentProjectId cannot turn a cross-scope tree move into zero delta", async () => {
  const h = moveFixture({ claimedSourceId: 15 });
  await assert.rejects(h.controller.moveTaskToDifferentBoard(h.params), (error) => error.code === "PLAN_LIMIT_REACHED");
  assert.deepEqual(h.effects, []);
  assert.equal(h.logs[0][1].delta, 3);
});

test("archived-board to Normal-board tree move in the same team is positive delta", async () => {
  const h = moveFixture({ sourceId: 17 });
  await assert.rejects(h.controller.moveTaskToDifferentBoard(h.params), (error) => error.code === "PLAN_LIMIT_REACHED");
  assert.deepEqual(h.effects, []);
  assert.equal(h.logs[0][1].delta, 3);
});

for (const options of [{ sourceId: 16, tickets: 600 }, { targetId: 17 }, { entitlement: "comped" }, { entitlement: "past_due" }, { enabled: false }]) {
  test(`tree move remains allowed with ${JSON.stringify(options)}`, async () => {
    const h = moveFixture(options);
    const result = await h.controller.moveTaskToDifferentBoard(h.params);
    assert.equal(result.success, true);
    assert.deepEqual(h.effects, [["move", 800], ["move", 801], ["move", 803], ["move", 802]]);
    assert.deepEqual(h.logs, []);
    if (options.enabled === false) {
      assert.equal(h.calls.some(([kind]) => kind === "tree.incoming" || kind === "scope.lock" || kind === "task.count"), false);
    }
  });
}

test("single-task mutation wires the shared transition guard inside the transaction before update", () => {
  const source = read("src/utils/controllers/tasks/single.ts");
  const transaction = source.indexOf("await prisma.$transaction(");
  const guard = source.indexOf("await assertTaskCountTransition(tx, currentState, updateData");
  const update = source.indexOf("await tx.task.update(", guard);
  assert.ok(transaction >= 0 && guard > transaction && update > guard);
  assert.match(source.slice(guard, update), /actorUserId: currentUser.id/);
});

test("signup provisioning is wired separately from the public task constructor", () => {
  const core = read("src/utils/controllers/tasks/createTaskCore.ts");
  assert.match(core, /createTaskCoreWithWriter\(options, createTaskWithBoardWebhookOutbox\)/);
  assert.match(core, /createTaskCoreWithWriter\(options, createProvisionedTaskWithBoardWebhookOutbox\)/);
  assert.match(read("src/utils/controllers/users/completeOnboardingStep.ts"), /await createProvisionedTaskCore\(/);
  assert.match(read("src/utils/controllers/users/provisionFirstWorkspace.ts"), /return CompleteOnboardingFirstStepProvisioning\(/);
});

function routeStubs(h) {
  Object.assign(h.stubs, {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    zod: { z: { custom: () => ({}) } },
    "./route": {
      legacyTaskWriteSession: async () => ({ userId: 985 }),
      taskWriteRoute: ({ operation, prepare }) => async (request, session = { userId: 985 }) =>
        operation(await request.json(), prepare ? await prepare(session) : session),
    },
  });
}

test("recover HTTP route returns exact 402 body from the whole-tree guard without post-restore effects", async () => {
  const h = recoveryFixture();
  routeStubs(h);
  h.db.task.findFirst = async () => ({ id: 800 });
  h.db.agent = { findFirst: async () => ({ id: actor.agentId }) };
  Object.assign(h.stubs, {
    "@/pages/api/queues/taskDeleteQueue": { cancelTaskDeleteJob: async () => { h.effects.push("cancel-delete"); } },
    "@/pages/api/queues/tasks/taskDeleteReminder": h.controller,
    "@/utils/controllers/turbopuffer/turbopufferHelper": { upsertTaskToTurbopuffer: () => { h.effects.push("index"); } },
  });
  const { POST } = h.load("src/lib/api/task-writes/recover.ts");
  const response = await POST({ headers: new Headers(), json: async () => ({ taskId: 800, agentId: actor.agentId }) }, { userId: 985 });
  assert.equal(response.status, 402);
  assert.deepEqual(await response.json(), responseBody("tickets"));
  assert.deepEqual(h.effects, []);
  assert.equal(h.logs.length, 1);
});

test("upload-finalize HTTP link step returns exact 402 for measured 26 MiB and removes staged bytes", async () => {
  const h = attachmentFixture();
  routeStubs(h);
  Object.assign(h.stubs, {
    "@/lib/media/heicPreview": { isHeicPreviewUrl: () => false },
    "@/lib/storage/directUpload": { DIRECT_UPLOAD_MAX_BATCH_BYTES: 100 * MiB, DIRECT_UPLOAD_MAX_FILES: 10, DIRECT_UPLOAD_MAX_FILE_BYTES: 20 * MiB },
    "@/lib/storage/uploadGrant": { verifyTaskAttachmentLinkReceipt: () => h.receipt },
    "@/lib/storage/linkTaskAttachment": h.controller,
    "@/lib/realtime/server": { broadcastTaskChange: async () => { h.effects.push("realtime"); } },
  });
  const { POST } = h.load("src/lib/api/task-writes/upload-finalize.ts");
  const response = await POST({ headers: new Headers(), json: async () => ({ action: "link-task-attachment", taskId: 900, receipt: "signed", projectId: 20 }) });
  assert.equal(response.status, 402);
  assert.deepEqual(await response.json(), responseBody("file_size"));
  assert.deepEqual(h.effects, ["attachment.head", ["attachment.delete", h.key]]);
  assert.equal(h.logs.length, 1);
  assert.deepEqual(h.logs[0][1].scope, teamScope);
});

test("board restore adapters share the boards-and-tickets restore helper", () => {
  for (const file of ["src/utils/controllers/projects/archiveProject.ts", "src/lib/mcp/operations/projects/archive/operation.ts", "src/lib/ai/tools/projectAdmin.ts"]) {
    assert.match(read(file), /await updateProjectStatus\(/, file);
    assert.match(read(file), /planLimitResponse\(error\)/, file);
  }
});

test("manifest preflights the full seed allowance before the first board insert", () => {
  const source = read("src/lib/mcp/boards/createBoardFromManifest.ts");
  const guard = source.indexOf("await assertTicketRoom(tx, scope, manifest.tasks.length, context)");
  const insert = source.indexOf("await createProjectWithStableName(", guard);
  assert.ok(guard >= 0 && insert > guard);
});

test("manual board create controller returns exact 402 for the third destination-team board", async () => {
  const h = fixture({ legacyTeams: [{ id: "unrelated-paid", subscriptionPlan: [{ subscriptionStatus: "active" }] }] });
  h.db.user = { findUnique: async () => ({ id: 985, accountId: "account" }) };
  h.db.team.findFirst = async () => ({ googleAccountId: "account" });
  Object.assign(h.stubs, {
    "@/lib/telemetry/savedWork": { enqueueBoardCreated: async () => { h.effects.push("board-analytics"); }, processAnalyticsIntentSoon: () => {} },
    "../logs/createLog": { default: () => { h.effects.push("board-log"); } },
    "@/lib/projectPrefix": {},
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": {},
    "@/utils/helperFunctions/Views/FilterHelperFunctions": {},
  });
  const create = h.load("src/utils/controllers/projects/create.ts").default;
  const response = await create(985, "Third board", "destination", "account");
  assert.equal(response.status, 402);
  assert.deepEqual(plain(response.json), responseBody("boards"));
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.effects, []);
  assert.equal(h.logs.length, 1);
  assert.equal(h.logs[0][1].entryPoint, "projects.create");
  assert.equal(h.calls.some(([kind]) => kind === "legacy.teams"), false);
});

test("recurring/agent-created tickets evaluate and log the acting user rather than the task author", async () => {
  const h = fixture();
  const events = h.load("src/lib/mcp/webhooks/taskEvents.ts");
  await assert.rejects(events.createTaskWithBoardWebhookOutbox(h.db, {
    userId: 7, agentId: "original-author-agent", actingUserId: 985, actingAgentId: "acting-agent",
  }, createdTask(h), "web", null, 15), (error) => error.code === "PLAN_LIMIT_REACHED");
  const flagCalls = h.calls.filter(([kind]) => kind === "flag");
  assert.ok(flagCalls.every(([, , userId]) => userId === 985));
  assert.deepEqual([...new Set(flagCalls.map(([, key]) => key))].sort(), [flag, "htpr-7923-unlimited-free-tickets"]);
  assert.equal(h.logs.length, 1);
  assert.equal(h.logs[0][1].actorUserId, 985);
  assert.equal(h.logs[0][1].agentId, "acting-agent");
  assert.deepEqual(h.effects, []);
});

test("personal 26 MiB attachment is Free even with a paid workspace elsewhere", async () => {
  const h = fixture({ entitlement: "paid" });
  await refused(h, h.policy.assertFileSizeForProject(30, 26 * MiB, actor), "file_size", personalScope, { bytes: 26 * MiB });
  assert.equal(h.calls.some(([kind]) => kind === "team.read"), false);
});

for (const entitlement of ["paid", "comped", "past_due"]) {
  test(`${entitlement} board restore may exceed both Free board and ticket limits`, async () => {
    const h = fixture({ entitlement });
    await h.boards.updateProjectStatus(17, "Normal", actor);
    assert.equal(h.projects.find((project) => project.id === 17).status, "Normal");
    assert.deepEqual(h.logs, []);
  });
}

function notificationFixture() {
  const h = fixture();
  const notifications = [], broadcasts = [];
  h.db.notification.findFirst = async ({ where }) => notifications.find((row) =>
    row.projectId === where.projectId && row.taskId === where.taskId && row.userId === where.userId &&
    row.message.startsWith(where.message.startsWith));
  h.db.notification.create = async ({ data }) => { notifications.push({ id: notifications.length + 1, ...data }); };
  Object.assign(h.stubs, {
    "@/lib/nativeAgent/agentMessageEnvelope": h.load("src/lib/nativeAgent/agentMessageEnvelope.ts"),
    "@/lib/realtime/server": { broadcastInboxChange: async (ownerId) => { broadcasts.push(ownerId); } },
  });
  return { ...h, notifications, broadcasts, notify: h.load("src/lib/planLimitNotifications.ts").notifyPlanLimitOwner };
}

test("recurring refusal creates one existing inbox message per source task and limit, even after rename or archive", async () => {
  const h = notificationFixture();
  const error = new h.policy.PlanLimitReachedError("tickets", 250, teamScope);
  const input = { projectId: 15, taskId: 900, title: "Recurring task", actorUserId: 985, error };
  await h.notify(input);
  h.notifications[0].status = "Archive";
  await h.notify({ ...input, title: "Renamed recurring task" });
  assert.equal(h.notifications.length, 1);
  assert.equal(h.notifications[0].type, "AgentMessage");
  assert.equal(h.notifications[0].userId, 7);
  assert.match(h.notifications[0].message, /Free plan allows 250 open tickets/);
  assert.deepEqual(h.broadcasts, [7]);
  assert.deepEqual(h.logs, []);
});

test("Slack notification deduplication uses the attempted task's source identity rather than its generated title", async () => {
  const h = notificationFixture();
  const error = new h.policy.PlanLimitReachedError("tickets", 250, teamScope);
  const input = { projectId: 15, title: "Same title", actorUserId: 985, error };
  await h.notify({ ...input, sourceKey: "slack:event-one" });
  await h.notify({ ...input, title: "Different generated title", sourceKey: "slack:event-one" });
  await h.notify({ ...input, sourceKey: "slack:event-two" });
  assert.equal(h.notifications.length, 2);
  assert.deepEqual(h.broadcasts, [7, 7]);
});

test("recurrence refusal retains the rule, passes the completer separately from authorship and never fails completion", async () => {
  const h = fixture();
  const error = new h.policy.PlanLimitReachedError("tickets", 250, teamScope);
  const notices = [], mutations = [], creations = [];
  const task = { id: 900, title: "Repeat", recurrence: "daily", userId: 7, projectId: 15,
    taskLabels: [], assignees: [], project: { uniqueIdentifier: "TEST" } };
  h.db.task.findUnique = async () => task;
  h.db.task.updateMany = async ({ data }) => { mutations.push(plain(data)); Object.assign(task, data); return { count: 1 }; };
  h.db.section = { findMany: async () => [{ id: 1, section_title: "Todo" }] };
  Object.assign(h.stubs, {
    "./createTaskCore": { createTaskCore: async (options) => { creations.push(options); throw error; } },
    "@/lib/recurrence": { isRecurrenceRule: () => true, nextOccurrence: () => new Date("2026-10-25T00:00:00Z") },
    "@/lib/mcp/boards/columnRole": { columnRoleFor: () => "todo" },
    "@/lib/realtime/server": { broadcastBoardChange: () => { throw new Error("No spawn to broadcast"); } },
    "@/pages/api/queues/duedateQueue": { scheduleDueDateJob: () => { throw new Error("No spawn to schedule"); } },
    "@/lib/planLimitNotifications": { notifyPlanLimitOwner: async (notice) => { notices.push(notice); } },
  });
  const { spawnNextRecurrence } = h.load("src/utils/controllers/tasks/spawnRecurrence.ts");
  assert.equal(await spawnNextRecurrence(900, null, 985, "acting-agent"), null);
  assert.equal(task.recurrence, "daily");
  assert.deepEqual(mutations, [{ recurrence: null }, { recurrence: "daily" }]);
  assert.equal(creations[0].userId, 7);
  assert.equal(creations[0].actingUserId, 985);
  assert.equal(creations[0].actingAgentId, "acting-agent");
  assert.equal(creations[0].agentId, undefined);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].taskId, 900);
  assert.equal(notices[0].actorUserId, 985);
});

for (const newlyUploaded of [false, true]) {
  test(`legacy URL refusal ${newlyUploaded ? "cleans proven current uploads" : "cannot delete an ownership-unproven object"}`, async () => {
    const h = fixture();
    const source = "https://files.invalid/tasks/attachments/other-users-upload.bin";
    const removed = [];
    h.db.task.findFirst = async () => ({ projectId: 15 });
    h.db.attachment = { findFirst: async () => null };
    Object.assign(h.stubs, {
      "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere: () => ({ authorized: true }) },
      "@/lib/storage/hypertasksS3": {
        parseHypertasksStorageKeyFromUrl: () => "tasks/attachments/other-users-upload.bin",
      },
      "@/lib/storage/uploadTaskAttachmentToS3": { TASK_ATTACHMENT_PREFIX: "tasks/attachments", getHypertasksObjectSize: async () => 26 * MiB },
      "@/lib/storage/linkTaskAttachment": {
        TaskAttachmentLinkError: class extends Error {},
        discardUnlinkedTaskAttachment: async (key) => { removed.push(key); },
        lockAttachmentReceipt: async () => {},
      },
    });
    const { verifyTaskAttachmentLinks } = h.load("src/lib/storage/verifyTaskAttachmentLinks.ts");
    await assert.rejects(verifyTaskAttachmentLinks(h.db, [source], {
      taskId: 900, ...(newlyUploaded ? { newlyUploadedSources: [source] } : {}),
    }, actor), (error) => error.code === "PLAN_LIMIT_REACHED");
    assert.deepEqual(removed, newlyUploaded ? ["tasks/attachments/other-users-upload.bin"] : []);
    assert.equal(h.logs.length, 1);
  });
}

test("archived-board writes and positive transitions serialize with board restore before reading countedness", () => {
  const policy = read("src/lib/planLimits.ts");
  for (const name of ["assertProjectTicketRoom", "assertTaskCountTransition"]) {
    const body = policy.slice(policy.indexOf(`export async function ${name}`));
    const lock = body.indexOf("await lockPlanLimitScope(tx, scope)");
    const share = body.indexOf("FOR SHARE");
    const current = body.indexOf("const current");
    assert.ok(lock >= 0 && share > lock && current > share, name);
  }
  const restore = read("src/utils/controllers/projects/boardQuota.ts").split("export async function updateProjectStatus")[1];
  assert.ok(restore.indexOf("lockPlanLimitScope(tx, destinationScope)") < restore.indexOf("FOR UPDATE"));
});

test("split compose preserves saved tickets and surfaces the refusal for unsaved drafts", () => {
  const compose = read("src/lib/ai/composeTask.ts");
  const branch = compose.slice(compose.indexOf('if ((error as { code?: string })?.code === "PLAN_LIMIT_REACHED")'));
  assert.match(branch, /if \(!tasks.length\) throw error/);
  assert.match(branch, /failedTitles.push\(\.\.\.drafts.slice\(index\)/);
  assert.match(branch, /toErrorMessage\(error/);
  assert.match(branch, /break;/);
  assert.match(branch, /return \{ task: tasks\[0\]/);
});

test("owner plan notices ride the existing inbox: attached to the task, inbox queries unchanged", async () => {
  const h = notificationFixture();
  const envelope = h.load("src/lib/nativeAgent/agentMessageEnvelope.ts");
  const error = new h.policy.PlanLimitReachedError("tickets", 250, teamScope);
  await h.notify({ projectId: 15, taskId: 42, title: "Weekly report", actorUserId: 985, error });
  assert.equal(h.notifications[0].taskId, 42);
  assert.equal(envelope.decodeAgentMessage(h.notifications[0].message), `Could not create the next ticket for "Weekly report": ${messages.tickets}`);
  for (const file of ["getAll.ts", "getCount.ts", "visibleInboxScope.ts"]) {
    assert.doesNotMatch(read(`src/utils/controllers/notifications/${file}`), /PLAN_LIMIT/);
  }
});

test("ticket admission re-resolves a personal destination owner after locking its project row", async () => {
  const h = fixture();
  const project = h.projects.find((row) => row.id === 30);
  h.tasks.push(...Array.from({ length: 250 }, (_, index) => ({ id: 2000 + index, projectId: 30, status: "Normal" })));
  let reads = 0;
  h.db.project.findUniqueOrThrow = async () => {
    reads += 1;
    if (reads === 1) {
      const beforeAdoption = { ...project };
      project.ownerId = 8;
      return beforeAdoption;
    }
    return { ...project };
  };
  await assert.rejects(h.policy.assertProjectTicketRoom(h.db, 30, 1, actor), (error) => {
    assert.deepEqual(plain(error.scope), { kind: "personal", ownerId: 8 });
    return error.code === "PLAN_LIMIT_REACHED";
  });
  assert.equal(h.logs.length, 1);
});

function uiAttachmentFixture(options = {}) {
  const h = fixture(options);
  const key = options.key ?? "tasks/attachments/composer.bin";
  const source = `https://files.invalid/${key}`;
  const saved = [];
  let heads = 0;
  const comment = { id: 44, creatorId: 985, taskId: 900, text: "Old text", task: { projectId: 15 } };
  h.db.task.findFirst = async () => options.denied ? null : { id: 900, projectId: 15 };
  h.db.comment = {
    findFirst: async () => options.denied ? null : comment,
    updateMany: async () => ({ count: 1 }),
    update: async ({ data }) => { saved.push({ kind: "comment", ...plain(data) }); return { ...comment, ...data }; },
  };
  h.db.attachment = {
    findFirst: async () => options.existing ? { id: 1 } : null,
    findMany: async () => [],
    create: async ({ data }) => { saved.push({ kind: "attachment", ...plain(data) }); return data; },
    createMany: async ({ data }) => { saved.push(...data.map(row => ({ kind: "attachment", ...plain(row) }))); return { count: data.length }; },
    deleteMany: async () => { saved.push({ kind: "delete" }); return { count: 0 }; },
  };
  h.db.description = { findFirst: async () => ({ id: "description" }) };
  h.db.url = {
    findMany: async () => [],
    create: async ({ data }) => { saved.push({ kind: "url", ...plain(data) }); return data; },
  };
  const tx = { ...h.db };
  h.db.$transaction = async callback => {
    const before = saved.length;
    try { return await callback(tx); }
    catch (error) { saved.splice(before); throw error; }
  };
  Object.assign(h.stubs, {
    "@/utils/controllers/projects/getAllIncludes": {
      taskWriteAccessWhere: userId => ({ authorizedUserId: userId }),
      projectContentAccessWhere: userId => ({ authorizedUserId: userId }),
    },
    "@/lib/storage/hypertasksS3": { parseHypertasksStorageKeyFromUrl: url => url.startsWith("https://files.invalid/") ? url.slice("https://files.invalid/".length).split("?")[0] : null },
    "@/lib/storage/uploadTaskAttachmentToS3": {
      getHypertasksObjectSize: async measuredKey => { heads++; assert.equal(measuredKey, key); return options.unverified ? null : options.bytes ?? 26 * MiB; },
    },
    "@/lib/storage/linkTaskAttachment": {
      TaskAttachmentLinkError: class extends Error { constructor(message, status) { super(message); this.status = status; } },
      lockAttachmentReceipt: async () => {},
      discardUnlinkedTaskAttachment: async () => assert.fail("unproven uploads must not be deleted"),
    },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 985 }) },
    "@/lib/media/inlineAgentImages.server": { inlineAgentImagesForUser: async text => text },
    "@/lib/realtime/server": { broadcastTaskComment: async () => {} },
    "@/utils/controllers/turbopuffer/turbopufferHelper": { upsertCommentToTurbopuffer() {} },
    "@/pages/api/queues/FAST/generateSummary": { default() {} },
    "@/pages/api/queues/FAST/generateCommentSummary": { default: async () => {} },
    "./processMentions": { processMentionsFromCommentText: async () => {} },
    "./readReceipts": { omitCommentSeen: value => value },
    "@/lib/ai/hyperAiConfirmation": { invalidateHyperAiCommentOrigin: async () => {} },
    "@/lib/agents/publicAgent": { publicAgentSelect: {} },
    "@/lib/mcp/normalizeBlockHtml": { normalizeBlockHtml: text => text },
  });
  h.stubs["@/lib/storage/verifyTaskAttachmentLinks"] = h.load("src/lib/storage/verifyTaskAttachmentLinks.ts");
  for (const file of ["measuredSize", "urlRowData"]) {
    h.stubs[`@/lib/attachments/${file}`] = h.load(`src/lib/attachments/${file}.ts`);
  }
  h.stubs["@/utils/controllers/urls/addIntoTask"] = h.load("src/utils/controllers/urls/addIntoTask.ts");
  h.stubs["@/utils/controllers/urls/addIntoTaskDesc"] = h.load("src/utils/controllers/urls/addIntoTaskDesc.ts");
  h.stubs["@/utils/controllers/comments/updateCommentService"] = h.load("src/utils/controllers/comments/updateCommentService.ts");
  const url = { TaskId: 900, urlString: source, Attachment: true, title: "composer.bin", fileSize: 1 };
  async function request(kind) {
    const routes = {
      comment: ["src/pages/api/urls/addIntoTask.ts", "POST", { commentId: 44, urlsToAdd: [url] }],
      description: ["src/pages/api/urls/addIntoTaskDesc.ts", "PUT", { taskId: 900, urlsToAdd: [url] }],
      edit: ["src/pages/api/comments/updateComment.ts", "PUT", {
        commentId: 44, creatorId: 985, taskId: 900, text: "Edited text", replaceAttachments: true,
        attachments: [{ fileSource: source, fileType: "application/octet-stream", fileName: "composer.bin", fileSize: "1" }],
      }],
    };
    const [file, method, body] = routes[kind];
    let status = 200, result;
    const res = { status(value) { status = value; return this; }, json(value) { result = value; return this; } };
    await h.load(file).default({ method, headers: {}, body }, res);
    return { status, body: plain(result) };
  }
  return { ...h, key, source, saved, request, heads: () => heads, verify: h.stubs["@/lib/storage/verifyTaskAttachmentLinks"].verifyTaskAttachmentLinks };
}

for (const kind of ["comment", "edit", "description"]) {
  for (const key of ["tasks/attachments/composer.bin", "ai-chat/attachments/session/composer.bin", "tasks/legacy-composer.bin"]) {
    test(`${kind} persistence refuses Free 26 MiB from ${key} before writes, ignoring a forged 1-byte size`, async () => {
      const h = uiAttachmentFixture({ key });
      const response = await h.request(kind);
      assert.equal(response.status, 402);
      assert.deepEqual(response.body, responseBody("file_size"));
      assert.deepEqual(h.saved, []);
      assert.equal(h.heads(), 1);
    });
    for (const options of [{ bytes: 25 * MiB }, { bytes: MiB }, { entitlement: "paid" }, { enabled: false }]) {
      test(`${kind} persistence still saves ${key} with ${JSON.stringify(options)}`, async () => {
        const h = uiAttachmentFixture({ key, ...options });
        const response = await h.request(kind);
        assert.equal(response.status, 200);
        const attachment = h.saved.find(row => row.kind === "attachment");
        assert.ok(attachment);
        assert.equal(attachment.fileSize, String(options.enabled === false ? 1 : options.bytes ?? 26 * MiB));
        assert.equal(h.heads(), options.enabled === false ? 0 : 1);
      });
    }
  }
  test(`${kind} persistence preserves access denial and never reads object size`, async () => {
    const h = uiAttachmentFixture({ denied: true });
    const response = await h.request(kind);
    assert.equal(response.status, 404);
    assert.deepEqual(h.saved, []);
    assert.equal(h.heads(), 0);
  });
}

function verificationRoute(h) {
  routeStubs(h);
  Object.assign(h.stubs, {
    "@/lib/media/heicPreview": { isHeicPreviewUrl: () => false },
    "@/lib/storage/directUpload": { DIRECT_UPLOAD_MAX_FILES: 10 },
    "@/lib/storage/uploadGrant": {},
    "@/lib/realtime/server": {},
  });
  return h.load("src/lib/api/task-writes/upload-finalize.ts").POST;
}

for (const existing of [false, true]) {
  test(`comment preflight refuses Free 26 MiB, including an existing description source (${existing})`, async () => {
    const h = uiAttachmentFixture({ existing });
    const POST = verificationRoute(h);
    const response = await POST({ headers: new Headers(), json: async () => ({ action: "verify-task-attachments", taskId: 900, sources: [h.source], projectId: 20, fileSize: 1 }) });
    assert.equal(response.status, 402);
    assert.deepEqual(await response.json(), responseBody("file_size"));
    assert.equal(h.heads(), 1);
    assert.deepEqual(h.saved, []);
  });
  for (const options of [{ bytes: 25 * MiB }, { entitlement: "paid" }, { enabled: false }]) {
    test(`comment preflight allows ${JSON.stringify(options)} (${existing})`, async () => {
      const h = uiAttachmentFixture({ existing, ...options });
      const POST = verificationRoute(h);
      const response = await POST({ headers: new Headers(), json: async () => ({ action: "verify-task-attachments", taskId: 900, sources: [h.source] }) });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { success: true });
      assert.deepEqual(h.saved, []);
    });
  }
}

for (const options of [{ denied: true, status: 404 }, { unverified: true, status: 409 }]) {
  test(`comment preflight fails closed with ${JSON.stringify(options)}`, async () => {
    const h = uiAttachmentFixture(options);
    const POST = verificationRoute(h);
    const response = await POST({ headers: new Headers(), json: async () => ({ action: "verify-task-attachments", taskId: 900, sources: [h.source] }) });
    assert.equal(response.status, options.status);
    assert.deepEqual(h.saved, []);
  });
}

for (const options of [{ bytes: 25 * MiB }, { entitlement: "paid" }]) {
  test(`create-modal receipt bind HTTP route still links ${JSON.stringify(options)}`, async () => {
    const h = attachmentFixture(options);
    routeStubs(h);
    Object.assign(h.stubs, {
      "@/lib/media/heicPreview": { isHeicPreviewUrl: () => false },
      "@/lib/storage/directUpload": {},
      "@/lib/storage/uploadGrant": { verifyTaskAttachmentLinkReceipt: () => h.receipt },
      "@/lib/storage/linkTaskAttachment": h.controller,
      "@/lib/realtime/server": { broadcastTaskChange: async () => {} },
    });
    const { POST } = h.load("src/lib/api/task-writes/upload-finalize.ts");
    const response = await POST({ headers: new Headers(), json: async () => ({ action: "link-task-attachment", taskId: 900, receipt: "signed" }) });
    assert.equal(response.status, 200);
    assert.equal(h.stored.length, 1);
    assert.equal(h.stored[0].fileSize, options.bytes ?? 26 * MiB);
  });
}

for (const options of [{}, { bytes: 25 * MiB }, { entitlement: "paid" }, { enabled: false }]) {
  test(`create-global project-scoped upload precheck: ${JSON.stringify(options)}`, async () => {
    const h = uiAttachmentFixture({ key: "ai-chat/attachments/session/composer.bin", ...options });
    const check = h.verify(h.db, [h.source], { projectId: 15 }, actor);
    if (options.bytes === undefined && options.entitlement !== "paid" && options.enabled !== false) {
      await assert.rejects(check, error => {
        assert.deepEqual(plain(h.policy.planLimitResponse(error)), { status: 402, body: responseBody("file_size") });
        return true;
      });
    } else {
      const sizes = await check;
      assert.equal(sizes.get(h.source), options.enabled === false ? undefined : options.bytes ?? 26 * MiB);
    }
    assert.deepEqual(h.saved, []);
  });
}

for (const body of [
  { taskId: 0, sources: [] }, { taskId: 900, sources: "file" }, { taskId: 900, sources: [123] },
]) {
  test(`comment preflight validates its request shape ${JSON.stringify(body)}`, async () => {
    const h = uiAttachmentFixture();
    const POST = verificationRoute(h);
    const response = await POST({ headers: new Headers(), json: async () => ({ action: "verify-task-attachments", ...body }) });
    assert.equal(response.status, 400);
    assert.equal(h.heads(), 0);
    assert.deepEqual(h.saved, []);
  });
}

for (const status of ["unpaid", "canceled", "incomplete_expired"]) {
  test(`ended subscription ${status} gets Free board admission without deleting data`, async () => {
    const h = fixture({ enabled: false, cancelledFree: true, legacyTeams: [
      { id: "customer-team", compedUntil: null, subscriptionPlan: [{ subscriptionStatus: status }] },
    ] });
    const before = plain({ projects: h.projects, tasks: h.tasks });
    await assert.rejects(h.boards.assertBoardQuota(7), { name: "BoardLimitReachedError" });
    assert.deepEqual(plain({ projects: h.projects, tasks: h.tasks }), before);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.calls.find((call) => call[1] === "htpr-7982-cancelled-free"),
      ["flag", "htpr-7982-cancelled-free", 7]);
  });
}

for (const status of ["active", "trialing", "past_due", "Paid"]) {
  test(`legitimate ${status} subscription still lifts the board cap`, async () => {
    const h = fixture({ enabled: false, cancelledFree: true, legacyTeams: [
      { id: "customer-team", compedUntil: null, subscriptionPlan: [{ subscriptionStatus: status }] },
    ] });
    assert.equal(await h.boards.isBoardLimitReached(7), false);
    assert.equal(await h.boards.hasPaidPlan(7), true);
  });
}

test("cancelled-Free flag Off preserves unpaid legacy admission", async () => {
  const h = fixture({ enabled: false, cancelledFree: false, legacyTeams: [
    { id: "customer-team", compedUntil: null, subscriptionPlan: [{ subscriptionStatus: "unpaid" }] },
  ] });
  assert.equal(await h.boards.isBoardLimitReached(7), false);
  assert.equal(await h.boards.hasPaidPlan(7), true);
});

test("a replacement paid subscription or explicit comp survives cancellation", async () => {
  for (const team of [
    { id: "customer-team", subscriptionPlan: [{ subscriptionStatus: "canceled" }, { subscriptionStatus: "active" }] },
    { id: "customer-team", compedUntil: new Date(Date.now() + 86_400_000), subscriptionPlan: [{ subscriptionStatus: "unpaid" }] },
  ]) {
    const h = fixture({ enabled: false, cancelledFree: true, legacyTeams: [team] });
    assert.equal(await h.boards.hasPaidPlan(7), true);
    assert.equal(await h.boards.isBoardLimitReached(7), false);
  }
});
