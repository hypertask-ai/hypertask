import { isGuestUser } from "@/lib/demo/guest";

export type FathomEventName = "Signup completed" | "Login page viewed";

type FathomWindow = { fathom?: { trackEvent: (name: string) => void } };

const NEW_ACCOUNT_WINDOW_MS = 30 * 60 * 1000;
const SCRIPT_WAIT_ATTEMPTS = 20;
const SCRIPT_WAIT_MS = 500;

export function trackFathomEvent(name: FathomEventName, onTracked?: () => void): () => void {
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const attempt = () => {
    const fathom = (window as FathomWindow).fathom;
    if (fathom) {
      fathom.trackEvent(name);
      onTracked?.();
      return;
    }
    attempts += 1;
    if (attempts < SCRIPT_WAIT_ATTEMPTS) timer = setTimeout(attempt, SCRIPT_WAIT_MS);
  };
  attempt();
  return () => clearTimeout(timer);
}

export const fathomSignupKey = (userId: number) => `fathom-signup-completed:${userId}`;

export function isNewAccount(joinedAt: unknown, now: number): boolean {
  const joined = new Date(joinedAt as string).getTime();
  return Number.isFinite(joined) && now - joined >= 0 && now - joined <= NEW_ACCOUNT_WINDOW_MS;
}

export function trackSignupCompleted(
  user: { id?: number; uid?: string | null; joinedAt?: unknown } | null | undefined,
  accountId: number | null,
  storage: Pick<Storage, "getItem" | "setItem">,
  now: number,
): (() => void) | undefined {
  if (!user || accountId === null || user.id !== accountId) return undefined;
  if (isGuestUser(user) || !isNewAccount(user.joinedAt, now)) return undefined;
  const key = fathomSignupKey(accountId);
  if (storage.getItem(key)) return undefined;
  return trackFathomEvent("Signup completed", () => storage.setItem(key, "1"));
}
