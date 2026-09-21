import { getSessionUser } from "@/lib/auth/getSessionUser";
import prisma from "@/lib/prisma";
import { COLUMN_ALL_VIEWS_FLAG, isFeatureEnabled } from "@/lib/flags";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { createColumnViewVisibilityHandler } from "@/lib/sections/columnViewVisibilityHandler";
import { setSectionVisibilityInAllViews } from "@/utils/controllers/section/viewHelpers";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

/**
 * Board membership is the edit right for columns here, the same check the
 * sibling auto-assign route uses; there is no read-only board role.
 */
export const POST = createColumnViewVisibilityHandler({
  session: (headers) => getSessionUser(headers),
  featureEnabled: (userId) => isFeatureEnabled(COLUMN_ALL_VIEWS_FLAG, userId),
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
