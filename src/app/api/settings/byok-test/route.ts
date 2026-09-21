import { NextResponse } from "next/server";
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

  // HTPR-4839: testing a key is part of the paid BYOK feature.
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

    try {
      const response = await fetch(testRequest.url, {
        ...testRequest.init,
        signal: controller.signal,
      });
      const responseBody = await response.text();
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
