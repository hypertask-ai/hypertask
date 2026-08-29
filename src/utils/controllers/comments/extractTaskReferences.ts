/**
 * Extracts task references from comment text (HTML or plain).
 * Used by createCommentService to create related tasks for MCP/CLI comments
 * and comments that may have been saved without client-side relation extraction.
 *
 * Supports:
 * - URL pattern: /detail/project-{projectId}/{uniqueIndex}
 * - HTML span: span[data-label="task"] with projectId and uniqueIndex
 * - Ticket number: PROJ-123 format (search by ticketNumber)
 */
export interface TaskReference {
  projectId: string;
  uniqueIndex: string;
}

/**
 * Extracts task references from comment text.
 * Returns unique { projectId, uniqueIndex } pairs for addRelatedTasks.
 */
export function extractTaskReferencesFromCommentText(text: string): TaskReference[] {
  const seen = new Set<string>();
  const refs: TaskReference[] = [];

  const addIfNew = (projectId: string, uniqueIndex: string) => {
    const key = `${projectId}-${uniqueIndex}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ projectId, uniqueIndex });
  };

  // Drop AI-generated ticket links (HTPR-3953 linkifyTicketRefs, marked with
  // data-ai-linkified="1") before scanning. Those are incidental ticket
  // mentions in an AI response, not a human-authored relation, so they must
  // not silently create a permanent TaskRelations row.
  const withoutAiLinks = text.replace(
    /<a\b[^>]*\bdata-ai-linkified=["']1["'][^>]*>[\s\S]*?<\/a>/gi,
    ""
  );

  // 1. URL pattern: /detail/project-{projectId}/{uniqueIndex}
  // Matches: href="/detail/project-4/70", https://app.hypertask.ai/detail/project-4/70, detail/project-4/70
  const urlRegex = /detail\/project-(\d+)\/(\d+)/gi;
  let urlMatch: RegExpExecArray | null;
  while ((urlMatch = urlRegex.exec(withoutAiLinks)) !== null) {
    addIfNew(urlMatch[1], urlMatch[2]);
  }

  // 2. HTML span: span[data-label="task"] with projectId and uniqueIndex attributes
  // Attribute order may vary
  const spanProjectFirst = /<span[^>]*data-label=["']task["'][^>]*projectId=["'](\d+)["'][^>]*uniqueIndex=["'](\d+)["'][^>]*>/gi;
  let spanMatch: RegExpExecArray | null;
  while ((spanMatch = spanProjectFirst.exec(withoutAiLinks)) !== null) {
    addIfNew(spanMatch[1], spanMatch[2]);
  }

  const spanIndexFirst = /<span[^>]*data-label=["']task["'][^>]*uniqueIndex=["'](\d+)["'][^>]*projectId=["'](\d+)["'][^>]*>/gi;
  while ((spanMatch = spanIndexFirst.exec(withoutAiLinks)) !== null) {
    addIfNew(spanMatch[2], spanMatch[1]);
  }

  return refs;
}
