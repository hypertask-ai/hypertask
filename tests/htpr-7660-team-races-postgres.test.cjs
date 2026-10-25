const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { load } = require('./task-route-loader.cjs');
const { NextRequest } = require('next/server');

const root = path.resolve(__dirname, '..');
const image = process.env.HTPR_PG_IMAGE || 'ghcr.io/hypertask-ai/ci-postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea';
const container = `htpr7660-${process.pid}-${Date.now()}`;
const run = (command, args, options = {}) => spawnSync(command, args, { encoding: 'utf8', timeout: 120_000, ...options });
let prisma;
let skipReason;
let started = false;

before(async () => {
  if (!process.env.CI && process.env.HT_REQUIRE_PG_TESTS !== '1') {
    skipReason = 'CI-only disposable database test';
    return;
  }
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const url = `postgresql://ht:ht@127.0.0.1:${port}/ht_test`;
  const start = run('docker', ['run', '-d', '--name', container, '-e', 'POSTGRES_USER=ht', '-e', 'POSTGRES_PASSWORD=ht', '-e', 'POSTGRES_DB=ht_test', '-p', `127.0.0.1:${port}:5432`, '--health-cmd', 'pg_isready -U ht -d ht_test', '--health-interval', '1s', '--health-retries', '30', image]);
  assert.equal(start.status, 0, start.stderr);
  started = true;
  const ready = run('docker', ['exec', container, 'sh', '-c', 'for i in $(seq 1 60); do pg_isready -U ht -d ht_test && exit 0; sleep 0.5; done; exit 1']);
  assert.equal(ready.status, 0, ready.stderr);
  const schema = run(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema', path.join(root, 'src/prisma/schema.prisma'), '--script'], { env: { ...process.env, DATABASE_URL: url } });
  assert.equal(schema.status, 0, schema.stderr);
  const apply = run('docker', ['exec', '-i', container, 'psql', '-U', 'ht', '-d', 'ht_test', '-v', 'ON_ERROR_STOP=1'], { input: schema.stdout });
  assert.equal(apply.status, 0, apply.stderr);
  const { PrismaClient } = require('@prisma/client');
  const { PrismaPg } = require('@prisma/adapter-pg');
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
});

after(async () => {
  if (prisma) await prisma.$disconnect();
  if (started) assert.equal(run('docker', ['rm', '-f', container]).status, 0);
});

async function fixture(actor = 'bound') {
  const stamp = `${Date.now()}-${Math.random()}`;
  const user = await prisma.user.create({ data: { uid: stamp, email: `${stamp}@example.invalid` } });
  const account = await prisma.googleAccount.create({ data: { userId: user.id, stripe_customer_id: stamp } });
  const teamA = await prisma.team.create({ data: { googleAccountId: account.id, totalSeats: 1 } });
  const teamB = await prisma.team.create({ data: { googleAccountId: account.id, totalSeats: 1 } });
  const teamScope = actor === 'bound' ? { teamId: teamA.id, accessBinding: `owner:${account.id}:0` } : null;
  const agent = await prisma.agent.create({ data: { userId: user.id, displayName: 'Race agent', permissions: { role: 'write' }, credentialTeamId: teamScope?.teamId, credentialTeamAccessBinding: teamScope?.accessBinding } });
  const project = await prisma.project.create({ data: { name: stamp, ownerId: user.id, teamId: teamA.id, members: { create: { userId: user.id, agentId: agent.id, status: 'Accepted' } } } });
  const other = await prisma.project.create({ data: { name: `${stamp}-other`, ownerId: user.id, teamId: teamB.id, members: { create: { userId: user.id, agentId: agent.id, status: 'Accepted' } } } });
  const task = await prisma.task.create({ data: { projectId: project.id, userId: user.id, uniqueIndex: 1, section: 'Todo', title: 'Before move', description: '' } });
  const page = await prisma.page.create({ data: { projectId: project.id, createdById: user.id, title: 'Before move' } });
  const principal = { userId: user.id, agentId: agent.id, teamScope };
  const move = {
    Project: () => prisma.project.update({ where: { id: project.id }, data: { teamId: teamB.id } }),
    Task: () => prisma.task.update({ where: { id: task.id }, data: { projectId: other.id } }),
    Page: () => prisma.page.update({ where: { id: page.id }, data: { projectId: other.id } }),
  };
  const mocks = {
    '@/lib/prisma': { default: prisma },
    '@/lib/auth/agentScope': { agentScopeEnforced: () => true, recordAgentBoardScopeMiss: () => {} },
    '@/lib/flags': { isFeatureEnabled: async () => false },
    '@/lib/realtime/server': { broadcastBoardChange: () => {} },
    '@/utils/controllers/turbopuffer/turbopufferHelper': { convertToPlain: value => value, upsertPageToTurbopuffer: async () => {}, deletePageFromTurbopuffer: async () => {} },
    '@/utils/controllers/activities/createLabelActivity': { default: async () => {} },
    '@/utils/controllers/urls/extractUrlsFromContent': {},
    '@/lib/agentWebhooks/outbox': {},
    '@/lib/mcp/routeWrapper': { wrapMcpRoute: handler => handler, checkMcpRouteRateLimit: async () => null, validateMcpRouteAuth: async () => ({ user, agentId: agent.id, teamScope }) },
    '@/lib/mcp/agents/readRoleGuard': { requireAgentWriteRole: async () => null },
  };
  return { user, agent, project, other, task, page, principal, move, mocks, load: (file, extra = {}) => load(file, { ...mocks, ...extra }) };
}

function observedClient({ beforeTransaction, afterRead, afterCommit, onError } = {}) {
  const observe = tx => new Proxy(tx, { get(target, key) {
    const value = target[key];
    if (!['project', 'task', 'page'].includes(key) || !afterRead) return typeof value === 'function' ? value.bind(target) : value;
    return new Proxy(value, { get(model, operation) {
      if (!['findFirst', 'findUnique'].includes(operation)) return model[operation];
      return async args => { const result = await model[operation](args); await afterRead(key, result); return result; };
    } });
  } });
  return new Proxy(prisma, { get(target, key) {
    if (key === '$transaction') return async (callback, options) => {
      await beforeTransaction?.();
      let result;
      try { result = await prisma.$transaction(tx => callback(observe(tx)), { timeout: 15_000, ...options }); }
      catch (error) { onError?.(error); throw error; }
      await afterCommit?.();
      return result;
    };
    return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
  } });
}

async function assertMoveBlocked(table, id, destination) {
  const field = table === 'Project' ? 'teamId' : 'projectId';
  await assert.rejects(prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '150ms'");
    await tx.$executeRawUnsafe(`UPDATE "${table}" SET "${field}" = $2 WHERE id = $1`, id, destination);
  }), error => error.code === 'P2010' && /55P03/.test(JSON.stringify(error)));
}

