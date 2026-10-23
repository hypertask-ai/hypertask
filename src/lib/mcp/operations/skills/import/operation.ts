import { withScopedProjectWrite } from "@/app/api/ai/_lib/customInstructions";
import { wrapMcpRoute, validateMcpRouteAuth as validateMcpAuth, checkMcpRouteRateLimit as checkMcpRateLimit } from '@/lib/mcp/routeWrapper'
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createUnauthorizedResponse } from '@/lib/mcp/auth'
import {
  assertSkillScopeAccess,
  skillErrorResponse,
} from "@/app/api/ai/_lib/skillAccess";
import { importSkillsFromGitHub } from "@/app/api/ai/_lib/skillImport";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const importSchema = z.object({
  url: z.string().url(),
  scope: z.enum(["user", "project"]),
  project_id: z.coerce.number().int().positive().optional(),
  dry_run: z.boolean().optional().default(false),
  slugs: z.array(z.string()).optional(),
});

export async function POST(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
  const rateLimited = await checkMcpRateLimit(request);
  if (rateLimited) return rateLimited;
  const ctx = await validateMcpAuth(request);
  if (!ctx) return createUnauthorizedResponse();
  const userId = ctx.user.id;

  try {
    const input = importSchema.parse(await request.json());
    const scope = await assertSkillScopeAccess(userId, input.scope, input.project_id, { userId, agentId: ctx.agentId, teamScope: ctx.teamScope });
    const parsed = await importSkillsFromGitHub(input.url);
    const selected = input.slugs
      ? parsed.filter((skill) => input.slugs?.includes(skill.slug))
      : parsed;
    if (input.dry_run) return NextResponse.json({ success: true, skills: parsed });
    if (selected.length === 0) throw new Error("Select at least one skill to import");

    const writes = (db: import("@prisma/client").Prisma.TransactionClient) => selected.map((skill) => {
        const data = {
          name: skill.name,
          description: skill.description,
          argumentHint: skill.argumentHint,
          body: skill.body,
          sourceUrl: skill.sourceUrl,
          enabled: true,
          createdById: userId,
        };
        return input.scope === "project"
          ? db.aI_Skill.upsert({
              where: {
                projectId_slug: { projectId: scope.projectId as number, slug: skill.slug },
              },
              create: { ...scope, ...data, slug: skill.slug },
              update: data,
            })
          : db.aI_Skill.upsert({
              where: { userId_slug: { userId, slug: skill.slug } },
              create: { ...scope, ...data, slug: skill.slug },
              update: data,
            });
      });
    const skills = ctx.teamScope != null
      ? await withScopedProjectWrite({ userId, agentId: ctx.agentId, teamScope: ctx.teamScope }, scope.projectId!, db => Promise.all(writes(db)))
      : await prisma.$transaction(writes(prisma));
    return NextResponse.json({ success: true, skills, total: skills.length });
  } catch (error) {
    return skillErrorResponse(error, { userId, agentId: ctx.agentId, teamScope: ctx.teamScope });
  }

  })(request)
}
