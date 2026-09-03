import { ICommandList } from "@/components/Modals/commands/HTC/HTCTypes";
import { DisplayDate } from "@/components/Modals/RemindMe/RemindMeComponent";
import { Tgroup } from "@/components/sidebars/leftSidebar";
import { IFilterSettings } from "@/models/Filters/model";
import { CommandMode } from "@/models/enums";
import { IAgent, IAttachment, IProject, ISection, ITask, ITasksPlaylist, ITeamByokApiKey, TDeviceTypes } from "@/models/model";
import { atom, recoilPersist, selectorFamily } from "@/lib/state";
import { atomWithStorage, createJSONStorage } from "jotai/utils";
import { TDefaultEditFocus, TSectionPayload } from "@/models/CreateTaskModalModels/model";
import { ITutorialAtom } from "@/models/InteractiveOnboarding/model";
import { IAnnouncement } from "@/models/Announcements/model";
import { AI_CHAT_SIDEBAR_DEFAULT_PX } from "@/lib/configs/style.config";
import type { StorePlanKind, StripeBillingInterval } from "@/lib/planFromStripePriceId";
import {
    DEFAULT_CALENDAR_SETTINGS,
    DEFAULT_CALENDAR_TASK_FILTERS,
    type CalendarSettings,
    type CalendarSort,
    type CalendarTaskFilters,
} from "@/models/Calendar/model";

const { persistAtom } = recoilPersist()

/** BYOK provider toggles from DB; no secrets. `provider` matches `TeamByokApiKey.provider` (string). */


export type CurrentBoardBilling = {
  projectId: number;
  teamId: string | null;
  stripePriceId: string | null;
  storePlanId: StorePlanKind;
  billingInterval: StripeBillingInterval | null;
  /** From `TeamByokApiKey` (provider + enabled only). Empty if team payload omitted keys. */
  byokProviderFlags: ITeamByokApiKey[];
};

export interface IFcmHookData {
    statusToggleFromDB: "true" | "false";
    fcmToken: string | undefined;
    permissionStatus: NotificationPermission
}

export interface ICurrentInViewObject {
    taskId: number | null,
    taskProjectId: number | null,
    sectionId?: number | null,
    sectionTitle?: string | null,
    taskTitle?: string | null,
    taskTicketNumber?: string | null,
}

export interface IGlobalNotificationFocus {
    currSplit: number;
    currIdx: number
}

export interface IShowHypertaskHTC {
    mode: CommandMode,
    show: boolean,
    scope?: "board",
    payload?: any,
    commentIndex?: number
}

export interface AllKanbanData {
    index: number;
    updatedProjects: IProject[];
    notificationsCount: any;
}
export const fcmAtom = atom<IFcmHookData>({
    key: "fcmAtom",
    default: {
        statusToggleFromDB: "false",
        fcmToken: undefined,
        permissionStatus: "default"
    },
    effects_UNSTABLE: [persistAtom],
});

// A query handed from Search's "Ask AI" to the single general AI chat, which
// consumes and auto-sends it when the chat mounts/opens, then clears it.
export const aiChatPendingPromptAtom = atom<string | null>({
    key: "aiChatPendingPromptAtom",
    default: null,
});



export const lastUsedReminderAtom = atom<DisplayDate | undefined>({
    key: "lastUsedReminder",
    default: undefined,
});

export const lastUsedDueDateAtom = atom<DisplayDate | undefined>({
    key: "lastUsedDueDate",
    default: undefined,
});

export const frequentlyUsedHTCAton = atom<{ [key: string]: ICommandList }>({
    key: "frequentlyUsedHTCAton",
    default: {
        "createTask": {
            key: "createTask",
            name: "Create task",
            keyboard: ["C"],
            commandMode: CommandMode.CreateTask,
            frequency: 1,
            keywords: "create add new task ticket issue todo work item"
        },
    },
    effects_UNSTABLE: [persistAtom]
})


