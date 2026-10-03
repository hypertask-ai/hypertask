import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { waitUntil } from "@vercel/functions";

import prisma from "@/lib/prisma";
import {
  isCreateTaskMention,
  isGeneralChatEvent,
  isHumanChannelMessage,
  routeSlackEvent,
  type SlackEvent,
} from "@/lib/slack/eventRouting";
import {
  extractSlackTaskReferences,
  filterSlackTaskIdsForTeam,
  hasSlackTaskReferences,
} from "@/lib/slack/references";
import { latestSlackTs } from "@/lib/slack/idle";
import { isSlackAppEnabled } from "@/lib/slack/feature";
import { saveSlackAssistantContext } from "@/lib/slack/assistant";
import { verifySlackSignature } from "@/lib/slack/signature";
import { claimSlackEventOnce } from "@/lib/slack/taskCreateIntent";
import { deleteSlackInstallForRevocation } from "@/lib/slack/uninstall";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type SlackEventEnvelope = {
  authorizations?: Array<{ team_id?: string }>;
  challenge?: string;
  event?: SlackEvent;
  event_id?: string;
  event_time?: number;
  team_id?: string;
  type?: string;
};

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (
    !verifySlackSignature(
      rawBody,
      request.headers.get("x-slack-signature"),
      request.headers.get("x-slack-request-timestamp"),
      process.env.SLACK_SIGNING_SECRET,
    )
  ) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: SlackEventEnvelope;
  try {
    payload = JSON.parse(rawBody) as SlackEventEnvelope;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (payload.type === "url_verification") {
    return NextResponse.json({ challenge: payload.challenge ?? "" });
  }
  if (payload.type !== "event_callback") {
    return NextResponse.json({ ok: true });
  }

  // HTPR-4857: the app left the workspace (or its bot token was revoked).
  // delete everything stored for that install. Retries stay harmless because
  // the second pass finds no install. A failure surfaces as 500 so Slack retries.
  if (
    payload.event?.type === "app_uninstalled" ||
    payload.event?.type === "tokens_revoked"
  ) {
    const result = await deleteSlackInstallForRevocation(prisma, payload);
    console.info(
      "Slack revocation handled",
      payload.team_id,
      payload.event.type,
      result,
    );
    if (
      result === "skipped_undecryptable" ||
      result === "skipped_missing_timestamp"
    ) {
      return NextResponse.json({ error: result }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  const slackTeamId =
    payload.team_id ?? payload.authorizations?.find((auth) => auth.team_id)?.team_id;
  if (!slackTeamId) return NextResponse.json({ ok: true });

  const eventRoute = routeSlackEvent(payload.event, true);
  if (
    eventRoute === "create_task" || eventRoute === "general_chat" ||
    eventRoute === "assistant_welcome" || eventRoute === "assistant_context"
  ) {
    const eventId = payload.event_id?.trim();
    if (!eventId || !(await claimSlackEventOnce(prisma, eventId))) {
      return NextResponse.json({ ok: true });
    }
    const event = payload.event!;
    // Email resolution can call Slack, so keep it after the acknowledgement.
    waitUntil(
      (async () => {
        const slackAppEnabled = await isSlackAppEnabled(
          slackTeamId,
          event.user ?? event.assistant_thread?.user_id,
        );
        const route = routeSlackEvent(event, slackAppEnabled);
        if (route === "create_task" && isCreateTaskMention(event)) {
          const { createSlackTaskFromThread } = await import("@/lib/slack/taskCreate");
          await createSlackTaskFromThread({
            channelId: event.channel,
            slackTeamId,
            slackUserId: event.user,
            threadTs: event.thread_ts ?? event.ts,
          });
        } else if (route === "general_chat" && isGeneralChatEvent(event)) {
          const { handleSlackChat } = await import("@/lib/slack/chat");
          await handleSlackChat({
            channelId: event.channel,
            channelType: event.channel_type,
            slackTeamId,
            slackUserId: event.user,
            text: event.text,
            threadTs: event.thread_ts ?? event.ts,
          });
        } else if (route === "assistant_welcome") {
          const thread = event.assistant_thread!;
          const { postSlackAssistantWelcome } = await import("@/lib/slack/chat");
          await postSlackAssistantWelcome({
            channelId: thread.channel_id!,
            slackTeamId,
            threadTs: thread.thread_ts!,
            ...(slackAppEnabled ? { assistantThread: thread } : {}),
          });
        } else if (route === "assistant_context") {
          const install = await prisma.slackInstall.findUnique({
            where: { slackTeamId }, select: { id: true },
          });
          if (install) await saveSlackAssistantContext(install.id, slackTeamId, event.assistant_thread!);
        }
      })().catch(() => console.error("Slack conversational event failed")),
    );
    return NextResponse.json({ ok: true });
  }

  if (eventRoute !== "ambient_message" || !isHumanChannelMessage(payload.event)) {
    return NextResponse.json({ ok: true });
  }

  const install = await prisma.slackInstall.findUnique({
    where: { slackTeamId },
    select: { id: true, teamId: true },
  });
  if (!install) return NextResponse.json({ ok: true });

  const event = payload.event;
  const channelId = event.channel;
  const messageTs = event.ts;
  const threadTs = event.thread_ts ?? messageTs;
  const key = {
    installId_channelId_threadTs: {
      installId: install.id,
      channelId,
      threadTs,
    },
  };
  const existing = await prisma.slackWatchedThread.findUnique({ where: key });
  const refs = extractSlackTaskReferences(event.text ?? "");

  let matchedTaskIds: number[] = [];
  if (hasSlackTaskReferences(refs)) {
    const or: Prisma.TaskWhereInput[] = [];
    if (refs.ticketNumbers.length) {
      or.push({ ticketNumber: { in: refs.ticketNumbers } });
    }
    or.push(
      ...refs.taskUrls.map(({ projectId, uniqueIndex }) => ({
        projectId,
        uniqueIndex,
      })),
    );
    const matches = await prisma.task.findMany({
      where: {
        OR: or,
        status: { not: "Deleted" },
        project: { teamId: install.teamId },
      },
      select: { id: true, project: { select: { teamId: true } } },
    });
    // Defense in depth: never persist a task id whose resolved project belongs
    // to a different team, even if the query above changes later.
    matchedTaskIds = filterSlackTaskIdsForTeam(matches, install.teamId);
  }

  if (!existing && matchedTaskIds.length === 0) {
    return NextResponse.json({ ok: true });
  }

  const combinedTaskIds = [
    ...new Set([...(existing?.matchedTaskIds ?? []), ...matchedTaskIds]),
  ];
  await prisma.slackWatchedThread.upsert({
    where: key,
    create: {
      installId: install.id,
      channelId,
      threadTs,
      matchedTaskIds: combinedTaskIds,
      lastMessageTs: messageTs,
    },
    update: {
      matchedTaskIds: { set: combinedTaskIds },
      lastMessageTs: existing
        ? latestSlackTs(existing.lastMessageTs, messageTs)
        : messageTs,
    },
  });

  return NextResponse.json({ ok: true });
}
