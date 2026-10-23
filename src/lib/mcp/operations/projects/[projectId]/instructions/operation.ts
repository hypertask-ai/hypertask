import { haiku55ModelEnabled } from "@/app/api/ai/_lib/planGate";
import { wrapMcpRoute, validateMcpRouteAuth as validateMcpAuth, checkMcpRouteRateLimit as checkMcpRateLimit } from '@/lib/mcp/routeWrapper'
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createUnauthorizedResponse } from '@/lib/mcp/auth'
import { assertProjectAccess, withScopedProjectWrite } from "@/app/api/ai/_lib/customInstructions";
import { getAiModelOptionById } from "@/lib/aiModelOptions";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


const updateSchema = z.object({
  custom_instruction: z.string(),
  model_selected: z.string().optional(),
});

function parseProjectId(raw: string): number {
  const projectId = Number(raw);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    throw new Error("projectId must be a positive integer");
  }
  return projectId;
}

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ projectId: string }> }
) {
  return wrapMcpRoute(async (request: NextRequest) => {
  const rateLimited = await checkMcpRateLimit(request);
  if (rateLimited) return rateLimited;
  const ctx = await validateMcpAuth(request);
  if (!ctx) return createUnauthorizedResponse();

  try {
    const { projectId: rawProjectId } = await props.params;
    const projectId = parseProjectId(rawProjectId);
    await assertProjectAccess(ctx.user.id, projectId, ctx.agentId, ctx.teamScope);

    const instruction = await prisma.aI_Custom_Instructions.findFirst({
      where: { projectId },
      include: { attachments: true },
    });

    const haiku55Enabled = await haiku55ModelEnabled(ctx.user.id);
    const selected = haiku55Enabled ? getAiModelOptionById(instruction?.model_selected, true) : undefined;
    return NextResponse.json({ success: true, instruction: instruction && selected ? {
      ...instruction, model_selected: selected.id, source_selected: selected.source,
    } : instruction });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to read custom instructions";
    const status = message.includes("access denied") ? 403 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }

  })(request)
}

export async function PUT(
  request: NextRequest,
  props: { params: Promise<{ projectId: string }> }
) {
  return wrapMcpRoute(async (request: NextRequest) => {
  const rateLimited = await checkMcpRateLimit(request);
  if (rateLimited) return rateLimited;
  const ctx = await validateMcpAuth(request);
  if (!ctx) return createUnauthorizedResponse();

  try {
    const { projectId: rawProjectId } = await props.params;
    const projectId = parseProjectId(rawProjectId);
    await assertProjectAccess(ctx.user.id, projectId, ctx.agentId, ctx.teamScope);

    const input = updateSchema.parse(await request.json());
    const modelOption = getAiModelOptionById(input.model_selected);
    if (input.model_selected !== undefined) {
      if (!modelOption) {
        return NextResponse.json(
          {
            success: false,
            error: `Unknown model_selected "${input.model_selected}"`,
            details: { field: "model_selected", code: "invalid_value" },
          },
          { status: 400 }
        );
      }
    }

    const instruction = await withScopedProjectWrite({ userId: ctx.user.id, agentId: ctx.agentId, teamScope: ctx.teamScope }, projectId, async (db) => {
      const existing = await db.aI_Custom_Instructions.findFirst({
        where: { projectId },
        select: { id: true },
      });

      const modelData = modelOption
        ? { model_selected: modelOption.id, source_selected: modelOption.source }
        : {};

      return existing
        ? await db.aI_Custom_Instructions.update({
            where: { id: existing.id, ...(ctx.teamScope != null ? { project: (await import("@/utils/controllers/projects/getAllIncludes")).getProjectWhere(ctx.user.id, ctx.agentId, ctx.teamScope) } : {}) },
            data: {
              customInstruction: input.custom_instruction,
              ...modelData,
              lastUpdatedAt: new Date(),
            },
            include: { attachments: true },
          })
        : await db.aI_Custom_Instructions.create({
            data: {
              projectId,
              customInstruction: input.custom_instruction,
              ...modelData,
            },
            include: { attachments: true },
          });
    });

    return NextResponse.json({ success: true, instruction });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update custom instructions";
    const status = message.includes("access denied") ? 403 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }

  })(request)
}
