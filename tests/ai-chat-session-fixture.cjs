const assert = require('node:assert/strict');
const { load } = require('./task-route-loader.cjs');
const flag = 'htpr-6924-rest-compat';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const session = (n, overrides = {}) => ({
  id: id(n), createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date(`2026-01-${String(1 + Math.floor(n / 3)).padStart(2, '0')}T00:00:00.000Z`),
  userId: 6, taskId: null, projectId: null, agentId: null, teamId: null, title: `Chat ${n}`,
  messages: [{ id: `message-${n}`, createdAt: new Date('2026-01-01T00:00:00.000Z'), content: 'saved '.repeat(100), attachments: [{ id: 'attachment', name: 'image.png' }], authorAgent: { displayName: 'Agent' } }],
  ...overrides,
});
function matches(row, where) {
  if (where.AND && !where.AND.every((clause) => matches(row, clause))) return false;
  if (where.OR && !where.OR.some((clause) => matches(row, clause))) return false;
  for (const [key, value] of Object.entries(where)) {
    if (key === 'AND' || key === 'OR') continue;
    if (key === 'messages') { if (value.none && row.messages.length) return false; continue; }
    if (key === 'agent') { if (row.runtimeType === value.runtimeType.not) return false; continue; }
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('lt' in value && !(row[key] < value.lt)) return false;
    } else if (value instanceof Date ? +row[key] !== +value : row[key] !== value) return false;
  }
  return true;
}
function project(row, args) {
  if (!args.select) return { ...row, messages: [...row.messages].sort((a, b) => +a.createdAt - +b.createdAt) };
  return Object.fromEntries(Object.keys(args.select).map((key) => [key, key === '_count' ? { messages: row.messages.length } : row[key]]));
}
function fixture(options = {}) {
  const rows = options.rows ?? Array.from({ length: 8 }, (_, n) => session(n + 1));
  const calls = [], writes = [], flags = [], limits = [];
  const chatSession = {
    findMany: async (args) => {
      calls.push(args);
      if (options.dbError) throw new Error('isolated query failure');
      const sorted = rows.filter((row) => matches(row, args.where)).sort((a, b) => +b.updatedAt - +a.updatedAt || (Array.isArray(args.orderBy) ? b.id.localeCompare(a.id) : 0));
      return sorted.slice(0, args.take ?? sorted.length).map((row) => project(row, args));
    },
    findFirst: async (args) => { calls.push(args); const row = rows.find((row) => matches(row, args.where)); return row ? project(row, args) : null; },
    create: async (args) => { writes.push(args); const row = session(99, { messages: [] }); rows.push(row); return project(row, args); },
  };
  const { GET } = load('src/app/api/ai-chat/all-sessions/route.ts', {
    '@/lib/prisma': { default: { chatSession } },
    '@/lib/auth/currentUser': { loadCurrentUser: async () => options.unauthorized ? null : { userId: 6, user: { id: 6 } } },
    '@/lib/flags': { HTPR_6924_REST_COMPAT_FLAG: flag, isFeatureEnabled: async (...args) => { flags.push(args); if (options.flagError) throw new Error('flag unavailable'); return options.on ?? true; } },
    '@/lib/api/rateLimit': { checkRestRateLimit: async (...args) => { limits.push(args); return null; } },
    '@/lib/api/response': { unauthorized: () => Response.json({ error: 'Unauthorized' }, { status: 401 }) },
    'next/server': { NextResponse: Response },
  });
  return { rows, calls, writes, flags, limits, get: (query = '') => GET(new Request(`https://example.test/api/ai-chat/all-sessions${query ? '?' + query : ''}`)) };
}
module.exports = { assert, fixture, session, id, flag };
