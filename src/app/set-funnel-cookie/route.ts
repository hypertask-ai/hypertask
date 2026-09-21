import { withoutAuth } from "#with-auth";
import { env as appEnv } from "#env";
// app/set-funnel-cookie/route.ts
import { NextRequest, NextResponse } from 'next/server';

async function GETHandler(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const originalPath = searchParams.get('originalPath') || '/login';
  const originalSearch = searchParams.get('originalSearch') || '';
  
  // Construct the redirect URL
  const redirectUrl = new URL(originalPath + originalSearch, request.url);
  
  const response = NextResponse.redirect(redirectUrl);
  
  // Set the cookie with maximum compatibility settings
  response.cookies.set('is_funnel_user', 'true', {
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
    sameSite: 'lax',
    httpOnly: false,
    secure: appEnv.NODE_ENV === 'production'
  });
  
  return response;
}

export const GET = withoutAuth(GETHandler);
