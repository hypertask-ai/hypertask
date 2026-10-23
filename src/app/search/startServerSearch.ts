import "server-only";
import getAllMinimal from "@/utils/controllers/projects/getAllMinimal";
import { searchDocuments } from "@/utils/controllers/search/searchDocuments";
import { defaultSearchArchiveStatus } from "@/lib/searchArchive";
import type { ServerStartedSearch } from "@/lib/search/serverStartedSearch";

export async function startServerSearch(
  userId: number,
  searchQuery: string,
  includeArchived: boolean,
  fromProject: number | null,
): Promise<ServerStartedSearch | null> {
  const normalizedSearchQuery = searchQuery.trim();
  if (searchQuery.length < 2 || !normalizedSearchQuery) return null;
  const projects = await getAllMinimal(userId, "ExtraMinimal");
  const projectIds = projects.status === 200 ? projects.json.map((project) => project.id) : [];
  if (projectIds.length === 0) return null;
  const { status, json } = await searchDocuments(
    userId, normalizedSearchQuery, Array.from(new Set(projectIds)), defaultSearchArchiveStatus(includeArchived), fromProject,
  );
  return { searchQuery, includeArchived, fromProject, projectIds, status, data: JSON.parse(JSON.stringify(json ?? null)) };
}
