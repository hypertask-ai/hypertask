import type { SortingMode } from "@prisma/client";
import type { SubtaskSetting } from "@prisma/client";
import type { IApiClient } from "../../types/index";
import { logger } from "../../utils/logger";
import { generateCorrelationId } from "../../utils/correlation";
import { buildPaginationMetadata } from "../../utils/pagination";
import {
  ApplyViewInputSchema,
  CreateViewInputSchema,
  DeleteViewInputSchema,
  GetViewInputSchema,
  ListViewsInputSchema,
  UpdateViewInputSchema,
} from "../../validations/view.validation";

export interface ViewListItem {
  id: string;
  title: string;
  visibility: "Public" | "Private" | string;
  createdAt: Date;
  lastUsedAt?: Date | null;
  owner: {
    id: number;
    email: string;
    displayName?: string;
  };
  project: {
    id: number;
    name: string;
    title?: string;
  };
  is_default: boolean;
}

export interface ViewMutationFilters {
  addedFilters: Array<{
    type: string;
    searchPayload: unknown[];
  }>;
  matchFilters: "ANY" | "ALL";
}

export interface BoardColumnView {
  id: number;
  deleted: boolean;
  ranking: string;
  projectId: number;
  visibility: boolean;
  section_title: string;
}

export interface ViewItem extends ViewListItem {
  board_sorting_mode: 'Manual' | string;
  board_sorting_order: 'Descending' | 'Ascending' | string;
  board_filters: ViewMutationFilters;
  board_columns_view: BoardColumnView[];
  board_subtask_setting: 'None' | string;
  board_empty_sections: 'Show' | 'Hide' | string;
}

export interface ListViewsResponse {
  success: boolean;
  views: ViewListItem[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
  next_offset?: number;
}

export interface GetViewResponse {
  success: boolean;
  view: ViewItem;
}

export interface CreateViewMutationRecord {
  id: string;
  title: string | null;
  slug: string | null;
  visibility: "Public" | "Private";
  projectId: number;
  filters: ViewMutationFilters;
  board_subtask_setting: SubtaskSetting;
  isDefault: boolean;
}

export interface CreateViewResponse {
  success: boolean;
  view: CreateViewMutationRecord;
  message?: string;
}

export interface UpdateViewMutationRecord extends CreateViewMutationRecord {
  sorting_mode: SortingMode;
  sorting_order: "Ascending" | "Descending";
}

export interface UpdateViewResponse {
  success: boolean;
  view: UpdateViewMutationRecord;
  message?: string;
}

export interface DeleteViewMutationRecord {
  id: string;
  title: string | null;
  projectId: number;
}

export interface DeleteViewResponse {
  success: boolean;
  view: DeleteViewMutationRecord;
}

export interface ApplyViewResponse {
  success: boolean;
  applied_view_id: string | null;
  is_default: boolean;
  view: {
    id: string;
    title: string | null;
    projectId: number;
  };
}

/**
 * Service for listing, retrieving, creating, updating, deleting, and applying views.
 */
export class ViewService {
  constructor(private readonly apiClient: IApiClient) {}

