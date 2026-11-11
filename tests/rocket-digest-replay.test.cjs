const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let loadId = 0;
const now = new Date("2026-11-11T07:23:00Z");

function fixture({ failPost = 0, claim = true, outdated = true } = {}) {
  const events = Array.from({ length: 14 }, (_, index) => ({
    timestamp: new Date(`2026-10-${String(19 + index % 12).padStart(2, "0")}T07:23:00Z`),
    to: "Flag: Everyone",
    task: {
      projectId: 15,
      uniqueIndex: 8000 + index,
      title: `Board improvement ${index + 1}`,
      description: "Flag: https://app.hypertask.ai/admin/flags/old (Everyone) Old content.",
      description_: { content: "<p>Boards remember your chosen sorting order.</p>" },
      section: "Flag: Everyone",
      deletedAt: null,
      archivedAt: new Date("2026-11-08T12:00:00Z"),
      taskLabels: [{ label: { value: "FEATURE 💎" } }],
    },
  }));
  const announcements = [
    { id: 1, createdAt: new Date("2026-09-01"), body: { title: "Old release", digest: { ticketIds: [7000] } } },
    ...(outdated ? [{ id: 2, createdAt: new Date("2026-11-09"), body: { title: "Broken batch", digest: { ticketIds: events.map(({ task }) => task.uniqueIndex) } } }] : []),
  ];
  const sitting = [];
  const calls = { posts: [], deleted: [], alarms: [], transactions: 0 };
  let openAlarm = null;
  const redisValues = new Map();
  const inWindow = (date, range) => !range || ((!range.gte || date >= range.gte) && (!range.lte || date <= range.lte));
  const taskMatches = (task, where) => (!where.projectId || task.projectId === where.projectId)
    && (where.deletedAt !== null || task.deletedAt === null)
    && (where.archivedAt !== null || task.archivedAt === null);
  const prisma = {
    announcments: {
      findMany: async ({ where } = {}) => announcements.filter((row) =>
        inWindow(row.createdAt, where?.createdAt) && !where?.id?.notIn?.includes(row.id)),
      findFirst: async () => [...announcements].sort((a, b) => b.createdAt - a.createdAt)[0] ?? null,
      deleteMany: async ({ where }) => {
        calls.deleted.push(...where.id.in);
        for (let index = announcements.length - 1; index >= 0; index--) {
          if (where.id.in.includes(announcements[index].id)) announcements.splice(index, 1);
        }
      },
    },
    userAnnouncement: { deleteMany: async () => ({ count: 1 }) },
    taskSectionEvent: {
      findMany: async ({ where }) => events.filter((event) =>
        inWindow(event.timestamp, where.timestamp) && where.to.in.includes(event.to) && taskMatches(event.task, where.task)),
    },
    task: {
      findMany: async ({ where }) => sitting.filter((task) => taskMatches(task, where)
        && where.section.in.includes(task.section) && inWindow(task.sectionChangedAt, where.sectionChangedAt)),
      findFirst: async () => openAlarm,
    },
    section: { findMany: async () => [{ section_title: "Done" }] },
    project: {
      findFirst: async () => ({ uniqueIdentifier: "HYCI", section: [{ id: 100, section_title: "Backlog" }], labels: [] }),
    },
    $transaction: async (operations) => { calls.transactions++; return Promise.all(operations); },
  };
  const modules = {
    "src/lib/prisma.ts": { default: prisma },
    "src/lib/redis.ts": {
      getRedis: async () => ({
        get: async (key) => redisValues.get(key) ?? null,
        set: async (key, value) => {
          if (key !== "rocket-digest:last-run" && !claim) return null;
          redisValues.set(key, value);
          return "OK";
        },
      }),
    },
    "src/utils/controllers/tasks/createTaskCore.ts": {
      createProvisionedTaskCore: async (input) => {
        calls.alarms.push(input);
        openAlarm = { uniqueIndex: 500 };
        return { task: openAlarm };
      },
    },
    "src/utils/controllers/announcements/createAnnouncement.ts": {
      createAnnouncement: async (input) => {
        assert.equal(calls.deleted.length, 0, "old entries must survive every publication attempt");
        if (failPost && calls.posts.length + 1 === failPost) {
          failPost = 0;
          throw new Error("publication failed");
        }
        calls.posts.push(input);
        announcements.push({ id: 100 + calls.posts.length, ...input });
      },
    },
  };
  const saved = new Map();
  for (const [relative, exports] of Object.entries(modules)) {
    const filename = path.join(root, relative);
    saved.set(filename, require.cache[filename]);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  }
  for (const relative of ["src/lib/rocketDigest/digest.ts", "src/lib/rocketDigest/shipped.ts"]) {
    const filename = path.join(root, relative);
    saved.set(filename, require.cache[filename]);
    delete require.cache[filename];
  }
  const jiti = require("jiti")(path.join(root, `tests/rocket-replay-${++loadId}.cjs`), {
    interopDefault: true, alias: { "@": path.join(root, "src") }, cache: false,
  });
  const digest = jiti(path.join(root, "src/lib/rocketDigest/digest.ts"));
  return {
    digest, events, sitting, announcements, calls,
    restore() {
      for (const [filename, cached] of saved) {
        if (cached) require.cache[filename] = cached;
        else delete require.cache[filename];
      }
    },
  };
}

