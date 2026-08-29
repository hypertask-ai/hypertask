/**
 * Task Link Utilities
 * 
 * Constructs HyperTasks task URLs for MCP clients.
 * 
 * Link format: https://app.hypertask.ai/detail/project-{projectId}/{uniqueIndex}
 * 
 * The uniqueIndex is the numeric part of the ticket number (e.g., "HTPR-3550" → 3550)
 */

const HYPERTASKS_BASE_URL = 'https://app.hypertask.ai';

/**
 * Extracts the unique index from a ticket number
 * 
 * @param ticketNumber - Ticket number in format "PREFIX-NUMBER" (e.g., "HTPR-3550", "MyB-61")
 * @returns The numeric unique index, or null if format is invalid
 * 
 * @example
 * extractUniqueIndex("HTPR-3550") // Returns 3550
 * extractUniqueIndex("MyB-61")   // Returns 61
 */
export function extractUniqueIndex(ticketNumber: string): number | null {
  if (!ticketNumber || typeof ticketNumber !== 'string') {
    return null;
  }

  // Extract number after the last dash
  const parts = ticketNumber.split('-');
  if (parts.length < 2) {
    return null;
  }

  const numberPart = parts[parts.length - 1];
  const uniqueIndex = parseInt(numberPart, 10);

  if (isNaN(uniqueIndex) || uniqueIndex <= 0) {
    return null;
  }

  return uniqueIndex;
}

/**
 * Builds a HyperTasks task detail URL
 * 
 * @param projectId - The project ID
 * @param uniqueIndex - The task's unique index (numeric part of ticket number)
 * @returns Full URL to the task detail page
 * 
 * @example
 * buildTaskLink(15, 3550) // Returns "https://app.hypertask.ai/detail/project-15/3550"
 */
export function buildTaskLink(projectId: number, uniqueIndex: number): string {
  return `${HYPERTASKS_BASE_URL}/detail/project-${projectId}/${uniqueIndex}`;
}

/**
 * Builds a task link from a ticket number and project ID
 * 
 * @param ticketNumber - Ticket number (e.g., "HTPR-3550", "MyB-61")
 * @param projectId - The project ID
 * @returns Full URL to the task detail page, or null if ticket number is invalid
 * 
 * @example
 * buildTaskLinkFromTicket("HTPR-3550", 15) // Returns "https://app.hypertask.ai/detail/project-15/3550"
 * buildTaskLinkFromTicket("MyB-61", 5)     // Returns "https://app.hypertask.ai/detail/project-5/61"
 */
export function buildTaskLinkFromTicket(ticketNumber: string, projectId: number): string | null {
  const uniqueIndex = extractUniqueIndex(ticketNumber);
  if (uniqueIndex === null) {
    return null;
  }

  return buildTaskLink(projectId, uniqueIndex);
}

/**
 * Builds a task link with a custom base URL (for CLI when using staging/localhost).
 * Derive baseUrl from API URL: new URL(apiUrl).origin
 *
 * @param baseUrl - App base URL (e.g. https://app.hypertask.ai, http://localhost:3000)
 * @param ticketNumber - Ticket number (e.g., "HTPR-3550")
 * @param projectId - The project ID
 * @returns Full URL to the task detail page, or null if ticket number is invalid
 */
export function buildTaskLinkFromTicketWithBase(
  baseUrl: string,
  ticketNumber: string,
  projectId: number
): string | null {
  const uniqueIndex = extractUniqueIndex(ticketNumber);
  if (uniqueIndex === null) return null;
  const base = baseUrl.replace(/\/$/, '');
  return `${base}/detail/project-${projectId}/${uniqueIndex}`;
}

/**
 * Builds a HyperTasks project URL
 *
 * @param baseUrl - App base URL (e.g. https://app.hypertask.ai)
 * @param projectId - The project ID
 * @returns Full URL to the project page
 */
export function buildProjectLink(baseUrl: string, projectId: number): string {
  const base = baseUrl.replace(/\/$/, '');
  return `${base}/project?id=${projectId}`;
}

/**
 * Builds a HyperTasks comment anchor URL
 *
 * @param baseUrl - App base URL
 * @param projectId - The project ID
 * @param ticketNumber - Ticket number (e.g., "HTPR-3550")
 * @param commentId - The comment ID
 * @returns Full URL with comment anchor, or null if ticket number is invalid
 */
export function buildCommentLink(
  baseUrl: string,
  projectId: number,
  ticketNumber: string,
  commentId: number
): string | null {
  const uniqueIndex = extractUniqueIndex(ticketNumber);
  if (uniqueIndex === null) return null;
  const base = baseUrl.replace(/\/$/, '');
  return `${base}/detail/project-${projectId}/${uniqueIndex}#comment-${commentId}`;
}

/**
 * Gets task link information for MCP clients
 * 
 * @param task - Task object with ticketNumber and projectId
 * @returns Link information object, or null if link cannot be constructed
 */
export function getTaskLinkInfo(task: { ticketNumber?: string; projectId: number }): {
  url: string;
  format: string;
  example: string;
} | null {
  if (!task.ticketNumber || !task.projectId) {
    return null;
  }

  const uniqueIndex = extractUniqueIndex(task.ticketNumber);
  if (uniqueIndex === null) {
    return null;
  }

  const url = buildTaskLink(task.projectId, uniqueIndex);

  return {
    url,
    format: `https://app.hypertask.ai/detail/project-{projectId}/{uniqueIndex}`,
    example: `https://app.hypertask.ai/detail/project-${task.projectId}/${uniqueIndex}`,
  };
}
