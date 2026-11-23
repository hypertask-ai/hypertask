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
