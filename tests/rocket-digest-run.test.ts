import assert from "node:assert/strict";
import test from "node:test";

type FakeTask = {
  uniqueIndex: number;
  title: string;
  description: string;
  section: string;
  projectId: number;
  deletedAt: Date | null;
  archivedAt: Date | null;
  description_: { content: string } | null;
  taskLabels: { label: { value: string | null } }[];
};

type FakeEvent = { timestamp: Date; to: string; task: FakeTask };

type FakeAnnouncement = { id: number; body: unknown; createdAt: Date };

const day = (iso: string) => new Date(`${iso}T07:23:00.000Z`);

function task(overrides: Partial<FakeTask> & { uniqueIndex: number }): FakeTask {
  return {
    title: `Change ${overrides.uniqueIndex}`,
    description: `<p>Change ${overrides.uniqueIndex} makes the board easier to read.</p>`,
    section: "Flag: Everyone",
    projectId: 15,
    deletedAt: null,
    archivedAt: null,
    description_: null,
    taskLabels: [{ label: { value: "IMPROVEMENT ⚒️" } }],
    ...overrides,
  };
}

function event(timestamp: Date, owner: FakeTask, to = "Flag: Everyone"): FakeEvent {
  return { timestamp, to, task: owner };
}

function matchesEvent(row: FakeEvent, where: Record<string, any>): boolean {
  const from = where.timestamp?.gte as Date | undefined;
  const until = where.timestamp?.lte as Date | undefined;
  if (from && row.timestamp.getTime() < from.getTime()) return false;
  if (until && row.timestamp.getTime() > until.getTime()) return false;
  if (Array.isArray(where.to) && !where.to.includes(row.to)) return false;
  const taskWhere = where.task ?? {};
  if (taskWhere.projectId !== undefined && row.task.projectId !== taskWhere.projectId) return false;
  if (taskWhere.deletedAt === null && row.task.deletedAt !== null) return false;
  if ("archivedAt" in taskWhere && row.task.archivedAt !== taskWhere.archivedAt) return false;
  return true;
}

function matchesAnnouncement(row: FakeAnnouncement, where: Record<string, any> | undefined): boolean {
  if (!where) return true;
  const excluded = (where.id?.notIn ?? []) as number[];
  if (excluded.includes(row.id)) return false;
  const from = where.createdAt?.gte as Date | undefined;
  if (from && row.createdAt.getTime() < from.getTime()) return false;
  return true;
}

function staleRow(id: number, ticketIds: number[], release: string): FakeAnnouncement {
  return {
    id,
    createdAt: day(release),
    body: {
      title: "Older wording",
      content: "Flag: https://app.hypertask.ai/admin/flags/older",
      digest: { version: 2, until: day(release).toISOString(), ticketIds },
    },
  };
}

