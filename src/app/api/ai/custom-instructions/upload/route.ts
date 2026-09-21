import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  errorMessage,
  getCurrentUserFromCookies,
} from "@/app/api/ai/_lib/editorAi";
import { uploadCustomInstructionFiles } from "@/app/api/ai/_lib/customInstructions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uploadRequestSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  teamId: z.string().nullable().optional(),
  URLs: z.array(z.string().url()).default([]),
});

export async function POST(request: NextRequest) {
  const cookieUser = await getCurrentUserFromCookies();
  if (!cookieUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = uploadRequestSchema.parse(await request.json());
    const result = await uploadCustomInstructionFiles({
      userId: cookieUser.id,
      projectId: body.projectId,
      urls: body.URLs,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("[ai/custom-instructions/upload] error:", error);
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 400 }
    );
  }
}
