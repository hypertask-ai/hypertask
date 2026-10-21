export interface TaskReference {
  projectId: string;
  uniqueIndex: string;
}

export function extractTaskReferencesFromCommentText(text: string): TaskReference[] {
  const seen = new Set<string>();
  const refs: TaskReference[] = [];

  const addIfNew = (projectId: string, uniqueIndex: string) => {
    const key = `${projectId}-${uniqueIndex}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ projectId, uniqueIndex });
  };

  const withoutAiLinks = text.replace(
    /<a\b[^>]*\bdata-ai-linkified=["']1["'][^>]*>[\s\S]*?<\/a>/gi,
    ""
  );

  const urlRegex = /detail\/project-(\d+)\/(\d+)/gi;
  let urlMatch: RegExpExecArray | null;
  while ((urlMatch = urlRegex.exec(withoutAiLinks)) !== null) {
    addIfNew(urlMatch[1], urlMatch[2]);
  }

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
