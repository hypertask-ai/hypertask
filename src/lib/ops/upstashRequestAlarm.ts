import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { createProvisionedTaskCore } from "@/utils/controllers/tasks/createTaskCore";

const BOARD_PROJECT_ID = 15;
const BOARD_SECTION_TITLE = "Bugs";
const BOARD_LABEL_VALUE = "Infra";
const OPS_USER_ID = 332;
const SAMPLE_KEY = "upstash:requests:sample";
const SAMPLE_TTL_SECONDS = 2 * 60 * 60;
const MIN_SAMPLE_AGE_MS = 30 * 60 * 1000;
const MARKER = "htpr-8978-upstash-request-alarm";

export const UPSTASH_DAILY_REQUEST_ALARM = 300_000;

export function parseTotalCommands(info: string): number | null {
  const match = /^total_commands_processed:(\d+)\s*$/m.exec(info);
  if (!match) return null;
  const total = Number(match[1]);
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}

export function projectDailyRequests(delta: number, elapsedMs: number): number {
  if (!(elapsedMs > 0) || !(delta >= 0) || !Number.isFinite(delta)) return 0;
  return Math.round((delta / elapsedMs) * 86_400_000);
}

async function findTicket(marker: string) {
  const existing = await prisma.task.findFirst({
    where: { projectId: BOARD_PROJECT_ID, description_: { is: { content: { contains: marker } } } },
    select: { id: true },
  });
  return existing ? existing.id : null;
}

async function createTicket(day: string, projected: number) {
  const project = await prisma.project.findFirst({
    where: { id: BOARD_PROJECT_ID, status: "Normal" },
    select: {
      uniqueIdentifier: true,
      section: { where: { deleted: false, visibility: true, section_title: BOARD_SECTION_TITLE }, select: { id: true, section_title: true }, take: 1 },
      labels: { where: { value: BOARD_LABEL_VALUE }, select: { id: true }, take: 1 },
    },
  });
  const section = project?.section[0];
  if (!project?.uniqueIdentifier || !section) {
    throw new Error("Upstash request alarm cannot resolve the Bugs section on board 15");
  }
  const { task } = await createProvisionedTaskCore({
    title: `Upstash requests projected above ${UPSTASH_DAILY_REQUEST_ALARM.toLocaleString("en-GB")} a day on ${day}`,
    description: `<p data-ht-marker="${MARKER}">Upstash projects ${projected.toLocaleString("en-GB")} requests for ${day}, above the ${UPSTASH_DAILY_REQUEST_ALARM.toLocaleString("en-GB")} a day alarm, from <code>INFO total_commands_processed</code> between cron runs.</p><p data-ht-marker="${MARKER}:${day}"></p>`,
    userId: OPS_USER_ID,
    creationChannel: "api",
    projectId: BOARD_PROJECT_ID,
    sectionId: section.id,
    sectionTitle: section.section_title,
    projectIdentifier: project.uniqueIdentifier,
    priorityIndex: 1,
    labelIds: project.labels.map((label) => label.id),
    createDrafts: false,
  });
  const taskId = Number(task.id);
  if (!Number.isInteger(taskId) || taskId <= 0) throw new Error("Upstash request alarm ticket was not created");
  return taskId;
}

export async function checkUpstashDailyRequests() {
  const redis = await getRedis();
  const total = parseTotalCommands(String(await redis.info("stats")));
  if (total === null) {
    console.error("[upstash-alarm] INFO stats carried no total_commands_processed");
    return { total: null, projectedDailyRequests: null, alarm: false, filedTaskId: null, reason: "no-total" };
  }

  const now = Date.now();
  const raw = await redis.get(SAMPLE_KEY);
  await redis.set(SAMPLE_KEY, JSON.stringify({ at: now, total }), "EX", SAMPLE_TTL_SECONDS);

  let previous: { at: number; total: number } | null = null;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { at?: unknown; total?: unknown };
      if (typeof parsed.at === "number" && typeof parsed.total === "number") {
        previous = { at: parsed.at, total: parsed.total };
      }
    } catch {
      previous = null;
    }
  }
  if (!previous) {
    return { total, projectedDailyRequests: null, alarm: false, filedTaskId: null, reason: "first-sample" };
  }

  const elapsedMs = now - previous.at;
  if (elapsedMs < MIN_SAMPLE_AGE_MS) {
    return { total, projectedDailyRequests: null, alarm: false, filedTaskId: null, reason: "sample-too-fresh" };
  }

  const projected = projectDailyRequests(total - previous.total, elapsedMs);
  if (projected <= UPSTASH_DAILY_REQUEST_ALARM) {
    return { total, projectedDailyRequests: projected, alarm: false, filedTaskId: null, reason: "under-alarm" };
  }

  const day = new Date().toISOString().slice(0, 10);
  const marker = `${MARKER}:${day}`;
  const existing = await findTicket(marker);
  if (existing) {
    return { total, projectedDailyRequests: projected, alarm: true, filedTaskId: existing, reason: "already-filed" };
  }
  const claimed = await redis.set(`${MARKER}:claim:${day}`, "1", "EX", 25 * 60 * 60, "NX");
  if (claimed !== "OK") {
    const raced = await findTicket(marker);
    return { total, projectedDailyRequests: projected, alarm: true, filedTaskId: raced, reason: raced ? "already-filed" : "filing-in-flight" };
  }
  const filedTaskId = await createTicket(day, projected);
  return { total, projectedDailyRequests: projected, alarm: true, filedTaskId, reason: "filed" };
}
