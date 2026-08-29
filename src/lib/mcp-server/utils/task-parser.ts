/**
 * Utility functions for parsing various task reference formats
 * Supports formats like:
 * - "MYB-48" (ticket number)
 * - "task 48" (task number)
 * - "PROJECT-5-48" (project-task format)
 * - "48" (just the number, requires project_id)
 * - "5-48" (project-task format)
 * - "https://app.hypertask.ai/detail/project-15/3272" (URL format)
 */

export interface ParsedTaskReference {
  projectId?: number;
  uniqueIndex?: number;
  ticketNumber?: string;
  taskId?: number;
}

/**
 * Parses a HyperTasks URL to extract project_id and unique_index
 * Supports formats like:
 * - "https://app.hypertask.ai/detail/project-15/3272"
 * - "https://hypertask.ai/detail/project-15/3272"
 * - "app.hypertask.ai/detail/project-15/3272"
 * 
 * @param url - The URL string to parse
 * @returns ParsedTaskReference with projectId and uniqueIndex, or null if not a valid URL
 */
export function parseHypertaskUrl(url: string): ParsedTaskReference | null {
  const trimmed = url.trim();
  
  // Match URLs like: https://app.hypertask.ai/detail/project-15/3272
  // or: app.hypertask.ai/detail/project-15/3272
  // or: hypertask.ai/detail/project-15/3272
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

/**
 * Parses a task reference string into structured data
 * Examples:
 * - "MYB-48" -> { ticketNumber: "MYB-48" }
 * - "task 48" -> { uniqueIndex: 48 }
 * - "PROJECT-5-48" -> { projectId: 5, uniqueIndex: 48 }
 * - "5-48" -> { projectId: 5, uniqueIndex: 48 }
 * - "48" -> { uniqueIndex: 48 }
 * - "https://app.hypertask.ai/detail/project-15/3272" -> { projectId: 15, uniqueIndex: 3272 }
 */
export function parseTaskReference(
  reference: string,
  defaultProjectId?: number
): ParsedTaskReference {
  const trimmed = reference.trim();

  // First, try to parse as a HyperTasks URL
  const urlParse = parseHypertaskUrl(trimmed);
  if (urlParse) {
    return urlParse;
  }

  // Try to match PROJECT-X-Y format (e.g., "PROJECT-5-48")
  const projectTaskMatch = trimmed.match(/^PROJECT-(\d+)-(\d+)$/i);
  if (projectTaskMatch) {
    return {
      projectId: parseInt(projectTaskMatch[1], 10),
      uniqueIndex: parseInt(projectTaskMatch[2], 10),
    };
  }

  // Try to match X-Y format where both are numbers (e.g., "5-48")
  const simpleProjectTaskMatch = trimmed.match(/^(\d+)-(\d+)$/);
  if (simpleProjectTaskMatch) {
    return {
      projectId: parseInt(simpleProjectTaskMatch[1], 10),
      uniqueIndex: parseInt(simpleProjectTaskMatch[2], 10),
    };
  }

  // Try to match "task X" or "task-X" format
  const taskNumberMatch = trimmed.match(/^task[- ]?(\d+)$/i);
  if (taskNumberMatch) {
    const index = parseInt(taskNumberMatch[1], 10);
    return {
      projectId: defaultProjectId,
      uniqueIndex: index,
    };
  }

  // Try to match ticket number format (e.g., "MYB-48", "DEV-123")
  const ticketNumberMatch = trimmed.match(/^[A-Z0-9]+-\d+$/i);
  if (ticketNumberMatch) {
    return {
      ticketNumber: trimmed.toUpperCase(),
    };
  }

  // Try to match just a number (e.g., "48")
  const numberMatch = trimmed.match(/^(\d+)$/);
  if (numberMatch) {
    const index = parseInt(numberMatch[1], 10);
    return {
      projectId: defaultProjectId,
      uniqueIndex: index,
    };
  }

  // If no pattern matches, treat as ticket number
  return {
    ticketNumber: trimmed,
  };
}

/**
 * Extracts task references from a text string
 * Looks for patterns like: MYB-48, task 48, PROJECT-5-48, etc.
 */
export function extractTaskReferences(
  text: string,
  defaultProjectId?: number
): ParsedTaskReference[] {
  const references: ParsedTaskReference[] = [];
  
  // Pattern to match various task reference formats
  const patterns = [
    // PROJECT-X-Y format
    /PROJECT-(\d+)-(\d+)/gi,
    // X-Y format (project-task)
    /\b(\d+)-(\d+)\b/g,
    // Ticket number format (e.g., MYB-48, DEV-123)
    /\b[A-Z0-9]+-\d+\b/gi,
    // "task X" format
    /task[- ]?(\d+)/gi,
    // Just numbers (context-dependent)
    /\b(\d+)\b/g,
  ];

  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const fullMatch = match[0];
      const parsed = parseTaskReference(fullMatch, defaultProjectId);
      
      // Avoid duplicates
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
