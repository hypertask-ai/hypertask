import prisma from "@/lib/prisma";
import { getInboxAccessibleProjectIds } from "@/utils/controllers/notifications/getAccessibleProjectIds";

// Shared with the signed draft endpoint. The caller supplies the verified user,
// never an id from a profile cookie or request body.
export default async function getUserDrafts(userId: number) {
  const [drafts, projectIds] = await Promise.all([prisma.drafts.findMany({
    where: { userId, type: "Comment", content: { notIn: ["", "<p></p>"] } },
    orderBy: { updatedAt: "desc" },
    include: {
      task: {
        select: {
          id: true, title: true, projectId: true, uniqueIndex: true,
          ticketNumber: true, status: true, section: true,
          project: { select: { id: true, title: true, name: true } },
        },
      },
    },
  }), getInboxAccessibleProjectIds(userId)]);
  const accessible = new Set(projectIds);
  return drafts.filter((draft) => draft.task.status === "Normal" && accessible.has(draft.task.projectId));
}
