import { savedViewBoardAccessWhere } from "../getAllIncludes";
import prisma from "@/lib/prisma";
import { sanitizeProjectViewBoardFilters } from "@/utils/helperFunctions/Views/BoardFilterSanitizer";

const getProjectView = async (projectId: number, currentUserId: number) => {
  const project_view_updated = await prisma.project_View.findFirst({
    where: { projectId, project: savedViewBoardAccessWhere(currentUserId) },
    include: {
      user_project_views: {
        where: {
          userId: currentUserId,
        },
        select: {
          appliedView: {
            include: {
              ViewLastUsed: {
                where: { userId: currentUserId },
                select: { board_empty_sections: true },
                take: 1,
              },
            },
          },
          unsavedView: true,
          userId: true,
          project_view_id: true,
          view_order: true,
        },
        take: 1,
      },
      default_view: {
        include: {
          ViewLastUsed: {
            where: { userId: currentUserId },
            select: { board_empty_sections: true },
            take: 1,
          },
        },
      },
      allViews: {
        where: {
          OR: [
            {
              visibility: "Public",
            },
            {
              userId: currentUserId,
              visibility: "Private",
            },
          ],
        },
        include: {
          owner: {
            select: {
              photoURL: true,
            },
          },
          ViewLastUsed: {
            where: {
              userId: currentUserId,
            },
            select: {
              lastUsedAt: true,
              board_empty_sections: true,
            },
            take: 1,
          },
        },
        orderBy: {
          lastUsedAt: "desc",
        },
      },
    },
  });
  return sanitizeProjectViewBoardFilters(project_view_updated, currentUserId);
};

export const getUniqueSlug = async (
    projectViewId: string | undefined,
    viewTitle: string | null
  ): Promise<string | null> => {
    const baseSlug = slugify(viewTitle);
    if(baseSlug === null) return null
    let suffix = 1;
    let candidateSlug = baseSlug;
  
    while (true) {
      const existing = await prisma.view.findFirst({
        where: {
          project_view_id: projectViewId,
          slug: candidateSlug,
        },
      });
  
      if (!existing) {
        return candidateSlug;
      }
  
      suffix++;
      candidateSlug = `${baseSlug}-${suffix}`;
    }
  };

function slugify(str: string | null) {
  if (str === null) return null;
  return str
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getViewUrl(projectId: number, slug: string): string {
  return `/project?id=${projectId}&view=${slug}`;
}

export default getProjectView;
