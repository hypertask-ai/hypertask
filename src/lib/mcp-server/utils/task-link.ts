
const HYPERTASKS_BASE_URL = 'https://app.hypertask.ai';

export function extractUniqueIndex(ticketNumber: string): number | null {
  if (!ticketNumber || typeof ticketNumber !== 'string') {
    return null;
  }

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

export function buildTaskLink(projectId: number, uniqueIndex: number): string {
  return `${HYPERTASKS_BASE_URL}/detail/project-${projectId}/${uniqueIndex}`;
}

export function buildTaskLinkFromTicket(ticketNumber: string, projectId: number): string | null {
  const uniqueIndex = extractUniqueIndex(ticketNumber);
  if (uniqueIndex === null) {
    return null;
  }

  return buildTaskLink(projectId, uniqueIndex);
}

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

export function buildProjectLink(baseUrl: string, projectId: number): string {
  const base = baseUrl.replace(/\/$/, '');
  return `${base}/project?id=${projectId}`;
}

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
