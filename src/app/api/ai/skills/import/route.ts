import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUserFromCookies } from "@/app/api/ai/_lib/editorAi";
import {
  assertSkillScopeAccess,
  skillErrorResponse,
} from "@/app/api/ai/_lib/skillAccess";
import { importSkillsFromGitHub } from "@/app/api/ai/_lib/skillImport";
import prisma from "@/lib/prisma";
import { hasTeamMembershipAccess } from "@/utils/controllers/teams/hasTeamMembershipAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const importSchema = z.object({
  url: z.string().url(),
  scope: z.enum(["user", "project"]),
  projectId: z.coerce.number().int().positive().optional(),
  teamId: z.string().trim().min(1).optional(),
  dryRun: z.boolean().optional().default(false),
  slugs: z.array(z.string()).optional(),
});

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = user.id;

  try {
    const input = importSchema.parse(await request.json());
    if (
      input.teamId &&
      !(await hasTeamMembershipAccess(userId, input.teamId))
    ) {
      return NextResponse.json({ error: "Team access denied" }, { status: 403 });
    }
    const scope = await assertSkillScopeAccess(userId, input.scope, input.projectId);
    const parsed = await importSkillsFromGitHub(input.url);
    const selected = input.slugs
      ? parsed.filter((skill) => input.slugs?.includes(skill.slug))
      : parsed;
    if (input.dryRun) return NextResponse.json({ skills: parsed });
    if (selected.length === 0) throw new Error("Select at least one skill to import");

    const skills = await prisma.$transaction(
      selected.map((skill) => {
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
          ? prisma.aI_Skill.upsert({
              where: {
                projectId_slug: { projectId: scope.projectId as number, slug: skill.slug },
              },
              create: { ...scope, ...data, slug: skill.slug },
              update: data,
            })
          : prisma.aI_Skill.upsert({
              where: { userId_slug: { userId, slug: skill.slug } },
              create: { ...scope, ...data, slug: skill.slug },
              update: data,
            });
      })
    );
    return NextResponse.json({ skills });
  } catch (error) {
    return skillErrorResponse(error);
  }
}
