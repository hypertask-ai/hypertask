import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { hasValidCronAuthorization } from "@/lib/cronAuthorization";
import { featureFlagCandidateUserIds } from "@/lib/flags";
import { HTPR_9055_NEEDS_YOU_FLAG } from "@/lib/flags/definitions/htpr-9055-needs-you";
import { scoreNeedsYouInbox } from "@/utils/controllers/notifications/scoreNeedsYou";
export const maxDuration = 300;
export async function GET(request: NextRequest) {
  if (!hasValidCronAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userIds = await featureFlagCandidateUserIds(HTPR_9055_NEEDS_YOU_FLAG);
  const users = await prisma.notification.findMany({
    where: { needsYouScoredAt: null, agentId: null, taskId: { not: null }, status: "Normal", archivedAt: null, ...(userIds === null ? {} : { userId: { in: userIds } }) },
    select: { userId: true }, distinct: ["userId"], orderBy: { id: "asc" }, take: 4,
  });
  let scored = 0;
  for (const { userId } of users) scored += await scoreNeedsYouInbox(userId);
  return NextResponse.json({ scored });
}