export const showSidebarAtom = atom({
    key: "showSidebar",
    default: false,
});

export const showScrollSettingModalAtom = atom({
    key: "showScrollSettingModal",
    default: false,
});

export const showMcpTokenModalAtom = atom({
    key: "showMcpTokenModal",
    default: false,
});

export const showQuickTipsAtom = atom<boolean>({
    key: "showQuickTips",
    default: true,
    effects_UNSTABLE: [persistAtom],

});
export const notifPromoteBannerVisibleAtom = atom<boolean>({
    key: "notifPromoteBannerVisible",
    default: false,
});
export const showShortcutsAtom = atom({
    key: "showShortcuts",
    default: false,
});
// HTPR-4883: guest "Log in / sign up" modal. Global so the surfaces that open
// it (app-shell rail, guest lock overlay) can close themselves without taking
// the modal down with them.
export const showGuestLoginAtom = atom({
    key: "showGuestLogin",
    default: false,
});
// Show saved views whose current filtered task count is zero in the app-shell
// view-tabs row. Hidden by default and persisted per-user across sessions.
export const showEmptyViewTabsAtom = atom<boolean>({
    key: "showEmptyViewTabs",
    default: false,
    effects_UNSTABLE: [persistAtom],
});
// The rail shell is the default layout. Users who prefer the old header
// layout can switch back from Ctrl+K ("Old Hypertask Design"), which
// persists false here.
export const appShellRailAtom = atom<boolean>({
    key: "appShellRail",
    default: true,
    effects_UNSTABLE: [persistAtom],
});
// Rail expanded (130px, labelled) vs collapsed (48px, icons only). Persisted
// per user so the choice survives a reload.
export const appShellRailExpandedAtom = atom<boolean>({
    key: "appShellRailExpanded",
    default: false,
    effects_UNSTABLE: [persistAtom],
});
// Per-view opt-out from the view-tabs bar: view id -> true means hidden.
// Absent/false means shown. Set from the "Manage views" modal, persisted
// per-user across sessions.
export const hiddenViewTabIdsAtom = atom<Record<string, boolean>>({
    key: "hiddenViewTabIds",
    default: {},
    effects_UNSTABLE: [persistAtom],
});
// Custom view order per board: project id -> ordered array of view ids, set
// by dragging pills on the bar or rows in "Manage views". Views not in the
// array fall back to the default sort, appended after the ordered ones.
// Key is live in prod localStorage since HTPR-4200 — do not rename.
export const viewTabsOrderAtom = atom<Record<number, string[]>>({
    key: "viewTabsOrder",
    default: {},
    effects_UNSTABLE: [persistAtom],
});
// Session-only write-through layer. Server data wins on a fresh load, while a
// drag/sort remains immediate until the next server payload catches up.
export const optimisticViewTabsOrderAtom = atom<Record<number, string[]>>({
    key: "optimisticViewTabsOrder",
    default: {},
});
// Built-in board views are virtual and must never reach User_Project_View.
// Keep their active selection in client memory, keyed by project id.
export const activeBuiltinViewsAtom = atom<Record<number, string>>({
    key: "activeBuiltinViews",
    default: {},
});
// Show history/activity events in the task detail feed. Shown by default;
// the toggle (pill / Ctrl+Shift+H / Ctrl+K) hides them. Persisted per-user so
// a user's choice sticks across sessions.
export const showTaskHistoryAtom = atom<boolean>({
    key: "showTaskHistory",
    default: true,
    effects_UNSTABLE: [persistAtom],
});
export const showArchivedOnBoardAtom = atom<boolean>({
    key: "showArchivedOnBoard",
    default: false,
    effects_UNSTABLE: [persistAtom],
});
export type ArchiveBoardScope = "active" | "all" | "archived";
// Optimistic value for a "show archived" toggle whose view write is still in
// flight, keyed by project. Without it a second toggle re-reads the stale saved
// override and repeats the first toggle's value (HTPR-5540).
export const pendingShowArchivedAtom = atom<{ projectId: number; value: boolean } | null>({
    key: "pendingShowArchived",
    default: null,
});
export const archiveBoardScopeAtom = atom<ArchiveBoardScope>({
    key: "archiveBoardScope",
    default: "active",
    effects_UNSTABLE: [persistAtom],
});
export type BoardLayout = "board" | "table";

