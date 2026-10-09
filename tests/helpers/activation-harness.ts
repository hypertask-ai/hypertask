import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const root = path.resolve(__dirname, "../..");
const nativeRequire = createRequire(__filename);

export function activationHarness() {
  const captures: any[] = [];
  const captureAttempts: any[] = [];
  const jobs: Promise<unknown>[] = [];
  const logs: any[] = [];
  let enabled = true;
  let failure: "capture" | "constructor" | "database" | "schedule" | null = null;
  const users = new Map<number, any>([[123, { id: 123, uid: "real_123", email: "member@example.test", displayName: "Member" }]]);
  const projects = new Map<number, any>([[15, { id: 15, ownerId: 123, title: "Board", teamId: "team", owner: users.get(123), team: { title: "Team" }, section: [] }]]);
  const sections = [{ id: 1, section_title: "Doing", isDone: false }, { id: 2, section_title: "Done", isDone: true }, { id: 3, section_title: "Delivered", isDone: true }, { id: 4, section_title: "Done", isDone: false }];
  const tasks = new Map<number, any>([[9, { id: 9, projectId: 15, sectionId: 1, section: "Doing", status: "Normal", userId: 123, title: "Task", updatedAt: new Date(0), uniqueIndex: 9 }]]);
  const invites: any[] = [];
  const members: any[] = [];
  const history: any[] = [];
  const matches = (row: any, where: any): boolean => {
    if (!where) return true;
    return Object.entries(where).every(([key, value]: [string, any]) => {
      if (key === "OR") return value.some((part: any) => matches(row, part));
      if (key === "log" && typeof value === "object" && value?.startsWith) return row.log.startsWith(value.startsWith);
      if (key === "createdAt" && value?.lt) return !row.createdAt || row.createdAt < value.lt;
      return row[key] === value;
    });
  };
  const prisma: any = {
    user: { findUnique: async ({ where }: any) => { if (failure === "database") throw Error("mock database unavailable"); return users.get(where.id); } },
    logs: {
      findFirst: async ({ where }: any) => logs.find((row) => matches(row, where)) ?? null,
      create: async ({ data }: any) => { logs.push({ ...data, id: logs.length + 1, createdAt: data.createdAt ?? new Date() }); return logs.at(-1); },
    },
    project: {
      findUnique: async ({ where }: any) => projects.get(where.id),
      findFirst: async ({ where }: any) => projects.get(where.id),
      findMany: async ({ where }: any) => [...projects.values()].filter((row) => row.ownerId === where.ownerId),
      count: async ({ where }: any) => [...projects.values()].filter((row) => row.ownerId === where.ownerId).length,
      create: async ({ data }: any) => { const project = { ...data, id: 20 + projects.size, owner: users.get(data.ownerId), team: { title: "Team" } }; projects.set(project.id, project); return project; },
      update: async ({ where, data }: any) => Object.assign(projects.get(where.id), data),
      updateMany: async ({ where, data }: any) => { for (const id of where.id.in) Object.assign(projects.get(id), data); return { count: where.id.in.length }; },
    },
    task: {
      findUnique: async ({ where }: any) => ({ ...tasks.get(where.id) }),
      update: async ({ where, data }: any) => { Object.assign(tasks.get(where.id), data, { updatedAt: new Date() }); return { ...tasks.get(where.id) }; },
    },
    section: {
      findMany: async ({ where }: any) => sections.filter((section) => where.id.in.includes(section.id)),
      findFirst: async ({ where }: any) => sections.find((section) => section.id === where.id),
      create: async ({ data }: any) => ({ ...data, id: 1 }),
    },
    comment: { findMany: async ({ where }: any) => history.filter((row) => !where.createdAt?.lt || !row.createdAt || row.createdAt < where.createdAt.lt) },
    taskSectionEvent: { create: async () => ({}) },
    agent: { findUnique: async () => ({ id: "managed", userId: 123, displayName: "Agent" }) },
    invite: {
      findFirst: async ({ where }: any) => invites.find((invite) => matches(invite, where)),
      findMany: async () => invites,
      create: async ({ data }: any) => { const invite = { ...data, id: `invite-${invites.length + 1}`, invitedBy: users.get(data.userId), project: projects.get(data.projectId) }; invites.push(invite); return invite; },
      update: async () => ({}),
    },
    member: {
      count: async () => 0,
      findFirst: async ({ where }: any) => members.find((member) => matches(member, where)),
      create: async ({ data }: any) => { const member = { ...data, user: users.get(data.userId) }; members.push(member); return member; },
      deleteMany: async () => ({}), updateMany: async () => ({}),
    },
    team: { findFirst: async () => ({ googleAccount: { userId: 123 }, members: [] }), findUnique: async () => ({ googleAccount: { userId: 123 } }), updateMany: async () => ({}) },
    member_Team: { findFirst: async () => ({ status: "Accepted" }), findUnique: async () => ({ status: "Accepted" }), updateMany: async () => ({}) },
    assignees: { updateMany: async () => ({}) },
    notification: { updateMany: async () => ({}) },
    $executeRaw: async () => 0,
  };
  prisma.user.update = async () => ({});
  // Serialized callbacks model the user advisory lock, including parallel claims.
  let transactionTail = Promise.resolve();
  prisma.$transaction = (callback: any) => {
    const transaction = transactionTail.then(() => callback(prisma));
    transactionTail = transaction.catch(() => undefined);
    return transaction;
  };
  const prismaCalls: string[] = [];
  for (const [model, methods] of Object.entries(prisma)) {
    if (typeof methods === "function") {
      prisma[model] = (...args: any[]) => { prismaCalls.push(model); return methods(...args); };
    } else {
      const functions = methods as Record<string, any>;
      for (const [method, implementation] of Object.entries(functions)) {
        functions[method] = (...args: any[]) => { prismaCalls.push(`${model}.${method}`); return implementation(...args); };
      }
    }
  }
  const flagChecks: { key: string; userId: number }[] = [];
  const noop = async () => undefined;
  const mocks: Record<string, any> = {
    "server-only": {},
    "@/lib/prisma": { default: prisma },
    "@/lib/flags": { FEATURE_FLAG_QA_USER_ID: 985, HTPR_7034_ACTIVATION_ANALYTICS_FLAG: "htpr-7034-activation-analytics", isFeatureEnabled: async (key: string, userId: number) => { flagChecks.push({ key, userId }); return enabled; } },
    "@vercel/functions": { waitUntil: (promise: Promise<unknown>) => { jobs.push(promise); if (failure === "schedule") throw Error("mock schedule unavailable"); } },
    "posthog-node": { PostHog: class {
      constructor() { if (failure === "constructor") throw Error("mock client unavailable"); }
      captureImmediate = async (capture: any) => {
        captureAttempts.push(capture);
        prismaCalls.push("captureImmediate");
        if (failure === "capture") throw Error("mock capture unavailable");
        const { uuid, ...payload } = capture;
        captures.push(payload);
      };
    } },
    "@/utils/controllers/logs/createLog": { default: noop },
    "@/lib/projectPrefix": { normalizeProjectPrefix: (value: any) => value, suggestProjectPrefix: () => "BOARD" },
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": { buildDefaultTitle: () => "Board", getViewFromProject: () => undefined },
    "@/utils/helperFunctions/Views/FilterHelperFunctions": { defaultFilterSettings: {} },
    "@/utils/controllers/projects/boardQuota": { isBoardLimitReached: async () => false },
    "@/utils/controllers/projects/getAll": { getProjectViewInclude: () => ({}) },
    "@/utils/controllers/notifications/sendNotification": { sendEmailNotification: async () => true },
    "@/lib/demo/guestGuard": { isGuestRequest: async () => false },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 123 }) },
    "@/utils/controllers/getMemberAndOwnerForBoard": { default: async () => [123] },
    "@/lib/auth/session": { verifySession: () => ({ id: 50 }) },
    "@/lib/subscription": {},
    "@/lib/configs/general.config": { generalConfig: { hyperAiId: 77 } },
    "@/lib/stripeCustomerName": {},
    "@/lib/onboarding/installCommands": { CLI_INSTALL_COMMAND: "mock-install-command", CLI_LOGIN_COMMAND: "hypertask login", CLI_WINDOWS_NOTE: "mock-windows-note" },
    "@/utils/helperFunctions/helperFunctions": { getSequentialLetters: () => "BOARD" },
    "@/utils/controllers/projects/createProjectWithStableName": { createProjectWithStableName: async (data: any) => prisma.project.create({ data }) },
    "@/utils/controllers/tasks/createTaskCore": { createTaskCore: async () => ({ task: { id: 8 } }) },
    "@/utils/controllers/assignees/assign": { default: noop },
    "@/pages/api/invite/createInviteLink": { generateInviteLink: (id: string) => `http://localhost/invite?key=${id}`, setViewSlug: () => undefined },
    "@/utils/controllers/projects/create": { createProjectViewAndCreateDefault: noop },
    "@/lib/seatBillingLock": { withTeamSeatBillingLock: async (_id: any, callback: any) => callback(() => {}) },
    "@/lib/teamMembership": {},
    "@/lib/syncSeatBilling": {},
    "@/utils/controllers/members/updateTrial": { updateTrial: noop },
  };
  const cache = new Map<string, any>();
  function load(file: string, source?: string): any {
    const absolute = path.resolve(root, file);
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const loaded = { exports: {} as any };
    cache.set(absolute, loaded);
    const compiled = ts.transpileModule(source ?? fs.readFileSync(absolute, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const requireMock = (name: string) => {
      let key = name;
      if (name.startsWith(".")) key = "@/" + path.relative(path.join(root, "src"), path.resolve(path.dirname(absolute), name)).replace(/\.ts$/, "");
      if (key in mocks) return { __esModule: true, ...mocks[key] };
      if (key.startsWith("@/")) {
        const allowed = ["@/lib/telemetry/", "@/lib/demo/guest", "@/lib/mcp/clientTelemetry", "@/lib/mcp/oauthTokenContract", "@/lib/mcp/boards/columnRole", "@/lib/mcp/tasks/humanMutationOverride"];
        if (!allowed.some((prefix) => key.startsWith(prefix))) throw Error(`Unmocked dependency ${key}`);
        return load(`src/${key.slice(2)}.ts`);
      }
      return nativeRequire(name);
    };
    vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`, { filename: absolute })(requireMock, loaded, loaded.exports);
    return loaded.exports;
  }
  async function drain() { for (let index = 0; index < jobs.length; index++) await jobs[index]; }
  return { captures, captureAttempts, logs, jobs, users, projects, sections, tasks, invites, members, history, prisma, prismaCalls, flagChecks, mocks, load, drain, setEnabled: (value: boolean) => { enabled = value; }, setFailure: (value: typeof failure) => { failure = value; } };
}
