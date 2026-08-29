import { taskBaseUri } from "@/utils";

export const searchConfig = {
  responseMessages: {
    success: "Found results",
    fail: "No results found",
    error: "Error searching",
    default: "None",
  },

  elementIds: {
    history: {
      id: "history-list",
      childKeys: "past-history",
    },
    input: {
      id: "search-input",
      placeholder: "Search",
    },
    results: {
      id: "tasks-list",
      childKeys: "list-row-all-tasks",
    },
    askAiRow: {
      id: "ask-ai-row",
    },
  },

  urls: {
    taskDetail: (projectId: number, uniqueIndex: number) =>
      `${taskBaseUri}project-${projectId}/${uniqueIndex}`,
  },

  handleKeyDown: {
    classNamesToReturnFrom: [
      "modal-open",
      "ProseMirror ProseMirror-focused",
      undefined,
    ],
    activeElementCheck: ["modalButtons", "htc", "boardManager"],
  },

  collections: {
    task: {
      alias: "tasks_collection",
      name: "tasks_v3",
    },
    comment: {
      alias: "comments_collection",
      name: "comments_v3",
    },
  },
  functions: {
    mention: (searchQuery: string, projectIds: number[]) => {
      return {
        q: searchQuery,
        query_by: "ticketNumber, title",
        query_by_weights: "2, 3",
        highlight_fields: "ticketNumber, title",
        sort_by: "updatedAt:desc",
        infix: "always, off",
        filter_by: `projectId:=[${projectIds}]`,
        per_page: 5,
      };
    },
    search: {
      task: (searchQuery: string, filters: string) => {
        return {
          q: searchQuery,
          query_by: "ticketNumber, title",
          query_by_weights: "2, 3",
          highlight_fields: "ticketNumber, title",
          sort_by: "updatedAt:desc",
          infix: "always, off",
          filter_by: filters,
          per_page: 50,
        };
      },
      /** MCP / API search: includes descriptionText, configurable per_page */
      taskForMcp: (
        searchQuery: string,
        filters: string,
        perPage: number = 50
      ) => ({
        q: searchQuery,
        query_by: "ticketNumber, title, descriptionText",
        query_by_weights: "2, 3, 1",
        highlight_fields: "ticketNumber, title",
        sort_by: "updatedAt:desc",
        infix: "always, off, off",
        filter_by: filters,
        per_page: perPage,
      }),
      comment: (searchQuery: string, projectIds: number[]) => {
        return {
          q: searchQuery,
          query_by: "commentText",
          highlight_full_fields: "commentText",
          sort_by: "createdAt:desc",
          filter_by: `projectId:=[${projectIds}]`,
          per_page: 50,
          group_by: "taskId",
          group_limit: 1,
        };
      },
    },
  },
};
