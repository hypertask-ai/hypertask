import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { publicAgentSelect } from "@/lib/agents/publicAgent";

const favoriteUserSelect = {
  id: true,
  displayName: true,
  photoURL: true,
  email: true,
} satisfies Prisma.UserSelect;

// HTPR-6509: consumers (sidebar, favorites modal, shortcuts) read the board's
// id, name/title, team, owner and members. Skip heavy columns such as
// description, sections and playbook on every app-shell load.
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
    where: { userSetting: { userId } },
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
