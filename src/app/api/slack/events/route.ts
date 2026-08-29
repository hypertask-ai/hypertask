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
import { verifySlackSignature } from "@/lib/slack/signature";
import { claimSlackEventOnce } from "@/lib/slack/taskCreateIntent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type SlackEventEnvelope = {
  authorizations?: Array<{ team_id?: string }>;
  challenge?: string;
  event?: SlackEvent;
  event_id?: string;
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

  const slackTeamId =
    payload.team_id ?? payload.authorizations?.find((auth) => auth.team_id)?.team_id;
  if (!slackTeamId) return NextResponse.json({ ok: true });

  const eventRoute = routeSlackEvent(payload.event);
  if (eventRoute === "create_task" && isCreateTaskMention(payload.event)) {
    const eventId = payload.event_id?.trim();
    if (!eventId || !(await claimSlackEventOnce(prisma, eventId))) {
      return NextResponse.json({ ok: true });
    }
    const event = payload.event;
    waitUntil(
      import("@/lib/slack/taskCreate")
        .then(({ createSlackTaskFromThread }) =>
          createSlackTaskFromThread({
            channelId: event.channel,
            slackTeamId,
            slackUserId: event.user,
            threadTs: event.thread_ts ?? event.ts,
          }),
        )
        .catch((error) => console.error("Slack create-task event failed", error)),
    );
    return NextResponse.json({ ok: true });
  }

  if (eventRoute === "general_chat" && isGeneralChatEvent(payload.event)) {
    const eventId = payload.event_id?.trim();
    if (!eventId || !(await claimSlackEventOnce(prisma, eventId))) {
      return NextResponse.json({ ok: true });
    }
    const event = payload.event;
    waitUntil(
      import("@/lib/slack/chat")
        .then(({ handleSlackChat }) =>
          handleSlackChat({
            channelId: event.channel,
            channelType: event.channel_type,
            slackTeamId,
            slackUserId: event.user,
            text: event.text,
            threadTs: event.thread_ts ?? event.ts,
          }),
        )
        .catch((error) => console.error("Slack chat event failed", error)),
    );
    return NextResponse.json({ ok: true });
  }

  if (eventRoute === "assistant_welcome") {
    const eventId = payload.event_id?.trim();
    if (!eventId || !(await claimSlackEventOnce(prisma, eventId))) {
      return NextResponse.json({ ok: true });
    }
    const thread = payload.event?.assistant_thread;
    waitUntil(
      import("@/lib/slack/chat")
        .then(({ postSlackAssistantWelcome }) =>
          postSlackAssistantWelcome({
            channelId: thread!.channel_id!,
            slackTeamId,
            threadTs: thread!.thread_ts!,
          }),
        )
        .catch((error) => console.error("Slack assistant welcome failed", error)),
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
