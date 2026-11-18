export const SEED_SIZE_FLOOR = { boards: 3, tickets: 200, members: 8, labels: 1, comments: 1, sectionsUsed: 2 };
export const SEED_TICKET_CEILING = 249;
export const ARCHIVED_SMOKE_PROJECT_ENV = "CORE_SMOKE_ARCHIVED_PROJECT_ID";

export function archivedSmokeProject({ runKey, ownerId, teamId, googleAccountId }) {
  return {
    name: `core-smoke-archived-${runKey}`,
    title: "Archived smoke board",
    ownerId,
    teamId,
    googleAccountId,
    status: "Archive",
    sections: ["Baseline"],
  };
}

const BOARDS = [
  ["fixture", "Core actions smoke", ["Baseline", "Alternate"], "SMOKE"],
  ["board-2", "Core smoke backlog", ["Todo", "Doing", "Done"], "SMK2"],
  ["board-3", "Core smoke review", ["Todo", "Doing", "Done"], "SMK3"],
];
const TICKETS_PER_BOARD = 70;
const MEMBER_COUNT = 8;

export function buildCoreSmokeSeedPlan({ runKey }) {
  const members = Array.from({ length: MEMBER_COUNT }, (_, index) => ({
    index,
    owner: index === 0,
    uid: `core-smoke-${runKey}-${index}`,
    email: `core-smoke-${runKey}-${index}@example.invalid`,
    displayName: index === 0 ? `Core smoke user ${runKey}` : `Core smoke member ${index} ${runKey}`,
  }));
  const boards = BOARDS.map(([key, title, sections, prefix]) => ({
    key,
    title,
    sections,
    prefix,
    tickets: TICKETS_PER_BOARD,
    name: key === "fixture" ? `core-smoke-${runKey}` : `core-smoke-${runKey}-${key}`,
  }));
  const labels = [];
  const tasks = [];
  const comments = [];
  const taskLabels = [];
  for (const board of boards) {
    const boardLabels = ["Bug", "Chore"].map((value) => {
      const label = { id: `core-smoke-label-${board.key}-${value}`, boardKey: board.key, value };
      labels.push(label);
      return label;
    });
    for (let index = 1; index <= board.tickets; index += 1) {
      tasks.push({
        boardKey: board.key,
        uniqueIndex: index,
        ticketNumber: `${board.prefix}-${index}`,
        title: board.key === "fixture" && index === 1 ? "Core actions smoke fixture" : `Core smoke ${board.prefix}-${index}`,
        sectionTitle: board.sections[(index - 1) % board.sections.length],
        ranking: board.key === "fixture" && index === 1 ? "A0100" : `B${String(index).padStart(4, "0")}`,
      });
      if (index % 10 === 1) comments.push({ boardKey: board.key, uniqueIndex: index, text: "Core smoke comment" });
      if (index % 5 === 0) taskLabels.push({ boardKey: board.key, uniqueIndex: index, labelId: boardLabels[index % 2].id });
    }
  }
  return { members, boards, labels, tasks, comments, taskLabels };
}

export function teamRoster(plan) {
  return plan.members.filter((member) => !member.owner)
}

export function boardRecords(plan, googleAccountId) {
  return plan.boards.map((board) => ({ ...board, googleAccountId }))
}

export function seedImplementationGaps(plan, source) {
  const gaps = []
  const roster = teamRoster(plan)
  if (roster.length !== plan.members.length - 1 || roster.some((member) => member.owner)) gaps.push("team roster includes the owner")
  const boards = boardRecords(plan, "account")
  if (boards.length !== plan.boards.length || boards.some((board) => board.googleAccountId !== "account")) gaps.push("boards are missing their google account")
  for (const token of ["buildCoreSmokeSeedPlan({ runKey })", "teamRoster(plan)", "boardRecords(plan, googleAccount.id)", "plan.tasks.map("]) {
    if (!source.includes(token)) gaps.push(`seed missing ${token}`)
  }
  return gaps
}

export function summarizePlan(plan) {
  return {
    boards: plan.boards.length, tickets: plan.tasks.length, members: plan.members.length,
    labels: plan.labels.length, comments: plan.comments.length,
    sectionsUsed: new Set(plan.tasks.map((task) => `${task.boardKey}:${task.sectionTitle}`)).size,
  };
}

export function seedSizeGaps(counts) {
  const gaps = [];
  for (const key of Object.keys(SEED_SIZE_FLOOR)) {
    const actual = counts[key] ?? 0;
    if (actual < SEED_SIZE_FLOOR[key]) gaps.push(`${key} ${actual} is below ${SEED_SIZE_FLOOR[key]}`);
  }
  if ((counts.tickets ?? 0) > SEED_TICKET_CEILING) gaps.push(`tickets ${counts.tickets} is above ${SEED_TICKET_CEILING}`);
  return gaps;
}

export function seedSizeReport(counts) {
  const gaps = seedSizeGaps(counts);
  const line = `core-smoke-seed-size counts ${JSON.stringify(counts)}`;
  return gaps.length
    ? { code: 1, lines: ["core-smoke-seed-size fail", ...gaps.map((gap) => `core-smoke-seed-size ${gap}`), line] }
    : { code: 0, lines: ["core-smoke-seed-size pass", line] };
}

export function countsFromLegacySeedSource(source) {
  const count = (name) => (source.match(new RegExp(`prisma\\.${name}\\.create\\(`, "g")) || []).length;
  const tickets = count("task");
  const sections = count("section");
  return {
    boards: count("project"),
    tickets,
    members: count("member"),
    labels: count("label"),
    comments: count("comment"),
    sectionsUsed: Math.min(sections, tickets),
  };
}
