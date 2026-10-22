const assert = require('node:assert/strict');
const test = require('node:test');
const { load } = require('./task-route-loader.cjs');
const { fixture: listFixture, session, id, flag } = require('./ai-chat-session-fixture.cjs');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture(options = {}) {
  const rows = options.rows ?? [session(1, { userId: 985, messages: [
    { id: 'human', role: 'human', content: 'question', attachments: [] },
    { id: 'assistant', role: 'assistant', content: 'answer', attachments: [] },
  ] })];
  const files = options.files ?? [];
  const calls = [], removedObjects = [];
  const matches = (row, where) => (where.userId === undefined || row.userId === where.userId) &&
    (where.id === undefined || (typeof where.id === 'string' ? row.id === where.id : where.id.in.includes(row.id)));
  const chatSession = {
    findMany: async ({ where }) => rows.filter((row) => matches(row, where)).map(({ id }) => ({ id })),
    findFirst: async ({ where }) => rows.find((row) => matches(row, where)) ?? null,
    deleteMany: async ({ where }) => {
      calls.push('delete');
      await options.beforeDelete?.();
      if (options.deleteError) throw options.deleteError;
      const removed = rows.filter((row) => matches(row, where));
      rows.splice(0, rows.length, ...rows.filter((row) => !matches(row, where)));
      return { count: removed.length };
    },
    delete: async ({ where }) => {
      const row = rows.find((row) => matches(row, where));
      if (!row) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
      await chatSession.deleteMany({ where });
      return row;
    },
    count: async ({ where }) => {
      calls.push('count');
      if (options.countError) throw options.countError;
      return rows.filter((row) => matches(row, where)).length;
    },
    create: async ({ data }) => {
      calls.push('create');
      if (options.createError) throw options.createError;
      const created = session(99, { ...data, messages: [] });
      rows.push(created);
      return created;
    },
    update: async ({ where }) => {
      const row = rows.find((row) => matches(row, where));
      if (!row) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
      return row;
    },
  };
  const chatMessage = {
    createMany: async ({ data }) => {
      for (const message of data) {
        const parent = rows.find((row) => row.id === message.sessionId);
        if (!parent) throw Object.assign(new Error('Foreign key constraint'), { code: 'P2003' });
        parent.messages.push(message);
      }
      return { count: data.length };
    },
  };
  const attachment = {
    findMany: async ({ where }) => {
      calls.push('attachments');
      const messageIds = rows.filter((row) => where.chatMessage.sessionId.in.includes(row.id))
        .flatMap((row) => row.messages.map(({ id }) => id));
      return files.filter((file) => messageIds.includes(file.chatMessageId));
    },
    deleteMany: async ({ where }) => {
      calls.push('deleteAttachments');
      files.splice(0, files.length, ...files.filter((file) => !where.id.in.includes(file.id)));
      return { count: where.id.in.length };
    },
  };
  const db = {
    chatSession, chatMessage, attachment,
    $transaction: async (run) => {
      const savedRows = structuredClone(rows), savedFiles = structuredClone(files);
      try { return await run({ chatSession, chatMessage, attachment }); }
      catch (error) {
        rows.splice(0, rows.length, ...savedRows);
        files.splice(0, files.length, ...savedFiles);
        throw error;
      }
    },
  };
  const mocks = {
    '@/lib/prisma': { default: db },
    '@/lib/auth/currentUser': { loadCurrentUser: async () => options.unauthorized ? null : { userId: 985, user: { id: 985 } } },
    '@/lib/flags': { HTPR_6924_REST_COMPAT_FLAG: flag, isFeatureEnabled: async () => options.compat ?? true },
    '@/utils/edgeHelpers': { isValidUser: () => ({ isValid: !options.unauthorized, user: options.unauthorized ? null : { id: 985 } }) },
    '@/lib/redis': { getRedis: async () => {
      if (options.cacheError) throw options.cacheError;
      return { eval: async () => 1 };
    } },
    '@/lib/storage/uploadTaskAttachmentToS3': { deleteTaskAttachmentFromS3: async (source) => {
      removedObjects.push(source);
      if (options.storageError) throw options.storageError;
      return true;
    } },
    'next/headers': { cookies: async () => ({ get: () => ({ value: 'fixture-cookie' }) }) },
    'next/server': { NextResponse: Response },
  };
  const { DELETE } = load('src/app/api/ai-chat/delete-session/route.ts', mocks);
  const { persistAssistantMessage } = load('src/app/api/ai/chat/stream/persistAssistantMessage.ts', {});
  return {
    rows, files, calls, removedObjects, db,
    remove: (sessionId = id(1)) => DELETE(new Request(`https://example.test/api/ai-chat/delete-session${sessionId === null ? '' : `?delete=${sessionId}`}`, { method: 'DELETE' })),
    finish: (linkify = async (text) => text) => persistAssistantMessage({
      db, sessionId: id(1), userId: 985, messageId: 'finishing-reply', content: 'final answer', linkify,
    }),
  };
}

