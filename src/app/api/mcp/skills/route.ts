import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  validateMcpAuth,
  checkMcpRateLimit,
  createUnauthorizedResponse,
} from "@/lib/mcp/auth";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mirrors the web skills API (src/app/api/ai/skills/route.ts) but authenticates
// with the MCP bearer token so the hypertask CLI, `ht`, and MCP tools can list
// and create skills. Params are snake_case to match the other /api/mcp/* routes.
const createSchema = z.object({
  scope: z.enum(["user", "project"]).default("user"),
  project_id: z.coerce.number().int().positive().optional(),
  markdown: z.string().optional(),
  raw_markdown: z.string().optional(),
  slug: z.string().optional(),
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  argument_hint: z.string().nullable().optional(),
  body: z.string().optional(),
  enabled: z.boolean().optional().default(true),
});

export async function GET(request: NextRequest) {
  const rateLimited = await checkMcpRateLimit(request);
  if (rateLimited) return rateLimited;
  const ctx = await validateMcpAuth(request);
  if (!ctx) return createUnauthorizedResponse();
  const userId = ctx.user.id;

  try {
    const projectIdValue = request.nextUrl.searchParams.get("project_id");
    const projectId = projectIdValue ? Number(projectIdValue) : undefined;
    if (projectIdValue && (!Number.isInteger(projectId) || Number(projectId) <= 0)) {
      throw new Error("project_id must be a positive integer");
    }
    if (projectId) await assertProjectAccess(userId, projectId);

    const skills = await prisma.aI_Skill.findMany({
      where: {
        OR: [
          { userId, projectId: null },
          ...(projectId ? [{ projectId, userId: null }] : []),
        ],
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return NextResponse.json({ success: true, skills, total: skills.length });
  } catch (error) {
    return skillErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const rateLimited = await checkMcpRateLimit(request);
  if (rateLimited) return rateLimited;
  const ctx = await validateMcpAuth(request);
  if (!ctx) return createUnauthorizedResponse();
  const userId = ctx.user.id;

  try {
    const input = createSchema.parse(await request.json());
    const scope = await assertSkillScopeAccess(userId, input.scope, input.project_id);
    const parsed = parseCreateInput(input);
    const skill = await prisma.aI_Skill.create({
      data: {
        ...scope,
        ...parsed,
        enabled: input.enabled,
        createdById: userId,
      },
    });
    return NextResponse.json({ success: true, skill }, { status: 201 });
  } catch (error) {
    return skillErrorResponse(error);
  }
}

function parseCreateInput(input: z.infer<typeof createSchema>) {
  const markdown = input.markdown ?? input.raw_markdown;
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
    argumentHint: input.argument_hint?.trim() || null,
  };
}
