/**
 * Pure HTML text-transform helpers for HTPR-3953: finding and linkifying
 * plain-text Hypertask ticket references (e.g. HTPR-1234) inside an HTML
 * fragment, without touching refs already inside an <a> tag.
 *
 * Kept dependency-free (no DB, no path aliases) so it stays unit-checkable
 * (see ticketRefLinker.check.ts). The DB-backed wrapper that resolves refs to
 * projects lives in linkifyTicketRefs.ts.
 */

const TICKET_REF_PATTERN = /\b[A-Z][A-Z0-9]{1,9}-\d{1,6}\b/g;

/**
 * Splits html into tag/text tokens and flags which tokens sit inside an
 * existing <a>...</a>, so ticket refs are only ever matched/replaced in text
 * nodes that aren't already part of a link.
 */
function tokenizeHtml(html: string) {
  const tokens = html.split(/(<[^>]+>)/g);
  const insideAnchor: boolean[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (/^<a[\s>]/i.test(token)) {
      insideAnchor.push(true);
      depth++;
    } else if (/^<\/a>/i.test(token)) {
      insideAnchor.push(true);
      depth = Math.max(0, depth - 1);
    } else {
      insideAnchor.push(depth > 0);
    }
  }
  return { tokens, insideAnchor };
}

/** Collects unique ticket refs from text nodes, skipping tags and existing links. */
export function findLinkableTicketRefs(html: string): string[] {
  if (!html) return [];
  const { tokens, insideAnchor } = tokenizeHtml(html);
  const refs = new Set<string>();
  tokens.forEach((token, i) => {
    if (token.startsWith("<") || insideAnchor[i]) return;
    for (const match of token.matchAll(TICKET_REF_PATTERN)) {
      refs.add(match[0]);
    }
  });
  return Array.from(refs);
}

/** Wraps refs present in refToProjectId with an anchor; leaves everything else untouched. */
export function applyTicketRefLinks(
  html: string,
  refToProjectId: Map<string, number>
): string {
  if (!html || refToProjectId.size === 0) return html;
  const { tokens, insideAnchor } = tokenizeHtml(html);
  return tokens
    .map((token, i) => {
      if (token.startsWith("<") || insideAnchor[i]) return token;
      return token.replace(TICKET_REF_PATTERN, (match) => {
        const projectId = refToProjectId.get(match);
        if (projectId === undefined) return match;
        const uniqueIndex = match.slice(match.lastIndexOf("-") + 1);
        // data-ai-linkified marks this as a machine-generated link (not a
        // human-authored one), so extractTaskReferencesFromCommentText can
        // skip it and avoid creating a permanent TaskRelations row for every
        // incidental ticket mention in an AI response.
        return `<a href="/detail/project-${projectId}/${uniqueIndex}" data-ai-linkified="1">${match}</a>`;
      });
    })
    .join("");
}

export interface ResolvedTicketRef {
  ticketNumber: string;
  projectId: number;
}

/**
 * Collapses resolved rows into a ticketNumber -> projectId map, dropping any
 * ticketNumber that resolves to more than one distinct project. ticketNumber
 * is only unique per-team, and a user's accessible projects can span teams,
 * so the same ref string can legitimately match multiple tasks. A wrong link
 * is worse than no link, so ambiguous refs are left as plain text.
 */
export function buildUnambiguousRefMap(
  rows: ResolvedTicketRef[]
): Map<string, number> {
  const projectIdsByRef = new Map<string, Set<number>>();
  for (const row of rows) {
    const set = projectIdsByRef.get(row.ticketNumber) ?? new Set<number>();
    set.add(row.projectId);
    projectIdsByRef.set(row.ticketNumber, set);
  }

  const refToProjectId = new Map<string, number>();
  for (const [ref, projectIds] of projectIdsByRef) {
    if (projectIds.size === 1) {
      refToProjectId.set(ref, [...projectIds][0]);
    }
  }
  return refToProjectId;
}

/**
 * Stamps data-ai-linkified="1" onto every task-detail anchor in an
 * AI-generated HTML fragment that doesn't already carry it. The model itself
 * is prompted to emit detail links, and those model-authored anchors must get
 * the same relation-extraction exemption as the ones this module generates —
 * otherwise an incidental AI mention still creates a permanent TaskRelation.
 */
export function markAiDetailAnchors(html: string): string {
  if (!html) return html;
  return html.replace(
    /<a\b([^>]*href=["'][^"']*\/detail\/project-\d+\/\d+[^"']*["'][^>]*)>/gi,
    (full, attrs) =>
      /\bdata-ai-linkified=/.test(attrs) ? full : `<a data-ai-linkified="1"${attrs.startsWith(" ") ? "" : " "}${attrs}>`
  );
}
