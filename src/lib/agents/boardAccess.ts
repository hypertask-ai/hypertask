import type { TRegisterBoard } from "./registerView";

export type TAgentBoardAccess = TRegisterBoard & {
  member: boolean;
  canChange: boolean;
  unavailableReason: string | null;
};

export function buildAgentBoardAccess(
  boards: TRegisterBoard[],
  memberProjectIds: number[],
  memberTeamIds: Array<string | null>,
): TAgentBoardAccess[] {
  const memberships = new Set(memberProjectIds);
  const teams = new Set(memberTeamIds);
  const lockedTeam = teams.size === 1 ? [...teams][0] : null;
  const canAdd = teams.size <= 1 && !teams.has(null);

  return boards
    .map((board) => {
      const member = memberships.has(board.id);
      const sameTeam = canAdd && (!lockedTeam || board.teamId === lockedTeam);
      return {
        ...board,
        member,
        canChange: member || sameTeam,
        unavailableReason:
          member || sameTeam ? null : "Agent belongs to another team",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function setAgentBoardMembership(
  boards: TAgentBoardAccess[],
  projectId: number,
  member: boolean,
): TAgentBoardAccess[] {
  const memberProjectIds = boards
    .filter((board) => (board.id === projectId ? member : board.member))
    .map((board) => board.id);
  const memberTeamIds = boards
    .filter((board) => memberProjectIds.includes(board.id))
    .map((board) => board.teamId);

  return buildAgentBoardAccess(boards, memberProjectIds, memberTeamIds);
}
