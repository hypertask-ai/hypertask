import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7732_BASETEN_BYOK_FLAG } from "@/lib/flags/definitions/htpr-7732-baseten-byok";
import { fetchWithoutBrotli } from "@/lib/net/fetchWithoutBrotli";
import { haiku55ModelEnabled } from "@/app/api/ai/_lib/planGate";
import { NextResponse } from "next/server";
import { z } from "zod";
import { logAiUsage } from "@/app/api/ai/_lib/aiUsage";
import { randomUUID } from "node:crypto";
import {
  resolveTeamByokApiKey,
  resolveTeamCustomEndpoint,
} from "@/app/api/ai/_lib/byokKeys";
import { getServerCookieUser } from "@/lib/auth/serverUser";
import {
  clearGdprProviderTestLease,
  getActiveGdprProviderTestLease,
  isByokProviderKey,
  isByokProviderRestrictedInGdprSafeMode,
  isGdprSafeModeEnabled,
  setGdprProviderTestLease,
} from "@/lib/aiProviders";
import { assertUserCanManageTeamByok } from "@/utils/controllers/teams/assertTeamByokAccess";
import { isPaidTeam } from "@/lib/freeTier";
import { buildByokTestRequest, classifyByokTestResponse } from "./providerTest";
import {
  normalizeCustomEndpointBaseUrl,
  normalizeCustomEndpointModelId,
} from "@/lib/ai/customEndpoint";
import { updateTeamAiSettingsAtomically } from "@/utils/controllers/teams/updateTeamAiSettingsAtomically";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const testUsageSchema = z.object({
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
  }),
});

const TEST_TIMEOUT_MS = 20_000;
const TEST_LEASE_MS = TEST_TIMEOUT_MS + 5_000;

class ProviderTestLeaseError extends Error {}

