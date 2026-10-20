import { hasFirstScreenDisplayPreferences, type FirstScreenDisplayPreferences } from "./contract";
import { AI_CHAT_SIDEBAR_MIN_PX } from "@/lib/configs/style.config";
import { TABLE_COLUMN_KEYS } from "@/utils/helperFunctions/Views/TableColumnsHelperFunctions";

export const BOARD_DISPLAY_COOKIE = "ht_board_display_v1";
export type BoardDisplay = FirstScreenDisplayPreferences & {
  isMobile: boolean;
  inbox?: { nudgeDismissed: boolean; pushPermission: NotificationPermission; pushEnabled: boolean };
  board: {
    railOn: boolean;
    showEmptyViewTabs: boolean;
    hiddenViewTabIds: Record<string, boolean>;
    viewTabsOrder: Record<string, string[]>;
    tableColumns: string[];
    tableWidths: Record<string, number>;
    tableTitleWrap: boolean;
    openChat: boolean;
    chatSuppressed: boolean;
    chatPinned: boolean;
    chatWidth?: number;
    chatSidebarMode?: boolean;
  };
};

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const identifier = (value: string) => /^[a-zA-Z0-9_-]{1,100}$/.test(value);
export function parseBoardDisplay(value: string | undefined, accountId: number, { desktopChat = false }: { desktopChat?: boolean } = {}): BoardDisplay | null {
  try {
    if (!value || value.length > 3800) return null;
    const display = JSON.parse(value) as BoardDisplay;
    if (!hasFirstScreenDisplayPreferences(display, accountId) || typeof display.isMobile !== "boolean" || !record(display.board)) return null;
    const b = display.board;
    if (![b.railOn, b.showEmptyViewTabs, b.tableTitleWrap, b.openChat, b.chatSuppressed, b.chatPinned].every(v => typeof v === "boolean") ||
        !record(b.hiddenViewTabIds) || !Object.entries(b.hiddenViewTabIds).every(([k, v]) => identifier(k) && typeof v === "boolean") ||
        !record(b.viewTabsOrder) || !Object.entries(b.viewTabsOrder).every(([k, v]) => /^\d+$/.test(k) && Array.isArray(v) && v.every(id => typeof id === "string" && identifier(id))) ||
        !Array.isArray(b.tableColumns) || !b.tableColumns.length || !b.tableColumns.every(key =>
          typeof key === "string" && ((TABLE_COLUMN_KEYS as readonly string[]).includes(key) || /^customField:[a-zA-Z0-9-]{1,100}$/.test(key))) ||
        !record(b.tableWidths) || !Object.entries(b.tableWidths).every(([k, v]) => typeof v === "number" && Number.isFinite(v) && v >= 40 && v <= 2000 &&
          ((TABLE_COLUMN_KEYS as readonly string[]).includes(k) || /^customField:[a-zA-Z0-9-]{1,100}$/.test(k)))) return null;
    if ((b.chatWidth !== undefined && (typeof b.chatWidth !== "number" || !Number.isFinite(b.chatWidth) || b.chatWidth < AI_CHAT_SIDEBAR_MIN_PX || b.chatWidth > 2000)) ||
        (b.chatSidebarMode !== undefined && typeof b.chatSidebarMode !== "boolean")) return null;
    if (!display.isMobile && (b.chatPinned || (b.openChat && !b.chatSuppressed)) &&
        (!desktopChat || b.chatWidth === undefined || b.chatSidebarMode === undefined)) return null;
    return display;
  } catch {
    return null;
  }
}
