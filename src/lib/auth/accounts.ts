"use client";

import nookies, { parseCookies } from "nookies";
import authConfig from "@/lib/configs/auth.config";
import { authClient } from "@/lib/auth/betterAuthClient";

/**
 * Multi-account support, rebuilt on Better Auth multi-session (HTPR-358).
 *
 * Each "account" is a real Better Auth device session. Switching calls
 * multiSession.setActive, whose response re-mints the legacy nookies_user +
 * signed ht_session cookies for the new user (via legacyCookiePlugin), so the
 * HTPR-4182 identity gate is satisfied. The old cookie-swap approach is dead:
 * swapping nookies_user without a matching signed ht_session now 401s.
 */
export interface SwitchAccount {
  sessionToken: string;
  id: number;
  email: string | null;
  name: string | null;
  image: string | null;
}

const ADD_ACCOUNT_COOKIE = "add_account";

const activateAccount = async (sessionToken: string): Promise<boolean> => {
  try {
    const response = await authClient.multiSession.setActive({ sessionToken });
    return !response?.error;
  } catch {
    return false;
  }
};

export interface AccountListResult {
  accounts: SwitchAccount[];
  ok: boolean;
}

/** All accounts signed in on this device, including request status. */
export const listAccountsWithStatus = async (): Promise<AccountListResult> => {
  try {
    const { data } = await authClient.multiSession.listDeviceSessions();
    if (!Array.isArray(data)) return { accounts: [], ok: false };
    const accounts = data
      .filter((d: any) => d?.session?.token && d?.user?.id != null)
      .map((d: any) => ({
        sessionToken: d.session.token,
        id: Number(d.user.id),
        email: d.user.email ?? null,
        name: d.user.name ?? null,
        image: d.user.image ?? null,
      }))
      .filter((a: SwitchAccount) => Number.isFinite(a.id));

    return { accounts, ok: true };
  } catch {
    return { accounts: [], ok: false };
  }
};

/** All accounts signed in on this device. */
export const listAccounts = async (): Promise<SwitchAccount[]> =>
  (await listAccountsWithStatus()).accounts;

/** The currently-active account id, read from the legacy identity cookie. */
export const getActiveAccountId = (): number | null => {
  try {
    const c = parseCookies();
    if (!c?.[authConfig.cookies.user]) return null;
    const u = JSON.parse(c[authConfig.cookies.user]);
    return u?.id ?? null;
  } catch {
    return null;
  }
};

/**
 * The active account as a display row, read from the legacy identity cookie.
 * A session created before multi-session was enabled won't appear in
 * listDeviceSessions until re-login, so the modal falls back to this to always
 * show (and checkmark) the account you're currently signed in as. It has no
 * sessionToken because it isn't a switch target — it's already active.
 */
export const getCurrentAccount = (): SwitchAccount | null => {
  try {
    const c = parseCookies();
    const raw = c?.[authConfig.cookies.user];
    if (!raw) return null;
    const u = JSON.parse(raw);
    if (u?.id == null) return null;
    return {
      sessionToken: "",
      id: Number(u.id),
      email: u.email ?? null,
      name: u.displayName ?? u.name ?? null,
      image: u.photoURL ?? u.image ?? null,
    };
  } catch {
    return null;
  }
};

/** Include the active legacy identity when Better Auth does not list it yet. */
export const mergeCurrentAccount = (
  accounts: SwitchAccount[],
): SwitchAccount[] => {
  const current = getCurrentAccount();
  if (!current || accounts.some((account) => account.id === current.id)) {
    return accounts;
  }

  return [current, ...accounts];
};

/**
 * Make the given device session active, then hard-reload. setActive's response
 * mints fresh legacy cookies for that user; reloading to "/" lets the app
 * resolve their landing board server-side from the new identity.
 */
export const switchAccount = async (
  sessionToken: string,
): Promise<boolean> => {
  const activated = await activateAccount(sessionToken);
  if (!activated) return false;

  // "/" is a logout booby trap (src/app/page.tsx clears cookies on reach);
  // land switched accounts on a real authed surface instead.
  window.location.assign("/inbox");
  return true;
};

/** Sign a single account out without affecting the other device sessions. */
export const removeAccount = async (
  sessionToken: string,
): Promise<boolean> => {
  try {
    const response = await authClient.multiSession.revoke({ sessionToken });
    return !response?.error && response?.data?.status !== false;
  } catch {
    return false;
  }
};

/**
 * Sign out the active account and land on another signed-in account.
 *
 * Activating first keeps a valid authenticated request available for revoking
 * the old session. If revocation fails, restore the old identity so the
 * Better Auth and legacy identity cookies do not disagree.
 */
export const signOutCurrentAccount = async (
  nextSessionToken: string,
): Promise<boolean> => {
  try {
    const sessionResponse = await authClient.getSession();
    const currentSessionToken = sessionResponse?.data?.session?.token;
    if (!currentSessionToken || currentSessionToken === nextSessionToken) {
      return false;
    }

    if (!(await activateAccount(nextSessionToken))) return false;

    if (!(await removeAccount(currentSessionToken))) {
      await activateAccount(currentSessionToken);
      return false;
    }

    // "/" is a logout booby trap (src/app/page.tsx clears cookies on reach);
    // land switched accounts on a real authed surface instead.
    window.location.assign("/inbox");
    return true;
  } catch {
    return false;
  }
};

/** Better Auth multi-session revokes every device session on normal sign-out. */
export const signOutAllAccounts = async (): Promise<boolean> => {
  try {
    const response = await authClient.signOut();
    return !response?.error && response?.data?.success !== false;
  } catch {
    return false;
  }
};

/**
 * Start "add another account": set a short-lived cookie so proxy.ts lets the
 * still-authenticated user reach /login (which otherwise redirects them away),
 * then go there. Signing in appends a new device session automatically.
 */
export const addAccount = (): void => {
  if (typeof window === "undefined") return;
  nookies.set(null, ADD_ACCOUNT_COOKIE, "1", {
    maxAge: 60 * 10, // 10 min
    path: authConfig.cookies.options.path,
  });
  window.location.assign("/login");
};

/** Clear the add-account marker once a login completes. */
export const clearAddAccountFlag = (): void => {
  if (typeof window === "undefined") return;
  nookies.destroy(null, ADD_ACCOUNT_COOKIE, {
    path: authConfig.cookies.options.path,
  });
};
