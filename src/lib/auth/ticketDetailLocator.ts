export type TicketDetailLocator = {
  projectSlug: string;
  uniqueIndex: string;
};

const DETAIL_TICKET = String.raw`(?:\d+|[A-Za-z0-9][A-Za-z0-9_-]*-\d+)`;

export function ticketDetailLocator(pathname: string): TicketDetailLocator | null {
  const match = new RegExp(`^/detail/(project-\\d+)/(${DETAIL_TICKET})/?$`).exec(pathname);
  if (!match) return null;
  return { projectSlug: match[1], uniqueIndex: match[2] };
}

export function ticketDetailFields(
  projectSlug: unknown,
  uniqueIndex: unknown,
): TicketDetailLocator | null {
  if (typeof projectSlug !== "string" || typeof uniqueIndex !== "string") return null;
  return ticketDetailLocator(`/detail/${projectSlug}/${uniqueIndex}`);
}

const TICKET_ACCOUNT_SWITCH_RETURN = "ticket-account-switch-return";
const SWITCHED_ACCOUNT_LABEL = "ticket-account-switched-label";
export const TICKET_ACCOUNT_SWITCH_CHOOSE = "ticket-account-switch";
export const TICKET_ACCOUNT_SWITCHED = "ticket-account-switched";
export const ACTIVE_ACCOUNT_TAB = "ht-active-account";

export function ticketAccountSwitchPath(pathname: string | null | undefined): string | null {
  if (typeof pathname !== "string" || !pathname.startsWith("/") || pathname.startsWith("//")) return null;
  const locator = ticketDetailLocator(pathname.split(/[?#]/, 1)[0]);
  if (!locator) return null;
  return `/detail/${locator.projectSlug}/${locator.uniqueIndex}`;
}

function ticketSwitchStorage(): Storage | null {
  if (typeof window === "undefined" || !window.sessionStorage) return null;
  return window.sessionStorage;
}

export function rememberTicketAccountSwitch(pathname: string) {
  const storage = ticketSwitchStorage();
  if (!storage) return;
  const next = ticketAccountSwitchPath(pathname);
  if (!next) {
    storage.removeItem(TICKET_ACCOUNT_SWITCH_RETURN);
    return;
  }
  storage.setItem(TICKET_ACCOUNT_SWITCH_RETURN, next);
}

export function takeTicketAccountSwitchLanding(): string | null {
  const storage = ticketSwitchStorage();
  if (!storage) return null;
  const next = ticketAccountSwitchPath(storage.getItem(TICKET_ACCOUNT_SWITCH_RETURN));
  storage.removeItem(TICKET_ACCOUNT_SWITCH_RETURN);
  return next;
}

export function forgetTicketAccountSwitch() {
  ticketSwitchStorage()?.removeItem(TICKET_ACCOUNT_SWITCH_RETURN);
}

export function ticketAccountSwitchStays(): boolean {
  if (typeof document === "undefined" || !document.getElementById("unauthorized-title")) return false;
  const here = ticketAccountSwitchPath(window.location.pathname);
  if (!here) return false;
  rememberTicketAccountSwitch(here);
  return true;
}

export function openSwitchedTicketAccount() {
  const here = ticketAccountSwitchPath(window.location.pathname);
  if (here && takeTicketAccountSwitchLanding() === here) {
    window.location.reload();
    return;
  }
  window.location.assign("/inbox");
}

export function rememberSwitchedAccount(label: string, userId: number) {
  const storage = ticketSwitchStorage();
  if (storage && label) storage.setItem(SWITCHED_ACCOUNT_LABEL, label);
  try {
    if (Number.isInteger(userId) && userId > 0) {
      window.localStorage.setItem(ACTIVE_ACCOUNT_TAB, String(userId));
    }
  } catch {
    return;
  }
}

function accountLabelFromCookie(): string | null {
  try {
    const raw = document.cookie.split("; ").find((part) => part.startsWith("nookies_user="));
    if (!raw) return null;
    const user = JSON.parse(decodeURIComponent(raw.slice("nookies_user=".length)));
    const label = user.displayName || user.name || user.email;
    return typeof label === "string" && label.trim() ? label.trim() : null;
  } catch {
    return null;
  }
}

export function consumeAccountSwitchNotice(): string | null {
  const storage = ticketSwitchStorage();
  const saved = storage?.getItem(SWITCHED_ACCOUNT_LABEL) ?? null;
  if (saved && storage) storage.removeItem(SWITCHED_ACCOUNT_LABEL);
  const marked = typeof document !== "undefined"
    && document.cookie.split("; ").some((part) => part.startsWith(`${TICKET_ACCOUNT_SWITCHED}=`));
  if (marked) document.cookie = `${TICKET_ACCOUNT_SWITCHED}=; Max-Age=0; Path=/`;
  if (!saved && !marked) return null;
  const label = saved || accountLabelFromCookie();
  return label ? `Switched to ${label}` : null;
}

export function accountTabShouldReload(currentUserId: number, nextValue: string | null): boolean {
  const next = Number(nextValue);
  return Number.isInteger(next) && next > 0 && next !== currentUserId;
}

export function syncSwitchedAccountTabs(userId: number, notify: (message: string) => void): () => void {
  const message = consumeAccountSwitchNotice();
  if (message) notify(message);
  try {
    if (Number.isInteger(userId) && userId > 0) {
      window.localStorage.setItem(ACTIVE_ACCOUNT_TAB, String(userId));
    }
  } catch {}
  const onStorage = (event: StorageEvent) => {
    if (event.key !== ACTIVE_ACCOUNT_TAB) return;
    if (accountTabShouldReload(userId, event.newValue)) window.location.reload();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

export function submitTicketAccountSwitch(pathname: string, openSwitcher: () => void) {
  if (typeof document === "undefined" || !document.getElementById("unauthorized-title")) return;
  const locator = ticketDetailLocator(pathname);
  if (!locator) return;
  const choose = document.cookie.split("; ").includes(`${TICKET_ACCOUNT_SWITCH_CHOOSE}=choose`);
  if (choose) {
    document.cookie = `${TICKET_ACCOUNT_SWITCH_CHOOSE}=; Max-Age=0; Path=/`;
    rememberTicketAccountSwitch(pathname);
    openSwitcher();
    return;
  }
  const attemptKey = `ticket-account-switch:${pathname}`;
  const storage = ticketSwitchStorage();
  if (!storage || storage.getItem(attemptKey)) return;
  storage.setItem(attemptKey, "1");
  const form = document.createElement("form");
  form.method = "POST";
  form.action = "/api/auth/ticket-account-switch";
  for (const [name, value] of [["projectSlug", locator.projectSlug], ["uniqueIndex", locator.uniqueIndex]] as const) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.append(input);
  }
  document.body.append(form);
  form.submit();
}
