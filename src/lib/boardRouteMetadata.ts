import "server-only";

import prisma from "@/lib/prisma";
import { cache } from "react";

export const getProjectForValidation = cache(async (
  userId: number,
  projectId: string,
  viewSlug?: string | null,
) => {
  try {
    const numericProjectId = Number(projectId);
    if (!Number.isSafeInteger(numericProjectId) || numericProjectId <= 0) {
      return { success: false as const, project: null };
    }

    const project = await prisma.project.findFirst({
      where: {
        id: numericProjectId,
        OR: [
          { ownerId: userId },
          { members: { some: { userId } } },
        ],
      },
      select: {
        id: true,
        title: true,
        teamId: true,
        team: {
          select: {
            id: true,
            title: true,
          },
        },
        project_view: {
          select: {
            allViews: {
              where: {
                slug: viewSlug ?? "__default_board_view__",
                OR: [
                  { visibility: "Public" },
                  { userId },
                ],
              },
              select: { title: true },
              take: 1,
            },
          },
        },
      },
    });

    if (!project) return { success: false as const, project: null };

    return {
      success: true as const,
      project: {
        id: project.id,
        title: project.title,
        teamId: project.teamId,
        team: project.team,
        viewTitle: viewSlug
          ? project.project_view?.allViews[0]?.title ?? null
          : null,
      },
    };
  } catch (error) {
    console.error("❌ getProjectForValidation failed:", error);
    return { success: false as const, project: null };
  }
});
