import { NextRequest, NextResponse } from 'next/server';
import { isValidUser } from './utils/edgeHelpers';
import { isMobileDevice } from './utils/serverActions';
import { canAccessTrialPage } from './utils/helperFunctions/helperFunctions';
import { parseSafeReturnTo } from '@/lib/auth/safeReturnTo';
import { verifySessionEdge } from '@/lib/auth/sessionEdge';
import { verifyCookieIdentity } from '@/lib/auth/cookieIdentity';
import {
  hasKeyboardShortcutTutorialQuery,
  isKeyboardShortcutTutorialPath,
  removeKeyboardShortcutTutorialQuery,
} from '@/lib/tutorial/keyboardShortcutTutorial';

const onboarding = "/onboarding"
const trial = "/trial"
const share = "/share"
const login = "/login"

// Bump this whenever a new @hypertask/hypertask_cli version is published (HTPR-4005).
// The CLI reads this header on every /api/mcp response and warns if it's out of date.
// HTPR-4510: this was stuck at 1.3.9 while the CLI shipped up to 1.10.0, so every
// stale install (e.g. 1.7.2) was told it was current and never warned — which is
// how agents kept concluding "views can't be created". Keep this in lockstep with
// the latest published CLI (`npm view @hypertask/hypertask_cli version`).
const CLI_LATEST_VERSION = "1.10.2"

