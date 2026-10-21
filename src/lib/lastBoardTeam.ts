
const LAST_BOARD_TEAM_KEY = "lastBoardTeamId";

export function getLastBoardTeam(): string | null {
  try {
    return window.localStorage.getItem(LAST_BOARD_TEAM_KEY);
  } catch {
    return null;
  }
}

export function setLastBoardTeam(teamId: string): void {
  try {
    window.localStorage.setItem(LAST_BOARD_TEAM_KEY, teamId);
  } catch {
  }
}