// Browser preference: used when a saved view has no explicit layout. Keep the
// existing key so current users retain their preference after saved layouts ship.
export const boardLayoutPreferenceAtom = atom<BoardLayout>({
    key: "boardLayout",
    default: "board",
    effects_UNSTABLE: [persistAtom],
});

// Effective surface for the current tab. Saved view overrides and shared-link
// surface hints must not rewrite the browser preference above.
export const boardLayoutAtom = atom<BoardLayout>({
    key: "activeBoardLayout",
    default: "board",
});

export {
    TABLE_COLUMN_KEYS,
    DEFAULT_TABLE_COLUMNS,
    customFieldColumnKey,
    isCustomFieldColumnKey,
    customFieldIdFromColumnKey,
    normalizeTableVisibleColumns,
    setTableStalenessColumns,
    seedMissingCustomFieldColumns,
    LOCKED_TABLE_COLUMNS,
} from "@/utils/helperFunctions/Views/TableColumnsHelperFunctions";
export type { TableColumnKey } from "@/utils/helperFunctions/Views/TableColumnsHelperFunctions";
import { DEFAULT_TABLE_COLUMNS } from "@/utils/helperFunctions/Views/TableColumnsHelperFunctions";

// Key is live in localStorage once table column configuration ships; do not rename.
export const tableVisibleColumnsAtom = atom<string[]>({
    key: "tableVisibleColumnsAtom",
    default: [...DEFAULT_TABLE_COLUMNS],
    effects_UNSTABLE: [persistAtom],
});
// A board-level time-total setting introduces the optional Time column once per
// browser. Keeping the one-time marker separate lets a later manual hide stay
// hidden instead of being re-added on every render.
export const tableTimeColumnSeededBoardsAtom = atom<number[]>({
    key: "tableTimeColumnSeededBoardsAtom",
    default: [],
    effects_UNSTABLE: [persistAtom],
});
// Per-column width overrides from drag-to-resize (HTPR-4987). Keyed the same
// way as tableVisibleColumnsAtom (built-in key or 'customField:<uuid>'); a
// column absent here just uses its default width. Same localStorage
// persistence layer as the order/visibility atom above, kept as a sibling
// atom rather than folded into that string[] so the existing order/visibility
// shape (and its tests) don't have to change.
export const tableColumnWidthsAtom = atom<Record<string, number>>({
    key: "tableColumnWidthsAtom",
    default: {},
    effects_UNSTABLE: [persistAtom],
});
export const tableTitleWrapAtom = atom<boolean>({
    key: "tableTitleWrap",
    default: true,
    effects_UNSTABLE: [persistAtom],
});
// One-shot signal: the command palette increments this to trigger the
// task-detail "expand/collapse all comments" toggle, whose state lives in
// local React state and isn't reachable from the global palette directly.
export const toggleAllCommentsSignalAtom = atom<number>({
    key: "toggleAllCommentsSignal",
    default: 0,
});
export const kanbanFiltersAtom = atom<IFilterSettings>({
    key: "kanbanFilterAtom",
    default: { addedFilters: [], matchFilters: "ALL" },
    effects_UNSTABLE: [persistAtom],

});

export const landingPageDataAtom = atom<AllKanbanData | null>({
    key: "landingPageData",
    default: null,
    effects_UNSTABLE: [persistAtom],

});
export const showBoardManagerAtom = atom({
    key: "showBoardManager",
    default: false,
});

// Board Ctrl+F search. Lives in Recoil so it survives navigating into a task
// detail route and back. Scoped by project so the filter does not leak across
// boards. Not persisted: a hard reload starts clean.
export const boardSearchAtom = atom<{
    open: boolean;
    keyword: string;
    projectId: number | null;
}>({
    key: "boardSearch",
    default: { open: false, keyword: "", projectId: null },
});

