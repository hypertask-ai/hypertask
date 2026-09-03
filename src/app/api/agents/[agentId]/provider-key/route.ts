import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { encryptByokSecret, decryptByokSecret } from "@/lib/crypto/byokCipher";
import { maskByokSecret } from "@/lib/crypto/maskByokSecret";
import { isByokProviderKey, type TByokProviderKey } from "@/lib/aiProviders";
import { resolveOwnedAgent } from "@/lib/agents/ownedSlugs";
import { verifyCookieIdentity } from "@/lib/auth/cookieIdentity";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { SESSION_COOKIE } from "@/lib/auth/session";

/**
 * Per-agent provider keys (HTPR-5389). An agent with its own key runs on that
 * provider account, so its spend is a real invoice on that account instead of
 * a share of the team pot.
 *
 * Custom endpoints stay team-only: they carry a base URL and GDPR flag that
 * belong to team settings, not to a single agent.
 */
const UNSUPPORTED_AGENT_PROVIDERS = new Set<string>(["custom"]);

function isAgentProviderKey(value: unknown): value is TByokProviderKey {
  return isByokProviderKey(value) && !UNSUPPORTED_AGENT_PROVIDERS.has(value);
}

/**
 * nookies_user is client-writable, so its id is only a claim. Identity is the
 * signed ht_session agreeing with that claim, or a Better Auth session.
 */
async function authenticatedUserId(request: NextRequest) {
  const [identity, sessionUser] = await Promise.all([
    verifyCookieIdentity(
      request.cookies.get("nookies_user")?.value,
      request.cookies.get(SESSION_COOKIE)?.value,
    ),
    getSessionUser(request.headers),
  ]);
  if (identity.status === "verified") return identity.id;
  if (identity.status === "forged") return null;
  return sessionUser?.userId ?? null;
}

/** Resolves the agent only when the caller owns it; null means 401/404. */
async function requireOwnedAgent(request: NextRequest, ref: string) {
  const userId = await authenticatedUserId(request);
  if (!userId) return { error: "Unauthorized" as const, status: 401 };

  const resolved = await resolveOwnedAgent(userId, ref);
  if (!resolved) return { error: "Agent does not exist" as const, status: 404 };

  const agent = await prisma.agent.findFirst({
    where: { id: resolved.id, userId },
    select: { id: true },
  });
  if (!agent) return { error: "Agent does not exist" as const, status: 404 };

  return { agentId: agent.id };
}

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ agentId: string }> },
) {
  const params = await props.params;
  const access = await requireOwnedAgent(request, params.agentId);
  if ("error" in access) {
    return NextResponse.json(
      { success: false, error: access.error },
      { status: access.status },
    );
  }

  const rows = await prisma.agentByokApiKey.findMany({
    where: { agentId: access.agentId },
    select: { provider: true, enabled: true, ciphertext: true, updatedAt: true },
    orderBy: { provider: "asc" },
  });

  const keys = rows.map((row) => {
    let maskedKey: string | null = null;
    const ciphertext = row.ciphertext?.trim();
    if (ciphertext) {
      try {
        maskedKey = maskByokSecret(decryptByokSecret(ciphertext));
      } catch (error) {
        console.error(
          `[agent provider-key] decrypt failed for provider=${row.provider}`,
          error,
        );
      }
    }
    return {
      provider: row.provider,
      enabled: row.enabled,
      maskedKey,
      updatedAt: row.updatedAt,
    };
  });

  return NextResponse.json({ success: true, keys });
}

export async function PUT(
  request: NextRequest,
  props: { params: Promise<{ agentId: string }> },
) {
  const params = await props.params;
  const access = await requireOwnedAgent(request, params.agentId);
  if ("error" in access) {
    return NextResponse.json(
      { success: false, error: access.error },
      { status: access.status },
    );
  }

  let body: { provider?: unknown; apiKey?: unknown; enabled?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (!isAgentProviderKey(body.provider)) {
    return NextResponse.json(
      { success: false, error: "Unsupported provider" },
      { status: 400 },
    );
  }

  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: "apiKey required" },
      { status: 400 },
    );
  }

  const enabled = body.enabled === undefined ? true : body.enabled === true;

  await prisma.agentByokApiKey.upsert({
    where: {
      agentId_provider: { agentId: access.agentId, provider: body.provider },
    },
    create: {
      agentId: access.agentId,
      provider: body.provider,
      ciphertext: encryptByokSecret(apiKey),
      enabled,
    },
    update: { ciphertext: encryptByokSecret(apiKey), enabled },
  });

  return NextResponse.json({
    success: true,
    provider: body.provider,
    enabled,
    maskedKey: maskByokSecret(apiKey),
  });
}

export async function DELETE(
  request: NextRequest,
  props: { params: Promise<{ agentId: string }> },
) {
  const params = await props.params;
  const access = await requireOwnedAgent(request, params.agentId);
  if ("error" in access) {
    return NextResponse.json(
      { success: false, error: access.error },
      { status: access.status },
    );
  }

  const provider = request.nextUrl.searchParams.get("provider");
  if (!isAgentProviderKey(provider)) {
    return NextResponse.json(
      { success: false, error: "Unsupported provider" },
      { status: 400 },
    );
  }

  await prisma.agentByokApiKey.deleteMany({
    where: { agentId: access.agentId, provider },
  });

  return NextResponse.json({ success: true, provider });
}
