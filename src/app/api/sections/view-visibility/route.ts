import { getSessionUser } from "@/lib/auth/getSessionUser";
import prisma from "@/lib/prisma";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { createColumnViewVisibilityHandler } from "@/lib/sections/columnViewVisibilityHandler";
import { setSectionVisibilityInAllViews } from "@/utils/controllers/section/viewHelpers";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

export const POST = createColumnViewVisibilityHandler({
  session: (headers) => getSessionUser(headers),
  findSection: (userId, sectionId) =>
    prisma.section.findFirst({
      where: {
        id: sectionId,
        deleted: false,
        project: getProjectWhere(userId),
      },
      select: { id: true, projectId: true, section_title: true, ranking: true },
    }),
  setVisibility: setSectionVisibilityInAllViews,
  afterChange: (projectId, userId) => {
    void broadcastBoardChange(projectId, { originUserId: userId });
  },
});