// NOT persisted: whether the chat is open is per-session UI state. Persisting it
// meant every app launch reopened the chat, so a user who couldn't dismiss it
// could not escape by restarting either — the app booted straight back into it.
export const showAIChatInterfaceAtom = atom<boolean>({
    key: "showAIChatInterface",
    default: false,
});

export const showAnnouncementsAtom = atom<boolean>({
    key: "showAnnouncements",
    default: false,
});

// True while the mobile comment composer is in active comment mode (editor
// focused, keyboard up). Transient — not persisted. Read by GloablProviders to
// hide the bottom MobileTabBar so the composer sits directly on the keyboard.
export const mobileCommentComposerOpenAtom = atom<boolean>({
    key: "mobileCommentComposerOpen",
    default: false,
});

// Remember the last desktop window mode. The side panel remains the default for
// new users, while someone who deliberately switches to the floating window
// gets that choice back after a reload. Full-screen chat is represented by its
// /chat route and returns to this last docked mode.
export const isAiChatSidebarModeAtom = atom<boolean>({
    key: "isAiChatSidebarMode",
    default: true,
    effects_UNSTABLE: [persistAtom],
});

export const aiChatSidebarWidthPxAtom = atom<number>({
    key: "aiChatSidebarWidthPx",
    default: AI_CHAT_SIDEBAR_DEFAULT_PX,
    effects_UNSTABLE: [persistAtom],
});

// User preference (Settings > General > Task Page): when on, opening any task
// detail page or board auto-opens AI chat in the remembered side-panel or
// floating-window mode. Client-only, persisted per-user in localStorage like
// the other Task Page toggles.
// HTPR-4866: defaults ON so the chat is the first thing a new user sees. Mobile
// is excluded at the call sites, and a manual close persists via
// aiChatAutoOpenSuppressedAtom, so closing it stays closed.
export const openAiChatByDefaultAtom = atom<boolean>({
    key: "openAiChatByDefault",
    default: true,
    effects_UNSTABLE: [persistAtom],
});

// A manual close suppresses default auto-open until the user opens chat again.
export const aiChatAutoOpenSuppressedAtom = atom<boolean>({
    key: "aiChatAutoOpenSuppressed",
    default: false,
    effects_UNSTABLE: [persistAtom],
});

// Keep AI chat open across task and board navigation until manually unpinned.
export const aiChatPinnedAtom = atom<boolean>({
    key: "aiChatPinned",
    default: false,
    effects_UNSTABLE: [persistAtom],
});

export const aiChatPinnedSessionIdsAtom = atom<string[]>({
    key: "aiChatPinnedSessionIds",
    default: [],
    effects_UNSTABLE: [persistAtom],
});

// Maps projectId -> last chat session used on that board.
export const aiChatBoardSessionMapAtom = atom<Record<number, string>>({
    key: "aiChatBoardSessionMap",
    default: {},
    effects_UNSTABLE: [persistAtom],
});

// Full-screen chat scope: null = all boards (list shows ALL chats), number =
// one board (list shows only that board's chats; also scopes the AI + mentions).
export const fullScreenChatScopeAtom = atom<number | null>({
    key: "fullScreenChatScope",
    default: null,
    effects_UNSTABLE: [persistAtom],
});

// null = current board (follows navigation), number = pinned board, "all" = all boards.
export const dockedChatScopeAtom = atom<number | "all" | null>({
    key: "dockedChatScope",
    default: null,
    effects_UNSTABLE: [persistAtom],
});

// Most-recently-selected chat scope board ids, newest first.
export const recentChatBoardIdsAtom = atom<number[]>({
    key: "recentChatBoardIds",
    default: [],
    effects_UNSTABLE: [persistAtom],
});

