const CLI_AUTH_PREFIX = '/cli-auth';
const SLACK_LINK_PATH = '/settings/slack/link';

/** sessionStorage key for resuming /cli-auth after sign-in */
export const POST_LOGIN_REDIRECT_STORAGE_KEY = 'postLoginRedirect';

/**
 * After CLI callback succeeds, navigate the Hypertask tab here (e.g. interactive onboarding).
 * Shared via localStorage so any tab running /cli-auth can read it.
 */
export const POST_CLI_NEXT_REDIRECT_KEY = 'hypertask_post_cli_next';

/**
 * The keyboard-first tutorial is disabled. Keep this parser as a null-returning
 * compatibility seam so stale localStorage is consumed without reopening it.
 */
export function parseSafePostCliRedirect(
  _raw: string | null | undefined
): string | null {
  return null;
}

/**
 * Stable window name: open this synchronously on the login/signup click (user gesture),
 * then after async auth call window.open(cliAuthUrl, CLI_AUTH_WINDOW_NAME) to navigate it.
 * Deferred window.open('_blank') is blocked by browsers.
 */
export const CLI_AUTH_WINDOW_NAME = 'HypertaskCliAuth';

/** Primed on /cli-auth "Allow" click; then navigated to localhost callback after code is issued */
export const CLI_CALLBACK_WINDOW_NAME = 'HypertaskCliCallback';

/**
 * Returns pathname + search safe for same-site navigation, or null.
 * Only the short allowlist of authenticated resume paths — prevents open redirects.
 */
export function parseSafeReturnTo(raw: string | null | undefined): string | null {
  if (raw == null || raw === '') return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(decoded)) return null;
  if (decoded.includes('\\') || decoded.includes('\0')) return null;
  if (!decoded.startsWith('/')) return null;

  const q = decoded.indexOf('?');
  const path = q === -1 ? decoded : decoded.slice(0, q);
  const search = q === -1 ? '' : decoded.slice(q);

  if (path.startsWith('//')) return null;

  const isCliAuth =
    path === CLI_AUTH_PREFIX || path.startsWith(`${CLI_AUTH_PREFIX}/`);
  if (!isCliAuth && path !== SLACK_LINK_PATH) {
    return null;
  }
  return path + search;
}

/** Call from Google login/signup handlers before any await, only when CLI return is queued */
export function primeCliAuthShellWindow(): void {
  if (typeof window === 'undefined') return;
  const raw = sessionStorage.getItem(POST_LOGIN_REDIRECT_STORAGE_KEY);
  const returnTo = parseSafeReturnTo(raw);
  if (
    !returnTo ||
    (returnTo !== CLI_AUTH_PREFIX && !returnTo.startsWith(`${CLI_AUTH_PREFIX}/`))
  ) return;
  window.open('about:blank', CLI_AUTH_WINDOW_NAME);
}
