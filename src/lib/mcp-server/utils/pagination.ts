
export interface PaginatedResponse<T> {
  success: boolean;
  items: T[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
  next_offset?: number;
}

export interface PaginationParams {
  offset: number;
  limit: number;
  total: number;
  itemsCount: number;
}

export function buildPaginationMetadata(params: PaginationParams): {
  has_more: boolean;
  next_offset?: number;
} {
  const { offset, total, itemsCount } = params;
  
  const currentPageEnd = offset + itemsCount;
  const hasMore = currentPageEnd < total;
  
  const nextOffset = hasMore ? currentPageEnd : undefined;
  
  return {
    has_more: hasMore,
    next_offset: nextOffset,
  };
}

export function buildPaginatedResponse<T>(
  items: T[],
  total: number,
  offset: number = 0,
  limit?: number
): PaginatedResponse<T> {
  const actualLimit = limit ?? items.length;
  const paginationMetadata = buildPaginationMetadata({
    offset,
    limit: actualLimit,
    total,
    itemsCount: items.length,
  });

  return {
    success: true,
    items,
    total,
    limit: actualLimit,
    offset,
    ...paginationMetadata,
  };
}
