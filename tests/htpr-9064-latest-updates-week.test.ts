import assert from "node:assert/strict";
import test from "node:test";

import {
  latestUpdatesDayGroups,
} from "../src/lib/rocketDigest/panel";

const now = new Date("2026-11-15T09:00:00.000Z");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000);
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

type FakeAnnouncement = { id: number; createdAt: Date; isActive: boolean; body: unknown };
type FakeUserAnnouncement = { userId: number; announcementId: number };

function announcement(id: number, createdAt: Date, isActive = true): FakeAnnouncement {
  return { id, createdAt, isActive, body: { title: `Note ${id}`, content: `Change ${id}` } };
}

function recentNotes(): FakeAnnouncement[] {
  const notes: FakeAnnouncement[] = [];
  for (let index = 0; index < 40; index += 1) notes.push(announcement(900 + index, hoursAgo(index * 2)));
  return notes;
}

function oldNotes(): FakeAnnouncement[] {
  return [announcement(100, daysAgo(9)), announcement(101, daysAgo(8)), announcement(102, daysAgo(8))];
}

function installFakeAnnouncements(
  client: any,
  userId: number,
  announcements: FakeAnnouncement[],
): FakeUserAnnouncement[] {
  const rows: FakeUserAnnouncement[] = [];
  client.user.findUnique = async ({ where }: { where: { id: number } }) => ({ id: where.id });
  client.announcments.findMany = async ({ where = {}, take }: any = {}) => {
    const since: Date | undefined = where.createdAt?.gte;
    const mine = new Set(rows.filter((row) => row.userId === userId).map((row) => row.announcementId));
    const matched = announcements
      .filter((row) => row.isActive && (!since || row.createdAt >= since) && !mine.has(row.id))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map((row) => ({ id: row.id }));
    return typeof take === "number" ? matched.slice(0, take) : matched;
  };
  client.userAnnouncement.createMany = async ({ data }: { data: FakeUserAnnouncement[] }) => {
    rows.push(...data);
    return { count: data.length };
  };
  client.userAnnouncement.findMany = async ({ where = {}, take }: any = {}) => {
    const since: Date | undefined = where.announcement?.createdAt?.gte;
    const byId = new Map(announcements.map((row) => [row.id, row]));
    const matched = rows
      .filter((row) => row.userId === where.userId)
      .map((row) => ({ ...row, announcement: byId.get(row.announcementId) }))
      .filter((row) => row.announcement && (!since || row.announcement.createdAt >= since))
      .sort((left, right) => right.announcement!.createdAt.getTime() - left.announcement!.createdAt.getTime());
    return typeof take === "number" ? matched.slice(0, take) : matched;
  };
  return rows;
}

test("the flag ships a week of updates to the owner and QA", async () => {
  const { default: definition, HTPR_9064_LATEST_UPDATES_WEEK_FLAG } = await import(
    "../src/lib/flags/definitions/htpr-9064-latest-updates-week"
  );
  assert.equal(HTPR_9064_LATEST_UPDATES_WEEK_FLAG, "htpr-9064-latest-updates-week");
  assert.equal(definition.key, "htpr-9064-latest-updates-week");
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
  assert.equal(definition.shippedOn, "2026-11-15");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.match(definition.description, /reaches back a week/);
  assert.match(definition.releaseRisk.reason, /newest 15 notes/);
});

test("day groups keep the sidebar readable and in order", () => {
  const posts = [
    { createdAt: now.toISOString(), id: "a" },
    { createdAt: hoursAgo(3).toISOString(), id: "b" },
    { createdAt: hoursAgo(30).toISOString(), id: "c" },
    { createdAt: daysAgo(4).toISOString(), id: "d" },
  ];
  const groups = latestUpdatesDayGroups(posts, now);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups[0].posts.map((post) => post.id), ["a", "b"]);
  assert.deepEqual(groups[1].posts.map((post) => post.id), ["c"]);
  assert.deepEqual(groups[2].posts.map((post) => post.id), ["d"]);
  assert.equal(groups[0].label, "Today");
  assert.equal(groups[1].label, "Yesterday");
});

async function main() {
  process.env.DATABASE_URL = "postgresql://unused:unused@localhost:5432/unused";
  const [{ default: prisma }, { getUserAnnouncements }] = await Promise.all([
    import("@/lib/prisma"),
    import("@/utils/controllers/users/getAnnouncements"),
  ]);
  const client = prisma as any;
  const originals = {
    userFindUnique: client.user.findUnique,
    announcementsFindMany: client.announcments.findMany,
    userAnnouncementFindMany: client.userAnnouncement.findMany,
    userAnnouncementCreateMany: client.userAnnouncement.createMany,
  };
  const restore = () => {
    client.user.findUnique = originals.userFindUnique;
    client.announcments.findMany = originals.announcementsFindMany;
    client.userAnnouncement.findMany = originals.userAnnouncementFindMany;
    client.userAnnouncement.createMany = originals.userAnnouncementCreateMany;
  };
  const everyone = 4242;
  const ownerOrQa = 985;

  try {
    await test("the flag off keeps the newest fifteen notes", async () => {
      const rows = installFakeAnnouncements(client, everyone, [...recentNotes(), ...oldNotes()]);
      const result = await getUserAnnouncements(everyone, {
        now,
        flagEnabled: async () => false,
      });
      assert.equal(result?.length, 15);
      assert.equal(result?.[0].announcement.id, 900);
      assert.equal(result?.[14].announcement.id, 914);
      assert.equal(rows.length, 15);
    });

    await test("the flag on reaches a full week of notes", async () => {
      const rows = installFakeAnnouncements(client, ownerOrQa, [...recentNotes(), ...oldNotes()]);
      const result = await getUserAnnouncements(ownerOrQa, {
        now,
        flagEnabled: async () => true,
      });
      assert.equal(result?.length, 40);
      assert.equal(result?.[0].announcement.id, 900);
      assert.equal(result?.[39].announcement.id, 939);
      assert.equal(result?.some((row) => row.announcement.id === 100), false);
      assert.equal(rows.length, 40);
    });

    await test("the flag on backfills notes older than the fifteen newest", async () => {
      const rows = installFakeAnnouncements(client, ownerOrQa, [...recentNotes(), ...oldNotes()]);
      await getUserAnnouncements(ownerOrQa, { now, flagEnabled: async () => true });
      const stored = rows.map((row) => row.announcementId).sort((left, right) => left - right);
      assert.equal(stored.length, 40);
      assert.equal(stored[0], 900);
      assert.equal(stored[39], 939);
    });

    await test("an unknown user gets no panel data", async () => {
      installFakeAnnouncements(client, everyone, recentNotes());
      client.user.findUnique = async () => null;
      const result = await getUserAnnouncements(everyone, { now });
      assert.equal(result, null);
    });
  } finally {
    restore();
  }
}

void main().then(() => {
  console.log("htpr-9064-latest-updates-week.test.ts: all assertions passed");
});
