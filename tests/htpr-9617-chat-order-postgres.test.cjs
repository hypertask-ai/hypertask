const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { load } = require('./task-route-loader.cjs');
const { NextRequest } = require('next/server');
const { withSchemaExtensions } = require('./helpers/schema-extensions.cjs');

const root = path.resolve(__dirname, '..');
const mirror = require(path.join(root, '.github/ci-images.json')).find(entry => entry.image === 'postgres' && entry.tag === '16-alpine');
const image = process.env.HTPR_PG_IMAGE || `${mirror.source}:${mirror.tag}@${mirror.digest}`;
const container = `htpr9617-${process.pid}-${Date.now()}`;
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
  const pull = run('docker', ['pull', image], { timeout: 300_000 });
  assert.equal(pull.status, 0, pull.stderr);
  const start = run('docker', ['run', '-d', '--name', container, '-e', 'POSTGRES_USER=ht', '-e', 'POSTGRES_PASSWORD=ht', '-e', 'POSTGRES_DB=ht_test', '-p', `127.0.0.1:${port}:5432`, '--health-cmd', 'pg_isready -U ht -d ht_test', '--health-interval', '1s', '--health-retries', '30', image]);
  assert.equal(start.status, 0, start.stderr);
  started = true;
  const ready = run('docker', ['exec', container, 'sh', '-c', 'for i in $(seq 1 60); do pg_isready -U ht -d ht_test && exit 0; sleep 0.5; done; exit 1']);
  assert.equal(ready.status, 0, ready.stderr);
  const schema = run(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema', path.join(root, 'src/prisma/schema.prisma'), '--script'], { env: { ...process.env, DATABASE_URL: url } });
  assert.equal(schema.status, 0, schema.stderr);
  const apply = run('docker', ['exec', '-i', container, 'psql', '-U', 'ht', '-d', 'ht_test', '-v', 'ON_ERROR_STOP=1'], { input: withSchemaExtensions(schema.stdout) });
  assert.equal(apply.status, 0, apply.stderr);
  const { PrismaClient } = require('@prisma/client');
  const { PrismaPg } = require('@prisma/adapter-pg');
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
});

after(async () => {
  if (prisma) await prisma.$disconnect();
  if (started) assert.equal(run('docker', ['rm', '-f', container]).status, 0);
});

async function fixture() {
  const stamp = `${Date.now()}-${Math.random()}`;
  const user = await prisma.user.create({ data: { uid: stamp, email: `${stamp}@example.invalid` } });
  const session = await prisma.chatSession.create({ data: { userId: user.id } });
  const mocks = {
    '@/lib/agents/chatContentScope': { chatAudienceWhere: () => ({}) },
    '@/lib/agents/chatAccess': { loadSidebarChatRequest: async () => ({ ok: true }) },
    '@/lib/auth/currentUser': { loadCurrentUser: async () => ({ user, userId: user.id }) },
    '@/lib/api/rateLimit': { checkRestRateLimit: async () => null },
    '@/lib/storage/uploadTaskAttachmentToS3': {},
    '@/utils/edgeHelpers': {},
    '@/utils/controllers/comments/linkifyTicketRefs': { linkifyTicketRefs: async content => content },
    'next/headers': { cookies: async () => ({ get() {} }) },
  };
  const post = async (db, message) => {
    const { POST } = load('src/app/api/ai-chat/add-message/route.ts', {
      ...mocks, '@/lib/prisma': { default: db },
    });
    return POST(new NextRequest('http://localhost/api/ai-chat/add-message', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.id, message }),
    }));
  };
  return { user, session, post };
}

test('real route keeps a queued human before a reply attempted between lookup and insert', { timeout: 30_000 }, async t => {
  if (skipReason) return t.skip(skipReason);
  const f = await fixture();
  const replyId = `reply-${f.session.id}`;
  let lookupMissed = false;
  let replyBlocked = false;
  const storeReply = () => prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '150ms'");
    return tx.chatMessage.createMany({ data: [{ id: replyId, sessionId: f.session.id, content: 'answer', role: 'assistant' }] });
  });
  const db = prisma.$extends({ query: { chatMessage: { async findFirst({ args, query }) {
    const result = await query(args);
    if (args.where.id === replyId) {
      lookupMissed = result === null;
      try {
        await storeReply();
        await prisma.$executeRaw`SELECT pg_sleep(0.01)`;
      } catch (error) {
        assert.match(error.message, /lock timeout/);
        replyBlocked = true;
      }
    }
    return result;
  } } } });
  const response = await f.post(db, { role: 'human', content: 'question', precedesMessageId: replyId });
  assert.equal(response.status, 200, await response.clone().text());
  if (replyBlocked) await storeReply();
  const rows = await prisma.chatMessage.findMany({ where: { sessionId: f.session.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const human = rows.find(row => row.role === 'human');
  const reply = rows.find(row => row.id === replyId);
  t.diagnostic(`lookupMissed=${lookupMissed} replyBlocked=${replyBlocked} human=${human.createdAt.toISOString()} reply=${reply.createdAt.toISOString()}`);
  assert.equal(lookupMissed, true);
  assert.ok(human.createdAt < reply.createdAt, 'queued human must sort before its answer');
  assert.equal(replyBlocked, true, 'reply cannot commit between the lookup and the human insert');
  assert.deepEqual(rows.map(row => row.content), ['question', 'answer']);
});

test('real route backdates only a matching assistant in the same session', { timeout: 30_000 }, async t => {
  if (skipReason) return t.skip(skipReason);
  const f = await fixture();
  const other = await prisma.chatSession.create({ data: { userId: f.user.id } });
  const old = new Date('2020-01-01T00:00:00.000Z');
  const assistant = await prisma.chatMessage.create({ data: { sessionId: f.session.id, content: 'answer', role: 'assistant', createdAt: old } });
  const foreign = await prisma.chatMessage.create({ data: { sessionId: other.id, content: 'private answer', role: 'assistant', createdAt: old } });
  const human = await prisma.chatMessage.create({ data: { sessionId: f.session.id, content: 'earlier question', role: 'human', createdAt: old } });
  for (const [id, backdated] of [[assistant.id, true], [foreign.id, false], [human.id, false], [undefined, false]]) {
    const response = await f.post(prisma, { role: 'human', content: 'question', precedesMessageId: id });
    assert.equal(response.status, 200, await response.clone().text());
    const { message } = await response.json();
    assert.equal(new Date(message.createdAt).getTime() === old.getTime() - 1, backdated);
  }
});
