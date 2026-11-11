import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_9017_SMART_PAGE_SEARCH_FLAG } from "@/lib/flags/definitions/htpr-9017-smart-page-search";
import turbopuffer, { turbopufferNamespaces } from "@/lib/turbopuffer";
import {
  buildProjectFilter,
  embedQueryForSearch,
  getMultiQueryRows,
  type TurbopufferPageRow,
} from "@/utils/controllers/turbopuffer/turbopufferHelper";

const PAGE_INCLUDE_ATTRIBUTES = ["title", "contentText", "projectId", "projectTitle", "updatedAt"];
const PAGE_SEARCH_RESULT_LIMIT = 50;

type SearchPagesParams = {
  searchQuery: string;
  projectIds: number[];
  userId: number;
  topK?: number;
};

const buildPageBm25RankBy = (query: string) => [
  "Sum",
  [
    ["Product", [4, ["title", "BM25", query, { last_as_prefix: true }]]],
    ["searchText", "BM25", query, { last_as_prefix: true }],
  ],
];

function normalizePageRow(row: TurbopufferPageRow): TurbopufferPageRow {
  return {
    ...row,
    id: row.id.toString(),
  };
}

export async function smartPageSearchEnabled(userId: number): Promise<boolean> {
  if (await isFeatureEnabled(HTPR_9017_SMART_PAGE_SEARCH_FLAG, userId)) return true;
  return false;
}

export async function searchPagesInTurbopuffer({
  searchQuery,
  projectIds,
  userId,
  topK = PAGE_SEARCH_RESULT_LIMIT,
}: SearchPagesParams): Promise<TurbopufferPageRow[]> {
  if (!await smartPageSearchEnabled(userId)) return [];

  const query = searchQuery.trim();
  const projectFilter = buildProjectFilter(projectIds);
  if (!query || !projectFilter) return [];

  const namespace = turbopuffer.namespace(turbopufferNamespaces.page.name);
  const bm25Query = {
    rank_by: buildPageBm25RankBy(query),
    top_k: topK,
    filters: projectFilter,
    include_attributes: PAGE_INCLUDE_ATTRIBUTES,
  };

  const queryVector = await embedQueryForSearch(
    query,
    "turbopuffer searchPagesInTurbopuffer",
    projectIds
  );

  if (queryVector) {
    try {
      const response = await namespace.query({
        queries: [
          {
            rank_by: ["vector", "ANN", queryVector],
            top_k: topK,
            filters: projectFilter,
            include_attributes: PAGE_INCLUDE_ATTRIBUTES,
          },
          bm25Query,
        ],
        rerank_by: ["RRF"],
      } as any);

      return getMultiQueryRows<TurbopufferPageRow>(response)
        .slice(0, topK)
        .map(normalizePageRow);
    } catch (error) {
      console.error(
        "turbopuffer searchPagesInTurbopuffer hybrid error, falling back to BM25:",
        error
      );
    }
  }

  try {
    const response = await namespace.query(bm25Query as any);
    return ((response.rows ?? []) as unknown as TurbopufferPageRow[])
      .slice(0, topK)
      .map(normalizePageRow);
  } catch (error) {
    console.error("turbopuffer searchPagesInTurbopuffer error:", error);
    return [];
  }
}