async function authMiddleware(request: NextRequest) {
  const currentPath = request.nextUrl.pathname;

  if (currentPath === '/mcp' || currentPath === '/sse' || currentPath === '/message' || currentPath === '/mcp-health') {
    return NextResponse.next();
  }

  // mcp.hypertask.ai parity with the retired standalone server: bare-domain
  // clients got a 307 to /mcp, and /health served an unauthenticated JSON probe.
  if (request.headers.get('host') === 'mcp.hypertask.ai') {
    if (currentPath === '/') {
      return NextResponse.redirect(new URL('/mcp', request.url), 307);
    }
    if (currentPath === '/health') {
      return NextResponse.rewrite(new URL('/mcp-health', request.url));
    }
  }

  // HTPR-4303: demo.hypertask.ai is the isolated-cookie host for the anonymous
  // demo. Its root lands on the purpose modal instead of /login so a fresh
  // visitor starts the demo immediately.
  if (request.headers.get('host') === 'demo.hypertask.ai' && currentPath === '/') {
    return NextResponse.redirect(new URL('/demo', request.url), 307);
  }

  if (currentPath.startsWith('/developers')) {
    return NextResponse.next();
  }

  if (currentPath === '/api/errors') {
    return NextResponse.next();
  }

  // **PRIORITY: Allow OAuth and well-known routes to pass through**
  // OAuth endpoints handle their own authentication logic.
  // HTPR-3979: "handle their own" previously meant /oauth/authorize trusted the
  // unsigned nookies_user cookie, so a forged {id: victimId} minted an auth code
  // for that user. Apply the same invariant the /api gate below uses: a presented
  // nookies_user must be backed by a validly-signed ht_session with the same id.
  // Cookie-less machine calls (/oauth/token, /oauth/register, /oauth/revoke) are untouched.
  // /.well-known stays fully untouched: it serves public, identity-independent
  // discovery documents, so redirecting it on a stale cookie would break client
  // discovery for no security gain.
  // /oauth/token, /oauth/register, and /oauth/revoke are machine endpoints that never read
  // identity from cookies. A browser-based client can still carry an incidental
  // stale nookies_user, and redirecting its POST to /login would break a
  // legitimate exchange, so they keep passing through untouched.
  //
  // This MUST return before the gated branch below. Excluding them from that
  // branch's condition is not enough: they would then match no /oauth branch at
  // all and fall through to the page-route logic further down, which redirects
  // to /login. That shipped briefly and broke OAuth client registration and
  // token exchange in production.
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
      // Drop the bad cookies and make them log in for real. Query params are
      // preserved so a legitimate stale session resumes the OAuth flow.
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

  // **PRIORITY: Allow MCP API routes with Authorization header to pass through**
  // Edge Runtime doesn't support Node.js crypto, so JWT validation happens in API routes
  // Just check if Authorization header exists and allow /api/mcp/* routes
  if (
    currentPath.startsWith('/api/mcp') ||
    currentPath === '/api/v1' ||
    currentPath.startsWith('/api/v1/')
  ) {
    const authHeader = request.headers.get('Authorization');
    const response = NextResponse.next();
    response.headers.set('x-cli-latest-version', CLI_LATEST_VERSION);
    if (authHeader && authHeader.startsWith('Bearer ')) {
      // Authorization header present - let API route handle validation
      console.log('[Middleware] MCP API route with Authorization header - allowing through');
      return response;
    }
    // No auth header - still allow through, API route will return 401
    console.log('[Middleware] MCP API route without Authorization header - allowing through (API will handle auth)');
    return response;
  }

  // **HTPR-4182: identity gate for all other /api routes.**
  // ~100 routes trust the UNSIGNED nookies_user cookie for identity. Require that
  // a presented nookies_user is backed by a validly-signed ht_session with the
  // same id, else 401. Requests without nookies_user (public/webhook/queue/logged
  // out) pass untouched. /api/auth manages its own login cookies; /api/mcp handled
  // above. Never fall through to the page-redirect logic below for /api paths.
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

  // HTPR-3944: nookies_user is an unsigned JSON cookie. /api routes are gated
  // (HTPR-4182), but page routes render server components that read
  // nookies_user.id directly for data (e.g. all-tasks/page.tsx ->
  // getRecentTasks(userObj.id)). Require a well-formed nookies_user to be backed
  // by a validly-signed ht_session with the same id; otherwise it is forged or
  // stale, so treat the request as logged out — redirect to /login and clear the
  // bad cookies. Legit sessions always match: the live /api gate enforces the
  // same invariant, so any logged-in user already has a matching ht_session.
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

  // The keyboard-first tutorials are disabled at the edge so direct URLs,
  // stale bookmarks, and client-side navigation cannot reach either legacy
  // implementation. Signed-in users return to their requested/current board;
  // signed-out users continue through the normal login path.
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

  // Old tutorial board/inbox/detail links use query parameters on otherwise
  // normal app routes. Strip them before any client code can enter a special
  // tutorial branch or carry the mode into later navigation.
  if (hasKeyboardShortcutTutorialQuery(request.nextUrl.searchParams)) {
    const destination = request.nextUrl.clone();
    removeKeyboardShortcutTutorialQuery(destination.searchParams);
    return NextResponse.redirect(destination, 307);
  }

  // EXTENSIVE DEBUGGING
  // console.log('=== MIDDLEWARE DEBUG START ===');
  // console.log('1. Current Path:', currentPath);
  // console.log('2. Has Funnel Param:', hasFunnelParam);
  // console.log('3. Search Params:', searchParams.toString());
  // console.log('4. Is Valid User:', isValid);
  // console.log('5. User Object:', user ? 'EXISTS' : 'NULL');
  // console.log('6. Funnel Tutorial Completed:', funnelTutorialCompleted?.value);
  // console.log('7. Is Funnel User:', isFunnelUser);
  // console.log('8. Funnel Cookie:', request.cookies.get('funnel')?.value);
  // console.log('9. Referer:', referer);
  // console.log('10. Coming from Trial:', isComingFromTrial);
  // console.log('11. Coming from Root:', isComingFromRoot);
  // console.log('12. Coming from Project:', isComingFromProject);
  // console.log('=== MIDDLEWARE DEBUG END ===\n');

  // **CASE 1: Handle unauthenticated users**
  if (!isValid || !user) {
    console.log('❌ USER NOT AUTHENTICATED');

    // Allow public routes
    if (currentPath.startsWith("/invite") ||
      currentPath.startsWith(share) ||
      currentPath.startsWith('/demo') ||
      currentPath.startsWith('/verify-email') ||
      currentPath.startsWith('/firebase-messaging-sw.js')) {
      // console.log('✅ Allowing public route:', currentPath);
      return NextResponse.next();
    }

    // HTPR-4845: no session at the root route = start the demo, not /login.
    // /demo provisions a guest board and hard-navigates to it; it sits in the
    // public allowlist above and /api/* returned earlier, so no loop. Only this
    // bounce changes — /login stays directly reachable below.
    if (currentPath === "/") {
      return NextResponse.redirect(new URL('/demo', request.url), 307);
    }

    // **FUNNEL USER FLOW (unauthenticated) - STRICT LOCK TO TUTORIAL**
    if (isFunnelUser) {
      console.log('🎯 FUNNEL USER DETECTED (unauthenticated) - STRICT LOCK TO TUTORIAL');
      
      // Set funnel cookie if not already set
      if (!request.cookies.get('funnel')?.value) {
        const response = NextResponse.next();
        response.cookies.set('funnel', 'true', { path: '/' });
        // funnel_tutorial_completed
        response.cookies.set('funnel_tutorial_completed', 'false', { path: '/' });
        return response;
      }

      // Allow funnel users to access login after the retired tutorial flow.
      if (currentPath === login) {
        if (funnelTutorialCompleted?.value === 'true') {
          // console.log('✅ Funnel user completed tutorial - LOGIN ALLOWED');
          // If no funnel param, redirect to login with funnel param
          if (!hasFunnelParam) {
            // console.log('🔄 Adding funnel param to login URL');
            const loginUrl = new URL(login, request.url);
            loginUrl.searchParams.set('funnel', 'true');
            return NextResponse.redirect(loginUrl);
          }
          return NextResponse.next();
        }
      }

      // For any other route, redirect to tutorial with funnel param
      // console.log('🔄 FUNNEL USER TRYING TO ACCESS:', currentPath, '- REDIRECTING TO TUTORIAL');
      // const tutorialUrl = new URL(interactiveTutorial, request.url);
      // tutorialUrl.searchParams.set('funnel', 'true');
      // return NextResponse.redirect(tutorialUrl);
    }

    // **NON-FUNNEL USER FLOW (unauthenticated)**
    // console.log('👤 NON-FUNNEL USER (unauthenticated)');
    if (currentPath === login) {
      // console.log('✅ Already on login page');
      return NextResponse.next();
    }

    // console.log('🔄 Redirecting non-funnel user to login');
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

  // **CASE 2: Handle authenticated users**
  // console.log('✅ USER AUTHENTICATED');

  // Prevent authenticated users from accessing login page
  // BUT allow if there's a token parameter (email magic link) or OAuth params so they can be processed
  if (currentPath === login) {
    if (request.cookies.get('add_account')?.value === '1') {
      return NextResponse.next();
    }
    const hasToken = request.nextUrl.searchParams.get('token');
    const hasOAuthParams = request.nextUrl.searchParams.has('client_id') && request.nextUrl.searchParams.has('redirect_uri');
    
    // If there's a token in the URL, allow access to login page so token can be processed
    if (hasToken) {
      console.log('🔗 Token detected in URL, allowing login page access for token processing');
      return NextResponse.next();
    }
    
    // If there are OAuth params, allow access so user can be redirected to authorize after login
    if (hasOAuthParams) {
      console.log('🔐 OAuth params detected, allowing login page access for OAuth flow');
      return NextResponse.next();
    }
    
    // If user has completed onboarding and has previousBoard, redirect there
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
    
    // If user has completed onboarding but no previousBoard, redirect to /project (will use first project)
    // if (checkIfOnboarded(user)) {
      console.log('🔄 Authenticated user on login page (onboarded, no previousBoard), redirecting to /project');
      return NextResponse.redirect(new URL('/', request.url));
    // }
    
    // // Only redirect to onboarding if user has NOT completed onboarding
    // console.log('🔄 Authenticated user on login page (not onboarded), redirecting to onboarding');
    // return NextResponse.redirect(new URL(onboarding, request.url));
  }

  // Prevent direct access to root route - redirect to project
  if (currentPath === "/") {
    // PRIORITY 2: If user has completed onboarding and has previousBoard, redirect there
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
    
    // PRIORITY 3: If user has completed onboarding but no previousBoard, redirect to /project
    if (checkIfOnboarded(user)) {
      console.log('🔄 Root route access - onboarded user with no previousBoard, redirecting to /project');
      return NextResponse.redirect(new URL('/project', request.url));
    }
    
    // PRIORITY 4: Only redirect to onboarding if user has NOT completed onboarding
    console.log('🔄 Root route access - user not onboarded, redirecting to onboarding');
    return NextResponse.redirect(new URL(onboarding, request.url));
  }

  // Bare /project (no board id) should never be a dead end: restore the user's
  // last board so a login/redirect that lost the id lands on their board instead
  // of the useless first/welcome board. /project?id=N already has an id and is
  // left untouched, so there is no redirect loop.
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

  // **FUNNEL USER FLOW (authenticated)**
  if (isFunnelUser) {
    // console.log('✅ Authenticated funnel user - allowing free roam');
    return NextResponse.next();
  }

  // **NON-FUNNEL USER FLOW (authenticated) - Original logic**
  // console.log('👤 Authenticated non-funnel user - checking onboarding');

  if (
    !checkIfOnboarded(user) &&
    currentPath !== onboarding &&
    !currentPath.startsWith(share) &&
    !currentPath.startsWith('/cli-auth')
  ) {
    // console.log('🔄 User not onboarded, redirecting to onboarding');
    return NextResponse.redirect(new URL(onboarding, request.url));
  }

  // Voluntary /trial: allow anyone who has not subscribed yet (Upgrade banner).
  if (currentPath === trial && !canAccessTrialPage(user)) {
    console.log('🔄 User not eligible for trial upgrade page, redirecting away from trial page');
    return NextResponse.redirect(new URL('/', request.url));
  }

  // HTPR-4839: out-of-trial users stay on a free tier and keep using the app.
  // Nothing compels a redirect to /trial any more; the page is voluntary only
  // (gated above by canAccessTrialPage).

  // Handle previous board restoration
  // This is now redundant since we handle it in the root route, but keeping for safety
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

  // console.log('✅ All checks passed, continuing normally');
  return NextResponse.next();
}

export default async function requireAuthMiddleware(request: NextRequest) {
  const response = await authMiddleware(request);
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
        maxAge: 60 * 60 * 24 * 30, // matches the Better Auth session lifetime
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
    '/((?!api|_next|flask-app|.*\\..*).*)',
    '/api/:path*' // HTPR-4182: run the identity gate for every /api route (covers /api/mcp and /api/v1)
  ]
};

const checkIfOnboarded = (user: any) => {
  return user.UserSetting?.onboardingTourStatus;
}

const checkIfTutorialCompleted = (user: any) => {
  return user.UserSetting?.onboardingTutorialStatus;
}
