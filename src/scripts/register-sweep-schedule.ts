#!/usr/bin/env tsx

import { ensureSweepSchedule } from "@/lib/qstashSweepSchedule";

async function registerSweepSchedule() {
  try {
    const schedule = await ensureSweepSchedule();

    console.log("✅ Sweep schedule ensured");
    console.log("   scheduleId:", schedule.scheduleId);
    console.log("   destination:", schedule.destination);
    console.log("   cron:", schedule.cron);
    process.exit(0);
  } catch (error) {
    console.error("❌ Failed to ensure sweep schedule:", error);
    process.exit(1);
  }
}

registerSweepSchedule();
