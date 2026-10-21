import type { Prisma } from "@prisma/client";

import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

export function slackAccessibleProjectWhere(
  teamId: string,
  userId: number,
): Prisma.ProjectWhereInput {
  return {
    AND: [{ status: "Normal", teamId }, getProjectWhere(userId)],
  };
}
