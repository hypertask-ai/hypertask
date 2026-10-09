import { NextRequest, NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { createMcpToken } from '@/lib/mcp/auth';
import createLog from '@/utils/controllers/logs/createLog';
import { LogType, Status } from '@prisma/client';

export const runtime = 'nodejs';

const RATE_KEY_PREFIX = 'cli_rl:te:';
const RATE_MAX_PER_WINDOW = 30;
const RATE_WINDOW_SEC = 60;

/** Atomic get + delete in one server round trip (avoids double-spend on concurrent requests). */
const ATOMIC_CONSUME_CLI_CODE = `
local v = redis.call('GET', KEYS[1])
if not v then return false end
redis.call('DEL', KEYS[1])
return v
`;

function getClientIp(request: NextRequest): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    return xff.split(',')[0]?.trim() || 'unknown';
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }
  return 'unknown';
}

async function isTokenExchangeRateLimited(clientIp: string): Promise<boolean> {
  const redis = await getRedis();
  const key = `${RATE_KEY_PREFIX}${clientIp}`;
  const n = await redis.incr(key);
  if (n === 1) {
    await redis.expire(key, RATE_WINDOW_SEC);
  }
  return n > RATE_MAX_PER_WINDOW;
}

export async function POST(request: NextRequest) {
  try {
    if (await isTokenExchangeRateLimited(getClientIp(request))) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again in a moment.' },
        { status: 429, headers: { 'Retry-After': String(RATE_WINDOW_SEC) } }
      );
    }

    const body = await request.json();
    const { code } = body;
    
    if (!code) {
      return NextResponse.json({ error: 'Code is required' }, { status: 400 });
    }
    
    // 1. Atomically read and remove the one-time code (no reuse, no TOCTOU race)
    const redis = await getRedis();
    const redisKey = `cli_auth:${code}`;
    const rawPayload = (await redis.eval(
      ATOMIC_CONSUME_CLI_CODE,
      1,
      redisKey
    )) as string | false;
    
    if (rawPayload === false || rawPayload == null) {
      return NextResponse.json({ error: 'Invalid or expired code' }, { status: 401 });
    }

    // 2. Parse payload
    const payload = JSON.parse(rawPayload);
    
    if (!payload.userId || !payload.email) {
      return NextResponse.json({ error: 'Invalid payload in code' }, { status: 500 });
    }
    
    // 4. Generate the actual JWT token for the user
    // We use createMcpToken to generate a 30-day valid MCP token
    const token = createMcpToken(payload.userId, payload.email, '30d');

    // counts real CLI onboards; first row per user = onboard, later rows = 30-day renewals.
    await createLog({
      log: 'cli_token_exchange',
      type: LogType.Signup,
      status: Status.Normal,
      LoggedById: payload.userId,
    });
    
    // 5. Return it to the CLI
    return NextResponse.json({ token });
  } catch (error) {
    console.error('Error exchanging CLI token:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
