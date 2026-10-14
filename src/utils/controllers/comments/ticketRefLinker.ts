
const TICKET_REF_PATTERN = /\b[A-Z][A-Z0-9]{1,9}-\d{1,6}\b/g;

function splitHtmlTags(html: string): string[] {
  const tokens: string[] = [];
  let textStart = 0;
  let i = html.indexOf("<");
  while (i !== -1) {
    const close = html.indexOf(">", i + 1);
    if (close === -1) break;
    if (close === i + 1) {
      i = html.indexOf("<", i + 1);
      continue;
    }
    tokens.push(html.slice(textStart, i), html.slice(i, close + 1));
    textStart = close + 1;
    i = html.indexOf("<", textStart);
  }
  tokens.push(html.slice(textStart));
  return tokens;
}

function tokenizeHtml(html: string) {
  const tokens = splitHtmlTags(html);
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
        return `<a href="/detail/project-${projectId}/${uniqueIndex}" data-ai-linkified="1">${match}</a>`;
      });
    })
    .join("");
}

export interface ResolvedTicketRef {
  ticketNumber: string;
  projectId: number;
}

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

export function markAiDetailAnchors(html: string): string {
  if (!html) return html;
  return html.replace(
    /<a\b([^>]*href=["'][^"']*\/detail\/project-\d+\/\d+[^"']*["'][^>]*)>/gi,
    (full, attrs) =>
      /\bdata-ai-linkified=/.test(attrs) ? full : `<a data-ai-linkified="1"${attrs.startsWith(" ") ? "" : " "}${attrs}>`
  );
}
