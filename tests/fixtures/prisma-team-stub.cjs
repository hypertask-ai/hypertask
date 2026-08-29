// Minimal prisma stand-in for the plan gate: one team, whatever the test sets.
const state = { team: null };
module.exports = {
  __esModule: true,
  setTeam(team) {
    state.team = team;
  },
  default: {
    project: { findUnique: async () => ({ team: state.team }) },
    team: { findUnique: async () => state.team },
  },
};
