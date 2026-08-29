import { searchTasks } from "@/utils/controllers/turbopuffer/turbopufferHelper";

export async function turbopufferGetSuggestions(
  searchQuery: string,
  projectIds: number[]
) {
  const taskRows = await searchTasks({
    searchQuery,
    projectIds,
    topK: 10,
  });

  const results = {
    results: [
      {
        hits: [],
        found: 0,
        out_of: 0,
        page: 1,
        request_params: {
          collection_name: "product_queries",
          q: searchQuery,
          per_page: 10,
        },
      },
      {
        hits: taskRows.map((row) => ({
          document: {
            id: row.id,
            ticketNumber: row.ticketNumber,
            title: row.title,
            descriptionText: row.descriptionText,
            projectId: row.projectId,
            creatorName: row.creatorName,
            status: row.status,
            updatedAt: row.updatedAt,
            uniqueIndex: row.uniqueIndex,
            project: {
              title: row.projectTitle,
            },
          },
          text_match: row.$dist,
        })),
        found: taskRows.length,
        out_of: taskRows.length,
        page: 1,
        request_params: {
          collection_name: "tasks",
          q: searchQuery,
          per_page: 10,
        },
      },
    ],
  };

  console.log("turbopufferGetSuggestions results:", results);
  return results;
}
