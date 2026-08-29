import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { MANAGED_TEAM_GATEWAY_PROVIDER } from "@/app/api/ai/_lib/managedGatewayKeys";
import { decryptByokSecret, encryptByokSecret } from "@/lib/crypto/byokCipher";
import {
  checkMcpRateLimit,
  createUnauthorizedResponse,
  validateManagementOrSessionAuth,
} from "@/lib/mcp/auth";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLATFORM_GATEWAY_ADMIN = {
  userId: 6,
  email: "valentin.yeo@gmail.com",
} as const;

const targetSchema = z
  .object({
    teamId: z.string().uuid().optional(),
    teamIdPrefix: z.string().trim().regex(/^[0-9a-f-]{8,36}$/i).optional(),
    ownerEmail: z.string().trim().email().optional(),
    apiKey: z.string().trim().startsWith("vck_").min(8),
  })
  .superRefine((target, ctx) => {
    if (!target.teamId && !target.teamIdPrefix) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "teamId or teamIdPrefix is required",
      });
    }
    if (target.teamIdPrefix && !target.ownerEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ownerEmail is required with teamIdPrefix",
      });
    }
  });

const provisionSchema = z.object({
  targets: z.array(targetSchema).min(1).max(50),
  removeMatchingLegacyRows: z.boolean().default(true),
});

type TeamIdentity = {
  id: string;
  title: string | null;
  ownerEmail: string;
};

function isPlatformGatewayAdmin(user: { id: number; email: string }) {
  return (
    user.id === PLATFORM_GATEWAY_ADMIN.userId &&
    user.email.trim().toLowerCase() === PLATFORM_GATEWAY_ADMIN.email
  );
}

function fingerprint(apiKey: string) {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}

async function resolveTarget(
  target: z.infer<typeof targetSchema>
): Promise<TeamIdentity> {
  const ownerEmail = target.ownerEmail?.toLowerCase();
  const ownerIds = ownerEmail
    ? (
        await prisma.user.findMany({
          where: { email: { equals: ownerEmail, mode: "insensitive" } },
          select: { id: true },
        })
      ).map((user) => user.id)
    : undefined;

  if (ownerIds && ownerIds.length === 0) {
    throw new Error(`No user found for owner ${ownerEmail}`);
  }

  const ownerWhere = ownerIds
    ? { googleAccount: { is: { userId: { in: ownerIds } } } }
    : {};
  const teams = target.teamId
    ? await prisma.team.findMany({
        where: { id: target.teamId, ...ownerWhere },
        select: {
          id: true,
          title: true,
          googleAccount: { select: { userId: true } },
        },
      })
    : await prisma.team.findMany({
        where: {
          id: { startsWith: target.teamIdPrefix },
          ...ownerWhere,
        },
        select: {
          id: true,
          title: true,
          googleAccount: { select: { userId: true } },
        },
        take: 3,
      });

  if (teams.length !== 1) {
    throw new Error(
      `Expected exactly one team for ${target.teamId ?? target.teamIdPrefix}, found ${teams.length}`
    );
  }

  const owner = await prisma.user.findUnique({
    where: { id: teams[0].googleAccount.userId },
    select: { email: true },
  });
  if (!owner) {
    throw new Error(`Owner not found for team ${teams[0].id}`);
  }

  return {
    id: teams[0].id,
    title: teams[0].title,
    ownerEmail: owner.email,
  };
}

