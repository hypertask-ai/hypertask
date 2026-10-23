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
    EMPTY_ARCHIVE_SHORTCUT_NUDGE,
    type ArchiveShortcutNudgeState,
} from "@/lib/notifications/archiveShortcutNudge";
import {
    DEFAULT_CALENDAR_SETTINGS,
    DEFAULT_CALENDAR_TASK_FILTERS,
    type CalendarSettings,
    type CalendarSort,
    type CalendarTaskFilters,
} from "@/models/Calendar/model";

const { persistAtom } = recoilPersist()

export type CurrentBoardBilling = {
  projectId: number;
  teamId: string | null;
  stripePriceId: string | null;
  storePlanId: StorePlanKind;
  billingInterval: StripeBillingInterval | null;
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
    paletteTab?: "search" | "compose",
    composeProject?: IProject,
    composeOnCreated?: () => void | Promise<void>,
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

export const composeTaskChatIntroAtom = atom<{ taskId: number; content: string; skillFollowup?: boolean } | null>({
    key: "composeTaskChatIntro",
    default: null,
});

export const composeTaskSkillFollowupAtom = atom<{ taskId: number } | null>({
    key: "composeTaskSkillFollowup",
    default: null,
});

export const composeTaskQuestionsTaskIdAtom = atom<number | null>({
    key: "composeTaskQuestionsTaskId",
    default: null,
});

export const aiChatPendingPromptAtom = atom<string | { query: string; fullScreen: true } | null>({
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
export const shortcutTipsEnabledAtom = atom<boolean>({
    key: "shortcutTipsEnabled",
    default: true,
    effects_UNSTABLE: [persistAtom],
});
export const archiveShortcutNudgeAtom = atom<ArchiveShortcutNudgeState>({
    key: "archiveShortcutNudge",
    default: EMPTY_ARCHIVE_SHORTCUT_NUDGE,
});
export const notifPromoteBannerVisibleAtom = atom<boolean>({
    key: "notifPromoteBannerVisible",
    default: false,
});
export const showShortcutsAtom = atom({
    key: "showShortcuts",
    default: false,
});
export const showGuestLoginAtom = atom({
    key: "showGuestLogin",
    default: false,
});
export const showEmptyViewTabsAtom = atom<boolean>({
    key: "showEmptyViewTabs",
    default: false,
    effects_UNSTABLE: [persistAtom],
});
export const appShellRailAtom = atom<boolean>({
    key: "appShellRail",
    default: true,
    effects_UNSTABLE: [persistAtom],
});
export const appShellRailExpandedAtom = atom<boolean>({
    key: "appShellRailExpanded",
    default: false,
    effects_UNSTABLE: [persistAtom],
});
export const hiddenViewTabIdsAtom = atom<Record<string, boolean>>({
    key: "hiddenViewTabIds",
    default: {},
    effects_UNSTABLE: [persistAtom],
});
export const viewTabsOrderAtom = atom<Record<number, string[]>>({
    key: "viewTabsOrder",
    default: {},
    effects_UNSTABLE: [persistAtom],
});
export const optimisticViewTabsOrderAtom = atom<Record<number, string[]>>({
    key: "optimisticViewTabsOrder",
    default: {},
});
export const activeBuiltinViewsAtom = atom<Record<number, string>>({
    key: "activeBuiltinViews",
    default: {},
});
export const showTaskHistoryAtom = atom<boolean>({
    key: "showTaskHistory",
    default: false,
    effects_UNSTABLE: [persistAtom],
});
export const showArchivedOnBoardAtom = atom<boolean>({
    key: "showArchivedOnBoard",
    default: false,
    effects_UNSTABLE: [persistAtom],
});
export type ArchiveBoardScope = "active" | "all" | "archived";
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

export const boardLayoutPreferenceAtom = atom<BoardLayout>({
    key: "boardLayout",
    default: "board",
    effects_UNSTABLE: [persistAtom],
});

export const boardLayoutAtom = atom<BoardLayout>({
    key: "activeBoardLayout",
    default: "board",
});

export {
    TABLE_COLUMN_KEYS,
    DEFAULT_TABLE_COLUMNS,
    MY_TASKS_TABLE_COLUMN_KEYS,
    DEFAULT_MY_TASKS_TABLE_COLUMNS,
    MY_TASKS_TABLE_COLUMN_LABELS,
    customFieldColumnKey,
    isCustomFieldColumnKey,
    customFieldIdFromColumnKey,
    normalizeTableVisibleColumns,
    normalizeMyTasksTableVisibleColumns,
    withForcedStatusWhileSorted,
    setTableStalenessColumns,
    seedMissingCustomFieldColumns,
    LOCKED_TABLE_COLUMNS,
} from "@/utils/helperFunctions/Views/TableColumnsHelperFunctions";
export type {
    TableColumnKey,
    MyTasksTableColumnKey,
} from "@/utils/helperFunctions/Views/TableColumnsHelperFunctions";
import { DEFAULT_TABLE_COLUMNS } from "@/utils/helperFunctions/Views/TableColumnsHelperFunctions";

export const tableVisibleColumnsAtom = atom<string[]>({
    key: "tableVisibleColumnsAtom",
    default: [...DEFAULT_TABLE_COLUMNS],
    effects_UNSTABLE: [persistAtom],
});
export const myTasksTableColumnsPickerRequestAtom = atom<number>({
    key: "myTasksTableColumnsPickerRequestAtom",
    default: 0,
});
export const tableTimeColumnSeededBoardsAtom = atom<number[]>({
    key: "tableTimeColumnSeededBoardsAtom",
    default: [],
    effects_UNSTABLE: [persistAtom],
});
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

export const boardSearchAtom = atom<{
    open: boolean;
    keyword: string;
    projectId: number | null;
}>({
    key: "boardSearch",
    default: { open: false, keyword: "", projectId: null },
});

export const showAIChatInterfaceAtom = atom<boolean>({
    key: "showAIChatInterface",
    default: false,
});

export const showAnnouncementsAtom = atom<boolean>({
    key: "showAnnouncements",
    default: false,
});

export const taskDetailNonEssentialReadyAtom = atom<boolean>({
    key: "taskDetailNonEssentialReady",
    default: false,
});

export const mobileCommentComposerOpenAtom = atom<boolean>({
    key: "mobileCommentComposerOpen",
    default: false,
});

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

export const openAiChatByDefaultAtom = atom<boolean>({
    key: "openAiChatByDefault",
    default: true,
    effects_UNSTABLE: [persistAtom],
});

export const keepAiChatClosedAtom = atom<boolean>({
    key: "keepAiChatClosed",
    default: false,
    effects_UNSTABLE: [persistAtom],
});

export const aiChatAutoOpenSuppressedAtom = atom<boolean>({
    key: "aiChatAutoOpenSuppressed",
    default: false,
    effects_UNSTABLE: [persistAtom],
});

export const aiChatEditTaskIdAtom = atom<number | null>({
    key: "aiChatEditTaskId",
    default: null,
});

export const aiChatExplicitOpenAtAtom = atom<number | null>({
    key: "aiChatExplicitOpenAt",
    default: null,
});

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

export const aiChatBoardSessionMapAtom = atom<Record<number, string>>({
    key: "aiChatBoardSessionMap",
    default: {},
    effects_UNSTABLE: [persistAtom],
});

export const fullScreenChatScopeAtom = atom<number | null>({
    key: "fullScreenChatScope",
    default: null,
    effects_UNSTABLE: [persistAtom],
});

export const dockedChatScopeAtom = atom<number | "all" | "ticket" | null>({
    key: "dockedChatScope",
    default: null,
    effects_UNSTABLE: [persistAtom],
});

export const recentChatBoardIdsAtom = atom<number[]>({
    key: "recentChatBoardIds",
    default: [],
    effects_UNSTABLE: [persistAtom],
});

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

export const isActiveTaskSelector = selectorFamily<boolean, number | null | undefined>({
    key: "isActiveTask",
    get: (taskId) => ({ get }) => get(activeItemAtom) === taskId,
});

export const currentProjectAtom = atom<IProject | null>({
    key: "currentProject",
    default: null,
});

export const selectedSettingsTeamIdAtom = atom<string | null>({
    key: "selectedSettingsTeamId",
    default: null,
    effects_UNSTABLE: [persistAtom],
});

export const kanbanRunningOnlyAtom = atom<boolean>({
    key: "kanbanRunningOnly",
    default: false,
});

export const currentBoardBillingAtom = atom<CurrentBoardBilling | null>({
    key: "currentBoardBilling",
    default: null,
});

export const projectSectionsAtom = atom<ISection[] | null>({
    key: "projectSections",
    default: null,
    effects_UNSTABLE: [persistAtom],
});

type PlaylistStringStorage = {
    getItem: (key: string) => string | null;
    setItem: (key: string, newValue: string) => void;
    removeItem: (key: string) => void;
};

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
            memoryPlaylistValues.set(key, null);
        }
    },
};

