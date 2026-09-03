/**
 * Remembers the team of the last board the user opened, so pages with no
 * board context of their own (Agent Chat) can default to "the team I'm
 * currently working in" instead of a separately-remembered preference.
 *
 * Set by the board page whenever it loads a project with a team
 * (`src/app/[...boardURL]/LandingPage.tsx`); read by Agent Chat as its
 * default team filter, and by the Alt+Shift+Arrow team-cycle shortcut to
 * know which team to cycle away from off a board page.
 */

const LAST_BOARD_TEAM_KEY = "lastBoardTeamId";

export function getLastBoardTeam(): string | null {
  try {
    return window.localStorage.getItem(LAST_BOARD_TEAM_KEY);
  } catch {
    // Private browsing and hardened policies can reject localStorage.
    return null;
  }
}

export function setLastBoardTeam(teamId: string): void {
  try {
    window.localStorage.setItem(LAST_BOARD_TEAM_KEY, teamId);
  } catch {
    // Private browsing and hardened policies can reject localStorage.
  }
}