for (const [kind, table] of [['report', 'Project'], ['view', 'Project'], ['page', 'Page'], ['page', 'Project']]) {
  for (const ordering of kind === 'page' && table === 'Project' ? ['move-first'] : ['move-first', 'write-first']) {
    for (const actor of ['bound', 'unbound']) {
      test(`real PG ${kind} ${table} ${ordering} ${actor}`, async t => {
        if (skipReason) return t.skip(skipReason);
        const f = await fixture(actor);
        let witnessed = false;
        const db = observedClient({
          beforeTransaction: ordering === 'move-first' ? f.move[table] : undefined,
          afterRead: ordering === 'write-first' && actor === 'bound' ? async (model, result) => {
            if (model !== table.toLowerCase() || witnessed || !result) return;
            witnessed = true;
            await assertMoveBlocked(table, kind === 'page' ? f.page.id : f.project.id, table === 'Project' ? f.other.teamId : f.other.id);
          } : undefined,
        });
        if (kind === 'report' && actor === 'unbound' && ordering === 'move-first') await f.move.Project();
        const extra = { '@/lib/prisma': { default: db } };
        let write;
        if (kind === 'report') write = () => f.load('src/utils/controllers/reports/reportService.ts', extra).createReport({ ...f.principal, projectId: f.project.id, slug: 'race', title: 'Race', bodyHtml: '<p>Race</p>' });
        if (kind === 'view') write = () => f.load('src/lib/mcp/views/services.ts', extra).createView({ ...f.principal, projectId: f.project.id, title: 'Race', setAsDefault: true });
        if (kind === 'page') write = () => f.load('src/utils/controllers/pages/pageService.ts', extra).updatePage({ ...f.principal, id: f.page.id, title: 'Changed' });
        const denied = ordering === 'move-first' && actor === 'bound';
        if (denied && kind !== 'report') await assert.rejects(write(), /not found|access denied/);
        else if (denied) assert.equal(await write(), null);
        else {
          const result = await write();
          assert.equal(kind === 'page' ? result.title : result.projectId, kind === 'page' ? 'Changed' : f.project.id);
        }
        if (kind === 'report') assert.equal(await prisma.report.count({ where: { projectId: f.project.id } }), denied ? 0 : 1);
        if (kind === 'view') {
          assert.equal(await prisma.view.count({ where: { project_view: { projectId: f.project.id } } }), denied ? 0 : 1);
          assert.equal(await prisma.project_View.count({ where: { projectId: f.project.id } }), denied ? 0 : 1);
        }
        if (kind === 'page') {
          assert.equal((await prisma.page.findUniqueOrThrow({ where: { id: f.page.id } })).title, denied ? 'Before move' : 'Changed');
          assert.equal(await prisma.docVersion.count({ where: { entityType: 'page', entityId: f.page.id } }), denied ? 0 : 1);
        }
        if (ordering === 'write-first') {
          assert.equal(witnessed, actor === 'bound');
          await f.move[table]();
        }
      });
    }
  }
}