export async function GET(request: NextRequest) {
  const rateLimited = await checkMcpRateLimit(request);
  if (rateLimited) return rateLimited;

  const ctx = await validateManagementOrSessionAuth(request, "read");
  if (!ctx) return createUnauthorizedResponse();
  if (!isPlatformGatewayAdmin(ctx.user)) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const rows = await prisma.teamByokApiKey.findMany({
    where: { provider: MANAGED_TEAM_GATEWAY_PROVIDER },
    orderBy: { teamId: "asc" },
    select: {
      teamId: true,
      enabled: true,
      ciphertext: true,
    },
  });
  const teams = await prisma.team.findMany({
    where: { id: { in: rows.map((row) => row.teamId) } },
    select: {
      id: true,
      title: true,
      googleAccount: { select: { userId: true } },
    },
  });
  const owners = await prisma.user.findMany({
    where: {
      id: { in: teams.map((team) => team.googleAccount.userId) },
    },
    select: { id: true, email: true },
  });
  const ownerEmailById = new Map(owners.map((owner) => [owner.id, owner.email]));
  const teamById = new Map(teams.map((team) => [team.id, team]));

  return NextResponse.json({
    success: true,
    keys: rows.map((row) => {
      const team = teamById.get(row.teamId);
      return {
        teamId: row.teamId,
        title: team?.title ?? null,
        ownerEmail: team
          ? ownerEmailById.get(team.googleAccount.userId) ?? null
          : null,
        enabled: row.enabled,
        configured: Boolean(row.ciphertext?.trim()),
      };
    }),
  });
}

export async function POST(request: NextRequest) {
  const rateLimited = await checkMcpRateLimit(request);
  if (rateLimited) return rateLimited;

  const ctx = await validateManagementOrSessionAuth(request, "write");
  if (!ctx) return createUnauthorizedResponse();
  if (!isPlatformGatewayAdmin(ctx.user)) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const input = provisionSchema.parse(await request.json());
    const resolvedTargets = await Promise.all(
      input.targets.map(async (target) => ({
        target,
        team: await resolveTarget(target),
        ciphertext: encryptByokSecret(target.apiKey),
      }))
    );
    const uniqueTeamIds = new Set(resolvedTargets.map(({ team }) => team.id));
    if (uniqueTeamIds.size !== resolvedTargets.length) {
      return NextResponse.json(
        { success: false, error: "Each target must resolve to a different team" },
        { status: 400 }
      );
    }

    const matchingLegacyRows = new Map<string, string>();
    if (input.removeMatchingLegacyRows) {
      const targetKeyByTeam = new Map(
        resolvedTargets.map(({ target, team }) => [team.id, target.apiKey])
      );
      const legacyRows = await prisma.teamByokApiKey.findMany({
        where: {
          teamId: { in: [...uniqueTeamIds] },
          provider: { in: ["gateway", "openai", "claude"] },
        },
        select: { teamId: true, provider: true, ciphertext: true },
      });
      for (const row of legacyRows) {
        if (!row.ciphertext) continue;
        try {
          if (decryptByokSecret(row.ciphertext) === targetKeyByTeam.get(row.teamId)) {
            matchingLegacyRows.set(
              `${row.teamId}:${row.provider}`,
              row.ciphertext
            );
          }
        } catch {
          // Preserve unreadable rows. Provisioning must never delete a secret
          // unless it exactly matches the platform key being migrated.
        }
      }
    }

    await prisma.$transaction(
      resolvedTargets.flatMap(({ ciphertext, team }) => {
        const upsert = prisma.teamByokApiKey.upsert({
          where: {
            teamId_provider: {
              teamId: team.id,
              provider: MANAGED_TEAM_GATEWAY_PROVIDER,
            },
          },
          create: {
            teamId: team.id,
            provider: MANAGED_TEAM_GATEWAY_PROVIDER,
            ciphertext,
            enabled: true,
          },
          update: {
            ciphertext,
            enabled: true,
          },
        });
        const deletes = ["gateway", "openai", "claude"].flatMap((provider) => {
          const observedCiphertext = matchingLegacyRows.get(
            `${team.id}:${provider}`
          );
          if (!observedCiphertext) return [];
          return [
            prisma.teamByokApiKey.deleteMany({
              where: {
                teamId: team.id,
                provider,
                ciphertext: observedCiphertext,
              },
            }),
          ];
        });
        return [upsert, ...deletes];
      })
    );

    return NextResponse.json({
      success: true,
      keys: resolvedTargets.map(({ target, team }) => ({
        ...team,
        provider: MANAGED_TEAM_GATEWAY_PROVIDER,
        enabled: true,
        fingerprint: fingerprint(target.apiKey),
      })),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Invalid request", issues: error.issues },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Provisioning failed",
      },
      { status: 400 }
    );
  }
}
