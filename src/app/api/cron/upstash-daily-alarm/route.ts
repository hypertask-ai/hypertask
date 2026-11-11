import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { hasValidCronAuthorization } from "@/lib/cronAuthorization";
import { getRedis } from "@/lib/redis";
import {
  advanceDayCursor,
  parseTotalCommands,
  shouldFileDailyAlarm,
  UPSTASH_DAILY_REQUEST_ALARM,
  type DayCursor,
} from "@/lib/ops/upstashDailyAlarm";
import { createProvisionedTaskCore } from "@/utils/controllers/tasks/createTaskCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOARD_PROJECT_ID = 15;
const BOARD_SECTION_TITLE = "Bugs";
const MARKER = "htpr-8978-upstash-daily-alarm";
const CURSOR_KEY = "upstash:daily-commands:cursor";
const OPS_USER_ID = 332;

function readCursor(raw: string | null): DayCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { day?: unknown; startTotal?: unknown };
    if (typeof parsed.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.day)
      && typeof parsed.startTotal === "number" && Number.isSafeInteger(parsed.startTotal) && parsed.startTotal >= 0) {
      return { day: parsed.day, startTotal: parsed.startTotal };
    }
  } catch {
    return null;
  }
  return null;
}

async function filedTaskId(day: string): Promise<number | null> {
  const existing = await prisma.task.findFirst({
    where: { projectId: BOARD_PROJECT_ID, description_: { is: { content: { contains: `${MARKER}:${day}` } } } },
    select: { id: true },
  });
  return existing ? existing.id : null;
}

async function fileAlarm(day: string, commandsToday: number): Promise<number> {
  const project = await prisma.project.findFirst({
    where: { id: BOARD_PROJECT_ID, status: "Normal" },
    select: {
      uniqueIdentifier: true,
      section: { where: { deleted: false, visibility: true, section_title: BOARD_SECTION_TITLE }, select: { id: true, section_title: true }, take: 1 },
      labels: { where: { value: { in: ["Infra", "brain-medium"] } }, select: { id: true, value: true } },
    },
  });
  const section = project?.section[0];
  if (!project?.uniqueIdentifier || !section) {
    throw new Error("Upstash daily alarm cannot resolve the Bugs section on board 15");
  }
  if (!project.labels.some((label) => label.value === "brain-medium")) {
    throw new Error("Upstash daily alarm needs the existing brain-medium label");
  }
  const { task } = await createProvisionedTaskCore({
    title: `Upstash requests went above ${UPSTASH_DAILY_REQUEST_ALARM.toLocaleString("en-GB")} on ${day}`,
    description: `<p data-ht-marker="${MARKER}:${day}">Upstash handled ${commandsToday.toLocaleString("en-GB")} commands on ${day}, above the ${UPSTASH_DAILY_REQUEST_ALARM.toLocaleString("en-GB")} daily alarm.</p>`,
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
  if (!Number.isInteger(taskId) || taskId <= 0) throw new Error("Upstash daily alarm ticket was not created");
  return taskId;
}

export async function GET(request: NextRequest) {
  if (!hasValidCronAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ message: "unauthorized" }, { status: 401 });
  }
  if (process.env.NODE_ENV !== "production" || process.env.VERCEL_ENV !== "production") {
    return NextResponse.json({ checked: 0 });
  }
  const redis = await getRedis();
  const total = parseTotalCommands(String(await redis.info("stats")));
  if (total === null) {
    return NextResponse.json({ error: "missing total_commands_processed" }, { status: 503 });
  }
  const day = new Date().toISOString().slice(0, 10);
  const advanced = advanceDayCursor(readCursor(await redis.get(CURSOR_KEY)), day, total);
  await redis.set(CURSOR_KEY, JSON.stringify(advanced.cursor), "EX", 48 * 60 * 60);
  if (!shouldFileDailyAlarm(advanced.commandsToday)) {
    return NextResponse.json({ day, commandsToday: advanced.commandsToday, filedTaskId: null });
  }
  const existing = await filedTaskId(day);
  if (existing) return NextResponse.json({ day, commandsToday: advanced.commandsToday, filedTaskId: existing });
  const claimKey = `${MARKER}:claim:${day}`;
  const claimed = await redis.set(claimKey, "1", "EX", 26 * 60 * 60, "NX");
  if (claimed !== "OK") {
    return NextResponse.json({ day, commandsToday: advanced.commandsToday, filedTaskId: await filedTaskId(day) });
  }
  try {
    const filed = await fileAlarm(day, advanced.commandsToday!);
    return NextResponse.json({ day, commandsToday: advanced.commandsToday, filedTaskId: filed });
  } catch (error) {
    await redis.del(claimKey);
    console.error("[upstash-daily-alarm] filing failed", error);
    return NextResponse.json({ error: "alarm filing failed" }, { status: 503 });
  }
}
