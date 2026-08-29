const TICKET_REF_PATTERN = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;
const TASK_URL_PATTERN =
  /\b(?:https?:\/\/)?app\.hypertask\.ai\/detail\/project-(\d+)\/(\d+)\b/g;

export type SlackTaskUrlReference = {
  projectId: number;
  uniqueIndex: number;
};

export type SlackTaskReferences = {
  taskUrls: SlackTaskUrlReference[];
  ticketNumbers: string[];
};

export function extractSlackTaskReferences(text: string): SlackTaskReferences {
  const ticketNumbers = [...new Set(text.match(TICKET_REF_PATTERN) ?? [])];
  const taskUrls = new Map<string, SlackTaskUrlReference>();

  for (const match of text.matchAll(TASK_URL_PATTERN)) {
    const projectId = Number(match[1]);
    const uniqueIndex = Number(match[2]);
    if (!Number.isSafeInteger(projectId) || !Number.isSafeInteger(uniqueIndex)) {
      continue;
    }
    taskUrls.set(`${projectId}:${uniqueIndex}`, { projectId, uniqueIndex });
  }

  return { ticketNumbers, taskUrls: [...taskUrls.values()] };
}

export function hasSlackTaskReferences(refs: SlackTaskReferences): boolean {
  return refs.ticketNumbers.length > 0 || refs.taskUrls.length > 0;
}

export function filterSlackTaskIdsForTeam(
  tasks: Array<{ id: number; project: { teamId: string | null } }>,
  teamId: string,
): number[] {
  return tasks
    .filter((task) => task.project.teamId === teamId)
    .map((task) => task.id);
}