export async function POST(request: Request) {
  const user = await getServerCookieUser();
  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  let body: {
    teamId?: unknown;
    provider?: unknown;
    apiKey?: unknown;
    baseUrl?: unknown;
    gdprCompliant?: unknown;
    modelId?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid request" }, { status: 400 });
  }

  const teamId = typeof body.teamId === "string" ? body.teamId.trim() : "";
  if (!teamId) {
    return NextResponse.json({ message: "teamId required" }, { status: 400 });
  }
  if (!isByokProviderKey(body.provider)) {
    return NextResponse.json({ message: "Invalid provider" }, { status: 400 });
  }

  const gate = await assertUserCanManageTeamByok(
    user.id,
    user.accountId,
    teamId,
  );
  if (!gate.ok) {
    return NextResponse.json(
      { message: gate.message },
      { status: gate.status },
    );
  }

  if (
    body.provider === "baseten" &&
    !(await isFeatureEnabled(HTPR_7732_BASETEN_BYOK_FLAG, user.id))
  ) {
    return NextResponse.json({ message: "Baseten is unavailable" }, { status: 403 });
  }

  if (!(await isPaidTeam(teamId))) {
    return NextResponse.json(
      {
        message: "Adding your own API key requires a paid plan.",
        code: "UPGRADE_REQUIRED",
      },
      { status: 402 },
    );
  }

  const suppliedKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (suppliedKey.length > 20_000) {
    return NextResponse.json(
      { message: "API key is too long" },
      { status: 400 },
    );
  }

  const savedCustomEndpoint =
    body.provider === "custom"
      ? await resolveTeamCustomEndpoint(
          { trustedTeamId: teamId },
          { includeDisabled: true },
        )
      : undefined;
  const apiKey =
    suppliedKey ||
    savedCustomEndpoint?.apiKey ||
    (await resolveTeamByokApiKey(
      body.provider,
      { trustedTeamId: teamId },
      { includeDisabled: true },
    ));
  if (!apiKey) {
    return NextResponse.json({ message: "No API key saved" }, { status: 400 });
  }

  let customEndpoint: { baseUrl: string; modelId: string } | undefined;
  let customEndpointGdprCompliant = false;
  if (body.provider === "custom") {
    try {
      customEndpointGdprCompliant =
        typeof body.gdprCompliant === "boolean"
          ? body.gdprCompliant
          : savedCustomEndpoint?.gdprCompliant === true;
      customEndpoint = {
        baseUrl: normalizeCustomEndpointBaseUrl(
          body.baseUrl ?? savedCustomEndpoint?.baseUrl,
        ),
        modelId: normalizeCustomEndpointModelId(
          body.modelId ?? savedCustomEndpoint?.modelId,
        ),
      };
    } catch (error) {
      return NextResponse.json(
        {
          message:
            error instanceof Error ? error.message : "Invalid custom endpoint",
        },
        { status: 400 },
      );
    }
  }

  const testRequest = buildByokTestRequest(
    body.provider,
    apiKey,
    customEndpoint,
    await haiku55ModelEnabled(user.id),
  );
  if (!testRequest) {
    return NextResponse.json(
      { message: "Provider test is not configured" },
      { status: 400 },
    );
  }

  const runTest = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
    const startedAt = Date.now();
    let outcome = "failed";
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;

    try {
      const response = await fetchWithoutBrotli(testRequest.url, {
        ...testRequest.init,
        signal: controller.signal,
      });
      const responseBody = await response.text();
      outcome = response.ok ? "ok" : "failed";
      try {
        const parsed = testUsageSchema.safeParse(JSON.parse(responseBody));
        if (parsed.success) {
          inputTokens = parsed.data.usage.input_tokens ?? parsed.data.usage.prompt_tokens;
          outputTokens = parsed.data.usage.output_tokens ?? parsed.data.usage.completion_tokens;
        }
      } catch {
        inputTokens = undefined;
        outputTokens = undefined;
      }
      return NextResponse.json({
        result: classifyByokTestResponse(response.status, responseBody),
        status: response.status,
        model: testRequest.modelLabel,
        elapsedMs: Date.now() - startedAt,
      });
    } catch {
      return NextResponse.json({
        result: "error",
        status: null,
        model: testRequest.modelLabel,
        elapsedMs: Date.now() - startedAt,
      });
    } finally {
      clearTimeout(timeout);
      await logAiUsage({
        userId: user.id, teamId, provider: `byok:${body.provider}`, model: testRequest.modelId,
        feature: "byok-test", outcome, inputTokens, outputTokens,
        totalTokens: inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined,
        costUsd: null, latencyMs: Date.now() - startedAt,
      });
    }
  };

  const requiresGdprLease =
    isByokProviderRestrictedInGdprSafeMode(body.provider) ||
    (body.provider === "custom" && !customEndpointGdprCompliant);
  if (requiresGdprLease) {
    const leaseId = randomUUID();
    try {
      const claimed = await updateTeamAiSettingsAtomically(
        teamId,
        (currentSettings) => {
          if (isGdprSafeModeEnabled(currentSettings)) {
            throw new ProviderTestLeaseError(
              "Turn off GDPR safe mode before testing this provider",
            );
          }
          if (getActiveGdprProviderTestLease(currentSettings)) {
            throw new ProviderTestLeaseError(
              "Another provider key test is already running",
            );
          }
          return setGdprProviderTestLease(currentSettings, {
            id: leaseId,
            expiresAt: Date.now() + TEST_LEASE_MS,
          });
        },
      );
      if (!claimed) {
        return NextResponse.json(
          { message: "Team not found" },
          { status: 404 },
        );
      }
    } catch (error) {
      if (error instanceof ProviderTestLeaseError) {
        return NextResponse.json({ message: error.message }, { status: 409 });
      }
      throw error;
    }

    try {
      return await runTest();
    } finally {
      await updateTeamAiSettingsAtomically(teamId, (currentSettings) =>
        clearGdprProviderTestLease(currentSettings, leaseId),
      );
    }
  }

  return runTest();
}
