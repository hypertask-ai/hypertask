import { getQstashClient, qstashCallbackBase } from "@/lib/qstash";

export const SWEEP_QUEUE_PATH = "/api/queues/sweep";
export const SWEEP_SCHEDULE_CRON = "* * * * *";
export const SWEEP_SCHEDULE_ID =
  process.env.QSTASH_SWEEP_SCHEDULE_ID?.trim() || "hypertask-sweep-v1";

export function shouldAutoEnsureSweepSchedule() {
  if (process.env.QSTASH_AUTO_REGISTER_SWEEP === "false") return false;
  if (process.env.QSTASH_AUTO_REGISTER_SWEEP === "true") return true;

  // Preview deployments share production data. Do not let a preview URL replace
  // the live schedule destination unless explicitly requested.
  if (process.env.VERCEL_ENV === "preview") return false;

  return process.env.NODE_ENV === "production";
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
