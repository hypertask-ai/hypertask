import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";

import prisma from "@/lib/prisma";
import { handleSlackCommand } from "@/lib/slack/commandHandler";
import { verifySlackSignature } from "@/lib/slack/signature";
import { claimSlackEventOnce } from "@/lib/slack/taskCreateIntent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

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
    return new NextResponse("Invalid signature", { status: 401 });
  }

  const form = new URLSearchParams(rawBody);
  const responseUrl = form.get("response_url")?.trim();
  const slackTeamId = form.get("team_id")?.trim();
  const slackUserId = form.get("user_id")?.trim();
  const channelId = form.get("channel_id")?.trim();
  if (!responseUrl || !slackTeamId || !slackUserId || !channelId) {
    return new NextResponse("Invalid command payload", { status: 400 });
  }

  const triggerId = form.get("trigger_id")?.trim() || undefined;
  const receiptId = triggerId
    ? `slack-command:${triggerId}`
    : `slack-command:${createHash("sha256").update(rawBody).digest("hex")}`;
  waitUntil(
    claimSlackEventOnce(prisma, receiptId)
      .then((claimed) =>
        claimed
          ? handleSlackCommand(
              {
                channelId,
                responseUrl,
                slackTeamId,
                slackUserId,
                text: form.get("text") ?? "",
                triggerId,
              },
              new URL(request.url).origin,
            )
          : undefined,
      )
      .catch((error) => console.error("Slack slash command failed", error)),
  );

  return new NextResponse(null, { status: 200 });
}