async function main() {
  process.env.DATABASE_URL = "postgresql://unused:unused@localhost:5432/unused";
  const [{ default: prisma }, { runRocketDigest }] = await Promise.all([
    import("@/lib/prisma"),
    import("@/lib/rocketDigest/digest"),
  ]);

  const client = prisma as any;
  const originals = {
    announcementsFindMany: client.announcments.findMany,
    announcementsFindFirst: client.announcments.findFirst,
    announcementsCreate: client.announcments.create,
    announcementsDeleteMany: client.announcments.deleteMany,
    userFindMany: client.user.findMany,
    userAnnouncementCreateMany: client.userAnnouncement.createMany,
    userAnnouncementDeleteMany: client.userAnnouncement.deleteMany,
    eventFindMany: client.taskSectionEvent.findMany,
    taskFindMany: client.task.findMany,
    transaction: client.$transaction,
  };

  const reset = () => Object.assign(client.announcments, {
    findMany: originals.announcementsFindMany,
    findFirst: originals.announcementsFindFirst,
    create: originals.announcementsCreate,
    deleteMany: originals.announcementsDeleteMany,
  });

  const restoreAll = () => {
    reset();
    client.user.findMany = originals.userFindMany;
    client.userAnnouncement.createMany = originals.userAnnouncementCreateMany;
    client.userAnnouncement.deleteMany = originals.userAnnouncementDeleteMany;
    client.taskSectionEvent.findMany = originals.eventFindMany;
    client.task.findMany = originals.taskFindMany;
    client.$transaction = originals.transaction;
  };

  const install = (events: FakeEvent[], announcements: FakeAnnouncement[]) => {
    const calls: string[] = [];
    const created: FakeAnnouncement[] = [];
    let nextId = 900;

    client.announcments.findMany = async ({ where }: { where?: Record<string, any> } = {}) =>
      announcements.filter((row) => matchesAnnouncement(row, where)).map((row) => ({ ...row }));
    client.announcments.findFirst = async () =>
      [...announcements].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ??
      null;
    client.announcments.create = async ({ data }: { data: Record<string, any> }) => {
      calls.push("create");
      const row = { id: nextId, body: data.body, createdAt: data.createdAt ?? new Date() };
      nextId += 1;
      announcements.push(row);
      created.push(row);
      return row;
    };
    client.announcments.deleteMany = async ({ where }: { where: { id: { in: number[] } } }) => {
      calls.push("delete");
      const ids = new Set(where.id.in);
      for (let index = announcements.length - 1; index >= 0; index -= 1) {
        if (ids.has(announcements[index].id)) announcements.splice(index, 1);
      }
      return { count: ids.size };
    };
    client.user.findMany = async () => [];
    client.userAnnouncement.createMany = async () => ({ count: 0 });
    client.userAnnouncement.deleteMany = async () => ({ count: 0 });
    client.taskSectionEvent.findMany = async ({ where }: { where: Record<string, any> }) =>
      events
        .filter((row) => matchesEvent(row, where))
        .map((row) => ({ timestamp: row.timestamp, task: row.task }));
    client.task.findMany = async () => [];
    client.$transaction = async (operations: Promise<unknown>[]) => Promise.all(operations);

    return { calls, created };
  };

  try {
    await test("a replay run reposts archived releases before it deletes outdated rows", async () => {
      restoreAll();
      const announcements: FakeAnnouncement[] = [staleRow(1, [8948], "2026-11-02")];
      const archived = task({ uniqueIndex: 8948, archivedAt: day("2026-11-09") });
      const live = task({ uniqueIndex: 8949 });
      const { calls, created } = install(
        [event(day("2026-11-02"), archived), event(day("2026-11-04"), live)],
        announcements,
      );

      const run = await runRocketDigest({ dryRun: false, now: day("2026-11-11") });

      assert.equal(run.posted, 2);
      assert.equal(run.cleared, 1);
      assert.deepEqual(
        created.map((row) => (row.body as { digest: { ticketIds: number[] } }).digest.ticketIds[0]),
        [8948, 8949],
      );
      assert.deepEqual(calls, ["create", "create", "delete"]);
      assert.equal(announcements.length, 2);
    });

    await test("a failed post keeps the outdated entries on the panel", async () => {
      restoreAll();
      const announcements: FakeAnnouncement[] = [staleRow(1, [8948], "2026-11-02")];
      const archived = task({ uniqueIndex: 8948, archivedAt: day("2026-11-09") });
      const { calls } = install([event(day("2026-11-02"), archived)], announcements);
      client.announcments.create = async () => {
        calls.push("create");
        throw new Error("post failed");
      };

      await assert.rejects(() => runRocketDigest({ dryRun: false, now: day("2026-11-11") }));
      assert.deepEqual(calls, ["create"]);
      assert.deepEqual(
        announcements.map((row) => row.id),
        [1],
      );
    });

    await test("a dry run reads the same releases and writes nothing", async () => {
      restoreAll();
      const announcements: FakeAnnouncement[] = [staleRow(1, [8948], "2026-11-02")];
      const archived = task({ uniqueIndex: 8948, archivedAt: day("2026-11-09") });
      const { calls } = install([event(day("2026-11-02"), archived)], announcements);

      const run = await runRocketDigest({ dryRun: true, now: day("2026-11-11") });

      assert.equal(run.entries.length, 1);
      assert.equal(run.posted, 0);
      assert.equal(run.cleared, 0);
      assert.deepEqual(calls, []);
      assert.deepEqual(
        announcements.map((row) => row.id),
        [1],
      );
    });
  } finally {
    restoreAll();
  }
}

void main().then(() => {
  console.log("rocket-digest-run.test.ts: all assertions passed");
});
