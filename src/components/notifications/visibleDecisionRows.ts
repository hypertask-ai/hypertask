export const DECISION_INBOX_COLLAPSED_ROWS = 5;

/** HTPR-7082: rows arrive oldest first, so the collapsed list keeps the oldest few. */
export const visibleDecisionRows = <T,>(rows: T[], expanded: boolean): T[] =>
  expanded ? rows : rows.slice(0, DECISION_INBOX_COLLAPSED_ROWS);
