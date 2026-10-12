// HTPR-7161: a bookmark (star or pin) can never reach a task or comment the
// signed-in user cannot read, and the bookmark lists only show readable tasks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

const ACCESS = { accessFor: 'user' };

function loadModule(file, stubs) {
  const filename = path.join(root, file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(code, {
    module: loaded, exports: loaded.exports, require: (id) => stubs[id] ?? require(id),
    console: { log() {}, error() {} }, Headers, Number,
  }, { filename });
  return loaded.exports;
}

// Board 1 belongs to the user; task 10 (comment 100) lives there. Task 20
// (comment 200) lives on board 2 of another team.
const TASKS = [{ id: 10, projectId: 1 }, { id: 20, projectId: 2 }];
const COMMENTS = [{ id: 100, taskId: 10 }, { id: 200, taskId: 20 }];

function loadToggle() {
  const calls = { created: [], taskWhere: [] };
  const tx = {
    savedContent: {
      findFirst: async () => null,
      deleteMany: async () => ({ count: 0 }),
      create: async ({ data }) => { calls.created.push(data); return { id: 'saved', ...data }; },
    },
  };
  const prisma = {
    task: {
      findFirst: async ({ where }) => {
        calls.taskWhere.push(where);
        const task = TASKS.find((t) => t.id === where.id);
        // The real access predicate only matches board 1 for this user.
        return task && where.project === ACCESS && task.projectId === 1 ? task : null;
      },
    },
    comment: {
      findFirst: async ({ where }) =>
        COMMENTS.find((c) => c.id === where.id && c.taskId === where.taskId) ?? null,
    },
  };
  const handler = loadModule('src/pages/api/savedContent/toggleSaved.ts', {
    '@/utils/controllers/savedContent/helper': { includeSavedContentComment: () => true },
    '@/lib/taskCardActions/writeLocks': { withTaskStarWriteLock: async (_id, op) => op(tx) },
    '@/lib/auth/getSessionUser': { getSessionUser: async () => ({ userId: 7 }) },
    '@/lib/prisma': { __esModule: true, default: prisma },
    '@/utils/controllers/projects/getAllIncludes': { projectContentAccessWhere: () => ACCESS },
  }).default;
  async function call(body) {
    const res = { statusCode: 0, body: undefined, status(code) { this.statusCode = code; return this; }, json(b) { this.body = b; return this; } };
    await handler({ headers: {}, body }, res);
    return res;
  }
  return { call, calls };
}

test('starring a task on another team\'s board is refused and saves nothing', async () => {
  const { call, calls } = loadToggle();
  const res = await call({ taskId: 20, projectId: 1, type: 'Private' });
  assert.equal(res.statusCode, 404);
  assert.equal(calls.created.length, 0);
  assert.equal(calls.taskWhere[0].project, ACCESS);
});

test('pinning another team\'s comment onto your own task is refused', async () => {
  const { call, calls } = loadToggle();
  for (const type of ['Private', 'Public']) {
    const res = await call({ taskId: 10, projectId: 1, commentId: 200, type });
    assert.equal(res.statusCode, 404, type);
  }
  assert.equal(calls.created.length, 0);
});

test('the saved board comes from the task, not from the request', async () => {
  const { call, calls } = loadToggle();
  const res = await call({ taskId: 10, projectId: 999, commentId: '100', type: 'Public' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(
    { taskId: calls.created[0].taskId, projectId: calls.created[0].projectId, commentId: calls.created[0].commentId },
    { taskId: 10, projectId: 1, commentId: 100 },
  );
});

test('your own star still works', async () => {
  const { call, calls } = loadToggle();
  const res = await call({ taskId: 10, projectId: 1, type: 'Private' });
  assert.equal(res.statusCode, 200);
  assert.equal(calls.created[0].commentId, null);
});

test('bad input is rejected before any lookup', async () => {
  const { call, calls } = loadToggle();
  for (const body of [{ projectId: 1, type: 'Private' }, { taskId: 10, type: 'Other' }, { taskId: 10, type: 'Public' }, { taskId: 10, commentId: 'x', type: 'Private' }]) {
    assert.equal((await call(body)).statusCode, 400, JSON.stringify(body));
  }
  assert.equal(calls.taskWhere.length, 0);
});

test('bookmark lists only read tasks the user can access, and drop comments from other tasks', async () => {
  const where = [];
  const rows = [
    { taskId: 10, comment: { taskId: 10 } },
    { taskId: 10, comment: { taskId: 20 } },
  ];
  const prisma = { savedContent: { findMany: async (q) => { where.push(q.where); return rows; } } };
  const helper = loadModule('src/utils/controllers/savedContent/helper.ts', {
    '@/utils/controllers/projects/getAllIncludes': { projectContentAccessWhere: () => ACCESS },
    '@/lib/prisma': { __esModule: true, default: {} },
  });
  const stubs = {
    '@/lib/prisma': { __esModule: true, default: prisma },
    '@/utils/controllers/projects/getAllIncludes': { projectContentAccessWhere: () => ACCESS },
    './helper': { ...helper, fetchProjectIds: async () => [1], includeSavedContentComment: () => true },
  };
  const starred = await loadModule('src/utils/controllers/savedContent/getAllStarred.ts', stubs).getAllStarred(7);
  const pinned = await loadModule('src/utils/controllers/savedContent/getAllPinned.ts', stubs).getAllPinned(7);
  assert.equal(where.length, 4);
  for (const w of where) assert.equal(w.task.project, ACCESS);
  assert.equal(starred.json.pinnedComments.length, 1);
  assert.equal(pinned.json.personalPins.length, 1);
  assert.equal(pinned.json.teamPins.length, 1);
});
