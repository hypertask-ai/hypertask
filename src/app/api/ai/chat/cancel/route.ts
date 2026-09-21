import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getAiRequestUser } from "@/app/api/ai/_lib/requestUser";
import { requestAiChatCancellation } from "../stream/streamLease";

export const maxDuration = 60;

const cancelSchema = z.object({
  session_id: z.string().uuid(),
  assistant_message_id: z.string().uuid(),
  stream_id: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  const user = await getAiRequestUser(request);
  if (!user?.id) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const parsed = cancelSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "A valid session_id is required" }, { status: 400 });
  }

  try {
    const cancellationResult = await requestAiChatCancellation(
      user.id,
      parsed.data.session_id,
      parsed.data.assistant_message_id,
      parsed.data.stream_id,
    );
    if (cancellationResult === "limited") {
      return NextResponse.json(
        { success: false, status: "limited", error: "Too many Stop requests" },
        { status: 429 },
      );
    }
    if (cancellationResult === "unknown") {
      return NextResponse.json(
        { success: false, status: "unknown", error: "This reply is not active" },
        { status: 409 },
      );
    }
    if (cancellationResult === "completed") {
      return NextResponse.json(
        { success: false, status: "completed", error: "This reply already completed" },
        { status: 409 },
      );
    }
    return NextResponse.json({ success: true, status: "cancelling" });
  } catch (error) {
    console.error("[ai/chat/cancel] cancellation unavailable", error);
    return NextResponse.json(
      { success: false, error: "Cancellation is temporarily unavailable" },
      { status: 503 },
    );
  }
}
