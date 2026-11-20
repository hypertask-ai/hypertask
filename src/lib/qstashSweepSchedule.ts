import { createHash } from "node:crypto";
import { getQstashClient, qstashCallbackBase } from "@/lib/qstash";
import { getRedis } from "@/lib/redis";

export const SWEEP_QUEUE_PATH = "/api/queues/sweep";
export const SWEEP_SCHEDULE_CRON = "* * * * *";
export const SWEEP_SCHEDULE_ID =
  process.env.QSTASH_SWEEP_SCHEDULE_ID?.trim() || "hypertask-sweep-v1";

export function shouldAutoEnsureSweepSchedule() {
  if (process.env.QSTASH_AUTO_REGISTER_SWEEP === "false") return false;
  if (process.env.QSTASH_AUTO_REGISTER_SWEEP === "true") return true;

  if (process.env.VERCEL_ENV === "preview") return false;

  return process.env.NODE_ENV === "production";
}

export const SWEEP_SCHEDULE_REGISTRATION_WINDOW_SECONDS = 60 * 60;

export function sweepScheduleRegistrationKey() {
  const callbackBase = createHash("sha256")
    .update(qstashCallbackBase())
    .digest("hex")
    .slice(0, 16);
  return `qstash:sweep-schedule:registered:${SWEEP_SCHEDULE_ID}:${callbackBase}`;
}

function isRateLimited(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error && error.status === 429;
}

export async function ensureSweepScheduleOncePerWindow() {
  const redis = await getRedis();
  const key = sweepScheduleRegistrationKey();
  const claimed = await redis.set(
    key,
    "1",
    "EX",
    SWEEP_SCHEDULE_REGISTRATION_WINDOW_SECONDS,
    "NX",
  );
  if (claimed !== "OK") {
    return { registered: false as const, reason: "already-registered-this-window" as const };
  }
  try {
    return { registered: true as const, ...(await ensureSweepSchedule()) };
  } catch (error) {
    if (!isRateLimited(error)) await redis.del(key).catch(() => undefined);
    throw error;
  }
}

export async function ensureSweepSchedule() {
  const destination = `${qstashCallbackBase()}${SWEEP_QUEUE_PATH}`;
  const schedule = await getQstashClient().schedules.create({
    scheduleId: SWEEP_SCHEDULE_ID,
    destination,
    cron: SWEEP_SCHEDULE_CRON,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ schedule: SWEEP_SCHEDULE_ID }),
  });

  return {
    scheduleId: schedule.scheduleId,
    destination,
    cron: SWEEP_SCHEDULE_CRON,
  };
}
