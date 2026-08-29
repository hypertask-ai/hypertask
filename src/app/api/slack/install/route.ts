import { NextRequest, NextResponse } from "next/server";

import { getServerCookieUser } from "@/lib/auth/serverUser";
import { createSlackOAuthState } from "@/lib/slack/oauthState";
import { hasTeamMembershipAccess } from "@/utils/controllers/teams/hasTeamMembershipAccess";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// users:read is required by the cron worker's users.info calls.
const SLACK_BOT_SCOPES = [
  "app_mentions:read",
  "assistant:write",
  "channels:history",
  "commands",
  "groups:history",
  "im:history",
  "chat:write",
  "team:read",
  "users:read",
  "users:read.email",
];

export async function GET(request: NextRequest) {
  const user = await getServerCookieUser();
  if (!user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("returnTo", "/settings/slack");
    return NextResponse.redirect(loginUrl);
  }

  const teamId = request.nextUrl.searchParams.get("teamId")?.trim();
  if (!teamId) {
    return NextResponse.redirect(
      settingsRedirect(request, "error", "missing_team"),
    );
  }
  if (!(await hasTeamMembershipAccess(user.id, teamId))) {
    return NextResponse.redirect(
      settingsRedirect(request, "error", "team_access_denied"),
    );
  }

  const clientId = process.env.SLACK_CLIENT_ID?.trim();
  const clientSecret = process.env.SLACK_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    console.error("Slack OAuth is missing SLACK_CLIENT_ID or SLACK_CLIENT_SECRET");
    return NextResponse.redirect(
      settingsRedirect(request, "error", "not_configured"),
    );
  }

  const redirectUri = new URL("/api/slack/oauth_redirect", request.url);
  const authorizeUrl = new URL("https://slack.com/oauth/v2/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("scope", SLACK_BOT_SCOPES.join(","));
  authorizeUrl.searchParams.set("redirect_uri", redirectUri.toString());
  authorizeUrl.searchParams.set(
    "state",
    createSlackOAuthState({ teamId, userId: user.id }, clientSecret),
  );

  return NextResponse.redirect(authorizeUrl);
}

function settingsRedirect(
  request: NextRequest,
  key: "error" | "success",
  value: string,
): URL {
  const url = new URL("/settings/slack", request.url);
  url.searchParams.set(`slack_${key}`, value);
  return url;
}
