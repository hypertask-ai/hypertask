export type ServerStartedSearch = {
  searchQuery: string;
  includeArchived: boolean;
  fromProject: number | null;
  projectIds: number[];
  status: number;
  data: { processedData: Record<string, unknown[]>; tabs: string[] };
};

export function isServerSearchFor(
  started: ServerStartedSearch | null,
  searchQuery: string,
  includeArchived: boolean,
  fromProject: number | null,
): started is ServerStartedSearch {
  return started?.status === 200 && started.searchQuery === searchQuery &&
    started.includeArchived === includeArchived && started.fromProject === fromProject &&
    Array.isArray(started.data?.processedData?.All);
}
