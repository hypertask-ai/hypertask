#!/usr/bin/env tsx

/**
 * One-time Turbopuffer backfill for task and comment search namespaces.
 *
 * Usage:
 *   npx tsx scripts/backfillTurbopuffer.ts
 */
import prisma from "@/lib/prisma";
import type { TurbopufferCommentRow } from "@/utils/controllers/turbopuffer/turbopufferHelper";
import {
  buildTurbopufferCommentRow,
  buildTurbopufferTaskRow,
  ensureTurbopufferSchema,
  turbopufferCommentInclude,
  turbopufferTaskInclude,
  upsertCommentRowsToTurbopuffer,
  upsertTaskRowsToTurbopuffer,
} from "@/utils/controllers/turbopuffer/turbopufferHelper";

const BATCH_SIZE = 256;

async function backfillTasks() {
  let lastId = 0;
  let total = 0;

  while (true) {
    const tasks = await prisma.task.findMany({
      where: {
        id: {
          gt: lastId,
        },
      },
      orderBy: {
        id: "asc",
      },
      take: BATCH_SIZE,
      include: turbopufferTaskInclude,
    });

    if (tasks.length === 0) break;

    const rows = tasks.map(buildTurbopufferTaskRow);
    await upsertTaskRowsToTurbopuffer(rows, { disableBackpressure: true });

    total += rows.length;
    lastId = tasks[tasks.length - 1].id;
    console.log(`Backfilled ${total} tasks`);
  }

  return total;
}

async function backfillComments() {
  let lastId = 0;
  let total = 0;

  while (true) {
    const comments = await prisma.comment.findMany({
      where: {
        id: {
          gt: lastId,
        },
      },
      orderBy: {
        id: "asc",
      },
      take: BATCH_SIZE,
      include: turbopufferCommentInclude,
    });

    if (comments.length === 0) break;

    const rows = comments
      .map(buildTurbopufferCommentRow)
      .filter((row): row is TurbopufferCommentRow => row !== null);

    await upsertCommentRowsToTurbopuffer(rows, { disableBackpressure: true });

    total += rows.length;
    lastId = comments[comments.length - 1].id;
    console.log(`Backfilled ${total} comments`);
  }

  return total;
}

async function main() {
  await ensureTurbopufferSchema();

  const taskCount = await backfillTasks();
  const commentCount = await backfillComments();

  console.log(
    `Turbopuffer backfill complete: ${taskCount} tasks, ${commentCount} comments`
  );
}

main()
  .catch((error) => {
    console.error("Turbopuffer backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
