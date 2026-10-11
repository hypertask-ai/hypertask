const assert = require("node:assert/strict");
const { Prisma } = require("@prisma/client");
const { load } = require("./task-route-loader.cjs");

const models = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name, model]));
const relationFields = ["id", "uniqueIndex", "ticketNumber", "title", "status", "projectId", "sectionId"];

function row(modelName, overrides = {}) {
  return Object.fromEntries(models.get(modelName).fields
    .filter((field) => field.kind !== "object" && !field.isIgnored)
    .map((field) => {
      let value;
      if (Object.hasOwn(overrides, field.name)) value = overrides[field.name];
      else if (field.isList) value = [];
      else if (!field.isRequired) value = null;
      else if (field.type === "Int") value = 1;
      else if (field.type === "Boolean") value = false;
      else if (field.type === "DateTime") value = "2026-10-06T00:00:00.000Z";
      else if (field.type === "Json") value = { fixture: true };
      else if (field.kind === "enum") value = Prisma.dmmf.datamodel.enums.find(({ name }) => name === field.type).values[0].name;
      else value = `fixture-${field.name}`;
      return [field.name, value];
    }));
}

const task = (id, overrides = {}) => row("Task", {
  id, uniqueIndex: id, ticketNumber: `HTPR-${id}`, title: `Task ${id}`,
  projectId: 15, sectionId: 20, userId: 7, status: "Normal",
  createdAt: "2026-10-06T00:00:00.000Z", updatedByUserIds: [],
  description: "synthetic description ".repeat(200), ...overrides,
});

function graph() {
  const children = [
    task(53, { status: "Archive", createdAt: "2026-10-05T00:00:00.000Z" }),
    task(52, { createdAt: "2026-10-04T00:00:00.000Z" }),
    task(54, { status: "Deleted" }),
  ];
  const parent = task(40);
  parent.subTasks = [task(55, { status: "Archive" }), task(50), task(56, { status: "Deleted" }), task(51)];
  return [{
    ...task(50), section: "To do",
    assignees: [{ user: row("User", { id: 7 }) }],
    comments: [{ id: 70, notifications: [{ id: 71 }] }],
    subTasks: children, parentTask: parent,
  }, { ...task(51), section: null, assignees: [], comments: [], subTasks: [], parentTask: null }];
}

function projectRow(modelName, data, args = {}) {
  const scalars = Object.fromEntries(models.get(modelName).fields
    .filter((field) => field.kind !== "object" && !field.isIgnored).map((field) => [field.name, true]));
  return Object.fromEntries(Object.entries({ ...(args.select ?? scalars), ...args.include })
    .filter(([, enabled]) => enabled).map(([key, selection]) => {
      const field = models.get(modelName).fields.find((candidate) => candidate.name === key);
      assert.ok(field, `${modelName}.${key}`);
      let value = data[key];
      if (field.kind !== "object" || value == null) return [key, value];
      const relation = selection === true ? {} : selection;
      if (Array.isArray(value)) {
        if (relation.where?.status?.not) value = value.filter((item) => item.status !== relation.where.status.not);
        if (relation.orderBy?.createdAt) value = [...value].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return [key, value.map((item) => projectRow(field.type, item, relation))];
      }
      return [key, projectRow(field.type, value, relation)];
    }));
}

const visibility = { boardAgentVisibilityWhere: (userId) => ({ userId, revokedAt: null }) };
const { getProjectWhere } = load("src/utils/controllers/projects/getAllIncludes.ts", {
  "@/lib/agents/visibility": visibility,
  "@/lib/agents/publicAgent": {},
  "@/lib/cycles": {},
  "@/utils/controllers/notifications/visibleInboxScope": {},
});

function fixture({ enabled = false, userId = 7, compat, failFlag = false, failQuery = false, roots = graph(), access = "owner" } = {}) {
  const calls = { queries: [], flags: [], auth: [] };
  const database = { task: { findMany: async (args) => {
    calls.queries.push(args);
    if (failQuery) throw new Error("synthetic query failure");
    assert.deepEqual(args.where.project, getProjectWhere(userId));
    assert.equal(args.where.projectId, 15);
    assert.equal(args.where.status, "Normal");
    if (access === "denied") return [];
    const board = { ownerId: access === "owner" ? userId : 8, teamId: 1, members: access === "member" ? [{ userId, agentId: null }] : [] };
    assert.ok(args.where.project.OR.some((branch) => branch.ownerId === board.ownerId ||
      board.members.some((member) => member.userId === branch.members?.some.userId && member.agentId === branch.members?.some.agentId)));
    return roots.map((item) => projectRow("Task", item, args));
  } } };
  const mocks = {
    "@/lib/api/task-writes/route": { withTaskWriteFlag: handler => handler },
    "@/lib/prisma": { default: database },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere },
    "@/lib/agents/visibility": visibility,
    "@/lib/auth/currentUser": { loadCurrentUser: async (...args) => {
      calls.auth.push(args);
      return userId == null ? null : { userId };
    } },
    "@/lib/flags": { HTPR_6924_REST_COMPAT_FLAG: "htpr-6924-rest-compat", isFeatureEnabled: async (...args) => {
      calls.flags.push(args);
      if (failFlag) throw new Error("synthetic flag failure");
      return enabled;
    } },
  };
  const controller = load("src/utils/controllers/tasks/getAll.ts", mocks).default;
  const handler = load("src/pages/api/tasks/getAll.ts", mocks).default;
  const invoke = (body = { projectId: 15 }, method = "POST", query = compat === undefined ? {} : { compat }) => pages(handler, { method, body, query, headers: {} });
  return { controller, invoke, calls, mocks };
}

async function pages(handler, request) {
  const result = { status: 200, headers: {} };
  const response = {
    status(status) { result.status = status; return this; },
    json(body) { result.text = JSON.stringify(body); result.body = body; return this; },
    setHeader(name, value) { result.headers[name] = value; return this; },
  };
  await handler(request, response);
  return result;
}

module.exports = { fixture, graph, getProjectWhere, models, pages, projectRow, relationFields, row, visibility };
