import prisma from "@/lib/prisma";
import { sanitizeProjectViewBoardFilters } from "@/utils/helperFunctions/Views/BoardFilterSanitizer";

const getProjectView = async (projectId: number, currentUserId: number) => {
  const project_view_updated = await prisma.project_View.findUnique({
    where: { projectId },
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
  return sanitizeProjectViewBoardFilters(project_view_updated);
};

export const getUniqueSlug = async (
    projectViewId: string | undefined,
    viewTitle: string | null
  ): Promise<string | null> => {
    const baseSlug = slugify(viewTitle); // Generate the base slug first
    if(baseSlug === null) return null
    // Check if the base slug exists
    let suffix = 1;
    let candidateSlug = baseSlug;
  
    while (true) {
      const existing = await prisma.view.findFirst({
        where: {
          project_view_id: projectViewId,
          slug: candidateSlug,
        },
      });
  
      // If the candidate slug is unused, return it
      if (!existing) {
        return candidateSlug;
      }
  
      // Otherwise, increment the suffix and try again
      suffix++;
      candidateSlug = `${baseSlug}-${suffix}`;
    }
  };

function slugify(str: string | null) {
  if (str === null) return null;
  return str
    .normalize("NFKD") // Normalize diacritics
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritic characters
    .toLowerCase() // Convert to lowercase
    .replace(/[^a-z0-9]/g, "-") // Replace non-alphanumeric with hyphens
    .replace(/-+/g, "-") // Collapse multiple hyphens
    .replace(/^-+|-+$/g, ""); // Trim hyphens from start/end
}

export function getViewUrl(projectId: number, slug: string): string {
  return `/project?id=${projectId}&view=${slug}`;
}

export default getProjectView;
