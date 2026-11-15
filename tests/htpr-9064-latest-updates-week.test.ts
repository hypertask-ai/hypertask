import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/loadModule.cjs";

import {
  dayLabel,
  latestUpdatesDayGroups,
} from "../src/lib/rocketDigest/panel";

process.env.TZ = "Europe/London";

const now = new Date(2026, 10, 15, 9, 0, 0);
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

function panelClient() {
  return {
    user: { findUnique: async () => null },
    announcments: { findMany: async () => [] },
    userAnnouncement: { findMany: async () => [], createMany: async () => ({ count: 0 }) },
  };
}

function loadPanel(client: any, weekOfUpdates: boolean) {
  return loadModule("src/utils/controllers/users/getAnnouncements.ts", {
    "@/lib/prisma": { default: client },
    "@/lib/flags": { isFeatureEnabled: async () => weekOfUpdates },
  }) as {
    getUserAnnouncements: (
      userId: number,
      options?: { now?: Date },
    ) => Promise<Array<{ announcement: FakeAnnouncement }> | null>;
  };
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

test("a 23-hour day still labels the previous day as yesterday", () => {
  const dstNow = new Date(2026, 2, 30, 0, 30);
  const yesterdayNoon = new Date(2026, 2, 29, 12, 0);
  assert.equal(new Date(dstNow.getTime() - 24 * 60 * 60 * 1000).getDate(), 28);
  assert.equal(dstNow.getTime() - yesterdayNoon.getTime() > 12 * 60 * 60 * 1000, true);
  assert.equal(dayLabel(yesterdayNoon, dstNow), "Yesterday");
  const [group] = latestUpdatesDayGroups([{ createdAt: yesterdayNoon.toISOString(), id: "dst" }], dstNow);
  assert.equal(group.label, "Yesterday");
  assert.equal(group.key, "2026-3-29");
});

test("the flag off keeps the newest fifteen notes", async () => {
  const client = panelClient();
  const userId = 4242;
  const rows = installFakeAnnouncements(client, userId, [...recentNotes(), ...oldNotes()]);
  const { getUserAnnouncements } = loadPanel(client, false);
  const result = await getUserAnnouncements(userId, { now });
  assert.equal(result?.length, 15);
  assert.equal(result?.[0].announcement.id, 900);
  assert.equal(result?.[14].announcement.id, 914);
  assert.equal(rows.length, 15);
});

test("the flag on reaches a full week of notes", async () => {
  const client = panelClient();
  const userId = 985;
  const rows = installFakeAnnouncements(client, userId, [...recentNotes(), ...oldNotes()]);
  const { getUserAnnouncements } = loadPanel(client, true);
  const result = await getUserAnnouncements(userId, { now });
  assert.equal(result?.length, 40);
  assert.equal(result?.[0].announcement.id, 900);
  assert.equal(result?.[39].announcement.id, 939);
  assert.equal(result?.some((row) => row.announcement.id === 100), false);
  assert.equal(rows.length, 40);
});

test("the flag on backfills notes older than the fifteen newest", async () => {
  const client = panelClient();
  const userId = 985;
  const rows = installFakeAnnouncements(client, userId, [...recentNotes(), ...oldNotes()]);
  const { getUserAnnouncements } = loadPanel(client, true);
  await getUserAnnouncements(userId, { now });
  const stored = rows.map((row) => row.announcementId).sort((left, right) => left - right);
  assert.equal(stored.length, 40);
  assert.equal(stored[0], 900);
  assert.equal(stored[39], 939);
});

test("an unknown user gets no panel data", async () => {
  const client = panelClient();
  const { getUserAnnouncements } = loadPanel(client, true);
  const result = await getUserAnnouncements(4242, { now });
  assert.equal(result, null);
});
