import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { createProvisionedTaskCore } from "@/utils/controllers/tasks/createTaskCore";
import { createAnnouncement } from "@/utils/controllers/announcements/createAnnouncement";
import { escapeHtml } from "@/utils/htmlEscape";
import { buildDigestEntries, type DigestEntry, type ShippedTicket } from "./entries";
import {
  ALARM_LABEL_VALUES,
  ALARM_PRIORITY_INDEX,
  ALARM_PROJECT_ID,
  ALARM_SECTION_TITLE,
  DIGEST_PROJECT_ID,
  RELEASE_SECTION_TITLES,
} from "./selection";
import { digestUntil } from "./cursor";
import { announcedTicketIds, selectShippedTickets } from "./shipped";

const DAY_MS = 24 * 60 * 60 * 1000;
const CURSOR_LOOKBACK_DAYS = 90;
const BACKFILL_DAYS = 30;
export const STALE_AFTER_DAYS = 4;
const ALARM_MARKER = "latest-updates-alarm";
const ALARM_USER_ID = 332;
const ALARM_CLAIM_SECONDS = 6 * 60 * 60;
const RUN_CLAIM_SECONDS = 10 * 60;

export type DigestRun = {
  skipped: boolean;
  since: string;
  until: string;
  shipped: number;
  entries: { title: string; content: string; releasedAt: string; ticketIds: number[] }[];
  posted: number;
};

export type FreshnessCheck = {
  newestEntryAt: string | null;
  staleDays: number;
  shipped: number;
  filed: boolean;
  ticketId: number | null;
};

