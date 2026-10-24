process.env.TZ = "UTC";

const NOW = Date.parse("2026-11-18T12:00:00.000Z");
const human = { id: 6, uid: "human-6", displayName: "Valentin" };
const other = { id: 7, uid: "human-7", displayName: "Ada" };
const agent = { id: "agent-a", displayName: "Builder" };
const agentB = { id: "agent-b", displayName: "Zebra" };
const humanRow = { userId: 6, agentId: null, user: human };
const agentRow = { userId: 6, agentId: agent.id, user: human, agent };
const fields = ["Text", "Number", "Date", "Select", "Checkbox"].map((type, i) => ({
  id: `00000000-0000-4000-8000-00000000000${i}`,
  name: type,
  type,
}));
const date = (day) => `2026-${day}T12:00:00.000Z`;
const columns = ["Inbox", "Doing", "Done", "Valentin Review", "UX Sign-off", "Empty", "Hidden"].map((section_title, i) => ({
  id: i + 1, sectionId: i + 1, section_title, ranking: String(i),
  visibility: i !== 6, isDone: i === 2,
}));
const definitions = [
  ["a", "Bravo", 2, 1, 2, "11-18", "11-18", "11-18", 1],
  ["b", "Alpha", 10, 2, 3, "11-17", "11-17", "11-17", 1],
  ["c", "Charlie", 100, 3, 4, "11-12", "11-12", "11-24", 2],
  ["d", "Delta", 3, 4, 5, "10-20", "10-20", "11-01", 3],
  ["e", "Echo", 20, null, 6, "10-19", "10-19", "11-25", 4],
  ["f", "Foxtrot", 1, 0, 0, "11-22", "11-22", null, 5],
  ["g", "Golf", 200, null, null, null, null, null, 1],
  ["h", "Hotel", 11, 2, 3, "11-01", null, "12-01", 2],
];
const values = [
  ["Bravo", 2, "11-18", "Zebra", "true"],
  ["Alpha", 10, "11-17", "Alpha", "false"],
  ["Charlie", -1, "11-24", "Middle", "true"],
  ["Delta", 0, "11-01", "Beta", "false"],
  ["Echo", 20, "11-25", "Omega", "true"],
  null,
  null,
  ["Bravo", 2, "11-18", "Zebra", "false"],
];

function fixture() {
  const tasks = definitions.map(([id, title, uniqueIndex, priority, size, created, updated, due, sectionId], i) => ({
    id, title, uniqueIndex, ticketNumber: `HTPR-${uniqueIndex}`, projectId: 15,
    sectionId, section: columns[sectionId - 1].section_title,
    ranking: String.fromCharCode(104 - i),
    status: id === "e" ? "Archive" : id === "f" ? "Deleted" : "Normal",
    priority: priority === null ? null : { priority_index: priority },
    estimate: size === null ? null : { estimate_index: size },
    createdAt: created ? date(created) : undefined,
    updatedAt: updated ? date(updated) : undefined,
    dueDate: due ? date(due) : null,
    sectionChangedAt: id === "e" ? date("11-18") : created ? date(created) : undefined,
    lastCommentAt: id === "e" ? date("11-18") : created ? date(created) : undefined,
    userId: i % 2 === 0 ? 6 : 7,
    agentId: id === "b" ? agent.id : id === "e" ? agentB.id : null,
    updatedByUserIds: [i % 2 === 0 ? 7 : 6],
    assignees: structuredClone([
      [humanRow], [agentRow], [humanRow, agentRow],
      [{ userId: 7, agentId: null, user: other }],
      [{ userId: 7, agentId: agentB.id, user: other, agent: agentB }],
      [], [], [agentRow, humanRow],
    ][i]),
    taskLabels: ([ ["red"], ["blue"], ["red", "blue"], [], ["red"], ["blue"], [], ["red"] ][i]).map((id) => ({ label: { id } })),
    notifications: id === "a" ? [{ seen: false }] : id === "b" ? [{ seen: true }] : [],
    savedContent: id === "a" || id === "c" ? [{ userId: 6 }] : [],
    waitingOnUserId: id === "a" ? 6 : id === "b" ? 7 : null,
    blockingTasks: id === "c" ? [{ id: "blocker" }] : [],
    cycleId: id === "a" || id === "b" ? 1 : id === "c" ? 2 : null,
    description: "description-only needle",
    subTasks: [],
    customFieldValues: values[i] ? fields.map((field, j) => ({
      fieldId: field.id,
      value: j === 2 ? date(values[i][j]) : String(values[i][j]),
      numericValue: j === 1 ? values[i][j] : j === 2 ? Date.parse(date(values[i][j])) : null,
    })) : id === "f" ? fields.map((field) => ({ fieldId: field.id, value: null, numericValue: null })) : [],
  }));
  delete tasks[6].assignees;
  delete tasks[6].taskLabels;
  delete tasks[6].notifications;
  const sections = columns.filter((column) => column.visibility).map((column) => ({
    ...column, items: tasks.filter((task) => task.sectionId === column.id),
  }));
  const project = { id: 15, section: structuredClone(columns), tasks, sections,
    timeTrackingEnabled: true, showTimeTotals: true, staleWarnDays: 7, staleHotDays: 20,
    project_view: { id: "project-view", allViews: [], user_project_views: [{}] },
  };
  const runtime = { runningTaskIds: new Set(["a", "e"]) };
  const timeTotals = new Map([
    ["a", { totalSeconds: 20, calculatedAt: new Date(NOW - 10000).toISOString(), runningTimers: [{ startedAt: new Date(NOW - 20000).toISOString(), pausedAt: null }] }],
    ["b", { totalSeconds: 10, calculatedAt: new Date(NOW).toISOString(), runningTimers: [{ startedAt: new Date(NOW - 60000).toISOString(), pausedAt: new Date(NOW).toISOString() }] }],
    ["c", { totalSeconds: 100, calculatedAt: new Date(NOW).toISOString(), runningTimers: [] }],
  ]);
  return { tasks, sections, project, runtime, timeTotals };
}

const ids = (tasks) => tasks.map((task) => task.id);
const sectionIds = (sections) => sections.flatMap((section) => ids(section.items));
const BASE = ["a", "b", "g", "c", "h", "d", "e", "f"];
module.exports = { NOW, human, other, agent, agentB, fields, columns, date, fixture, ids, sectionIds, BASE };
