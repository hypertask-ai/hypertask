const CLI_AUTH_PREFIX = '/cli-auth';
const SLACK_LINK_PATH = '/settings/slack/link';
export const SLACK_SETTINGS_PATH = '/settings/slack';

export const POST_LOGIN_REDIRECT_STORAGE_KEY = 'postLoginRedirect';

export const POST_CLI_NEXT_REDIRECT_KEY = 'hypertask_post_cli_next';

export function parseSafePostCliRedirect(
  _raw: string | null | undefined
): string | null {
  return null;
}

export const CLI_AUTH_WINDOW_NAME = 'HypertaskCliAuth';

export const CLI_CALLBACK_WINDOW_NAME = 'HypertaskCliCallback';

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
  if (isCliAuth) return path + search;
  if (path === SLACK_SETTINGS_PATH) return path;
  if (path === SLACK_LINK_PATH) return path + search;
  return null;
}

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
