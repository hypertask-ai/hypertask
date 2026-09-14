export type TicketSearchQuery = {
  prefix: string | null;
  uniqueIndex: number;
  normalizedQuery: string;
};

export type SearchRankHit = {
  ticketNumber?: string | null;
  title?: string | null;
  taskTitle?: string | null;
  descriptionText?: string | null;
  commentText?: string | null;
  projectId: number;
  uniqueIndex?: number | null;
  status?: string | null;
};

export type SearchResultGroup = "current-board" | "other";

export function parseTicketSearchQuery(query: string): TicketSearchQuery | null {
  const prefixedMatch = query.match(/^([A-Za-z]{2,10})[-\s]?(\d{1,7})$/);
  if (prefixedMatch) {
    const prefix = prefixedMatch[1].toUpperCase();
    const uniqueIndex = Number(prefixedMatch[2]);

    return {
      prefix,
      uniqueIndex,
      normalizedQuery: `${prefix}-${uniqueIndex}`,
    };
  }

  const bareMatch = query.match(/^(\d{1,7})$/);
  if (bareMatch) {
    return {
      prefix: null,
      uniqueIndex: Number(bareMatch[1]),
      normalizedQuery: query,
    };
  }

  return null;
}

export function tokenize(value: string): string[] {
  const normalized = value.toLowerCase();
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter("und", { granularity: "word" });
    const tokens: string[] = [];
    for (const { segment, isWordLike } of segmenter.segment(normalized)) {
      if (isWordLike) tokens.push(segment);
    }
    return Array.from(new Set(tokens));
  }

  return Array.from(new Set(normalized.match(/[\p{L}\p{N}_-]+/gu) ?? []));
}

export function isExactTicketHit(
  hit: SearchRankHit,
  ticketQuery: TicketSearchQuery | null
): boolean {
  if (!ticketQuery) return false;

  const ticketNumber = String(hit.ticketNumber ?? "").toLowerCase();

  if (ticketQuery.prefix) {
    const dashed =
      `${ticketQuery.prefix}-${ticketQuery.uniqueIndex}`.toLowerCase();
    const compact =
      `${ticketQuery.prefix}${ticketQuery.uniqueIndex}`.toLowerCase();
    return (
      ticketNumber === dashed || ticketNumber.replace(/-/g, "") === compact
    );
  }

  return (
    Number.isInteger(hit.uniqueIndex) &&
    hit.uniqueIndex === ticketQuery.uniqueIndex
  );
}

export function isStrongLexicalHit(hit: SearchRankHit, query: string): boolean {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return false;

  const haystackText = [
    hit.ticketNumber,
    hit.title,
    hit.taskTitle,
    hit.descriptionText,
    hit.commentText,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
  const haystackTokens = new Set(tokenize(haystackText));

  return queryTokens.every((token) => haystackTokens.has(token));
}

export function rankAndGroupHits<T extends SearchRankHit>(
  hits: T[],
  query: string,
  contextProjectId: number | null
): Array<T & { searchGroup?: SearchResultGroup }> {
  const ticketQuery = parseTicketSearchQuery(query);
  const strongHits = hits.filter(
    (hit) =>
      isExactTicketHit(hit, ticketQuery) || isStrongLexicalHit(hit, query)
  );

  const exactHits = ticketQuery
    ? strongHits.filter((hit) => isExactTicketHit(hit, ticketQuery))
    : [];
  const restHits = ticketQuery
    ? strongHits.filter((hit) => !isExactTicketHit(hit, ticketQuery))
    : strongHits;

  if (contextProjectId === null) {
    return [
      ...openBeforeArchived(exactHits),
      ...openBeforeArchived(restHits),
    ];
  }

  const currentHits = restHits.filter(
    (hit) => hit.projectId === contextProjectId
  );
  const otherHits = restHits.filter((hit) => hit.projectId !== contextProjectId);

  return [
    ...openBeforeArchived(exactHits).map((hit) =>
      withGroup(hit, contextProjectId)
    ),
    ...openBeforeArchived(currentHits).map((hit) =>
      withGroup(hit, contextProjectId)
    ),
    ...openBeforeArchived(otherHits).map((hit) =>
      withGroup(hit, contextProjectId)
    ),
  ];
}

function openBeforeArchived<T extends SearchRankHit>(items: T[]): T[] {
  return [
    ...items.filter((item) => item.status !== "Archive"),
    ...items.filter((item) => item.status === "Archive"),
  ];
}

function withGroup<T extends SearchRankHit>(
  hit: T,
  contextProjectId: number
): T & { searchGroup: SearchResultGroup } {
  return {
    ...hit,
    searchGroup:
      hit.projectId === contextProjectId ? "current-board" : "other",
  };
}

export function resolveContextProjectId(
  requestedContextProjectId: unknown,
  searchedProjectIds: number[]
): number | null {
  if (
    !Number.isInteger(requestedContextProjectId) ||
    (requestedContextProjectId as number) <= 0
  ) {
    return null;
  }

  return searchedProjectIds.includes(requestedContextProjectId as number)
    ? (requestedContextProjectId as number)
    : null;
}
