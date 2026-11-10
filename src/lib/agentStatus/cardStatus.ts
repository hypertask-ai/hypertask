import type { IProject, ITask } from "@/models/model";
import { agentStatusIsFresh, agentStatusText, agentStepFor, type AgentStep } from "./chip";
import { useMinuteClock } from "./minuteClock";

export type CardAgentStatus = { agentName: string; step: AgentStep; text: string };

export function useCardAgentStatus(task: ITask, project?: IProject): CardAgentStatus | null {
  const minute = useMinuteClock(Boolean(task.agentStatus));
  const status = task.agentStatus;
  if (!status || !agentStatusIsFresh(status.at, minute)) return null;
  const step = agentStepFor(
    project?.sections?.find((section) => section.id === task.sectionId)?.section_title,
    (task.taskLabels ?? []).map((taskLabel) => taskLabel.label?.value ?? ""),
  );
  return { agentName: status.agentName, step, text: agentStatusText(status.agentName, step, status.at) };
}

export function stackFaces<U extends { displayName?: string | null }, A extends { displayName?: string | null }>(
  users: readonly U[],
  agents: readonly A[],
  statusAgent?: string,
  max = 5,
): { users: U[]; agents: A[] } {
  const working = agents.find((agent) => agent.displayName === statusAgent);
  const others = agents.filter((agent) => agent !== working).slice(0, working ? max - 1 : max);
  return { users: users.slice(0, max), agents: working ? [...others, working] : others };
}