for (const action of ['claim', 'heartbeat', 'release']) {
  for (const [ordering, table] of [['move-first', 'Task'], ['move-first', 'Project'], ['write-first', 'Task']]) {
    for (const actor of ['bound', 'unbound']) {
      test(`real PG lease ${action} ${table} ${ordering} ${actor}`, async t => {
        if (skipReason) return t.skip(skipReason);
        const f = await fixture(actor);
        const token = require('node:crypto').randomUUID();
        if (action !== 'claim') await prisma.taskLease.create({ data: { taskId: f.task.id, holder: f.user.id, agentId: f.agent.id, token, expiresAt: new Date(Date.now() + 60_000), heartbeatAt: new Date(0) } });
        const before = await prisma.taskLease.findUnique({ where: { taskId: f.task.id } });
        if (actor === 'unbound' && ordering === 'move-first') await f.move[table]();
        let witnessed = false;
        const db = observedClient({
          beforeTransaction: ordering === 'move-first' ? f.move[table] : undefined,
          afterRead: ordering === 'write-first' && actor === 'bound' ? async (model, result) => {
            if (model === 'task' && result && !witnessed) {
              witnessed = true;
              await assertMoveBlocked('Task', f.task.id, f.other.id);
            }
          } : undefined,
        });
        const route = f.load(`src/app/api/mcp/tasks/lease/${action}/route.ts`, { '@/lib/prisma': { default: db } });
        const response = await route.POST(new NextRequest('http://localhost/api/mcp/tasks/lease', { method: 'POST', body: JSON.stringify({ task_id: f.task.id, lease_token: token, ttl_seconds: 300 }) }));
        const denied = actor === 'bound' && ordering === 'move-first';
        assert.equal(response.status, denied ? 404 : 200, await response.text());
        const after = await prisma.taskLease.findUnique({ where: { taskId: f.task.id } });
        if (denied) assert.deepEqual(after, before);
        else if (action === 'release') assert.equal(after, null);
        else {
          assert.equal(after.agentId, f.agent.id);
          assert.equal(after.token, token);
          assert.ok(after.heartbeatAt > (before?.heartbeatAt ?? new Date(0)));
          if (before) assert.ok(after.expiresAt > before.expiresAt);
        }
        if (ordering === 'write-first') {
          assert.equal(witnessed, actor === 'bound');
          await f.move.Task();
        }
      });
    }
  }
}

for (const [phase, table] of [['move-first', 'Task'], ['move-first', 'Project'], ['write-first', 'Task'], ['reconcile', 'Task'], ['reconcile', 'Project']]) {
  for (const actor of ['bound', 'unbound']) {
    test(`real PG upload ${table} ${phase} ${actor}`, async t => {
      if (skipReason) return t.skip(skipReason);
      const f = await fixture(actor);
      let transactions = 0;
      let witnessed = false;
      const transactionErrors = [];
      assert.equal((await f.load('src/lib/mcp/tasks/resolveTask.ts').findTaskByIdentifier(f.user, { task_id: f.task.id }, f.agent.id, undefined, f.principal.teamScope)).id, f.task.id);
      const db = observedClient({
        beforeTransaction: async () => {
          transactions++;
          if (phase === 'move-first' || phase === 'reconcile' && transactions === 2) await f.move[table]();
        },
        afterRead: phase === 'write-first' && actor === 'bound' ? async (model, result) => {
          if (model === 'task' && result && !witnessed) {
            witnessed = true;
            await assertMoveBlocked('Task', f.task.id, f.other.id);
          }
        } : undefined,
        afterCommit: async () => { if (phase === 'reconcile' && transactions === 1) throw new Error('Lost commit acknowledgement'); },
        onError: error => transactionErrors.push(error),
      });
      const uploader = f.load('src/lib/mcp/attachments/storeLockedBatch.ts');
      const file = { kind: 'data', filename: 'race.txt', contentType: 'text/plain', buffer: Buffer.from('race') };
      const upload = () => uploader.storeAttachmentBatchWithTargetLock(db, [file], { taskId: f.task.id, targetKey: 'race' }, { ...f.principal, taskId: f.task.id, commentId: null, descriptionId: null }, {
        withTargetLock: (_key, callback) => callback(),
        buildKey: () => 'race-key',
        upload: async () => 'https://storage.example.invalid/race.txt',
      });
      const denied = actor === 'bound' && phase !== 'write-first';
      if (denied) {
        await assert.rejects(upload(), error => error.status === 500);
        assert.equal(transactionErrors.at(-1)?.status, 404);
      }
      else assert.equal((await upload()).length, 1);
      assert.equal(await prisma.attachment.count({ where: { taskId: f.task.id } }), phase === 'move-first' && actor === 'bound' ? 0 : 1);
      if (phase === 'reconcile') assert.equal(transactions, 2);
      if (phase === 'write-first') {
        assert.equal(witnessed, actor === 'bound');
        await f.move.Task();
      }
    });
  }
}

