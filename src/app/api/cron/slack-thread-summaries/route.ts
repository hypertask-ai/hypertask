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
import { buildSlackThreadSummaryComment } from "@/lib/slack/threadSummary";

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
    where: { lastMessageTs: { lte: slackIdleCutoffTs(nowMs) } },
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
      const commentText = await buildSlackThreadSummaryComment({
        aiProviderSettings: thread.install.team.aiProviderSettings,
        botToken: decryptSecret(thread.install.encryptedBotToken),
        channelId: thread.channelId,
        installedByUserId: thread.install.installedByUserId,
        projectId: projectIds.length === 1 ? projectIds[0] : null,
        taskId: tasks.length === 1 ? tasks[0].id : null,
        teamId: thread.install.teamId,
        threadTs: thread.threadTs,
        userNameCache,
      });
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

  return NextResponse.json({
    candidates: threads.length,
    summarized,
    failed: failures,
  });
}

async function markThreadSummarized(id: string, lastMessageTs: string) {
  await prisma.slackWatchedThread.update({
    where: { id },
    data: { lastSummarizedTs: lastMessageTs },
  });
}
