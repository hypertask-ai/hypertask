"use client";

import nookies, { parseCookies } from "nookies";
import authConfig from "@/lib/configs/auth.config";
import { authClient } from "@/lib/auth/betterAuthClient";

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

export const listAccounts = async (): Promise<SwitchAccount[]> =>
  (await listAccountsWithStatus()).accounts;

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

export const mergeCurrentAccount = (
  accounts: SwitchAccount[],
): SwitchAccount[] => {
  const current = getCurrentAccount();
  if (!current || accounts.some((account) => account.id === current.id)) {
    return accounts;
  }

  return [current, ...accounts];
};

export const switchAccount = async (
  sessionToken: string,
): Promise<boolean> => {
  const activated = await activateAccount(sessionToken);
  if (!activated) return false;

  window.location.assign("/inbox");
  return true;
};

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

    window.location.assign("/inbox");
    return true;
  } catch {
    return false;
  }
};

export const signOutAllAccounts = async (): Promise<boolean> => {
  try {
    const response = await fetch("/api/auth/force-signout", {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) return false;
    authClient.$store.notify("$sessionSignal");
    return true;
  } catch {
    return false;
  }
};

export const addAccount = (): void => {
  if (typeof window === "undefined") return;
  nookies.set(null, ADD_ACCOUNT_COOKIE, "1", {
    maxAge: 60 * 10,
    path: authConfig.cookies.options.path,
  });
  window.location.assign("/login");
};

export const clearAddAccountFlag = (): void => {
  if (typeof window === "undefined") return;
  nookies.destroy(null, ADD_ACCOUNT_COOKIE, {
    path: authConfig.cookies.options.path,
  });
};
