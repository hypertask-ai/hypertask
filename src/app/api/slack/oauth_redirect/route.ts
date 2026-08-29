import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { getServerCookieUser } from "@/lib/auth/serverUser";
import { encryptSecret } from "@/lib/crypto/byokCipher";
import { verifySlackOAuthState } from "@/lib/slack/oauthState";
import { hasTeamMembershipAccess } from "@/utils/controllers/teams/hasTeamMembershipAccess";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SlackOAuthResponse = {
  access_token?: string;
  bot_user_id?: string;
  error?: string;
  ok: boolean;
  team?: { id?: string; name?: string };
};

export async function GET(request: NextRequest) {
  const clientId = process.env.SLACK_CLIENT_ID?.trim();
  const clientSecret = process.env.SLACK_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return redirectWithError(request, "not_configured");
  }

  const state = verifySlackOAuthState(
    request.nextUrl.searchParams.get("state"),
    clientSecret,
  );
  if (!state) return redirectWithError(request, "invalid_state");

  const currentUser = await getServerCookieUser();
  if (currentUser && currentUser.id !== state.userId) {
    return redirectWithError(request, "user_mismatch");
  }
  if (!(await hasTeamMembershipAccess(state.userId, state.teamId))) {
    return redirectWithError(request, "team_access_denied");
  }

  const slackError = request.nextUrl.searchParams.get("error");
  if (slackError) return redirectWithError(request, slackError);

  const code = request.nextUrl.searchParams.get("code");
  if (!code) return redirectWithError(request, "missing_code");

  try {
    const redirectUri = new URL("/api/slack/oauth_redirect", request.url);
    const response = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri.toString(),
      }),
    });
    if (!response.ok) {
      throw new Error(`Slack token exchange failed (${response.status})`);
    }

    const result = (await response.json()) as SlackOAuthResponse;
    const slackTeamId = result.team?.id?.trim();
    const slackTeamName = result.team?.name?.trim();
    const botUserId = result.bot_user_id?.trim();
    const botToken = result.access_token?.trim();
    if (
      !result.ok ||
      !slackTeamId ||
      !slackTeamName ||
      !botUserId ||
      !botToken
    ) {
      console.error("Slack OAuth response was incomplete", result.error);
      return redirectWithError(request, result.error ?? "slack_failed");
    }

    const [existingWorkspace, existingTeamInstall] = await Promise.all([
      prisma.slackInstall.findUnique({
        where: { slackTeamId },
        select: { teamId: true },
      }),
      prisma.slackInstall.findUnique({
        where: { teamId: state.teamId },
        select: { slackTeamId: true },
      }),
    ]);
    if (existingWorkspace && existingWorkspace.teamId !== state.teamId) {
      return redirectWithError(request, "workspace_already_connected");
    }

    const encryptedBotToken = encryptSecret(botToken);
    const installData = {
      slackTeamId,
      slackTeamName,
      encryptedBotToken,
      botUserId,
      installedByUserId: state.userId,
    };
    if (
      existingTeamInstall &&
      existingTeamInstall.slackTeamId !== slackTeamId
    ) {
      // Replacing a workspace must also remove its old channel/thread checkpoints.
      await prisma.$transaction([
        prisma.slackInstall.delete({ where: { teamId: state.teamId } }),
        prisma.slackInstall.create({
          data: { ...installData, teamId: state.teamId },
        }),
      ]);
    } else {
      await prisma.slackInstall.upsert({
        where: { teamId: state.teamId },
        create: { ...installData, teamId: state.teamId },
        update: installData,
      });
    }

    const destination = new URL("/settings/slack", request.url);
    destination.searchParams.set("slack_success", "connected");
    return NextResponse.redirect(destination);
  } catch (error) {
    console.error("Slack OAuth callback failed", error);
    return redirectWithError(request, "server_error");
  }
}

function redirectWithError(request: NextRequest, error: string) {
  const destination = new URL("/settings/slack", request.url);
  destination.searchParams.set("slack_error", error);
  return NextResponse.redirect(destination);
}
