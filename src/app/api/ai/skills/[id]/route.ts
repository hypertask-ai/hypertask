import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUserFromCookies } from "@/app/api/ai/_lib/editorAi";
import {
  getAccessibleSkill,
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

const updateSchema = z.object({
  markdown: z.string().optional(),
  rawMarkdown: z.string().optional(),
  slug: z.string().optional(),
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  argumentHint: z.string().nullable().optional(),
  body: z.string().optional(),
  enabled: z.boolean().optional(),
  teamId: z.string().trim().min(1).nullable().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const user = await getCurrentUserFromCookies();
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const skill = await loadSkill(user.id, context);
    const input = updateSchema.parse(await request.json());
    if (
      input.teamId &&
      !(await hasTeamMembershipAccess(user.id, input.teamId))
    ) {
      return NextResponse.json({ error: "Team access denied" }, { status: 403 });
    }
    const markdown = input.markdown ?? input.rawMarkdown;
    const data = markdown
      ? parseSkillMarkdown(markdown)
      : parseUpdateFields(input, skill.slug);
    const updated = await prisma.aI_Skill.update({
      where: { id: skill.id },
      data: {
        ...data,
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      },
    });
    return NextResponse.json({ skill: updated });
  } catch (error) {
    return skillErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const user = await getCurrentUserFromCookies();
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const teamId = request.nextUrl.searchParams.get("teamId")?.trim();
    if (teamId && !(await hasTeamMembershipAccess(user.id, teamId))) {
      return NextResponse.json({ error: "Team access denied" }, { status: 403 });
    }
    const skill = await loadSkill(user.id, context);
    await prisma.aI_Skill.delete({ where: { id: skill.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return skillErrorResponse(error);
  }
}

async function loadSkill(userId: number, context: RouteContext) {
  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid skill id");
  return getAccessibleSkill(userId, id);
}

function parseUpdateFields(input: z.infer<typeof updateSchema>, currentSlug: string) {
  const data: Record<string, string | null> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new Error("Skill name is required");
    data.name = name;
  }
  if (input.slug !== undefined) {
    const slug = slugifySkill(input.slug);
    if (!slug) throw new Error("Skill slug is required");
    data.slug = slug;
  } else if (!currentSlug) {
    throw new Error("Skill slug is required");
  }
  if (input.body !== undefined) {
    const body = input.body.trim();
    if (!body) throw new Error("Skill body is required");
    if (Buffer.byteLength(body, "utf8") > MAX_SKILL_BODY_BYTES) {
      throw new Error("Skill body exceeds the 64KB limit");
    }
    data.body = body;
  }
  if (input.description !== undefined) data.description = input.description?.trim() || null;
  if (input.argumentHint !== undefined) data.argumentHint = input.argumentHint?.trim() || null;
  return data;
}