// Persisted width of the full-screen chat session rail.
export const fullScreenChatRailWidthAtom = atom<number>({
    key: "fullScreenChatRailWidth",
    default: 280,
    effects_UNSTABLE: [persistAtom],
});

export const showCommandsAtom = atom<IShowHypertaskHTC>({
    key: "showCommands",
    default: {
        show: false,
        mode: CommandMode.Command
    },
});

export const boardZoomedOutAtom = atom<Record<number, boolean>>({
    key: "boardZoomedOut",
    default: {},
});

export const showPriorityModal = atom({
    key: "showPriorityModal",
    default: false,
});

export const inViewObjectAtom = atom<ICurrentInViewObject>({
    key: "inViewObject",
    default: {
        taskId: null,
        taskProjectId: null,
        sectionId: null,
        sectionTitle :null,
        taskTitle: null,
        taskTicketNumber: null,
    },
})

export const activeItemAtom = atom<number | null>({
    key: "activeItem",
    default: null,
});

// HTPR-3814: per-card active check. Subscribing a Kanban card to this selector
// (instead of activeItemAtom directly) means moving the selection between cards
// only re-renders the two cards whose value flips, not every card on the board.
export const isActiveTaskSelector = selectorFamily<boolean, number | null | undefined>({
    key: "isActiveTask",
    get: (taskId) => ({ get }) => get(activeItemAtom) === taskId,
});

export const currentProjectAtom = atom<IProject | null>({
    key: "currentProject",
    default: null,
});

/** Authoritative team scope for the full-screen Settings tree. */
export const selectedSettingsTeamIdAtom = atom<string | null>({
    key: "selectedSettingsTeamId",
    default: null,
});

export const kanbanRunningOnlyAtom = atom<boolean>({
    key: "kanbanRunningOnly",
    default: false,
});

/** Team / Stripe plan for the board in `currentProjectAtom` (updated in `useGlobalProvider`). */
export const currentBoardBillingAtom = atom<CurrentBoardBilling | null>({
    key: "currentBoardBilling",
    default: null,
});

export const projectSectionsAtom = atom<ISection[] | null>({
    key: "projectSections",
    default: null,
    effects_UNSTABLE: [persistAtom],
});

// Session storage keeps each browser tab's playlist to itself, so archiving in one
// tab cannot navigate into a playlist another tab wrote (HTPR-5584).
type PlaylistStringStorage = {
    getItem: (key: string) => string | null;
    setItem: (key: string, newValue: string) => void;
    removeItem: (key: string) => void;
};

// Used when the browser blocks storage access. Keeping the values in memory means
// navigation still works for the life of the tab instead of resetting on mount.
const memoryPlaylistValues = new Map<string, string | null>();
const memoryPlaylistStorage: PlaylistStringStorage = {
    getItem: (key) => memoryPlaylistValues.get(key) ?? null,
    setItem: (key, newValue) => {
        memoryPlaylistValues.set(key, newValue);
    },
    removeItem: (key) => {
        memoryPlaylistValues.delete(key);
    },
};

const browserPlaylistStorage: PlaylistStringStorage = {
    getItem: (key) => {
        if (memoryPlaylistValues.has(key)) {
            return memoryPlaylistStorage.getItem(key);
        }

        try {
            return typeof window === "undefined"
                ? memoryPlaylistStorage.getItem(key)
                : window.sessionStorage.getItem(key);
        } catch {
            return memoryPlaylistStorage.getItem(key);
        }
    },
    setItem: (key, newValue) => {
        try {
            if (typeof window === "undefined") {
                memoryPlaylistStorage.setItem(key, newValue);
                return;
            }

            window.sessionStorage.setItem(key, newValue);
            memoryPlaylistStorage.removeItem(key);
        } catch {
            memoryPlaylistStorage.setItem(key, newValue);
        }
    },
    removeItem: (key) => {
        if (typeof window === "undefined") {
            memoryPlaylistStorage.removeItem(key);
            return;
        }

        try {
            window.sessionStorage.removeItem(key);
            memoryPlaylistStorage.removeItem(key);
        } catch {
            // Keep a tombstone so a later read cannot restore stale browser data.
            memoryPlaylistValues.set(key, null);
        }
    },
};

