import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  validateMcpAuth,
  checkMcpRateLimit,
  createUnauthorizedResponse,
} from "@/lib/mcp/auth";
import { assertProjectAccess } from "@/app/api/ai/_lib/customInstructions";
import { getAiModelOptionById } from "@/lib/aiModelOptions";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// MCP mirror of the web-only custom-instructions API
// (src/pages/api/ai/project/customInstruction.ts) so the hypertask CLI, `ht`,
// and MCP tools can read and set a board's AI custom instructions with the MCP
// bearer token. Params are snake_case to match the other /api/mcp/* routes.

const updateSchema = z.object({
  custom_instruction: z.string(),
  // An AI model option id (e.g. from /lib/aiModelOptions). When supplied we
  // resolve it the same way the web route does so model_selected/source_selected
  // stay valid for the settings dropdown; omitted = leave the existing values.
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
  const rateLimited = await checkMcpRateLimit(request);
  if (rateLimited) return rateLimited;
  const ctx = await validateMcpAuth(request);
  if (!ctx) return createUnauthorizedResponse();

  try {
    const { projectId: rawProjectId } = await props.params;
    const projectId = parseProjectId(rawProjectId);
    await assertProjectAccess(ctx.user.id, projectId);

    const instruction = await prisma.aI_Custom_Instructions.findFirst({
      where: { projectId },
      include: { attachments: true },
    });

    return NextResponse.json({ success: true, instruction });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to read custom instructions";
    const status = message.includes("access denied") ? 403 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function PUT(
  request: NextRequest,
  props: { params: Promise<{ projectId: string }> }
) {
  const rateLimited = await checkMcpRateLimit(request);
  if (rateLimited) return rateLimited;
  const ctx = await validateMcpAuth(request);
  if (!ctx) return createUnauthorizedResponse();

  try {
    const { projectId: rawProjectId } = await props.params;
    const projectId = parseProjectId(rawProjectId);
    await assertProjectAccess(ctx.user.id, projectId);

    const input = updateSchema.parse(await request.json());
    // Reject an unknown model id instead of falling back to the default. The
    // fallback reported success while quietly writing a different model than
    // the caller named, which an agent has no way to notice.
    let modelOption;
    if (input.model_selected !== undefined) {
      modelOption = getAiModelOptionById(input.model_selected);
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

    // ponytail: findFirst-then-create/update mirrors the shipped web route
    // (pages/api/ai/project/customInstruction.ts); projectId has no unique
    // constraint, so two racing first-time PUTs could create two rows. Benign
    // for this low-concurrency admin write. Upgrade path if it ever matters:
    // add @@unique([projectId]) + prisma.upsert.
    const existing = await prisma.aI_Custom_Instructions.findFirst({
      where: { projectId },
      select: { id: true },
    });

    const modelData = modelOption
      ? { model_selected: modelOption.id, source_selected: modelOption.source }
      : {};

    const instruction = existing
      ? await prisma.aI_Custom_Instructions.update({
          where: { id: existing.id },
          data: {
            customInstruction: input.custom_instruction,
            ...modelData,
            lastUpdatedAt: new Date(),
          },
          include: { attachments: true },
        })
      : await prisma.aI_Custom_Instructions.create({
          data: {
            projectId,
            customInstruction: input.custom_instruction,
            ...modelData,
          },
          include: { attachments: true },
        });

    return NextResponse.json({ success: true, instruction });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update custom instructions";
    const status = message.includes("access denied") ? 403 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
