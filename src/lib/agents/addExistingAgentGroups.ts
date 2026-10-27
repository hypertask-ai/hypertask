import type { TRegisterBoard } from "./registerView";
import { canAttachAgentToTeam } from "@/utils/controllers/agents/teamScope";

export type OwnedAgentForBoard = {
  id: string;
  displayName: string;
  photoURL?: string | null;
  revokedAt: string | null;
  archivedAt?: string | null;
  boards: TRegisterBoard[];
};

export function addExistingAgentGroups(
  ownedAgents: OwnedAgentForBoard[],
  projectId: number,
  boardTeamId: string | null,
  keyword: string,
  crossTeamEnabled = false,
) {
  const onThisTeam: OwnedAgentForBoard[] = [];
  const notOnAnyBoard: OwnedAgentForBoard[] = [];
  const unavailable: Array<{ agent: OwnedAgentForBoard; reason: string }> = [];
  const search = keyword.trim().toLowerCase();

  for (const agent of ownedAgents) {
    if (
      agent.archivedAt ||
      agent.boards.some((board) => board.id === projectId) ||
      !agent.displayName.toLowerCase().includes(search)
    ) {
      continue;
    }

    if (agent.revokedAt) {
      unavailable.push({ agent, reason: "Turn the agent on before adding it" });
    } else if (!boardTeamId) {
      unavailable.push({ agent, reason: "Board does not belong to a team" });
    } else if (agent.boards.length === 0) {
      notOnAnyBoard.push(agent);
    } else if (
      crossTeamEnabled || (
        canAttachAgentToTeam(agent.boards.map((board) => board.teamId), boardTeamId) &&
        agent.boards.some((board) => board.teamId === boardTeamId)
      )
    ) {
      onThisTeam.push(agent);
    } else {
      unavailable.push({ agent, reason: "Agent belongs to another team" });
    }
  }

  return { onThisTeam, notOnAnyBoard, unavailable };
}