async function withLogs(run) {
  const errors = [], warnings = [];
  const error = console.error, warn = console.warn;
  console.error = (...args) => errors.push(args);
  console.warn = (...args) => warnings.push(args);
  try { return await run({ errors, warnings }); }
  finally { console.error = error; console.warn = warn; }
}

for (const compat of [false, true]) {
  test(`fresh answered chat deletion removes messages and attachments (compat=${compat})`, async () => {
    const f = fixture({ compat, files: [{ id: 7, chatMessageId: 'human', fileSource: 'owned.png' }] });
    const response = await f.remove();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { message: `Session ${id(1)} deleted successfully` });
    assert.equal(f.rows.some((row) => row.id === id(1)), false);
    assert.equal(f.rows.flatMap((row) => row.messages).length, 0);
    assert.deepEqual(f.files, []);
    assert.deepEqual(f.removedObjects, ['owned.png']);
    assert.equal(f.rows.length, 1, 'last-chat deletion still seeds an empty replacement');
  });

  test(`another user's session is refused before attachment side effects (compat=${compat})`, async () => {
    const foreign = session(2, { userId: 986 });
    const files = [{ id: 8, chatMessageId: foreign.messages[0].id, fileSource: 'foreign.png' }];
    const f = fixture({ compat, rows: [foreign], files });
    assert.equal((await f.remove(id(2))).status, 404);
    assert.deepEqual(f.rows, [foreign]);
    assert.equal(f.files.length, 1);
    assert.deepEqual(f.removedObjects, []);
    assert.deepEqual(f.calls, []);
  });

  test(`own session is still allowed through the same ownership boundary (compat=${compat})`, async () => {
    const foreign = session(2, { userId: 986 });
    const f = fixture({ compat, rows: [session(1, { userId: 985 }), foreign] });
    assert.equal((await f.remove()).status, 200);
    assert.equal(f.rows.some((row) => row.id === id(1)), false);
    assert.deepEqual(f.rows.find((row) => row.id === id(2)), foreign);
  });
}

for (const failure of ['countError', 'createError']) {
  test(`committed deletion stays successful when ${failure} throws`, () => withLogs(async ({ errors }) => {
    const error = new Error('replacement bookkeeping failed');
    const f = fixture({ [failure]: error });
    assert.equal((await f.remove()).status, 200);
    assert.equal(f.rows.some((row) => row.id === id(1)), false);
    assert.ok(errors.some(([message, cause]) => message.includes('after deletion') && cause === error));
  }));
}

test('failed database deletion rolls back attachment cleanup and reports failure', () => withLogs(async () => {
  const f = fixture({ deleteError: new Error('delete failed'), files: [{ id: 7, chatMessageId: 'human', fileSource: 'owned.png' }] });
  assert.equal((await f.remove()).status, 500);
  assert.equal(f.rows[0].messages.length, 2);
  assert.equal(f.files.length, 1);
  assert.deepEqual(f.removedObjects, []);
}));

