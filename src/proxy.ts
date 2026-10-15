import { NextRequest, NextResponse } from 'next/server';
import { isValidUser } from './utils/edgeHelpers';
import { isMobileDevice } from './utils/serverActions';
import { canAccessTrialPage } from './utils/helperFunctions/helperFunctions';
import { parseSafeReturnTo } from '@/lib/auth/safeReturnTo';
import { verifySessionEdge } from '@/lib/auth/sessionEdge';
import { isSessionTokenRevoked } from '@/lib/auth/sessionRevocation';
import { verifyCookieIdentity } from '@/lib/auth/cookieIdentity';
import { detailWithoutTicketRedirect } from '@/lib/routing/detailWithoutTicket';
import {
  hasKeyboardShortcutTutorialQuery,
  isKeyboardShortcutTutorialPath,
  removeKeyboardShortcutTutorialQuery,
} from '@/lib/tutorial/keyboardShortcutTutorial';

const onboarding = "/onboarding"
const trial = "/trial"
const share = "/share"
const login = "/login"

const CLI_LATEST_VERSION = "1.10.2"

async function authMiddleware(request: NextRequest) {
  const currentPath = request.nextUrl.pathname;
  const isMcpBearer = (
    currentPath.startsWith('/api/mcp') ||
    currentPath === '/api/v1' ||
    currentPath.startsWith('/api/v1/')
  ) && request.headers.get('Authorization')?.startsWith('Bearer ');
  const isAuthRoute = currentPath === '/api/auth' || currentPath.startsWith('/api/auth/');
  const isCookieFreeEndpoint = [
    '/oauth/token', '/oauth/register', '/oauth/revoke',
    '/mcp', '/sse', '/message', '/mcp-health',
  ].includes(currentPath) || currentPath.startsWith('/.well-known');
  if (!isMcpBearer && !isAuthRoute && !isCookieFreeEndpoint && await isSessionTokenRevoked(
    request.cookies.get('ht_session')?.value,
    { failClosed: false }
  )) {
    if (currentPath.startsWith('/api')) {
      return NextResponse.json(
        { error: 'Unauthorized', code: 'SESSION_REQUIRED' },
        { status: 401 }
      );
    }
    const res = NextResponse.redirect(request.nextUrl);
    res.cookies.delete('nookies_user');
    res.cookies.delete('ht_session');
    return res;
  }

  if (currentPath === '/mcp' || currentPath === '/sse' || currentPath === '/message' || currentPath === '/mcp-health') {
    return NextResponse.next();
  }

  const detailRedirect = detailWithoutTicketRedirect(currentPath);
  if (detailRedirect) {
    return NextResponse.redirect(new URL(detailRedirect, request.url), 307);
  }

  if (request.headers.get('host') === 'mcp.hypertask.ai') {
    if (currentPath === '/') {
      return NextResponse.redirect(new URL('/mcp', request.url), 307);
    }
    if (currentPath === '/health') {
      return NextResponse.rewrite(new URL('/mcp-health', request.url));
    }
  }

  if (
    process.env.VERCEL_ENV === 'production' &&
    request.headers.get('host')?.endsWith('.vercel.app') &&
    currentPath.startsWith('/demo')
  ) {
    return NextResponse.redirect(new URL(`${currentPath}${request.nextUrl.search}`, 'https://app.hypertask.ai'), 307);
  }

  if (request.headers.get('host') === 'demo.hypertask.ai' && currentPath === '/') {
    return NextResponse.redirect(new URL('/demo', request.url), 307);
  }

  if (currentPath.startsWith('/developers')) {
    return NextResponse.next();
  }

  if (currentPath === '/api/errors') {
    return NextResponse.next();
  }

  if (
    currentPath === '/oauth/token' ||
    currentPath === '/oauth/register' ||
    currentPath === '/oauth/revoke'
  ) {
    return NextResponse.next();
  }

  if (currentPath.startsWith('/oauth')) {
    const identity = await verifyCookieIdentity(
      request.cookies.get('nookies_user')?.value,
      request.cookies.get('ht_session')?.value
    );
    if (identity.status === 'forged') {
      const loginUrl = new URL(login, request.url);
      request.nextUrl.searchParams.forEach((value, key) =>
        loginUrl.searchParams.set(key, value)
      );
      const res = NextResponse.redirect(loginUrl);
      res.cookies.delete('nookies_user');
      res.cookies.delete('ht_session');
      return res;
    }
    console.log('[Middleware] OAuth route - allowing through');
    return NextResponse.next();
  }

  if (currentPath.startsWith('/.well-known')) {
    console.log('[Middleware] well-known route - allowing through');
    return NextResponse.next();
  }

  if (
    currentPath.startsWith('/api/mcp') ||
    currentPath === '/api/v1' ||
    currentPath.startsWith('/api/v1/')
  ) {
    const authHeader = request.headers.get('Authorization');
    const response = NextResponse.next();
    response.headers.set('x-cli-latest-version', CLI_LATEST_VERSION);
    if (authHeader && authHeader.startsWith('Bearer ')) {
      console.log('[Middleware] MCP API route with Authorization header - allowing through');
      return response;
    }
    console.log('[Middleware] MCP API route without Authorization header - allowing through (API will handle auth)');
    return response;
  }

  if (currentPath.startsWith('/api')) {
    if (currentPath === '/api/auth' || currentPath.startsWith('/api/auth/')) {
      return NextResponse.next();
    }
    const identity = await verifyCookieIdentity(
      request.cookies.get('nookies_user')?.value,
      request.cookies.get('ht_session')?.value
    );
    if (identity.status === 'forged') {
      return NextResponse.json(
        { error: 'Unauthorized', code: 'SESSION_REQUIRED' },
        { status: 401 }
      );
    }
    return NextResponse.next();
  }

  const cookies = request.cookies.get("nookies_user");
  const previousBoard = request.cookies.get("previousBoard");
  const funnelTutorialCompleted = request.cookies.get("funnel_tutorial_completed");

  const { isValid, user } = isValidUser(cookies?.value);

  if (isValid && user) {
    const session = await verifySessionEdge(request.cookies.get('ht_session')?.value);
    if (!session || Number(session.id) !== Number((user as { id?: unknown }).id)) {
      const loginUrl = new URL(login, request.url);
      const res = NextResponse.redirect(loginUrl);
      res.cookies.delete('nookies_user');
      res.cookies.delete('ht_session');
      return res;
    }
  }

  const searchParams = request.nextUrl.searchParams;
  const hasFunnelParam = searchParams.has('funnel');
  const isFunnelUser = hasFunnelParam || request.cookies.get('funnel')?.value === 'true';

  if (isKeyboardShortcutTutorialPath(currentPath)) {
    if (!isValid || !user) {
      return NextResponse.redirect(new URL(login, request.url), 307);
    }

    const requestedProjectId = request.nextUrl.searchParams.get("projectId");
    const previousProjectId = previousBoard?.value
      ?.split("|&|")[0]
      ?.replace("project-", "");
    const projectId = [requestedProjectId, previousProjectId].find(
      (candidate) =>
        candidate != null &&
        /^\d+$/.test(candidate) &&
        Number(candidate) > 0,
    );
    const destination = new URL(projectId ? "/project" : "/", request.url);
    if (projectId) destination.searchParams.set("id", projectId);
    return NextResponse.redirect(destination, 307);
  }

  if (hasKeyboardShortcutTutorialQuery(request.nextUrl.searchParams)) {
    const destination = request.nextUrl.clone();
    removeKeyboardShortcutTutorialQuery(destination.searchParams);
    return NextResponse.redirect(destination, 307);
  }


  if (!isValid || !user) {
    console.log('❌ USER NOT AUTHENTICATED');

    if (currentPath.startsWith("/invite") ||
      currentPath.startsWith(share) ||
      currentPath.startsWith('/demo') ||
      currentPath.startsWith('/verify-email') ||
      currentPath === '/add-to-slack' ||
      currentPath === '/slack/support' ||
      currentPath === '/qa/login' ||
      currentPath.startsWith('/qa/login/') ||
      currentPath.startsWith('/firebase-messaging-sw.js')) {
      return NextResponse.next();
    }

    if (currentPath === "/") {
      return NextResponse.redirect(new URL('/demo', request.url), 307);
    }

    if (isFunnelUser) {
      console.log('🎯 FUNNEL USER DETECTED (unauthenticated) - STRICT LOCK TO TUTORIAL');
      
      if (!request.cookies.get('funnel')?.value) {
        const response = NextResponse.next();
        response.cookies.set('funnel', 'true', { path: '/' });
        response.cookies.set('funnel_tutorial_completed', 'false', { path: '/' });
        return response;
      }

      if (currentPath === login) {
        if (funnelTutorialCompleted?.value === 'true') {
          if (!hasFunnelParam) {
            const loginUrl = new URL(login, request.url);
            loginUrl.searchParams.set('funnel', 'true');
            return NextResponse.redirect(loginUrl);
          }
          return NextResponse.next();
        }
      }
    }

    if (currentPath === login) {
      return NextResponse.next();
    }

    const loginUrl = new URL(login, request.url);
    if (
      currentPath === '/cli-auth' ||
      currentPath.startsWith('/cli-auth/') ||
      currentPath === '/settings/slack/link'
    ) {
      const candidate = request.nextUrl.pathname + request.nextUrl.search;
      const safe = parseSafeReturnTo(candidate);
      if (safe) {
        loginUrl.searchParams.set('returnTo', safe);
      }
    }
    return NextResponse.redirect(loginUrl);
  }


  if (currentPath === login) {
    if (request.cookies.get('add_account')?.value === '1') {
      return NextResponse.next();
    }
    const hasToken = request.nextUrl.searchParams.get('token');
    const hasOAuthParams = request.nextUrl.searchParams.has('client_id') && request.nextUrl.searchParams.has('redirect_uri');
    
    if (hasToken) {
      console.log('🔗 Token detected in URL, allowing login page access for token processing');
      return NextResponse.next();
    }
    
    if (hasOAuthParams) {
      console.log('🔐 OAuth params detected, allowing login page access for OAuth flow');
      return NextResponse.next();
    }
    
    if (previousBoard?.value && checkIfOnboarded(user)) {
      console.log('🔄 Authenticated user on login page, redirecting to previous board');
      const url = request.nextUrl.clone();
      const [projectId, view] = previousBoard.value.split('|&|');
      if (projectId) {
        url.pathname = "project";
        url.searchParams.set("id", projectId.split("-")[1]);
        if (view && view.length > 0 && view !== "undefined") {
          url.searchParams.set("view", view);
        }
        return NextResponse.redirect(url);
      }
    }
    
      console.log('🔄 Authenticated user on login page (onboarded, no previousBoard), redirecting to /project');
      return NextResponse.redirect(new URL('/', request.url));
  }

  if (currentPath === "/") {
    if (previousBoard?.value && checkIfOnboarded(user)) {
      console.log('🔄 Root route access - restoring previous board');
      const url = request.nextUrl.clone();
      const [projectId, view] = previousBoard.value.split('|&|');
      if (projectId) {
        url.pathname = "project";
        url.searchParams.set("id", projectId.split("-")[1]);
        if (view && view.length > 0 && view !== "undefined") {
          url.searchParams.set("view", view);
        }
        return NextResponse.redirect(url);
      }
    }
    
    if (checkIfOnboarded(user)) {
      console.log('🔄 Root route access - onboarded user with no previousBoard, redirecting to /project');
      return NextResponse.redirect(new URL('/project', request.url));
    }
    
    console.log('🔄 Root route access - user not onboarded, redirecting to onboarding');
    return NextResponse.redirect(new URL(onboarding, request.url));
  }

  if (
    currentPath === "/project" &&
    !request.nextUrl.searchParams.has("id") &&
    previousBoard?.value &&
    checkIfOnboarded(user)
  ) {
    const [projectId, view] = previousBoard.value.split('|&|');
    if (projectId) {
      const url = request.nextUrl.clone();
      url.pathname = "project";
      url.searchParams.set("id", projectId.split("-")[1]);
      if (view && view.length > 0 && view !== "undefined") {
        url.searchParams.set("view", view);
      }
      console.log('🔄 Bare /project access - restoring last board');
      return NextResponse.redirect(url);
    }
  }

  if (isFunnelUser) {
    return NextResponse.next();
  }


  if (
    !checkIfOnboarded(user) &&
    currentPath !== onboarding &&
    currentPath !== '/add-to-slack' &&
    currentPath !== '/slack/support' &&
    currentPath !== '/qa/login' &&
    !currentPath.startsWith(share) &&
    !currentPath.startsWith('/cli-auth')
  ) {
    return NextResponse.redirect(new URL(onboarding, request.url));
  }

  if (currentPath === trial && !canAccessTrialPage(user)) {
    console.log('🔄 User not eligible for trial upgrade page, redirecting away from trial page');
    return NextResponse.redirect(new URL('/', request.url));
  }


  if (previousBoard?.value && currentPath === "/") {
    console.log('🔄 Restoring previous board');
    const url = request.nextUrl.clone();
    const [projectId, view] = previousBoard.value.split('|&|');
    if (projectId) {
      url.pathname = "project";
      url.searchParams.set("id", projectId.split("-")[1]);
      if (view && view.length > 0 && view !== "undefined") {
        url.searchParams.set("view", view);
      }
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export default async function requireAuthMiddleware(request: NextRequest) {
  const response = await authMiddleware(request);
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.delete('x-ht-board-document-route');
  forwardedHeaders.delete('x-ht-inbox-document-route');
  if (request.nextUrl.pathname === '/project' || request.nextUrl.pathname === '/inbox') {
    if (request.headers.get('sec-fetch-dest') === 'document') {
      forwardedHeaders.set(request.nextUrl.pathname === '/inbox' ? 'x-ht-inbox-document-route' : 'x-ht-board-document-route', request.nextUrl.pathname + request.nextUrl.search);
    }
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('CDN-Cache-Control', 'no-store');
    response.headers.set('Vercel-CDN-Cache-Control', 'no-store');
  }
  if (response.headers.get('x-middleware-next') === '1') {
    const forwarding = NextResponse.next({ request: { headers: forwardedHeaders } });
    forwarding.headers.forEach((value, name) => {
      if (name.startsWith('x-middleware-')) response.headers.set(name, value);
    });
  }
  const { isValid, user } = isValidUser(request.cookies.get('nookies_user')?.value);
  const loggedIn = isValid && user && request.cookies.has('ht_session');
  const htIn = request.cookies.get('ht_in');

  if (
    response &&
    request.nextUrl.hostname === 'app.hypertask.ai' &&
    !response.headers.get('content-type')?.startsWith('application/json')
  ) {
    if (loggedIn && htIn?.value !== '1') {
      response.cookies.set('ht_in', '1', {
        domain: '.hypertask.ai',
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
        sameSite: 'lax',
        secure: true,
        httpOnly: false,
      });
    } else if (!loggedIn && htIn) {
      response.cookies.set('ht_in', '', {
        domain: '.hypertask.ai',
        path: '/',
        maxAge: 0,
      });
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!api|_next|flask-app|files(?:/|$)|.*\\..*).*)',
    '/api/:path*'
  ]
};

const checkIfOnboarded = (user: any) => {
  return user.UserSetting?.onboardingTourStatus;
}

const checkIfTutorialCompleted = (user: any) => {
  return user.UserSetting?.onboardingTutorialStatus;
}
