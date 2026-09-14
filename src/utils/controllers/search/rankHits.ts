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

function tokenizeInOrder(value: string): string[] {
  const normalized = value.toLowerCase();
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter("und", { granularity: "word" });
    const tokens: string[] = [];
    for (const { segment, isWordLike } of segmenter.segment(normalized)) {
      if (isWordLike) tokens.push(segment);
    }
    return tokens;
  }

  return normalized.match(/[\p{L}\p{N}_-]+/gu) ?? [];
}

export function tokenize(value: string): string[] {
  return Array.from(new Set(tokenizeInOrder(value)));
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

export function isTitleStrongHit(hit: SearchRankHit, query: string): boolean {
  return everyQueryTokenInFields(query, [
    hit.ticketNumber,
    hit.title,
    hit.taskTitle,
  ]);
}

export function isTitlePhraseHit(hit: SearchRankHit, query: string): boolean {
  const queryTokens = tokenizeInOrder(query);
  if (queryTokens.length === 0) return false;

  const titleTokens = tokenizeInOrder(
    [hit.ticketNumber, hit.title, hit.taskTitle]
      .filter((value): value is string => Boolean(value))
      .join(" ")
  );
  if (titleTokens.length < queryTokens.length) return false;

  for (let index = 0; index <= titleTokens.length - queryTokens.length; index += 1) {
    if (queryTokens.every((token, offset) => titleTokens[index + offset] === token)) {
      return true;
    }
  }
  return false;
}

export function isStrongLexicalHit(hit: SearchRankHit, query: string): boolean {
  return everyQueryTokenInFields(query, [
    hit.ticketNumber,
    hit.title,
    hit.taskTitle,
    hit.descriptionText,
    hit.commentText,
  ]);
}

function everyQueryTokenInFields(
  query: string,
  fields: Array<string | null | undefined>
): boolean {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return false;

  const haystackTokens = new Set(
    tokenize(
      fields
        .filter((value): value is string => Boolean(value))
        .join(" ")
        .toLowerCase()
    )
  );

  return queryTokens.every((token) => haystackTokens.has(token));
}

export function shouldKeepRankedHit(
  hit: SearchRankHit,
  query: string,
  archive: "Normal" | "Archive" | null
): boolean {
  if (archive === null) return true;
  if (archive === "Archive") return hit.status === "Archive";
  if (hit.status !== "Archive") return true;
  return (
    isExactTicketHit(hit, parseTicketSearchQuery(query)) ||
    isTitleStrongHit(hit, query)
  );
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
      ...titleBeforeBodyThenOpen(exactHits, query),
      ...titleBeforeBodyThenOpen(restHits, query),
    ];
  }

  const currentHits = restHits.filter(
    (hit) => hit.projectId === contextProjectId
  );
  const otherHits = restHits.filter((hit) => hit.projectId !== contextProjectId);

  return [
    ...titleBeforeBodyThenOpen(exactHits, query).map((hit) =>
      withGroup(hit, contextProjectId)
    ),
    ...titleBeforeBodyThenOpen(currentHits, query).map((hit) =>
      withGroup(hit, contextProjectId)
    ),
    ...titleBeforeBodyThenOpen(otherHits, query).map((hit) =>
      withGroup(hit, contextProjectId)
    ),
  ];
}

function titleBeforeBodyThenOpen<T extends SearchRankHit>(
  items: T[],
  query: string
): T[] {
  const phraseHits = items.filter((item) => isTitlePhraseHit(item, query));
  const titleHits = items.filter(
    (item) => isTitleStrongHit(item, query) && !isTitlePhraseHit(item, query)
  );
  const bodyHits = items.filter((item) => !isTitleStrongHit(item, query));
  return [
    ...openBeforeArchived(phraseHits),
    ...openBeforeArchived(titleHits),
    ...openBeforeArchived(bodyHits),
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