test("archived releases backfill the missing weeks before old entries are retired", async () => {
  const f = fixture();
  try {
    const result = await f.digest.runRocketDigest({ dryRun: false, now });
    assert.equal(result.shipped, 14);
    assert.equal(result.posted, 14, "migration must not truncate the backfill to twelve topics");
    assert.equal(result.cleared, 1);
    assert.deepEqual(f.calls.deleted, [2]);
    assert.ok(f.announcements.some((row) => row.id === 1), "preserve releases outside the replay window");
    for (const row of f.calls.posts) {
      assert.equal(row.body.content, "Boards remember your chosen sorting order.");
      assert.ok(row.body.digest.version >= 2);
      assert.ok(row.createdAt >= new Date("2026-10-18") && row.createdAt < new Date("2026-11-08"));
    }
    const again = await f.digest.runRocketDigest({ dryRun: false, now });
    assert.equal(again.posted, 0);
    assert.equal(again.cleared, 0);
    assert.equal(f.calls.posts.length, 14);
  } finally { f.restore(); }
});

test("archived releases without a section event use their recorded release date", async () => {
  const f = fixture();
  try {
    const event = f.events.shift();
    f.sitting.push({ ...event.task, sectionChangedAt: event.timestamp });
    const result = await f.digest.runRocketDigest({ dryRun: true, now });
    assert.equal(result.shipped, 14);
    const entry = result.entries.find((item) => item.ticketIds.includes(event.task.uniqueIndex));
    assert.equal(entry.releasedAt, event.timestamp.toISOString());
  } finally { f.restore(); }
});

test("a dry run has the same backfill but makes no mutations", async () => {
  const f = fixture();
  try {
    const result = await f.digest.runRocketDigest({ dryRun: true, now });
    assert.equal(result.entries.length, 14);
    assert.equal(result.posted, 0);
    assert.equal(result.cleared, 0);
    assert.equal(f.calls.transactions, 0);
    assert.equal(f.calls.posts.length, 0);
    assert.deepEqual(f.calls.deleted, []);
  } finally { f.restore(); }
});

test("a publication failure retains the old batch and a retry resumes without duplicating posts", async () => {
  const f = fixture({ failPost: 3 });
  try {
    await assert.rejects(f.digest.runRocketDigest({ dryRun: false, now }), /publication failed/);
    assert.equal(f.calls.posts.length, 2);
    assert.deepEqual(f.calls.deleted, []);
    assert.ok(f.announcements.some((row) => row.id === 2));
    const retry = await f.digest.runRocketDigest({ dryRun: true, now });
    assert.equal(retry.entries.length, 12);
    assert.ok(retry.entries.every((entry) => !f.calls.posts.some((post) => post.body.digest.ticketIds.includes(entry.ticketIds[0]))));
    const resumed = await f.digest.runRocketDigest({ dryRun: false, now });
    assert.equal(resumed.posted, 12);
    assert.equal(resumed.cleared, 1);
    assert.equal(new Set(f.calls.posts.flatMap((post) => post.body.digest.ticketIds)).size, 14);
  } finally { f.restore(); }
});

test("a competing run cannot delete or post entries", async () => {
  const f = fixture({ claim: false });
  try {
    const result = await f.digest.runRocketDigest({ dryRun: false, now });
    assert.equal(result.skipped, true);
    assert.equal(result.cleared, 0);
    assert.equal(f.calls.posts.length, 0);
    assert.deepEqual(f.calls.deleted, []);
  } finally { f.restore(); }
});

test("archived internal, deleted and reverted tickets never become release notes", async () => {
  const f = fixture();
  try {
    f.events[0].task.taskLabels = [{ label: { value: "CI" } }];
    f.events[1].task.title = "Agent feedback, friction: failed call";
    f.events[2].task.deletedAt = new Date();
    f.events[3].task.section = "Flag: Off";
    const result = await f.digest.runRocketDigest({ dryRun: true, now });
    assert.equal(result.shipped, 10);
    assert.ok(result.entries.every((entry) => entry.ticketIds.every((id) => id >= 8004)));
  } finally { f.restore(); }
});

test("an empty successful run updates last-run status without posting", async () => {
  const f = fixture({ outdated: false });
  try {
    f.events.length = 0;
    assert.equal(await f.digest.lastDigestRunAt(), null);
    await f.digest.runRocketDigest({ dryRun: true, now });
    assert.equal(await f.digest.lastDigestRunAt(), null);
    const result = await f.digest.runRocketDigest({ dryRun: false, now });
    assert.equal(result.posted, 0);
    assert.equal((await f.digest.lastDigestRunAt()).toISOString(), now.toISOString());
  } finally { f.restore(); }
});

test("four quiet days with archived releases files one urgent alarm and reports the last run", async () => {
  const f = fixture({ outdated: false });
  try {
    const lastRun = "2026-10-18T07:23:00.000Z";
    f.announcements.push({ id: 3, createdAt: new Date("2026-10-18"), body: { digest: { version: 2, runAt: lastRun, ticketIds: [] } } });
    const result = await f.digest.checkUpdatesFreshness({ now });
    assert.equal(result.shipped, 14);
    assert.equal(result.filed, true);
    assert.equal(result.lastRunAt, lastRun);
    assert.equal(f.calls.alarms[0].projectId, 11514);
    assert.equal(f.calls.alarms[0].priorityIndex, 1);
    const again = await f.digest.checkUpdatesFreshness({ now });
    assert.equal(again.ticketId, 500);
    assert.equal(again.filed, false);
    assert.equal(f.calls.alarms.length, 1);
  } finally { f.restore(); }
});
