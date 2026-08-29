import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  errorMessage,
  getCurrentUserFromCookies,
} from "@/app/api/ai/_lib/editorAi";
import { deleteCustomInstructionFile } from "@/app/api/ai/_lib/customInstructions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const deleteRequestSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  sourceUrl: z.string().url(),
  fileIdToRemove: z.coerce.number().int().positive().optional(),
});

export async function DELETE(request: NextRequest) {
  const cookieUser = await getCurrentUserFromCookies();
  if (!cookieUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    const body = deleteRequestSchema.parse(params);
    const result = await deleteCustomInstructionFile({
      userId: cookieUser.id,
      projectId: body.projectId,
      sourceUrl: body.sourceUrl,
      fileIdToRemove: body.fileIdToRemove,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("[ai/custom-instructions/delete-file-by-source] error:", error);
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 400 }
    );
  }
}
