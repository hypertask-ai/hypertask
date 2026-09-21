import { NextRequest, NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { checkMcpRateLimit } from '@/lib/mcp/auth';
import { handleMcpTokenRefresh } from '@/lib/mcp/token/refresh';

export const runtime = 'nodejs';

const RATE_KEY_PREFIX = 'mcp_rl:refresh:';
const RATE_MAX_PER_WINDOW = 10;
const RATE_WINDOW_SEC = 60;

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

async function isTokenRefreshRateLimited(clientIp: string): Promise<boolean> {
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
    if (await isTokenRefreshRateLimited(getClientIp(request))) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again in a moment.' },
        { status: 429, headers: { 'Retry-After': String(RATE_WINDOW_SEC) } }
      );
    }

    const rateLimited = await checkMcpRateLimit(request);
    if (rateLimited) return rateLimited;

    return await handleMcpTokenRefresh(request);
  } catch (error) {
    console.error('Error refreshing MCP token:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
