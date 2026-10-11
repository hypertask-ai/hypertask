import { NextRequest, NextResponse } from "next/server";

import { createCommentService } from "@/utils/controllers/comments/createCommentService";
import { generalConfig } from "@/lib/configs/general.config";
import { hasValidCronAuthorization } from "@/lib/cronAuthorization";
import { decryptSecret } from "@/lib/crypto/byokCipher";
import prisma from "@/lib/prisma";
import {
  needsSlackThreadSummary,
  slackIdleCutoffTs,
} from "@/lib/slack/idle";
import { batchBackgroundAiEnabled } from "@/app/api/ai/_lib/planGate";
import {
  prepareSlackSummaryForBatch,
  submitSlackSummaryBatches,
  type SlackBatchEntry,
} from "@/lib/slack/threadSummaryBatch";
import {
  buildSlackThreadSummaryComment,
  type SlackThreadSource,
} from "@/lib/slack/threadSummary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (
    !hasValidCronAuthorization(
      request.headers.get("authorization"),
      process.env.CRON_SECRET,
    )
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const nowMs = Date.now();
  const candidates = await prisma.slackWatchedThread.findMany({
    where: { lastMessageTs: { lte: slackIdleCutoffTs(nowMs) }, summaryBatchId: null },
    orderBy: { lastMessageTs: "asc" },
    take: 50,
    include: {
      install: {
        include: {
          team: { select: { aiProviderSettings: true } },
        },
      },
    },
  });
  const threads = candidates.filter((thread) =>
    needsSlackThreadSummary(thread, nowMs),
  );
  const botUser = await prisma.user.findUnique({
    where: { id: generalConfig.hyperAiId },
    select: { id: true, email: true, displayName: true, photoURL: true },
  });
  if (!botUser) {
    return NextResponse.json(
      { error: "HyperAI user not found" },
      { status: 500 },
    );
  }

  const failures: string[] = [];
  const userNameCache = new Map<string, Promise<string>>();
  let summarized = 0;
  const batchEntries: SlackBatchEntry[] = [];

  for (const thread of threads) {
    try {
      const tasks = await prisma.task.findMany({
        where: {
          id: { in: thread.matchedTaskIds },
          status: { not: "Deleted" },
          project: { teamId: thread.install.teamId },
        },
        select: { id: true, projectId: true, userId: true },
      });
      if (tasks.length === 0) {
        await markThreadSummarized(thread.id, thread.lastMessageTs);
        continue;
      }

      const projectIds = [...new Set(tasks.map((task) => task.projectId))];
      const summaryContext = {
        aiProviderSettings: thread.install.team.aiProviderSettings,
        botToken: decryptSecret(thread.install.encryptedBotToken),
        channelId: thread.channelId,
        installedByUserId: thread.install.installedByUserId,
        projectId: projectIds.length === 1 ? projectIds[0] : null,
        taskId: tasks.length === 1 ? tasks[0].id : null,
        teamId: thread.install.teamId,
        threadTs: thread.threadTs,
        userNameCache,
      };
      // HTPR-7098: with the flag on, the summary waits in a half-price batch instead of running now.
      // Teams on their own AI key get `instant` back and keep the existing path.
      let source: SlackThreadSource | undefined;
      if (await batchBackgroundAiEnabled(thread.install.installedByUserId)) {
        const prepared = await prepareSlackSummaryForBatch(summaryContext, thread, tasks.map((task) => task.id));
        if (prepared.type === "empty") {
          await markThreadSummarized(thread.id, thread.lastMessageTs);
          continue;
        }
        if (prepared.type === "batch") {
          batchEntries.push(prepared.entry);
          continue;
        }
        source = prepared.source;
      }
      const commentText = await buildSlackThreadSummaryComment({ ...summaryContext, source });
      if (!commentText) {
        await markThreadSummarized(thread.id, thread.lastMessageTs);
        continue;
      }

      for (const task of tasks) {
        await createCommentService({
          text: commentText,
          creatorId: botUser.id,
          taskId: task.id,
          ownerId: task.userId,
          currentUser: botUser,
          agentId: null,
          processTaskReferences: false,
          trustedCaller: true,
        });
      }
      await markThreadSummarized(thread.id, thread.lastMessageTs);
      summarized += 1;
    } catch (error) {
      failures.push(thread.id);
      console.error(`Slack thread summary failed for ${thread.id}`, error);
    }
  }

  const batched = await submitSlackSummaryBatches(batchEntries);
  failures.push(...batched.failed);

  return NextResponse.json({
    candidates: threads.length,
    summarized,
    batched: batched.queued.length,
    failed: failures,
  });
}

async function markThreadSummarized(id: string, lastMessageTs: string) {
  await prisma.slackWatchedThread.update({
    where: { id },
    data: { lastSummarizedTs: lastMessageTs },
  });
}
