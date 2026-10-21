import { NotificationType } from "@prisma/client";

export const systemDefinedSplits = ["Important", "Decisions", "Updates", "Reactions", "@Mentions", "Agents", "Stale"]

export const decisionsSplitName = "Decisions"

export const agentSplitName = "Agents"

export const staleSplitName = "Stale"

type PartialInboxNotificationConfig = {
    alsoImportant?: NotificationType[];
    statusSplits?: NotificationType[];
    mentionedSplit?: NotificationType[];
    reactionSplit?: NotificationType[];
    importantSplit?: NotificationType[];
    agentSplitTypes?: NotificationType[];
    selfTriggeredHidden?: NotificationType[];
    importantAddressedAlways?: NotificationType[];
    importantAddressedIfAssigned?: NotificationType[];
    staleDays?: number;
};

export const inboxConfig = {
    alsoImportant: ["Mentioned"],
    statusSplits: ["TaskMoved", "TaskArchived", "TaskDueDate"],
    mentionedSplit: ["Mentioned", "AddedToFollowerInTask"],
    reactionSplit: ["Reacted"],
    importantSplit: ["Comment", "Assigned", "TaskMovedToInbox", "TaskReminder", "TaskOverdue", "TaskUpdateDescription"],

    agentSplitTypes: [
        "Comment",
        "Assigned",
        "TaskMoved",
        "TaskArchived",
        "TaskDueDate",
        "TaskUpdateDescription",
    ],

    importantAddressedAlways: ["Assigned", "TaskReminder", "TaskMovedToInbox"],
    importantAddressedIfAssigned: ["Comment", "TaskOverdue", "TaskUpdateDescription"],
    staleDays: 21,

    selfTriggeredHidden: [
        "Comment",
        "Assigned",
        "TaskMoved",
        "TaskArchived",
        "TaskDueDate",
        "TaskUpdateDescription",
        "Reacted",
        "Mentioned",
        "AddedToFollowerInTask",
    ],

    bulkSelectIconSize: 18,
    tooltipOffsets: {
        bulkArchive: { left: -220, bottom: 19 },
        bulkReminder: { left: -274, bottom: 19 },
        selectAll: { left: 48, bottom: 32 },
        selectAllGlobal: { left: 48, bottom: 0 },
        goToarchiveButton: { left: -156, bottom: -5 },
        goToAiChatButton: { left: -125, bottom: -10 },
        backButton: { left: 45, bottom: 2 },
    },

    keybindings: {
        openCommandPalette: (isApple: boolean) => [isApple ? "CMD" : "CTRL", "K"],
        undo: (isApple: boolean) => [isApple ? "CMD" : "CTRL", "Z"],
        createTask: ["C"],
        subtask: ["SHIFT", "S"],
        archiveSelected: ["E"],
        remindSelected: ["H"],
        selectAll: (isApple: boolean) => [isApple ? "CMD" : "CTRL", "A"],
        selectAllGlobal: (isApple: boolean) => [isApple ? "CMD" : "CTRL", "SHIFT", "A"],
        archivePage: ["G", "R"],
        goToInbox: ["G", "I"],
        goBack: ["ESC"],
    },

    scroll: {
        debounceGKeyMs: 5000,
        mobileBehavior: "instant" as ScrollBehavior,
        desktopBehavior: "smooth" as ScrollBehavior,
    },

    undo: {
        toastMessage: "Undo archive",
        queryKey: ["inbox"],
    },

    navigation: {
        queryKeys: {
            inbox: ["inbox"],
        },
        defaultSplitIndex: 0,
    },

    colors: {
        bulkSelected: {
            background: "#2178ca",
            text: "white",
            border: "border-[#fffff]",

        },

        text: {
            primary: "text-white-black",
            secondary: "text-[#8E9093]",
            hover: "text-icon-hover-gray",
            darkGray: "text-icon-dark-gray",
        },

        labels: {
            default: "border-border-labelComponent text-label-component",
            selected: "text-white border-white",
        },
    },


    responsive: {
        padding: {
            horizontal: "sm:p-inbox-horizontal",
            dateGroups: "responsive-inbox-padding-date-groups",
        },

        text: {
            small: "text-content sm:text-meta",
        },

        borders: {
            desktop: "md:border-l-4",
            mobile: "sm:border-l-2",
        },
    },

    bulkSelectionStyling: {
        notificationTag: (isBulkSelected: boolean) => ({
            border_color:isBulkSelected?"white":"black",
            text:isBulkSelected ? "text-white" : "text-white-black",
        }),
        text: (isBulkSelected: boolean) =>
            isBulkSelected ? inboxConfig.colors.bulkSelected.text : inboxConfig.colors.text.secondary,

        timestamp: (isBulkSelected: boolean) =>
            isBulkSelected ? inboxConfig.colors.bulkSelected.text : inboxConfig.colors.text.secondary,

        content: (isBulkSelected: boolean) =>
            isBulkSelected ? inboxConfig.colors.bulkSelected.text : inboxConfig.colors.text.secondary,

        username: (isBulkSelected: boolean) =>
            isBulkSelected ? inboxConfig.colors.bulkSelected.text : inboxConfig.colors.text.primary,

        commentCount: (isBulkSelected: boolean) =>
            isBulkSelected ? inboxConfig.colors.bulkSelected.text : inboxConfig.colors.text.secondary,

        ticketNumber: (isBulkSelected: boolean) =>
            isBulkSelected ? inboxConfig.colors.bulkSelected.text : inboxConfig.colors.text.darkGray,

        taskTitle: (isBulkSelected: boolean) =>
            isBulkSelected ? inboxConfig.colors.bulkSelected.text : inboxConfig.colors.text.primary,

        taskLabels: (isBulkSelected: boolean) =>
            isBulkSelected ? inboxConfig.colors.labels.selected : inboxConfig.colors.labels.default,

        archive_reminder_icon: (isBulkSelected: boolean) =>
            isBulkSelected ? "white" : "#696b6e",

        focusBorder: (isBulkSelected: boolean) =>
            isBulkSelected ? "white" : "#696b6e",
    },

    interactions: {
        hover: {
            debounceMs: 100,
        },

        keyboard: {
            gKeyDelayMs: 5000,
        },
    },

    modals: {
        subtaskLinking: {
            toggleKey: "CMD/CTRL+SHIFT+O",
        },
    },

    visibility: {
        hidden: (value: number, index: number) => value !== index,
        display: (value: number, index: number) =>
            value !== index ? "none" : "flex",
        showBulkActions: (selectedCount: number) => selectedCount > 0,
    },

    urls: {
        taskDetail: (projectId: number, uniqueIndex: number, mentionedQueryParam: string = "") =>
            `/detail/project-${projectId}/${uniqueIndex}?inboxFlow=true${mentionedQueryParam}`,

        commentHash: (commentId: number) => `#comment-${commentId}`,

        queryParams: {
            inboxFlow: "inboxFlow=true",
            reply: "reply=true",
            audio: "audio=true",
        },
    },

    dateGrouping: {
        labels: {
            today: "Today",
            yesterday: "Yesterday",
            thisWeek: "Earlier this week",
            lastWeek: "Last week",
        },

        monthNames: [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        ],

        order: ["today", "yesterday", "thisWeek", "lastWeek"],
    },

} satisfies PartialInboxNotificationConfig & Record<string, unknown>;
