
export interface ParsedTaskReference {
  projectId?: number;
  uniqueIndex?: number;
  ticketNumber?: string;
  taskId?: number;
}

export function parseHypertaskUrl(url: string): ParsedTaskReference | null {
  const trimmed = url.trim();
  
  const urlMatch = trimmed.match(
    /(?:https?:\/\/)?(?:app\.)?hypertask\.ai\/detail\/project-(\d+)\/(\d+)/i
  );
  
  if (urlMatch) {
    return {
      projectId: parseInt(urlMatch[1], 10),
      uniqueIndex: parseInt(urlMatch[2], 10),
    };
  }
  
  return null;
}

export function parseTaskReference(
  reference: string,
  defaultProjectId?: number
): ParsedTaskReference {
  const trimmed = reference.trim();

  const urlParse = parseHypertaskUrl(trimmed);
  if (urlParse) {
    return urlParse;
  }

  const projectTaskMatch = trimmed.match(/^PROJECT-(\d+)-(\d+)$/i);
  if (projectTaskMatch) {
    return {
      projectId: parseInt(projectTaskMatch[1], 10),
      uniqueIndex: parseInt(projectTaskMatch[2], 10),
    };
  }

  const simpleProjectTaskMatch = trimmed.match(/^(\d+)-(\d+)$/);
  if (simpleProjectTaskMatch) {
    return {
      projectId: parseInt(simpleProjectTaskMatch[1], 10),
      uniqueIndex: parseInt(simpleProjectTaskMatch[2], 10),
    };
  }

  const taskNumberMatch = trimmed.match(/^task[- ]?(\d+)$/i);
  if (taskNumberMatch) {
    const index = parseInt(taskNumberMatch[1], 10);
    return {
      projectId: defaultProjectId,
      uniqueIndex: index,
    };
  }

  const ticketNumberMatch = trimmed.match(/^[A-Z0-9]+-\d+$/i);
  if (ticketNumberMatch) {
    return {
      ticketNumber: trimmed.toUpperCase(),
    };
  }

  const numberMatch = trimmed.match(/^(\d+)$/);
  if (numberMatch) {
    const index = parseInt(numberMatch[1], 10);
    return {
      projectId: defaultProjectId,
      uniqueIndex: index,
    };
  }

  return {
    ticketNumber: trimmed,
  };
}

export function extractTaskReferences(
  text: string,
  defaultProjectId?: number
): ParsedTaskReference[] {
  const references: ParsedTaskReference[] = [];
  
  const patterns = [
    /PROJECT-(\d+)-(\d+)/gi,
    /\b(\d+)-(\d+)\b/g,
    /\b[A-Z0-9]+-\d+\b/gi,
    /task[- ]?(\d+)/gi,
    /\b(\d+)\b/g,
  ];

  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const fullMatch = match[0];
      const parsed = parseTaskReference(fullMatch, defaultProjectId);
      
      const isDuplicate = references.some((ref) => {
        if (parsed.ticketNumber && ref.ticketNumber === parsed.ticketNumber) return true;
        if (
          parsed.projectId &&
          parsed.uniqueIndex &&
          ref.projectId === parsed.projectId &&
          ref.uniqueIndex === parsed.uniqueIndex
        ) {
          return true;
        }
        return false;
      });

      if (!isDuplicate) {
        references.push(parsed);
      }
    }
  }

  return references;
}