  async listViews(params: unknown): Promise<ListViewsResponse> {
    const correlationId = generateCorrelationId();

    try {
      // Validate input
      const validatedInput = ListViewsInputSchema.parse(params);

      // Build query parameters
      const queryParams = new URLSearchParams();

      if (validatedInput.project_id) {
        queryParams.append("projectId", String(validatedInput.project_id));
      }
      if (validatedInput.visibility) {
        queryParams.append("visibility", validatedInput.visibility);
      }
      if (validatedInput.limit !== undefined) {
        queryParams.append("limit", String(validatedInput.limit));
      }
      if (validatedInput.offset !== undefined) {
        queryParams.append("offset", String(validatedInput.offset));
      }
      if (validatedInput.sort_by) {
        queryParams.append("sort_by", validatedInput.sort_by);
      }
      if (validatedInput.sort_order) {
        queryParams.append("sort_order", validatedInput.sort_order);
      }

      const response = await this.apiClient.makeRequest<ListViewsResponse>(
        `/mcp/view?${queryParams.toString()}`,
        {
          method: "GET",
        },
        correlationId,
      );

      // Guard against undefined/malformed response (HTPR-3030)
      const rawViews = response?.views ?? [];
      const validViews = rawViews.filter((t): t is ViewListItem => t != null);

      // Add pagination metadata following MCP best practices
      const offset = validatedInput.offset ?? 0;
      const limit =
        validatedInput.limit ?? response?.limit ?? validViews.length;
      const total = response?.total ?? validViews.length;
      const paginationMetadata = buildPaginationMetadata({
        offset,
        limit,
        total,
        itemsCount: validViews.length,
      });

      return {
        ...response,
        views: validViews,
        ...paginationMetadata,
      };
    } catch (error) {
      logger.error("Failed to list views", {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async getView(params: unknown): Promise<GetViewResponse> {
    const correlationId = generateCorrelationId();

    try {
      // Validate input
      const validatedInput = GetViewInputSchema.parse(params);

      // Build query parameters
      const queryParams = new URLSearchParams();

      if (validatedInput.viewId) {
        queryParams.append("viewId", String(validatedInput.viewId));
      }

      const response = await this.apiClient.makeRequest<GetViewResponse>(
        `/mcp/view/${validatedInput.viewId}`,
        {
          method: "GET",
        },
        correlationId,
      );

      const validView = response?.view ?? null;

      return {
        ...response,
        view: validView,
      };
    } catch (error) {
      logger.error("Failed to get view", {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async createView(params: unknown): Promise<CreateViewResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = CreateViewInputSchema.parse(params);

      const response = await this.apiClient.makeRequest<CreateViewResponse>(
        "/mcp/view",
        {
          method: "POST",
          body: JSON.stringify(validatedInput),
        },
        correlationId,
      );

      logger.info("View created successfully", {
        correlationId,
        viewId: response.view.id,
        projectId: validatedInput.project_id,
      });

      return response;
    } catch (error) {
      logger.error("Failed to create view", {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async updateView(params: unknown): Promise<UpdateViewResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = UpdateViewInputSchema.parse(params);
      const { viewId, ...body } = validatedInput;

      // Omitted filter fields (label_names/assignee_ids/match) are deliberately
      // left out of the PATCH body: the REST endpoint merges them against the
      // view's stored filters server-side, where the real (nested) filter
      // shape lives. Do not try to pre-merge here against GetViewResponse's
      // board_filters — its shape (addedFilters/matchFilters) doesn't match
      // this endpoint's flat label_names/assignee_ids/match fields, and a
      // client-side merge against the wrong shape silently clears filters.
      const response = await this.apiClient.makeRequest<UpdateViewResponse>(
        `/mcp/view/${viewId}`,
        {
          method: "PATCH",
          body: JSON.stringify(body),
        },
        correlationId,
      );

      logger.info("View updated successfully", {
        correlationId,
        viewId,
      });

      return response;
    } catch (error) {
      logger.error("Failed to update view", {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async deleteView(params: unknown): Promise<DeleteViewResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = DeleteViewInputSchema.parse(params);

      const response = await this.apiClient.makeRequest<DeleteViewResponse>(
        `/mcp/view/${validatedInput.viewId}`,
        {
          method: "DELETE",
        },
        correlationId,
      );

      logger.info("View deleted successfully", {
        correlationId,
        viewId: validatedInput.viewId,
      });

      return response;
    } catch (error) {
      logger.error("Failed to delete view", {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async applyView(params: unknown): Promise<ApplyViewResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = ApplyViewInputSchema.parse(params);

      const response = await this.apiClient.makeRequest<ApplyViewResponse>(
        `/mcp/view/${validatedInput.viewId}/apply`,
        {
          method: "POST",
        },
        correlationId,
      );

      logger.info("View applied successfully", {
        correlationId,
        viewId: validatedInput.viewId,
        isDefault: response.is_default,
      });

      return response;
    } catch (error) {
      logger.error("Failed to apply view", {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
