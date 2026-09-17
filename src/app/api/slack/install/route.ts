import { NextRequest, NextResponse } from "next/server";

import { getRequestBaseUrl } from "@/lib/auth/requestBaseUrl";
import { getServerCookieUser } from "@/lib/auth/serverUser";
import { createSlackOAuthState } from "@/lib/slack/oauthState";
import {
  findSoleAccessibleTeamId,
  hasTeamMembershipAccess,
} from "@/utils/controllers/teams/hasTeamMembershipAccess";

import { buildSlackAuthorizeUrl } from "@/lib/slack/authorize";
import { resolveSlackInstallTeamId } from "@/lib/slack/installTeam";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await getServerCookieUser();
  if (!user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("returnTo", "/settings/slack");
    return NextResponse.redirect(loginUrl);
  }

  const requestedTeamId = request.nextUrl.searchParams.get("teamId");
  const teamId = await resolveSlackInstallTeamId(
    user.id,
    requestedTeamId,
    hasTeamMembershipAccess,
    findSoleAccessibleTeamId,
  );
  if (!teamId) {
    return NextResponse.redirect(
      settingsRedirect(
        request,
        "error",
        requestedTeamId?.trim() ? "team_access_denied" : "missing_team",
      ),
    );
  }

  const clientSecret = process.env.SLACK_CLIENT_SECRET?.trim();
  const authorizeUrl = buildSlackAuthorizeUrl(getRequestBaseUrl(request));
  if (!clientSecret || !authorizeUrl) {
    console.error("Slack OAuth is not configured: SLACK_CLIENT_ID or SLACK_CLIENT_SECRET is missing");
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
