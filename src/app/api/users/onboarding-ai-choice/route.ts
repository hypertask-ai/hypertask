import { NextRequest, NextResponse } from "next/server";
import { LogType, Status } from "@prisma/client";

import { getCurrentUserFromCookies } from "@/app/api/ai/_lib/editorAi";
import createLog from "@/utils/controllers/logs/createLog";

export const runtime = "nodejs";

const ALLOWED_TOOLS = new Set([
  "claude",
  "claude-code",
  "cursor",
  "vscode",
  "chatgpt",
  "builtin",
]);

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUserFromCookies();
    if (typeof user?.id !== "number") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: { tool?: unknown };
    try {
      body = (await request.json()) as { tool?: unknown };
    } catch {
      return NextResponse.json(
        { error: "Invalid AI tool" },
        { status: 400 },
      );
    }
    if (typeof body.tool !== "string" || !ALLOWED_TOOLS.has(body.tool)) {
      return NextResponse.json(
        { error: "Invalid AI tool" },
        { status: 400 },
      );
    }

    await createLog({
      log: `onboarding_ai_choice:${body.tool}`,
      type: LogType.Signup,
      status: Status.Normal,
      LoggedById: user.id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("POST [users/onboarding-ai-choice] failed:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
