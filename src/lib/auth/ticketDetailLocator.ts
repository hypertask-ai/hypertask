export type TicketDetailLocator = {
  projectSlug: string;
  uniqueIndex: string;
};

export function ticketDetailLocator(pathname: string): TicketDetailLocator | null {
  const match = /^\/detail\/(project-\d+)\/(\d+)\/?$/.exec(pathname);
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
export const TICKET_ACCOUNT_SWITCH_CHOOSE = "ticket-account-switch";

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