test('storage cleanup throwing after deletion logs and still returns success', () => withLogs(async ({ errors }) => {
  const error = new Error('storage unavailable');
  const f = fixture({ storageError: error, files: [{ id: 7, chatMessageId: 'human', fileSource: 'owned.png' }] });
  assert.equal((await f.remove()).status, 200);
  assert.equal(f.rows.some((row) => row.id === id(1)), false);
  assert.ok(errors.some(([message, , cause]) => message.includes('storage cleanup failed') && cause === error));
}));

test('the real Redis cache/rate-limit step throwing logs but does not fail deletion', () => withLogs(async ({ warnings }) => {
  const f = fixture({ cacheError: new Error('cache unavailable') });
  assert.equal((await f.remove()).status, 200);
  assert.equal(f.rows.some((row) => row.id === id(1)), false);
  assert.ok(warnings.some(([message]) => message.includes('[rest-rate-limit] Counter unavailable')));
}));

test('finishing stream persistence before deletion is cascaded with the other messages', async () => {
  let f;
  f = fixture({ beforeDelete: async () => { assert.equal(await f.finish(), true); } });
  assert.equal((await f.remove()).status, 200);
  assert.equal(f.rows.flatMap((row) => row.messages).length, 0);
});

test('deletion while a finishing stream is linkifying cannot return a server error or resurrect its session', async () => {
  const entered = deferred(), release = deferred();
  const f = fixture();
  const finishing = f.finish(async (text) => { entered.resolve(); await release.promise; return text; });
  await entered.promise;
  const deleted = await f.remove();
  release.resolve();
  // The stream caller already catches persistence errors; the FK prevents resurrection.
  await assert.rejects(finishing, { code: 'P2003' });
  assert.equal(deleted.status, 200);
  assert.equal(f.rows.some((row) => row.id === id(1)), false);
  assert.equal(await f.finish(), false);
});

test('next legacy load and cached compat cursor both exclude the deleted chat', async () => {
  const rows = [session(9, { userId: 985 }), session(1, { userId: 985 })];
  const listing = listFixture({ rows, userId: 985 });
  const first = await (await listing.get('compat=htpr-6924&limit=1')).json();
  assert.deepEqual(first.sessions.map(({ id }) => id), [id(9)]);
  assert.ok(first.nextCursor);
  const f = fixture({ rows });
  assert.equal((await f.remove()).status, 200);
  const legacy = await (await listing.get()).json();
  assert.deepEqual(legacy.sessions.map(({ id }) => id), [id(9)]);
  const cursor = await (await listing.get(`compat=htpr-6924&limit=1&cursor=${first.nextCursor}`)).json();
  assert.deepEqual(cursor.sessions, [], 'a stale cached ID is rechecked against the database');
  const refreshed = await (await listing.get('compat=htpr-6924&limit=1')).json();
  assert.deepEqual(refreshed.sessions.map(({ id }) => id), [id(9)]);
});

test('delete ALL removes only owned sessions and preserves an empty replacement', async () => {
  const foreign = session(2, { userId: 986 });
  const f = fixture({ rows: [session(1, { userId: 985 }), session(3, { userId: 985 }), foreign] });
  assert.equal((await f.remove('ALL')).status, 200);
  assert.deepEqual(f.rows.find((row) => row.id === id(2)), foreign);
  assert.deepEqual(f.rows.filter((row) => row.userId === 985).map((row) => row.messages), [[]]);
});

test('missing id remains 400 without database or storage side effects', async () => {
  const f = fixture();
  const response = await f.remove(null);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Session ID is required or ALL tag required' });
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.removedObjects, []);
});

test('unauthenticated deletion remains refused', async () => {
  const f = fixture({ unauthorized: true });
  assert.equal((await f.remove()).status, 401);
  assert.deepEqual(f.calls, []);
});
