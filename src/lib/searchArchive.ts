export type SearchArchiveStatus = "Normal" | "Archive" | null;

export function defaultSearchArchiveStatus(
  includeArchived: boolean
): SearchArchiveStatus {
  return includeArchived ? null : "Normal";
}

export function buildSearchUrl(
  searchTerm: string,
  tabIndex: number | null | undefined,
  includeArchived: boolean
) {
  const params = new URLSearchParams({ searchTerm });
  if (tabIndex !== undefined && tabIndex !== null) {
    params.set("index", String(tabIndex));
  }
  if (includeArchived) params.set("includeArchived", "1");
  return `/search?${params.toString()}`;
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