const tasksPlaylistStorage = createJSONStorage<ITasksPlaylist[] | null>(
    () => browserPlaylistStorage,
);

// getOnInit restores the stored playlist on the first read, so a same-tab reload keeps
// task-detail navigation working instead of starting from an empty playlist.
export const tasksPlayListAtom = atomWithStorage<ITasksPlaylist[] | null>(
    "tasksPlayListAtom",
    null,
    tasksPlaylistStorage,
    { getOnInit: true },
);

export const InboxTaskIndexAtom = atom<number>({
    key: "InboxTaskIndexAtom",
    default: 0,
    effects_UNSTABLE: [persistAtom],
});
export const globalNotificationFocusAtom = atom<IGlobalNotificationFocus>({
    key: "GlobalNotificationFocus",
    default: { currIdx: 0, currSplit: 0 },
    effects_UNSTABLE: [persistAtom],
});
export const SearchTaskIndexAtom = atom<number | null>({
    key: "SearchTaskIndexAtom",
    default: 0,
    effects_UNSTABLE: [persistAtom],
});

export const ArchivedTaskIndexAtom = atom<number | null>({
    key: "ArchivedTaskIndexAtom",
    default: 0,
    effects_UNSTABLE: [persistAtom],
});
export const CurrentGroupAtom = atom<Tgroup>({
    key: "CurrentGroupAtom",
    default: "Teams",
    effects_UNSTABLE: [persistAtom],
});

export const activeSectionAtom = atom<number | null>({
    key: "activeSection",
    default: null,
})
export const activeSectionIdAtom = atom<number | null>({
    key: "activeSectionId",
    default: null,
});
export const isActiveSectionSelector = selectorFamily<boolean, number | null | undefined>({
    key: "isActiveSection",
    get: (sectionIndex) => ({ get }) => get(activeSectionAtom) === sectionIndex,
});
export const openBoardByClickAtom = atom({
    key: "openBoardByClick",
    default: false,
});
export const idToDeleteCommentAtom = atom({
    key: "idToDeleteComment",
    default: null,
});

export const currentUserAtom = atom<any>({
    key: "currentUser",
    default: null,
    effects_UNSTABLE: [persistAtom],
})

// Define the atoms
export const uploadInProgressAtom = atom<boolean>({
    key: 'uploadInProgressAtom',
    default: false,
});
export const commentsUploadInProgress = atom<any[]>({
    key: 'commentsUploadInProgressAtom',
    default: [],
});

// Define the atoms
interface ICreateTaskModalAtom {
    show: boolean;
    column_payload?: TSectionPayload
    defaultEditFocus?: TDefaultEditFocus
    duplicate?: any
}
export const showCreateTaskModalAtom = atom<ICreateTaskModalAtom>({
    key: 'showCreateTaskModalAtom',
    default: {
        show: false,
    },
});


export const macOrWindowsAtom = atom<TDeviceTypes>({
    key: "macOrWindows",
    default: "Windows",
    effects_UNSTABLE: [persistAtom],

})


interface IUploadingDescriptionAtom {
    attached: number;
    uploaded: number;
    canUpload: boolean
}
export const uploadingStateCreateTaskModalAtom = atom<IUploadingDescriptionAtom | undefined> ({
    key:"uploadingStateCreateTaskModalAtom",
    default:undefined,
})

export const tutorialActiveSceneAtom=atom<ITutorialAtom>({
  key:"tutorialActiveSceneAtom",
  default:{
    index:0,
    phase:0,
    currPage:"landing"
  },
//   effects_UNSTABLE: [persistAtom],
})

export const newTaskCreatedAtom = atom<ITask | undefined>({
    key: "newTaskCreatedAtom",
    default: undefined,
  });

  export const announcementSlideAtom = atom<IAnnouncement | undefined>({
    key: "announcementSlideAtom",
    default: undefined,
})

