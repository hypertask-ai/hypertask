import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { createProvisionedTaskCore } from "@/utils/controllers/tasks/createTaskCore";
import { createAnnouncement } from "@/utils/controllers/announcements/createAnnouncement";
import { escapeHtml } from "@/utils/htmlEscape";
import {
  buildDigestEntries,
  DIGEST_VERSION,
  type DigestEntry,
  type ShippedTicket,
} from "./entries";
import {
  ALARM_LABEL_VALUES,
  ALARM_PRIORITY_INDEX,
  ALARM_PROJECT_ID,
  ALARM_SECTION_TITLE,
  DIGEST_PROJECT_ID,
  RELEASE_SECTION_TITLES,
} from "./selection";
import { announcementDigest } from "./cursor";
import { announcedTicketIds, selectShippedTickets } from "./shipped";

const DAY_MS = 24 * 60 * 60 * 1000;
const BACKFILL_DAYS = 45;
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
  cleared: number;
  posted: number;
};

export type FreshnessCheck = {
  newestEntryAt: string | null;
  lastRunAt: string | null;
  staleDays: number;
  shipped: number;
  filed: boolean;
  ticketId: number | null;
};

function newestOf(dates: readonly Date[]): Date | null {
  if (!dates.length) return null;
  return new Date(Math.max(...dates.map((date) => date.getTime())));
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

function digestVersion(body: unknown): number | null {
  if (!announcementDigest(body)) return null;
  const version = (announcementDigest(body) as { version?: unknown }).version;
  return typeof version === "number" ? version : 0;
}

async function outdatedDigestEntryIds(since: Date): Promise<number[]> {
  const rows = await prisma.announcments.findMany({
    where: { createdAt: { gte: since } },
    select: { id: true, body: true },
  });
  return rows
    .filter((row) => {
      const version = digestVersion(row.body);
      return version !== null && version < DIGEST_VERSION;
    })
    .map((row) => row.id);
}

async function dropOutdatedDigestEntries(outdated: number[]): Promise<number> {
  if (outdated.length) {
    await prisma.$transaction([
      prisma.userAnnouncement.deleteMany({ where: { announcementId: { in: outdated } } }),
      prisma.announcments.deleteMany({ where: { id: { in: outdated } } }),
    ]);
  }
  return outdated.length;
}

export async function lastDigestRunAt(): Promise<Date | null> {
  const redis = await getRedis();
  const recorded = await redis.get("rocket-digest:last-run");
  if (recorded) {
    const date = new Date(recorded);
    if (!Number.isNaN(date.getTime())) return date;
  }
  const rows = await prisma.announcments.findMany({
    where: { createdAt: { gte: new Date(Date.now() - BACKFILL_DAYS * DAY_MS) } },
    select: { body: true },
  });
  const runAt = rows
    .map((row) => announcementDigest(row.body)?.runAt)
    .filter((value): value is string => typeof value === "string")
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()));
  return newestOf(runAt);
}

function announcementBody(entry: DigestEntry, runAt: Date) {
  return {
    title: entry.title,
    content: entry.content,
    digest: {
      version: DIGEST_VERSION,
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
  const since = new Date(now.getTime() - BACKFILL_DAYS * DAY_MS);
  const outdated = await outdatedDigestEntryIds(since);
  const announced = await announcedTicketIds(outdated);
  const tickets = await selectShippedTickets(DIGEST_PROJECT_ID, since, now, announced);
  const entries = buildDigestEntries(
    tickets,
    outdated.length ? { maxTopics: Number.MAX_SAFE_INTEGER } : {},
  );
  let cleared = 0;
  let posted = 0;

  if (!dryRun && (entries.length || outdated.length)) {
    if (!(await claim("rocket-digest:run", now, RUN_CLAIM_SECONDS))) {
      return {
        skipped: true,
        since: since.toISOString(),
        until: now.toISOString(),
        shipped: 0,
        entries: [],
        cleared,
        posted: 0,
      };
    }
    for (const entry of entries) {
      await createAnnouncement({ body: announcementBody(entry, now), createdAt: entry.releasedAt });
      posted += 1;
    }
    cleared = await dropOutdatedDigestEntries(outdated);
  }
  if (!dryRun) {
    const redis = await getRedis();
    await redis.set("rocket-digest:last-run", now.toISOString(), "EX", 90 * DAY_MS / 1000);
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
    cleared,
    posted,
  };
}

function alarmTitle(staleDays: number, shipped: number): string {
  return `Latest Updates has posted nothing for ${Math.max(1, Math.floor(staleDays))} days while ${shipped} changes shipped`;
}

function alarmDescription(
  staleDays: number,
  shipped: number,
  newestEntryAt: Date | null,
  lastRunAt: Date | null,
) {
  return (
    `<p><strong>${escapeHtml(alarmTitle(staleDays, shipped))}</strong></p><ul>` +
    `<li>Newest panel entry: ${escapeHtml(newestEntryAt?.toISOString() ?? "none")}.</li>` +
    `<li>Last digest run: ${escapeHtml(lastRunAt?.toISOString() ?? "never")}.</li>` +
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
  lastRunAt: Date | null,
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
    description: alarmDescription(staleDays, tickets.length, newestEntryAt, lastRunAt),
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
  const lastRunAt = await lastDigestRunAt();
  const since = newestEntryAt ?? new Date(now.getTime() - BACKFILL_DAYS * DAY_MS);
  const staleDays = newestEntryAt
    ? (now.getTime() - newestEntryAt.getTime()) / DAY_MS
    : BACKFILL_DAYS;
  const quiet: FreshnessCheck = {
    newestEntryAt: newestEntryAt?.toISOString() ?? null,
    lastRunAt: lastRunAt?.toISOString() ?? null,
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

  const ticketId = await fileAlarm(staleDays, tickets, newestEntryAt, lastRunAt);
  return { ...quiet, shipped: tickets.length, filed: ticketId !== null, ticketId };
}
