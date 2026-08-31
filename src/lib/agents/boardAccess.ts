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
      const sameTeam =
        board.teamId !== null &&
        canAdd &&
        (!lockedTeam || board.teamId === lockedTeam);
      let unavailableReason: string | null = null;
      if (!member && !sameTeam) {
        unavailableReason = "Agent belongs to another team";
        if (board.teamId === null) {
          unavailableReason = "Board does not belong to a team";
        }
      }
      return {
        ...board,
        member,
        canChange: member || sameTeam,
        unavailableReason,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
