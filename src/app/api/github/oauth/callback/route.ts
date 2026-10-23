import { NextRequest } from "next/server";

import {
  attemptCookieNonce,
  finishAttempt,
  getGithubConnectPrincipal,
  githubCallbackUrl,
  refusePrincipal,
} from "@/app/api/github/_lib";
import { adoptGithubInstallation } from "@/lib/github/adoptInstallation";
import { getGithubAppConfig } from "@/lib/github/appConfig";
import {
  findBoardGithubAdmin,
  proveGithubInstallationOwner,
} from "@/lib/github/installAuthority";
import {
  consumeGithubInstallNonce,
  githubPkceVerifier,
  verifyGithubInstallState,
} from "@/lib/github/oauthState";
import {
  exchangeGithubUserCode,
  fetchGithubUser,
  findGithubUserInstallation,
  GithubRequestError,
} from "@/lib/github/userApi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_CODE_LENGTH = 512;

export async function GET(request: NextRequest) {
  const principal = await getGithubConnectPrincipal(request);
  if (principal.status !== "allowed") return refusePrincipal(principal);

  const config = await getGithubAppConfig();
  if (!config) return finishAttempt(request, null, { error: "not_configured" });

  const params = request.nextUrl.searchParams;
  const state = verifyGithubInstallState(
    params.get("state"),
    attemptCookieNonce(request),
    "authorize",
    config.stateSecret,
  );
  if (!state || !state.installationId) {
    return finishAttempt(request, null, { error: "invalid_state" });
  }
  if (state.userId !== principal.userId) {
    return finishAttempt(request, null, { error: "user_mismatch" });
  }

  const consumed = await consumeGithubInstallNonce(state.nonce);
  if (consumed !== "consumed") {
    return finishAttempt(request, state.projectId, {
      error: consumed === "reused" ? "attempt_reused" : "unavailable",
    });
  }

  if (params.get("error")) {
    return finishAttempt(request, state.projectId, {
      error: params.get("error") === "access_denied" ? "access_denied" : "github_refused",
    });
  }
  const code = params.get("code")?.trim();
  if (!code || code.length > MAX_CODE_LENGTH) {
    return finishAttempt(request, state.projectId, { error: "missing_code" });
  }

  const admin = await findBoardGithubAdmin(principal.userId, state.projectId);
  if (!admin || admin.teamId !== state.teamId) {
    return finishAttempt(request, state.projectId, { error: "board_access_denied" });
  }

  try {
    const userToken = await exchangeGithubUserCode(
      {
        code,
        codeVerifier: githubPkceVerifier(state.nonce, config.stateSecret),
        redirectUri: githubCallbackUrl(request),
      },
      config,
    );
    const githubUser = await fetchGithubUser(userToken);
    const installation = await findGithubUserInstallation(userToken, state.installationId);
    if (!installation) return finishAttempt(request, state.projectId, { status: "pending" });

    const proof = await proveGithubInstallationOwner({
      appId: config.appId,
      githubUser,
      installation,
      userToken,
    });
    if (proof !== "verified") return finishAttempt(request, state.projectId, { error: proof });

    const adoption = await adoptGithubInstallation({
      installation,
      projectId: state.projectId,
      teamId: state.teamId,
      userId: principal.userId,
    });
    return finishAttempt(
      request,
      state.projectId,
      adoption === "connected" ? { status: "connected" } : { error: adoption },
    );
  } catch (error) {
    console.error(
      "GitHub install callback failed",
      error instanceof GithubRequestError
        ? `GitHub status ${error.status}`
        : error instanceof Error
          ? error.message
          : "unknown error",
    );
    return finishAttempt(request, state.projectId, {
      error: error instanceof GithubRequestError ? "github_unavailable" : "connection_failed",
    });
  }
}
