import type { Prisma } from "@prisma/client";

import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

/**
 * Projects a linked Slack user may touch: the install's team AND their own
 * membership.
 *
 * Composed with AND, never by spreading. `getProjectWhere` carries its own
 * `teamId` key, so spreading it over `teamId` would replace the install's team
 * with "any team" and expose other teams the user happens to belong to.
 */
export function slackAccessibleProjectWhere(
  teamId: string,
  userId: number,
): Prisma.ProjectWhereInput {
  return {
    AND: [{ status: "Normal", teamId }, getProjectWhere(userId)],
  };
}