for (const kind of ['board', 'agent']) {
  for (const [moved, table] of [['unchanged', 'Project'], ['before-send', 'Project'], ['after-send', 'Project'], ['before-send', 'Task'], ['after-send', 'Task']]) {
    for (const actor of ['bound', 'unbound']) {
      test(`real PG ${kind} delayed send and retry ${table} ${moved} ${actor}`, async t => {
        if (skipReason) return t.skip(skipReason);
        const f = await fixture(actor);
        const board = kind === 'board';
        const subscriptionModel = board ? prisma.webhookSubscription : prisma.agentWebhookSubscription;
        const deliveryModel = board ? prisma.boardWebhookDelivery : prisma.agentWebhookDelivery;
        const subscription = await subscriptionModel.create({ data: { agentId: f.agent.id, projectId: f.project.id, url: 'https://receiver.example.invalid/hook', secret: 'throwaway-test-secret', events: ['task.assigned'], ...(board ? { createdById: f.user.id, createdByAgentId: f.agent.id } : {}) } });
        const payload = board ? { event: 'task.assigned', data: { task: { id: f.task.id, projectId: f.project.id } } } : { event: 'task.assigned', projectId: f.project.id, taskId: f.task.id };
        const delivery = await deliveryModel.create({ data: { subscriptionId: subscription.id, event: 'task.assigned', payload, nextAttemptAt: new Date(0) } });
        const calls = [];
        const extra = {
          '@/lib/mcp/webhooks/delivery': { postSignedWebhook: async input => { calls.push(input); return { ok: true, statusCode: 200, durationMs: 1 }; } },
          './delivery': { postSignedWebhook: async input => { calls.push(input); return { ok: true, statusCode: 200, durationMs: 1 }; } },
          './queue': { queueBoardWebhookDelivery: async () => {}, queueAgentWebhookDelivery: async () => {} },
        };
        const outbox = f.load(board ? 'src/lib/mcp/webhooks/outbox.ts' : 'src/lib/agentWebhooks/outbox.ts', extra);
        const sender = f.load(board ? 'src/lib/mcp/webhooks/outboxDelivery.ts' : 'src/lib/agentWebhooks/delivery.ts', extra);
        if (moved === 'before-send') await f.move[table]();
        const allowed = moved !== 'before-send' || actor === 'unbound' && table === 'Project';
        const result = await (board ? sender.deliverBoardWebhook(delivery.id) : sender.deliverAgentWebhook(delivery.id));
        assert.equal(result.status, allowed ? 'delivered' : 'skipped');
        assert.equal(calls.length, allowed ? 1 : 0);
        const stored = await deliveryModel.findUniqueOrThrow({ where: { id: delivery.id } });
        assert.equal(stored.status, allowed ? 'delivered' : 'cancelled');
        assert.equal(stored.attemptCount, allowed ? 1 : 0);
        if (moved === 'after-send') await f.move[table]();
        const retryAllowed = moved === 'unchanged' || actor === 'unbound' && table === 'Project';
        const retry = await (board ? outbox.retryBoardWebhookDelivery({ deliveryId: delivery.id, subscriptionId: subscription.id, idempotencyKey: delivery.id }) : outbox.replayAgentWebhookDelivery({ deliveryId: delivery.id, subscriptionId: subscription.id }));
        assert.equal(Boolean(retry), retryAllowed);
        assert.equal(await deliveryModel.count({ where: { subscriptionId: subscription.id } }), retryAllowed ? 2 : 1);
      });
    }
  }
}
