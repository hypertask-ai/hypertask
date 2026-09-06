import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { publicAgentSelect } from "@/lib/agents/publicAgent";

const favoriteUserSelect = {
  id: true,
  displayName: true,
  photoURL: true,
  email: true,
} satisfies Prisma.UserSelect;

export const getFavoritesForUser = (userId: number) =>
  prisma.favorites.findMany({
    where: { userSetting: { userId } },
    include: {
      project: {
        include: {
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