const tasksPlaylistStorage = createJSONStorage<ITasksPlaylist[] | null>(
    () => browserPlaylistStorage,
);

export const tasksPlayListAtom = atomWithStorage<ITasksPlaylist[] | null>(
    "tasksPlayListAtom",
    null,
    tasksPlaylistStorage,
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

export const uploadInProgressAtom = atom<boolean>({
    key: 'uploadInProgressAtom',
    default: false,
});
export const commentsUploadInProgress = atom<any[]>({
    key: 'commentsUploadInProgressAtom',
    default: [],
});

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

export const agentChatTeamCycleAtom = atom<{ direction: 1 | -1; seq: number } | null>({
    key: "agentChatTeamCycle",
    default: null,
});

export const agentChatMobileFullscreenAtom = atom<boolean>({
    key: "agentChatMobileFullscreen",
    default: false,
});

export const calendarCheckedProjectsAtom = atom<Record<number, boolean>>({
    key: "calendarCheckedProjectsAtom",
    default: {},
    effects_UNSTABLE: [persistAtom],
});

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

export const mobileTopBarTitleAtom = atom<string | null>({
    key: "mobileTopBarTitle",
    default: null,
});

export const showAccountSwitcherAtom = atom<boolean>({
    key: "showAccountSwitcher",
    default: false,
});
