import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  validateMcpAuth,
  checkMcpRateLimit,
  createUnauthorizedResponse,
} from "@/lib/mcp/auth";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// MCP mirror of src/app/api/ai/skills/[id]/route.ts (get / update / delete a
// single skill), plus a GET the web route doesn't expose. getAccessibleSkill
// enforces that the caller owns the personal skill or is a member of the
// project the skill belongs to.
const updateSchema = z.object({
  markdown: z.string().optional(),
  raw_markdown: z.string().optional(),
  slug: z.string().optional(),
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  argument_hint: z.string().nullable().optional(),
  body: z.string().optional(),
  enabled: z.boolean().optional(),
});

type RouteContext = { params: Promise<{ skill_id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await authenticate(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const skill = await loadSkill(auth.userId, context);
    return NextResponse.json({ success: true, skill });
  } catch (error) {
    return skillErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await authenticate(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const skill = await loadSkill(auth.userId, context);
    const input = updateSchema.parse(await request.json());
    const markdown = input.markdown ?? input.raw_markdown;
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
    return NextResponse.json({ success: true, skill: updated });
  } catch (error) {
    return skillErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await authenticate(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const skill = await loadSkill(auth.userId, context);
    await prisma.aI_Skill.delete({ where: { id: skill.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return skillErrorResponse(error);
  }
}

async function authenticate(request: NextRequest) {
  const rateLimited = await checkMcpRateLimit(request);
  if (rateLimited) return rateLimited;
  const ctx = await validateMcpAuth(request);
  if (!ctx) return createUnauthorizedResponse();
  return { userId: ctx.user.id };
}

async function loadSkill(userId: number, context: RouteContext) {
  const { skill_id: rawId } = await context.params;
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
  if (input.argument_hint !== undefined) data.argumentHint = input.argument_hint?.trim() || null;
  return data;
}
