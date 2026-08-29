import { NotificationType } from "@prisma/client";

export const systemDefinedSplits = ["Important", "Updates", "Reactions", "@Mentions", "Agents", "Stale"]

/** Split holding agent housekeeping and routine output. */
export const agentSplitName = "Agents"

/**
 * Split holding rows whose task has been idle for staleDays+. Only exists on boards
 * with staleness tracking switched on (Project.stalenessEnabled); everywhere else
 * those rows stay in Updates. Appears when non-empty, like every split.
 */
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

    /**
     * Important is only for things waiting on you. When an agent performs one of these
     * it is housekeeping (property change) or routine output (docs entry, review note),
     * so it moves to the Agent split. An agent that needs an answer mentions you, and
     * "Mentioned" is deliberately absent here so it still reaches Important.
     */
    agentSplitTypes: [
        "Comment",
        "Assigned",
        "TaskMoved",
        "TaskArchived",
        "TaskDueDate",
        "TaskUpdateDescription",
    ],

    /**
     * HTPR-4769: Important = names you, on a task still alive.
     * addressedAlways reach Important by themselves; addressedIfAssigned only when
     * you are an assignee of the task. A dead task (archived, Done column, or stale
     * for staleDays) demotes its rows to Updates; mentions survive a move to Done
     * when the mention is newer than the move, and nothing survives archive/stale.
     * Demotion re-classifies only; rows never leave the inbox without a manual drain.
     */
    importantAddressedAlways: ["Assigned", "TaskReminder", "TaskMovedToInbox"],
    importantAddressedIfAssigned: ["Comment", "TaskOverdue", "TaskUpdateDescription"],
    staleDays: 21,

    /**
     * Events you performed yourself, on your own task. You already know they happened,
     * so they never enter the inbox; the task stays findable via Ctrl+K.
     * TaskMovedToInbox / TaskReminder / TaskOverdue are excluded on purpose: putting a
     * task in your own inbox or snoozing it is exactly a self-action you want back.
     */
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
        selectAll: { left: 22, bottom: 32 },
        selectAllGlobal: { left: 22, bottom: 0 },
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

    // Expanded styling configuration
    colors: {
        // Selection colors
        bulkSelected: {
            background: "#2178ca",
            text: "white",
            border: "border-[#fffff]",

        },

        // Text colors
        text: {
            primary: "text-white-black",
            secondary: "text-[#8E9093]",
            hover: "text-icon-hover-gray",
            darkGray: "text-icon-dark-gray",
        },

        // Label colors
        labels: {
            default: "border-border-labelComponent text-label-component",
            selected: "text-white border-white",
        },
    },


    // Responsive classes
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

    // State-based styling functions
    bulkSelectionStyling: {

        // Text styling
        notificationTag: (isBulkSelected: boolean) => ({
            border_color:isBulkSelected?"white":"black",
            text:isBulkSelected ? "text-white" : "text-white-black",
        }),
        text: (isBulkSelected: boolean) =>
            isBulkSelected ? inboxConfig.colors.bulkSelected.text : inboxConfig.colors.text.secondary,

        // Specific element styling
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

    // Animation and interaction settings
    interactions: {
        hover: {
            debounceMs: 100,
        },

        keyboard: {
            gKeyDelayMs: 5000, // from globalConstants.gThenKeyDelay
        },
    },

    // Modal and dialog settings
    modals: {
        subtaskLinking: {
            toggleKey: "CMD/CTRL+SHIFT+O",
        },
    },

    // Visibility states
    visibility: {
        hidden: (value: number, index: number) => value !== index,
        // HTPR-5515: the split wrapper carries an inline `display` value, and an
        // inline style beats the UA stylesheet rule that the `hidden` attribute
        // relies on. So `hidden` alone left every inactive split laid out as an
        // empty `flex: 1` box, and those empty boxes ate the inbox height.
        // Resolve display from the same predicate instead.
        display: (value: number, index: number) =>
            value !== index ? "none" : "flex",
        showBulkActions: (selectedCount: number) => selectedCount > 0,
    },

    // URL and navigation patterns
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

    // Date grouping configuration
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

        order: ["today", "yesterday", "thisWeek", "lastWeek"], // predefined groups come first
    },

} satisfies PartialInboxNotificationConfig & Record<string, unknown>;
