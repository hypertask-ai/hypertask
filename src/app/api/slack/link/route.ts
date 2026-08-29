import { NextRequest, NextResponse } from "next/server";

import { getServerCookieUser } from "@/lib/auth/serverUser";
import prisma from "@/lib/prisma";
import {
  createSlackLinkConfirmation,
  consumeSlackLinkState,
  verifySlackLinkState,
} from "@/lib/slack/linkState";
import { claimSlackEventOnce } from "@/lib/slack/taskCreateIntent";
import { isSlackInstallTeamMember } from "@/lib/slack/userLink";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = await getServerCookieUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url), 303);

  const form = await request.formData();
  const rawState = form.get("state");
  const serializedState = typeof rawState === "string" ? rawState : null;
  const verifiedState = verifySlackLinkState(
    serializedState,
    process.env.SLACK_CLIENT_SECRET,
  );
  if (!verifiedState) return resultRedirect(request, "invalid");
  if (!(await isSlackInstallTeamMember(verifiedState.installId, user.id))) {
    return resultRedirect(request, "team_access_denied");
  }
  const state = await consumeSlackLinkState(
    serializedState,
    process.env.SLACK_CLIENT_SECRET,
    (receiptId) => claimSlackEventOnce(prisma, receiptId),
  );
  if (!state) return resultRedirect(request, "invalid");

  const secret = process.env.SLACK_CLIENT_SECRET?.trim();
  if (!secret) return resultRedirect(request, "server_error");
  const confirmation = createSlackLinkConfirmation(
    {
      installId: state.installId,
      slackUserId: state.slackUserId,
      userId: user.id,
    },
    secret,
  );
  const url = new URL("/settings/slack/link", request.url);
  url.searchParams.set("confirmation", confirmation);
  return NextResponse.redirect(url, 303);
}

function resultRedirect(request: NextRequest, status: string) {
  const url = new URL("/settings/slack/link", request.url);
  url.searchParams.set("status", status);
  return NextResponse.redirect(url, 303);
}
