#!/usr/bin/env tsx
import { logger as htLogger } from "#logger";

import { ensureSweepSchedule } from "@/lib/qstashSweepSchedule";

/**
 * Fallback registration for the sweep's QStash cron schedule.
 * The source of truth is startup registration via src/instrumentation.ts.
 * This script is safe to re-run because it upserts a stable QStash schedule id:
 *
 *   tsx src/scripts/register-sweep-schedule.ts
 */
async function registerSweepSchedule() {
  try {
    const schedule = await ensureSweepSchedule();

    htLogger.info("✅ Sweep schedule ensured");
    htLogger.info("   scheduleId:", schedule.scheduleId);
    htLogger.info("   destination:", schedule.destination);
    htLogger.info("   cron:", schedule.cron);
    process.exit(0);
  } catch (error) {
    htLogger.error("❌ Failed to ensure sweep schedule:", error);
    process.exit(1);
  }
}

registerSweepSchedule();
