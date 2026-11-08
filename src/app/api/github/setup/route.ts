import { NextRequest } from "next/server";

import {
  attemptCookieNonce,
  finishAttempt,
  getGithubConnectPrincipal,
  githubCallbackUrl,
  redirectWithAttempt,
  refusePrincipal,
} from "@/app/api/github/_lib";
import { getGithubAppConfig } from "@/lib/github/appConfig";
import { findBoardGithubAdmin } from "@/lib/github/installAuthority";
import {
  consumeGithubInstallNonce,
  createGithubInstallAttempt,
  githubPkceChallenge,
  githubPkceVerifier,
  isGithubId,
  verifyGithubInstallState,
} from "@/lib/github/oauthState";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";

export async function GET(request: NextRequest) {
  const principal = await getGithubConnectPrincipal(request);
  if (principal.status !== "allowed") return refusePrincipal(principal);

  const config = getGithubAppConfig();
  if (!config) return finishAttempt(request, null, { error: "not_configured" });

  const params = request.nextUrl.searchParams;
  const state = verifyGithubInstallState(
    params.get("state"),
    attemptCookieNonce(request),
    "install",
    config.stateSecret,
  );
  if (!state) return finishAttempt(request, null, { error: "invalid_state" });
  if (state.userId !== principal.userId) {
    return finishAttempt(request, null, { error: "user_mismatch" });
  }

  const consumed = await consumeGithubInstallNonce(state.nonce);
  if (consumed !== "consumed") {
    return finishAttempt(request, state.projectId, {
      error: consumed === "reused" ? "attempt_reused" : "unavailable",
    });
  }

  const admin = await findBoardGithubAdmin(principal.userId, state.projectId);
  if (!admin || admin.teamId !== state.teamId) {
    return finishAttempt(request, state.projectId, { error: "board_access_denied" });
  }

  const installationId = params.get("installation_id");
  if (params.get("setup_action") === "request" || !isGithubId(installationId)) {
    return finishAttempt(request, state.projectId, { status: "pending" });
  }

  const next = createGithubInstallAttempt(
    {
      installationId,
      phase: "authorize",
      projectId: state.projectId,
      teamId: state.teamId,
      userId: state.userId,
    },
    config.stateSecret,
  );
  const authorizeUrl = new URL(GITHUB_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", githubCallbackUrl(request));
  authorizeUrl.searchParams.set("state", next.state);
  authorizeUrl.searchParams.set(
    "code_challenge",
    githubPkceChallenge(githubPkceVerifier(next.nonce, config.stateSecret)),
  );
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  return redirectWithAttempt(request, authorizeUrl, next.nonce, 302);
}