function newestOf(dates: readonly Date[]): Date | null {
  if (!dates.length) return null;
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

function lookbackStart(now: Date): Date {
  return new Date(now.getTime() - CURSOR_LOOKBACK_DAYS * DAY_MS);
}

async function claim(key: string, now: Date, seconds: number): Promise<boolean> {
  try {
    const redis = await getRedis();
    return (
      (await redis.set(
        `${key}:${Math.floor(now.getTime() / (seconds * 1000))}`,
        "1",
        "EX",
        seconds,
        "NX",
      )) === "OK"
    );
  } catch {
    return true;
  }
}

export async function readDigestCursor(now: Date): Promise<Date> {
  const recent = await prisma.announcments.findMany({
    where: { createdAt: { gte: lookbackStart(now) } },
    select: { body: true },
  });
  const marked = newestOf(
    recent
      .map((row) => digestUntil(row.body))
      .filter((date): date is Date => date !== null && date.getTime() <= now.getTime()),
  );
  if (marked) return marked;

  const newest = await prisma.announcments.findFirst({
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (newest) return newest.createdAt < now ? newest.createdAt : now;
  return new Date(now.getTime() - BACKFILL_DAYS * DAY_MS);
}

function announcementBody(entry: DigestEntry, runAt: Date) {
  return {
    title: entry.title,
    content: entry.content,
    digest: {
      until: entry.releasedAt.toISOString(),
      ticketIds: entry.ticketIds,
      runAt: runAt.toISOString(),
    },
  };
}

export async function runRocketDigest({
  dryRun,
  now = new Date(),
}: {
  dryRun: boolean;
  now?: Date;
}): Promise<DigestRun> {
  const since = await readDigestCursor(now);
  const announced = await announcedTicketIds();
  const tickets = await selectShippedTickets(DIGEST_PROJECT_ID, since, now, announced);
  const entries = buildDigestEntries(tickets);
  let posted = 0;

  if (!dryRun && entries.length) {
    if (!(await claim("rocket-digest:run", now, RUN_CLAIM_SECONDS))) {
      return { skipped: true, since: since.toISOString(), until: now.toISOString(), shipped: 0, entries: [], posted: 0 };
    }
    for (const entry of entries) {
      await createAnnouncement({ body: announcementBody(entry, now), createdAt: entry.releasedAt });
      posted += 1;
    }
  }

  return {
    skipped: entries.length === 0,
    since: since.toISOString(),
    until: now.toISOString(),
    shipped: tickets.length,
    entries: entries.map((entry) => ({
      title: entry.title,
      content: entry.content,
      releasedAt: entry.releasedAt.toISOString(),
      ticketIds: entry.ticketIds,
    })),
    posted,
  };
}

function alarmTitle(staleDays: number, shipped: number): string {
  return `Latest Updates has posted nothing for ${Math.max(1, Math.floor(staleDays))} days while ${shipped} changes shipped`;
}

function alarmDescription(staleDays: number, shipped: number, newestEntryAt: Date | null) {
  return (
    `<p><strong>${escapeHtml(alarmTitle(staleDays, shipped))}</strong></p><ul>` +
    `<li>Newest panel entry: ${escapeHtml(newestEntryAt?.toISOString() ?? "none")}.</li>` +
    `<li>Changes released since that entry: ${shipped}.</li>` +
    `<li>How to undo: nothing to undo, this ticket only reports a quiet feed.</li>` +
    `</ul><p>${escapeHtml(ALARM_MARKER)}</p>`
  );
}

async function findOpenAlarm(): Promise<number | null> {
  const done = await prisma.section.findMany({
    where: { projectId: ALARM_PROJECT_ID, isDone: true },
    select: { section_title: true },
  });
  const open = await prisma.task.findFirst({
    where: {
      projectId: ALARM_PROJECT_ID,
      deletedAt: null,
      archivedAt: null,
      ...(done.length ? { section: { notIn: done.map((section) => section.section_title) } } : {}),
      description_: { is: { content: { contains: ALARM_MARKER } } },
    },
    orderBy: { id: "desc" },
    select: { uniqueIndex: true },
  });
  return open?.uniqueIndex ?? null;
}

async function fileAlarm(
  staleDays: number,
  tickets: readonly ShippedTicket[],
  newestEntryAt: Date | null,
): Promise<number | null> {
  const project = await prisma.project.findFirst({
    where: { id: ALARM_PROJECT_ID, status: "Normal" },
    select: {
      uniqueIdentifier: true,
      section: {
        where: { deleted: false, visibility: true, section_title: ALARM_SECTION_TITLE },
        orderBy: { ranking: "asc" },
        take: 1,
        select: { id: true, section_title: true },
      },
      labels: { where: { value: { in: ALARM_LABEL_VALUES } }, select: { id: true } },
    },
  });
  const section = project?.section[0];
  if (!project?.uniqueIdentifier || !section) {
    throw new Error("Latest Updates alarm board or section is unavailable");
  }

  const { task } = await createProvisionedTaskCore({
    title: alarmTitle(staleDays, tickets.length),
    description: alarmDescription(staleDays, tickets.length, newestEntryAt),
    userId: ALARM_USER_ID,
    creationChannel: "api",
    projectId: ALARM_PROJECT_ID,
    sectionId: section.id,
    sectionTitle: section.section_title,
    projectIdentifier: project.uniqueIdentifier,
    priorityIndex: ALARM_PRIORITY_INDEX,
    labelIds: project.labels.map((label) => label.id),
    createDrafts: false,
  });
  const uniqueIndex = Number((task as { uniqueIndex?: number }).uniqueIndex);
  return Number.isInteger(uniqueIndex) && uniqueIndex > 0 ? uniqueIndex : null;
}

export async function checkUpdatesFreshness({
  now = new Date(),
}: { now?: Date } = {}): Promise<FreshnessCheck> {
  const newest = await prisma.announcments.findFirst({
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const newestEntryAt = newest?.createdAt ?? null;
  const since = newestEntryAt ?? new Date(now.getTime() - BACKFILL_DAYS * DAY_MS);
  const staleDays = newestEntryAt
    ? (now.getTime() - newestEntryAt.getTime()) / DAY_MS
    : BACKFILL_DAYS;
  const quiet: FreshnessCheck = {
    newestEntryAt: newestEntryAt?.toISOString() ?? null,
    staleDays: Number(staleDays.toFixed(2)),
    shipped: 0,
    filed: false,
    ticketId: null,
  };

  if (staleDays < STALE_AFTER_DAYS) return quiet;

  const announced = await announcedTicketIds();
  const tickets = await selectShippedTickets(
    DIGEST_PROJECT_ID,
    since,
    now,
    announced,
    RELEASE_SECTION_TITLES,
  );
  if (!tickets.length) return quiet;

  const openTicket = await findOpenAlarm();
  if (openTicket !== null) return { ...quiet, shipped: tickets.length, ticketId: openTicket };
  if (!(await claim("rocket-digest:alarm", now, ALARM_CLAIM_SECONDS))) {
    return { ...quiet, shipped: tickets.length };
  }

  const ticketId = await fileAlarm(staleDays, tickets, newestEntryAt);
  return { ...quiet, shipped: tickets.length, filed: ticketId !== null, ticketId };
}
