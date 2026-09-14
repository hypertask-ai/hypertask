export type SearchArchiveStatus = "Normal" | "Archive" | null;

export function defaultSearchArchiveStatus(
  includeArchived: boolean
): SearchArchiveStatus {
  return includeArchived ? null : "Normal";
}

export function buildSearchUrl(
  searchTerm: string,
  tabIndex: number | null | undefined,
  includeArchived: boolean,
  fromProject?: number | null
) {
  const params = new URLSearchParams({ searchTerm });
  if (tabIndex !== undefined && tabIndex !== null) {
    params.set("index", String(tabIndex));
  }
  if (includeArchived) params.set("includeArchived", "1");
  if (fromProject != null && Number.isInteger(fromProject) && fromProject > 0) {
    params.set("fromProject", String(fromProject));
  }
  return `/search?${params.toString()}`;
}

export function boardContextFromPath(
  pathname: string | null | undefined,
  currentProjectId?: number | null
): number | null {
  if (!pathname) return null;

  const detailMatch = pathname.match(/^\/detail\/project-(\d+)/);
  if (detailMatch) {
    const projectId = Number(detailMatch[1]);
    return Number.isInteger(projectId) && projectId > 0 ? projectId : null;
  }

  if (
    pathname.startsWith("/project") &&
    currentProjectId != null &&
    Number.isInteger(currentProjectId) &&
    currentProjectId > 0
  ) {
    return currentProjectId;
  }

  return null;
}

export class SearchRequestGate {
  private latest = 0;

  begin() {
    this.latest += 1;
    return this.latest;
  }

  invalidate() {
    this.latest += 1;
  }

  isLatest(requestId: number) {
    return requestId === this.latest;
  }
}
