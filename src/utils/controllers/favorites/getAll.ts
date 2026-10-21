import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { publicAgentSelect } from "@/lib/agents/publicAgent";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

const favoriteUserSelect = {
  id: true,
  displayName: true,
  photoURL: true,
  email: true,
} satisfies Prisma.UserSelect;

const favoriteProjectSelect = {
  id: true,
  name: true,
  title: true,
  ownerId: true,
  status: true,
  teamId: true,
  googleAccountId: true,
  uniqueIdentifier: true,
} satisfies Prisma.ProjectSelect;

export const getFavoritesForUser = (userId: number) =>
  prisma.favorites.findMany({
    relationLoadStrategy: "join",
    where: { userSetting: { userId }, project: getProjectWhere(userId) },
    include: {
      project: {
        select: {
          ...favoriteProjectSelect,
          owner: { select: favoriteUserSelect },
          members: {
            include: {
              user: { select: favoriteUserSelect },
              agent: { select: publicAgentSelect },
            },
          },
        },
      },
    },
    orderBy: { index: "asc" },
  });
