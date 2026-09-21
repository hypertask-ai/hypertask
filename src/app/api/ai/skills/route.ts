import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUserFromCookies } from "@/app/api/ai/_lib/editorAi";
import { assertProjectAccess } from "@/app/api/ai/_lib/customInstructions";
import {
  assertSkillScopeAccess,
  skillErrorResponse,
} from "@/app/api/ai/_lib/skillAccess";
import {
  MAX_SKILL_BODY_BYTES,
  parseSkillMarkdown,
  slugifySkill,
} from "@/app/api/ai/_lib/skillMarkdown";
import prisma from "@/lib/prisma";
import { hasTeamMembershipAccess } from "@/utils/controllers/teams/hasTeamMembershipAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  scope: z.enum(["user", "project"]).default("user"),
  projectId: z.coerce.number().int().positive().optional(),
  teamId: z.string().trim().min(1).optional(),
  markdown: z.string().optional(),
  rawMarkdown: z.string().optional(),
  slug: z.string().optional(),
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  argumentHint: z.string().nullable().optional(),
  body: z.string().optional(),
  enabled: z.boolean().optional().default(true),
});

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const projectIdValue = request.nextUrl.searchParams.get("projectId");
    const teamId = request.nextUrl.searchParams.get("teamId")?.trim();
    const projectId = projectIdValue ? Number(projectIdValue) : undefined;
    if (projectIdValue && (!Number.isInteger(projectId) || Number(projectId) <= 0)) {
      throw new Error("projectId must be a positive integer");
    }
    if (projectId) await assertProjectAccess(user.id, projectId);
    if (teamId && !(await hasTeamMembershipAccess(user.id, teamId))) {
      return NextResponse.json({ error: "Team access denied" }, { status: 403 });
    }

    const skills = await prisma.aI_Skill.findMany({
      where: {
        OR: [
          { userId: user.id, projectId: null },
          ...(projectId ? [{ projectId, userId: null }] : []),
        ],
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return NextResponse.json({ skills });
  } catch (error) {
    return skillErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const input = createSchema.parse(await request.json());
    if (
      input.teamId &&
      !(await hasTeamMembershipAccess(user.id, input.teamId))
    ) {
      return NextResponse.json({ error: "Team access denied" }, { status: 403 });
    }
    const scope = await assertSkillScopeAccess(
      user.id,
      input.scope,
      input.projectId
    );
    const parsed = parseCreateInput(input);
    const skill = await prisma.aI_Skill.create({
      data: {
        ...scope,
        ...parsed,
        enabled: input.enabled,
        createdById: user.id,
      },
    });
    return NextResponse.json({ skill }, { status: 201 });
  } catch (error) {
    return skillErrorResponse(error);
  }
}

function parseCreateInput(input: z.infer<typeof createSchema>) {
  const markdown = input.markdown ?? input.rawMarkdown;
  if (markdown) return parseSkillMarkdown(markdown);

  const name = input.name?.trim() || "";
  const slug = slugifySkill(input.slug || name);
  const body = input.body?.trim() || "";
  if (!name) throw new Error("Skill name is required");
  if (!slug) throw new Error("Skill slug is required");
  if (!body) throw new Error("Skill body is required");
  if (Buffer.byteLength(body, "utf8") > MAX_SKILL_BODY_BYTES) {
    throw new Error("Skill body exceeds the 64KB limit");
  }
  return {
    name,
    slug,
    body,
    description: input.description?.trim() || null,
    argumentHint: input.argumentHint?.trim() || null,
  };
}