export const showMentionListAtom = atom<boolean>({
    key: "showMentionListAtom",
    default: false,
})

export const showTrialModalAtom = atom<boolean>({
    key: "showTrialModalAtom",
    default: false,
})

export const searchHistoryAtom = atom<string[]>({
    key: "searchHistoryAtom",
    default: [],
    effects_UNSTABLE: [persistAtom],
})

export const isXScrollOnKanbanAtom = atom<boolean>({
    key: "isXScrollOnKanbanAtom",
    default: false,
    effects_UNSTABLE: [persistAtom],
})

export const showSetLinkModalAtom = atom<boolean>({
    key: "showSetLinkModalAtom",
    default: false,
})

export const currentViewAtom = atom<"month" | "week" | "day">({
    key: "currentViewAtom",
    default: "week",
    effects_UNSTABLE: [persistAtom],
});

export const calendarSettingsAtom = atom<CalendarSettings>({
    key: "calendarSettingsAtom",
    default: DEFAULT_CALENDAR_SETTINGS,
    effects_UNSTABLE: [persistAtom],
});

export const isFavoritesExpandedAtom = atom<boolean>({
    key: "isFavoritesExpandedAtom",
    default: false,
    effects_UNSTABLE: [persistAtom],
});

export const boardSortModeAtom = atom<"teams" | "lastUsed">({
    key: "boardSortModeAtom",
    default: "teams",
    effects_UNSTABLE: [persistAtom],
});

export const lastUsedBoardsAtom = atom<{ [projectId: number]: number }>({
    key: "lastUsedBoardsAtom",
    default: {},
    effects_UNSTABLE: [persistAtom],
});

/**
 * Bridges the Alt+Shift+Arrow team-cycle shortcut (registered once, in the
 * app-wide keydown handler alongside Ctrl+B) into Agent Chat, whose team
 * filter is page-local state the global handler has no other way to reach.
 * Agent Chat watches this and applies the direction to its own team list;
 * bumping `seq` on every press is what lets the same direction fire twice
 * in a row register as two separate events.
 */
export const agentChatTeamCycleAtom = atom<{ direction: 1 | -1; seq: number } | null>({
    key: "agentChatTeamCycle",
    default: null,
});

export const calendarCheckedProjectsAtom = atom<Record<number, boolean>>({
    key: "calendarCheckedProjectsAtom",
    default: {},
    effects_UNSTABLE: [persistAtom],
});

// Calendar boards/filters sidebar: closed by default (left overlay opened by the
// header hamburger, like the Kanban board manager). Not persisted, so the board
// list stays hidden on every load (safe during client demos).
export const calendarBoardsSidebarOpenAtom = atom<boolean>({
    key: "calendarBoardsSidebarOpenAtom",
    default: false,
});

export const calendarTaskFiltersAtom = atom<CalendarTaskFilters>({
    key: "calendarTaskFiltersAtom",
    default: DEFAULT_CALENDAR_TASK_FILTERS,
    effects_UNSTABLE: [persistAtom],
});

export const calendarSortAtom = atom<CalendarSort | null>({
    key: "calendarSortAtom",
    default: null,
    effects_UNSTABLE: [persistAtom],
});

export const agentToEditAtom = atom<IAgent | null>({
    key: "agentToEditAtom",
    default: null,
});

// Title for the mobile top bar when the surface owns it: the calendar shows
// the month it is scrolled to, which the top bar cannot derive.
export const mobileTopBarTitleAtom = atom<string | null>({
    key: "mobileTopBarTitle",
    default: null,
});

// Opens the account switcher modal from globally-mounted surfaces (board
// sidebar account row). Hosted in GloablProviders because the commands host
// (HypertasksCommands) is not mounted on every route the sidebar opens on.
export const showAccountSwitcherAtom = atom<boolean>({
    key: "showAccountSwitcher",
    default: false,
});
