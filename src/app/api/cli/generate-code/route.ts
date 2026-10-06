import { loadCurrentUser } from '@/lib/auth/currentUser';
import { HTPR_6924_REST_COMPAT_FLAG, isFeatureEnabled } from '@/lib/flags';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isValidUser } from '@/utils/edgeHelpers';
import crypto from 'crypto';
import { getRedis } from '@/lib/redis';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const userCookie = cookieStore.get('nookies_user');
    
    if (!userCookie?.value) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const currentUser = await loadCurrentUser(request.headers, true).catch(() => null);
    let restCompat = false;
    if (currentUser) {
      try {
        restCompat = await isFeatureEnabled(HTPR_6924_REST_COMPAT_FLAG, currentUser.userId);
      } catch {
        // Flag lookup failure preserves the legacy entry path.
      }
    }
    const { isValid, user } = restCompat && currentUser
      ? { isValid: true, user: currentUser.user }
      : isValidUser(userCookie.value);
    
    if (!isValid || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Generate a secure random code
    const code = crypto.randomBytes(32).toString('hex');
    
    // Store in Redis with a 2-minute expiration (120 seconds)
    // Key format: cli_auth:{code}, Value: JSON string with userId and email
    const payload = JSON.stringify({
      userId: user.id,
      email: user.email
    });
    
    const redis = await getRedis();
    await redis.set(`cli_auth:${code}`, payload, 'EX', 120);
    
    return NextResponse.json({ code });
  } catch (error) {
    console.error('Error generating CLI code:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
