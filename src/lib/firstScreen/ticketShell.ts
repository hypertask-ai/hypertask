import { HTPR_7627_TICKET_FIRST_SCREEN_FLAG } from "@/lib/flags/keys";
import { BOARD_FIRST_SCREEN_FLAG } from "./boardDocument";
import type { BoardDisplay } from "./boardDisplay";
import { hasFirstScreenDisplayPreferences, type FirstScreenFlags } from "./contract";

export const TICKET_DOCUMENT_ROUTE_HEADER = "x-ht-ticket-document-route";

export type TicketShellSeed = {
  accountId: number;
  flags: FirstScreenFlags;
  display: BoardDisplay;
};

export function getTicketShellSeed(seed: TicketShellSeed | null, accountId: number): TicketShellSeed | null {
  return seed?.accountId === accountId && seed.flags.accountId === accountId &&
    Number.isFinite(Date.parse(seed.flags.evaluatedAt)) &&
    seed.flags.values[BOARD_FIRST_SCREEN_FLAG] === true && seed.flags.values[HTPR_7627_TICKET_FIRST_SCREEN_FLAG] === true &&
    hasFirstScreenDisplayPreferences(seed.display, accountId) && typeof seed.display.isMobile === "boolean"
    ? seed : null;
}
