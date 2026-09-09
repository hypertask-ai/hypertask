import { NextRequest, NextResponse } from "next/server";

import { getServerCookieUser } from "@/lib/auth/serverUser";
import { createSlackOAuthState } from "@/lib/slack/oauthState";
import { hasTeamMembershipAccess } from "@/utils/controllers/teams/hasTeamMembershipAccess";

import { buildSlackAuthorizeUrl } from "@/lib/slack/authorize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

  const clientSecret = process.env.SLACK_CLIENT_SECRET?.trim();
  const authorizeUrl = buildSlackAuthorizeUrl(new URL(request.url).origin);
  if (!clientSecret || !authorizeUrl) {
    console.error("Slack OAuth is missing SLACK_CLIENT_ID or SLACK_CLIENT_SECRET");
    return NextResponse.redirect(
      settingsRedirect(request, "error", "not_configured"),
    );
  }

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
