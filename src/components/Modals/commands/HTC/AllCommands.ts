import { CommandMode } from "@/models/enums";
import { IAllCommands } from "@/models/model";
import { RAIL_TOGGLE_KEY } from "@/lib/constants/railToggleKey";
import { CommandGroup, ICommandList } from "./HTCTypes";

const mobileAppCommands: CommandGroup = {
  group: "App",
  commandLists: [
    {
      key: "reloadApp",
      name: "Reload app",
      commandMode: CommandMode.ReloadApp,
      keywords: "reload refresh restart app page",
    },
  ],
};

export const getMobileCommandGroups = (
  commandGroups: CommandGroup[],
  isMobile: boolean
): CommandGroup[] => {
  if (!isMobile) return commandGroups;

  const zoomGroupIndex = commandGroups.findIndex((group) =>
    group.commandLists.some(
      (command) => command.commandMode === CommandMode.ToggleBoardZoom
    )
  );
  if (zoomGroupIndex === -1) return [mobileAppCommands, ...commandGroups];

  const zoomGroup = commandGroups[zoomGroupIndex];
  const zoomCommand = zoomGroup.commandLists.find(
    (command) => command.commandMode === CommandMode.ToggleBoardZoom
  )!;
  return [
    {
      ...zoomGroup,
      commandLists: [
        zoomCommand,
        ...zoomGroup.commandLists.filter(
          (command) => command.commandMode !== CommandMode.ToggleBoardZoom
        ),
      ],
    },
    mobileAppCommands,
    ...commandGroups.filter((_, index) => index !== zoomGroupIndex),
  ];
};

const getNavigateCommands = (commandOptions: IAllCommands): CommandGroup => ({
  group: "Navigate",
  commandLists: [
    {
      key: "undoLatest",
      name: "Undo latest action",
      keyboard: ["CTRL", "Z"],
      commandMode: CommandMode.UndoLatest,
      keywords: "undo restore reverse latest archive delete star pin inbox action",
    },
    {
      key: "GotoInbox",
      name: "Go to inbox",
      keyboard: ["G", null, "I"],
      commandMode: CommandMode.GotoInbox,
      keywords: "navigate open inbox notifications activity mentions assignments updates feed",
    },
    {
      key: "GotoSnippets",
      name: "Go to snippets",
      keyboard: ["G", null, ";"],
      commandMode: CommandMode.GotoSnippets,
      keywords: "navigate open snippets saved text templates reusable content responses",
    },
    {
      key: "GotoReports",
      name: "Go to reports",
      commandMode: CommandMode.GotoReports,
      keywords: "reports analytics velocity metrics dashboards insights",
    },
    {
      key: "GoToCalender",
      name: "Go to calendar",
      keyboard: ["G", null, "C"],
      commandMode: CommandMode.GoToCalender,
      keywords: "navigate open calendar calender schedule dates deadlines timeline planning",
    },
    {
      key: "GoToAllTasks",
      name: "Go to all tasks",
      keyboard: ["G", null, "A"],
      commandMode: CommandMode.GoToAllTasks,
      keywords: "navigate open every all tasks tickets issues master list",
    },
    {
      key: "GoToDueDates",
      name: "Go to scheduled tasks",
      keyboard: ["G", null, "U"],
      commandMode: CommandMode.GoToDueDates,
      keywords: "navigate open scheduled due dates deadlines upcoming calendar tasks",
    },
    {
      key: "GoToMyTasks",
      name: "Go to my tasks",
      keyboard: ["G", null, "M"],
      commandMode: CommandMode.GoToMyTasks,
      keywords: "navigate open my tasks mine assigned to me across boards table overdue due dates",
      isNew: true,
    },
    {
      key: "GoToDrafts",
      name: "Go to drafts",
      keyboard: ["G", null, "D"],
      commandMode: CommandMode.GoToDrafts,
      keywords: "navigate open draft drafts unsent replies comments writing",
    },
    {
      key: "GoToStarred",
      name: "Go to starred",
      keyboard: ["G", null, "S"],
      commandMode: CommandMode.GoToStarred,
      keywords: "navigate open starred stars favorites favourite bookmarks saved tasks",
    },
    {
      key: "GoToPinned",
      name: "Go to pinned",
      keyboard: ["G", null, "P"],
      commandMode: CommandMode.GoToPinned,
      keywords: "pinned pin",
    },
    {
      key: "GoToAgents",
      name: "Go to agents",
      commandMode: CommandMode.GoToAgents,
      keywords:
        "agents agent bots dashboard manage automation coordinator instructions model",
    },
    {
      key: "GoToAgentChat",
      name: "Agent Chat",
      commandMode: CommandMode.GoToAgentChat,
      keywords: "agents chat talk message",
    },
    {
      key: "GotoReminders",
      name: "Go to reminders",
      keyboard: ["G", null, "H"],
      commandMode: CommandMode.GotoReminders,
      keywords: "navigate open reminders alerts notifications later snoozed scheduled followups",
    },
    {
      key: "GotoTaskArchived",
      name: "Go to archived tasks",
      keyboard: ["G", null, "E"],
      commandMode: CommandMode.GotoTaskArchives,
      keywords: "navigate open archive archived completed done finished hidden old tasks",
    },
    {
      key: "GotoInboxArchive",
      name: "Go to archived inbox",
      keyboard: ["G", null, "R"],
      commandMode: CommandMode.GotoInboxArchives,
      keywords: "archived inbox activity",
    },
    {
      key: "archiveShowActiveBoardsOnly",
      name: "Archive: show active boards only",
      commandMode: CommandMode.ArchiveShowActiveBoardsOnly,
      keywords: "archive active normal boards projects task visibility",
    },
    {
      key: "archiveShowAllBoards",
      name: "Archive: show all boards",
      commandMode: CommandMode.ArchiveShowAllBoards,
      keywords: "archive all active archived boards projects task visibility",
    },
    {
      key: "archiveShowArchivedBoardsOnly",
      name: "Archive: show archived boards only",
      commandMode: CommandMode.ArchiveShowArchivedBoardsOnly,
      keywords: "archive archived boards projects task visibility",
    },
    {
      key: "GoToProjectInbox",
      name: "Go to project inbox",
      commandMode: CommandMode.GotoProjectInbox,
      keywords: "project inbox activity",
    },
    {
      key: "GoToTrash",
      name: "Go to trash",
      keyboard: ["G", null, "#"],
      commandMode: CommandMode.GotoTrash,
      keywords: "trash deleted recycle bin remove",
    },
    ...(commandOptions.searchOptions
      ? [
          {
            key: "toggleArchivedSearchResults",
            name: `${commandOptions.searchOptions.includeArchived ? "Hide" : "Show"} archived search results`,
            keyboard: ["G", null, "X"],
            commandMode: CommandMode.ToggleArchivedSearchResults,
            keywords: "show hide toggle archive archived search results tasks",
          },
        ]
      : []),
    {
      key: "searchTask",
      name: "Search",
      keyboard: ["/"],
      commandMode: CommandMode.SearchTask,
      payload: "",
      keywords: "find search lookup locate query tasks tickets issues content",
    },
    {
      key: "ShowFilterHtc",
      name: "Filters",
      keyboard: ["SHIFT", "F"],
      commandMode: CommandMode.ShowFilterHTC,
      keywords: "filter narrow refine search view rules conditions matching tasks",
    },
  ],
});

const getTimeCommands = (commandOptions: IAllCommands): CommandGroup => {
  const taskTimeActionCommands: ICommandList[] =
    commandOptions.context === "Task" &&
    commandOptions.taskOptions?.timeTrackingEnabled
      ? [
          {
            key: "toggleTimeTracking",
            name: "Start or stop timer",
            keyboard: ["W"],
            commandMode: CommandMode.ToggleTimeTracking,
            keywords: "start stop toggle time tracking timer work log",
          },
          {
            key: "logTimeOnTask",
            name: "Log time",
            keyboard: ["B"],
            commandMode: CommandMode.LogTimeOnTask,
            keywords: "log add record time task work duration minutes hours",
          },
        ]
      : [];
  const taskTimeNavigationCommands: ICommandList[] =
    commandOptions.context === "Task" &&
    commandOptions.taskOptions?.timeTrackingEnabled
      ? [
          {
            key: "goToTimeThisTask",
            name: "Time: this task",
            commandMode: CommandMode.GoToTimeThisTask,
            keywords: "time task entries history report tracking",
          },
        ]
      : [];
  const boardTimeCommand: ICommandList[] =
    commandOptions.context === "Task" || commandOptions.context === "Kanban"
      ? [
          {
            key: "goToTimeThisBoard",
            name: "Time: this board",
            commandMode: CommandMode.GoToTimeThisBoard,
            keywords: "time board project entries report tracking",
          },
          {
            key: "toggleBoardTimeTracking",
            name: "Toggle time tracking for this board",
            commandMode: CommandMode.ToggleBoardTimeTracking,
            keywords: "time tracking enable disable turn on off board timer show",
          },
        ]
      : [];

  return {
    group: "Time",
    commandLists: [
      ...taskTimeActionCommands,
      {
        key: "GoToTimers",
        name: "Time: running timers",
        keyboard: ["G", null, "T"],
        commandMode: CommandMode.GoToTimers,
        keywords: "navigate open running timers time tracking active work",
      },
      ...taskTimeNavigationCommands,
      ...boardTimeCommand,
      {
        key: "goToTimeMyWeek",
        name: "Time: my week",
        commandMode: CommandMode.GoToTimeMyWeek,
        keywords: "time my week weekly entries report tracking",
      },
    ],
  };
};

const getBulkTaskCommands = (
  commandOptions: IAllCommands,
): CommandGroup | null => {
  if (!commandOptions.bulkSelectionCount) return null;

  return {
    group: "Selected tasks",
    commandLists: [
      {
        key: "bulkMoveToColumn",
        name: "Move selected tasks to column",
        keyboard: ["M"],
        commandMode: CommandMode.MoveToColumn,
        keywords: "move selected tasks status column section stage kanban workflow",
      },
      {
        key: "bulkAssignUser",
        name: "Assign selected tasks",
        keyboard: ["A"],
        commandMode: CommandMode.OpenAssignModal,
        keywords: "assign selected tasks assignee owner user member person delegate",
      },
      {
        key: "bulkSetLabels",
        name: "Set tags on selected tasks",
        keyboard: ["T"],
        commandMode: CommandMode.LabelModal,
        keywords: "set add edit tags labels selected tasks categories organize",
      },
      {
        key: "bulkArchive",
        name: "Archive selected tasks",
        keyboard: ["CTRL", "E"],
        commandMode: CommandMode.ArchiveTask,
        keywords: "archive selected tasks done complete finish close",
      },
    ],
  };
};

// Agent Chat's shortcuts are handler-only local keydown listeners with no
// dispatchable action of their own (roster/composer/mention state lives in
// AgentChatClient.tsx, not here). These entries make them palette-visible
// and invokable by dispatching a window CustomEvent AgentChatClient listens
// for (src/lib/agents/chatPaletteCommands.ts) rather than duplicating that
// component-local state and logic here.
const getAgentChatCommands = (): CommandGroup => ({
  group: "Agent Chat",
  commandLists: [
    {
      key: "agentChatNextAgent",
      name: "Next agent",
      keyboard: ["CTRL", "TAB"],
      commandMode: CommandMode.AgentChatNextAgent,
      keywords: "agent chat next cycle roster switch",
    },
    {
      key: "agentChatPreviousAgent",
      name: "Previous agent",
      keyboard: ["CTRL", "SHIFT", "TAB"],
      commandMode: CommandMode.AgentChatPreviousAgent,
      keywords: "agent chat previous cycle roster switch",
    },
    {
      key: "agentChatSendMessage",
      name: "Send message",
      keyboard: ["CTRL", "ENTER"],
      commandMode: CommandMode.AgentChatSendMessage,
      keywords: "agent chat send message composer",
    },
    {
      key: "agentChatOpenLinks",
      name: "Open all links in latest reply",
      keyboard: ["CTRL", "O"],
      commandMode: CommandMode.AgentChatOpenLinks,
      keywords: "agent chat open links latest reply tabs",
    },
    {
      key: "agentChatAddAgent",
      name: "Add agent",
      commandMode: CommandMode.AgentChatAddAgent,
      keywords: "agent chat add create new agent",
    },
  ],
});

const getAppShellCommands = (): CommandGroup => ({
  group: "App shell surfaces",
  commandLists: [
    {
      key: "appShellInbox",
      name: "App shell: Inbox",
      keyboard: ["1"],
      commandMode: CommandMode.GotoInbox,
      keywords: "surface switch inbox notifications",
    },
    {
      key: "appShellBoard",
      name: "App shell: Board",
      keyboard: ["2"],
      commandMode: CommandMode.GoToBoardSurface,
      keywords: "surface switch board kanban",
    },
    {
      key: "appShellTable",
      name: "App shell: Table",
      keyboard: ["3"],
      commandMode: CommandMode.GoToTableSurface,
      keywords: "surface switch table list",
    },
    {
      key: "appShellCalendar",
      name: "App shell: Calendar",
      keyboard: ["4"],
      commandMode: CommandMode.GoToCalender,
      keywords: "surface switch calendar schedule",
    },
    {
      key: "appShellAIChat",
      name: "App shell: Toggle AI chat",
      keyboard: ["5"],
      commandMode: CommandMode.AIChatInterface,
      keywords: "surface switch toggle ai chat",
    },
    {
      key: "appShellAIChatAlternative",
      name: "App shell: Toggle AI chat (alternative)",
      keyboard: ["]"],
      commandMode: CommandMode.AIChatInterface,
      keywords: "surface switch toggle ai chat bracket alternative",
    },
  ],
});

const inbox: CommandGroup = {
  group: "Inbox",
  commandLists: [
    {
      key: "swipeThroughUnread",
      name: "Swipe through unread",
      commandMode: CommandMode.SwipeThroughUnread,
      keywords: "inbox unread catch up review swipe triage notifications",
    },
    {
      key: "clearInboxToZero",
      name: "Clear inbox to zero",
      commandMode: CommandMode.ClearInboxToZero,
      keywords: "inbox zero clear archive cleanup notifications triage",
    },
    {
      key: "archiveAllReadNotifications",
      name: "Archive all read",
      commandMode: CommandMode.ArchiveAllReadNotifications,
      keywords: "inbox archive read seen notifications clear",
    },
    {
      key: "archiveReactionNotifications",
      name: "Archive reactions",
      commandMode: CommandMode.ArchiveReactionNotifications,
      keywords: "inbox archive reactions emoji notifications clear",
    },
  ],
};

const teamAndBilling: CommandGroup = {
  group: "Team & billing",
  commandLists: [
    {
      key: "createTeam",
      name: "Create team",
      commandMode: CommandMode.CreateTeam,
      keywords: "create add new team workspace organization group start setup",
    },
    {
      key: "teamSettings",
      name: "Team settings",
      checkOwnerShip: true,
      commandMode: CommandMode.TeamSettings,
      keywords: "team settings preferences configure workspace organization options admin",
    },
    {
      key: "ManageTeamMembers",
      name: "Manage team members",
      checkOwnerShip: true,
      commandMode: CommandMode.ManageTeamMembers,
      keywords: "manage members people team workspace access permissions remove roles admin",
    },
    {
      key: "billing",
      name: "Billing",
      checkOwnerShip: true,
      commandMode: CommandMode.Billing,
      keywords: "billing pricing plans price cost payment invoice upgrade account",
    },
    {
      key: "manageSubscriptions",
      name: "Manage subscription",
      checkOwnerShip: true,
      commandMode: CommandMode.ManageSubscriptions,
      keywords: "subscription plan pricing view downgrade upgrade cancel renew seats",
    },
    {
      key: "manageTeamAIAPIKeys",
      name: "Manage API keys",
      checkOwnerShip: true,
      commandMode: CommandMode.ManageTeamAIAPIKeys,
      keywords: "manage ai api keys credentials providers byok secret token",
    },
  ],
};

const getBoardCommands = (commandOptions: IAllCommands): CommandGroup => ({
  group: "Board",
  commandLists: [
    ...(commandOptions.boardZoomedOut !== undefined
      ? [
          {
            key: "toggleBoardZoom",
            name: commandOptions.boardZoomedOut
              ? "Zoom board in"
              : "Zoom board out",
            commandMode: CommandMode.ToggleBoardZoom,
            keywords: "zoom board overview columns compact in out",
          },
        ]
      : []),
    {
      key: "createTask",
      name: "Create task",
      keyboard: ["C"],
      commandMode: CommandMode.CreateTask,
      keywords: "create add new task ticket issue todo work item",
    },
    {
      key: "createTaskWithAiWriter",
      name: "Create task with AI Task Writer",
      keyboard: ["CTRL", "J"],
      commandMode: CommandMode.CreateTaskWithAiWriter,
      keywords: "create add new task ai writer prompt generate draft describe",
    },
    {
      key: "newTaskFromTemplate",
      name: "New task from template",
      commandMode: CommandMode.NewTaskFromTemplate,
      keywords: "template new task from preset reuse boilerplate repeatable create",
      isNew: true,
    },
    {
      key: "generateStatusUpdate",
      name: "Generate status update",
      commandMode: CommandMode.GenerateStatusUpdate,
      keywords: "status update report summary weekly progress standup digest what happened shipped",
      isNew: true,
    },
    {
      key: "sendFeedback",
      name: "Send feedback",
      commandMode: CommandMode.SendFeedback,
      keywords: "feedback send report bug issue suggestion request broken missing annoying",
    },
    {
      key: "sortBoard",
      name: "Sort board",
      keyboard: ["SHIFT", "S"],
      commandMode: CommandMode.SortKanbanBoard,
      keywords: "sort order arrange board kanban tasks priority date size",
    },
    // Board surfaces only: the action opens the board's Filters modal, and Calendar keeps its
    // filters in a separate atom, so offering it there would silently edit the last open board.
    // "Task" is the Kanban context whenever a card is focused, hence both.
    ...(commandOptions.context === "Task" || commandOptions.context === "Kanban"
      ? [
          {
            key: "toggleFilterValueMatch",
            // Opens Filters, because the palette cannot know which filter you mean when several
            // are active. Arrow left/right does the flip inside a filter's value picker.
            name: "Filter values: match any or all",
            commandMode: CommandMode.ToggleFilterValueMatch,
            keywords: "filter values match any all labels tags assignees both either",
          },
        ]
      : []),
    ...(commandOptions.context === "Task" || commandOptions.context === "Kanban"
      ? [
          {
            key: "toggleStaleness",
            name: commandOptions.projectOptions?.stalenessEnabled
              ? "Turn off staleness for this board"
              : "Turn on staleness for this board",
            commandMode: CommandMode.ToggleStaleness,
            keywords: "staleness age time status column comments board toggle",
          },
          {
            key: "toggleStalenessView",
            name: commandOptions.projectOptions?.stalenessViewEnabled
              ? "Turn off staleness for this view"
              : "Turn on staleness for this view",
            commandMode: CommandMode.ToggleStalenessView,
            keywords: "staleness age view toggle hide show private",
          },
          {
            key: "toggleAutoArchive",
            name: commandOptions.projectOptions?.autoArchiveEnabled
              ? "Turn off auto-archive for this board"
              : "Turn on auto-archive for this board (6 months idle)",
            commandMode: CommandMode.ToggleAutoArchive,
            keywords: "auto archive stale close old inactive tasks cleanup board",
          },
          {
            key: "boardVelocityReport",
            name: "Board velocity report",
            commandMode: CommandMode.GotoBoardVelocityReport,
            keywords:
              "velocity report metrics analytics throughput speed stats who is active idle stale lead time",
          },
          {
            key: "sortByTimeInColumn",
            name: "Sort by time in column",
            commandMode: CommandMode.SortByTimeInColumn,
            keywords: "sort staleness age time status column oldest",
          },
          {
            key: "sortByLastComment",
            name: "Sort by last comment",
            commandMode: CommandMode.SortByLastComment,
            keywords: "sort staleness age comment discussion oldest",
          },
        ]
      : []),
    ...(commandOptions.context === "Kanban"
      ? [
          {
            key: "autoAssignColumn",
            name: "Auto-assign for this column",
            commandMode: CommandMode.AutoAssignColumn,
            keywords: "auto assign column section member owner default workflow",
          },
        ]
      : []),
    {
      key: "manageColumns",
      name: "Manage board columns",
      commandMode: CommandMode.ManageColumn,
      keywords: "manage move reorder columns statuses sections kanban board organize",
    },
    {
      key: "renameColumn",
      name: "Rename board column",
      commandMode: CommandMode.RenameColumn,
      keywords: "rename edit change column status section title name board kanban",
    },
    {
      key: "hideColumn",
      name: "Hide board column",
      commandMode: CommandMode.HideColumn,
      keywords: "hide conceal column status section board kanban visibility remove from view",
    },
    {
      key: "addColumn",
      name: "Add board column",
      commandMode: CommandMode.AddColumn,
      keywords: "add create new column status section board kanban stage",
    },
    {
      key: "deleteColumn",
      name: "Delete board column",
      commandMode: CommandMode.DeleteColumn,
      keywords: "delete remove destroy column status section board kanban erase",
    },
    {
      key: "inviteBoard",
      name: "Invite people",
      commandMode: CommandMode.InviteMember,
      keywords: "invite share add board member people coworker teammate team collaborate",
    },
    {
      key: "manageMembers",
      name: "Manage members",
      commandMode: CommandMode.ManageMembers,
      keywords: "members people remove kick board access permissions manage teammates users",
    },
    {
      key: "goToViews",
      name: "Go to views",
      keyboard: ["G", null, "V"],
      commandMode: CommandMode.ShowBoardViews,
      keywords: "views switch view layout board saved go open apply",
    },
    {
      key: "manageViews",
      name: "Manage views",
      commandMode: CommandMode.ManageViews,
      keywords: "views layout",
    },
    ...(commandOptions.context === "Task" || commandOptions.context === "Kanban"
      ? [
          {
            key: "createSmartSplit",
            name: "Add smart split",
            commandMode: CommandMode.CreateSmartSplit,
            keywords: "add create smart split ai prompt automatic view label tag",
            isNew: true,
          },
        ]
      : []),
    {
      key: "toggleBoardLayout",
      name: "Switch to table layout",
      keyboard: ["SHIFT", "T"],
      commandMode: CommandMode.ToggleBoardLayout,
      keywords: "table list board kanban layout view",
    },
    {
      key: "configureTableColumns",
      name: "Table columns",
      commandMode: CommandMode.ConfigureTableColumns,
      keywords: "columns fields show hide table configure customize",
    },
    {
      key: "copyCurrentViewId",
      name: "Copy URL of view",
      commandMode: CommandMode.CopyViewURL,
      keywords: "copy URL link view",
    },
    {
      key: "manageLabels",
      name: "Manage tags",
      commandMode: CommandMode.ManageLabels,
      keywords: "manage tags labels categories board organize create edit delete",
    },
    {
      key: "createCustomField",
      name: "Create custom field…",
      commandMode: CommandMode.CreateCustomField,
      keywords: "custom field property add ice score number text date",
    },
    {
      key: "manageCustomFields",
      name: "Manage custom fields…",
      commandMode: CommandMode.ManageCustomFields,
      keywords:
        "custom fields manage rename delete reorder visibility rail table ice score",
    },
    {
      key: "toggleEmptyColumns",
      name: "Hide empty board columns",
      commandMode: CommandMode.ToggleEmptyColumns,
      keywords:
        "empty columns sections hide show toggle blank empty column visibility collapse",
    },
    ...(commandOptions.searchOptions
      ? []
      : [
          {
            key: "toggleArchivedOnBoard",
            name: `${commandOptions.showArchivedOnBoard ? "Hide" : "Show"} archived tasks on board`,
            keyboard: ["G", null, "X"],
            commandMode: CommandMode.ToggleArchivedOnBoard,
            keywords:
              "show hide toggle archive archived completed tasks board visibility",
          },
        ]),
    {
      key: "renameBoard",
      name: "Rename board",
      commandMode: CommandMode.EditBoard,
      keywords: "rename change edit board name title project label update",
    },
    {
      key: "copyBoardLink",
      name: "Copy board join link",
      commandMode: CommandMode.BoardJoinResetLink,
      keywords: "copy share board join invite link url access teammates",
    },
    {
      key: "resetBoardLink",
      name: "Reset board join link",
      commandMode: CommandMode.BoardJoinResetLink,
      keywords: "reset link regenerate",
    },
    {
      key: "manageTeams",
      name: "Manage boards",
      commandMode: CommandMode.ManageTeams,
      keywords: "manage teams boards projects organize switch edit archive delete",
    },
    {
      key: "createBoard",
      name: "Create board",
      commandMode: CommandMode.NewBoard,
      keywords: "create add new board project kanban workspace list setup",
    },
    {
      key: "boardCreationAssistant",
      name: "Board creation assistant",
      commandMode: CommandMode.BoardCreationAssistant,
      keywords:
        "generate board ai board create board from prompt assistant wizard describe project starter board",
    },
    {
      key: "archiveBoards",
      name: "Archive board",
      commandMode: CommandMode.ArchiveBoard,
      keywords: "archive hide close current board project",
    },
    {
      key: "deleteBoard",
      name: "Delete board",
      commandMode: CommandMode.DeleteBoard,
      keywords: "delete remove destroy current board project",
    },
    {
      key: "toggleRailExpanded",
      name: "Collapse / expand sidebar",
      commandMode: CommandMode.ToggleRailExpanded,
      keyboard: [RAIL_TOGGLE_KEY],
      keywords: "collapse expand sidebar rail labels narrow wide toggle show hide",
    },
    {
      key: "toggleAppShellRail",
      // The entry names where the toggle takes you, not where you are.
      name: commandOptions.appShellRailOn
        ? "Old Hypertask Design"
        : "New Hypertask Design",
      commandMode: CommandMode.ToggleAppShellRail,
      keywords: "rail sidebar shell layout icons left design old new switch",
    },
  ],
});

const ai: CommandGroup = {
  group: "AI",
  commandLists: [
    {
      key: "aiChatInterface",
      name: "Chat with AI",
      commandMode: CommandMode.AIChatInterface,
      keywords: "chat ask ai assistant bot conversation answer help discuss",
    },
    {
      key: "pinAiChatOpen",
      name: "Pin AI chat open",
      commandMode: CommandMode.PinAIChatOpen,
      keywords: "pin keep chat open always",
    },
    {
      key: "fullScreenAiChat",
      name: "Open AI chat full screen",
      commandMode: CommandMode.FullScreenAIChat,
      keywords: "full screen chat fullscreen expand ai big large page",
    },
    {
      key: "branchInNewChat",
      name: "Ask AI about this",
      commandMode: CommandMode.BranchInNewChat,
      keywords: "ask ai about this branch new chat context discuss explain",
    },
    {
      key: "toggleAIChatView",
      name: "Switch AI chat mode",
      commandMode: CommandMode.ToggleAIChatView,
      keywords: "switch toggle ai chat mode sidebar floating view layout",
    },
    {
      key: "createAgent",
      name: "Create agent",
      commandMode: CommandMode.CreateAgent,
      keywords: "create add new agent ai assistant automation bot setup",
    },
    {
      key: "manageAgents",
      name: "Manage agents",
      commandMode: CommandMode.ManageAgents,
      keywords: "manage edit delete connect agents ai assistants bots automation",
      isNew: true,
    },
    {
      key: "disabledAgents",
      name: "Disabled agents",
      commandMode: CommandMode.DisabledAgents,
      keywords: "disabled deleted inactive agents ai assistants bots restore enable archived",
    },
    {
      key: "deleteAllChats",
      name: "Delete all chat sessions",
      commandMode: CommandMode.DeleteAllChats,
      keywords: "delete clear erase remove all chats sessions conversations history",
    },
  ],
};

const appearance: CommandGroup = {
  group: "Appearance",
  commandLists: [
    {
      key: "systemTheme",
      name: "Follow system",
      commandMode: CommandMode.ToggleSystemTheme,
      keywords: "system automatic auto os default theme appearance",
    },
    {
      key: "lightTheme",
      name: "Light · Porcelain",
      commandMode: CommandMode.ToggleWhiteTheme,
      keywords: "light white day bright porcelain theme appearance",
    },
    {
      key: "darkTheme",
      name: "Dark · Graphite",
      commandMode: CommandMode.ToggleDarkTheme,
      keywords: "dark night grey gray graphite theme appearance",
    },
    {
      key: "amoledTheme",
      name: "OLED black · AMOLED",
      commandMode: CommandMode.ToggleAmoledTheme,
      keywords: "oled amoled true black terminal cyan turquoise theme appearance",
    },
    {
      key: "paperTheme",
      name: "Paper · Dia",
      commandMode: CommandMode.ToggleDiaTheme,
      keywords: "paper editorial serif warm light elegant dia theme appearance",
    },
    {
      key: "profilePicture",
      name: "Profile picture",
      commandMode: CommandMode.Setting,
      payload: "general",
      keywords: "profile picture avatar photo image account user upload change remove",
    },
    {
      key: "switchAccount",
      name: "Switch account",
      commandMode: CommandMode.SwitchAccount,
      keywords: "switch add account google login user profile change multi",
    },
    {
      key: "manageFavorites",
      name: "Manage favorites",
      commandMode: CommandMode.ManageFavorites,
      keywords: "manage favorites favourites starred pinned sidebar boards reorder remove organize",
    },
    {
      key: "calendarSettings",
      name: "Calendar settings",
      commandMode: CommandMode.CalendarSettings,
      keywords:
        "calendar options week start monday sunday weekends workdays view",
    },
    {
      key: "toggleCalendarWeekends",
      name: "Show weekends",
      commandMode: CommandMode.ToggleCalendarWeekends,
      keywords: "weekend saturday sunday hide show calendar week",
    },
    {
      key: "calendarWeekStartsMonday",
      name: "Week starts on Monday",
      commandMode: CommandMode.CalendarWeekStartsMonday,
      keywords: "week start monday calendar first day",
    },
    {
      key: "calendarWeekStartsSunday",
      name: "Week starts on Sunday",
      commandMode: CommandMode.CalendarWeekStartsSunday,
      keywords: "week start sunday calendar first day",
    },
    {
      key: "subscribeGoogleCalendar",
      name: "Subscribe in Google Calendar",
      commandMode: CommandMode.SubscribeGoogleCalendar,
      keywords:
        "google calendar subscribe ics ical feed sync export due dates apple outlook",
      isNew: true,
    },
  ],
};

const snippets: CommandGroup = {
  group: "Snippets",
  commandLists: [
    {
      key: "useSnippet",
      name: "Use snippet",
      keyboard: [";"],
      commandMode: CommandMode.UseSnippet,
      keywords: "snippet insert reusable text template canned response block",
    },
    {
      key: "createSnippet",
      name: "Create snippet",
      commandMode: CommandMode.CreateSnippet,
      keywords: "snippet create add new reusable text template response manage edit delete",
    },
    {
      key: "createSnippetFromDraft",
      name: "Create snippet from draft",
      commandMode: CommandMode.CreateSnippetFromDraft,
      keywords: "snippet create save current draft editor comment description reusable text",
    },
  ],
};

const settings: CommandGroup = {
  group: "Settings",
  commandLists: [
    {
      key: "settingsGeneral",
      name: "Settings: General",
      commandMode: CommandMode.Setting,
      payload: "general",
      keywords: "settings general profile personal preferences application",
    },
    {
      key: "settingsAppearance",
      name: "Settings: Appearance",
      commandMode: CommandMode.Setting,
      payload: "appearance",
      keywords: "settings appearance display color scheme personal profile",
    },
    {
      key: "settingsTaskPage",
      name: "Settings: Task page",
      commandMode: CommandMode.Setting,
      payload: "task-page",
      keywords: "settings task page comments avatar gifs history ai chat scroll behavior personal profile",
    },
    {
      key: "settingsNotifications",
      name: "Settings: Notifications",
      commandMode: CommandMode.Setting,
      payload: "notifications",
      keywords: "settings notifications alerts email push activity preferences",
    },
    {
      key: "settingsAccounts",
      name: "Settings: Accounts",
      commandMode: CommandMode.Setting,
      payload: "accounts",
      keywords: "settings accounts switch add sign out login user multi session",
    },
    {
      key: "settingsBilling",
      name: "Settings: Billing",
      commandMode: CommandMode.Setting,
      payload: "billing",
      keywords: "settings billing payment invoices subscription team plan",
    },
    {
      key: "settingsPlans",
      name: "Settings: Plans",
      commandMode: CommandMode.Setting,
      payload: "plans",
      keywords: "settings plans pricing upgrade downgrade subscription team",
    },
    {
      key: "settingsAiUsage",
      name: "Settings: AI usage",
      commandMode: CommandMode.Setting,
      payload: "ai-usage",
      keywords: "settings ai usage quota allowance tokens spend limits team",
    },
    {
      key: "settingsMemberUsage",
      name: "Settings: Usage by member",
      commandMode: CommandMode.Setting,
      payload: "member-usage",
      keywords: "settings ai usage members share team owner",
    },
    {
      key: "settingsAiModels",
      name: "Settings: AI models",
      commandMode: CommandMode.Setting,
      payload: "ai-models",
      keywords: "settings ai models providers defaults selection team",
    },
    {
      key: "settingsAiFeatures",
      name: "Settings: AI features",
      commandMode: CommandMode.Setting,
      payload: "ai-features",
      keywords: "settings ai features system summaries questions models team",
    },
    {
      key: "settingsDefaultModels",
      name: "Settings: Default models",
      commandMode: CommandMode.Setting,
      payload: "default-models",
      keywords: "settings default ai models personal profile selection",
    },
    {
      key: "settingsApiKeys",
      name: "Settings: Bring your own key",
      commandMode: CommandMode.Setting,
      payload: "apiKeys",
      keywords: "settings bring your own key byok ai api credentials provider team",
    },
    {
      key: "settingsMembers",
      name: "Settings: Members",
      commandMode: CommandMode.Setting,
      payload: "members",
      keywords: "settings members people permissions invite roles access team",
    },
    {
      key: "settingsTeamAgents",
      name: "Settings: Agents (team)",
      commandMode: CommandMode.Setting,
      payload: "team-agents",
      keywords: "settings agents assistants bots boards team",
    },
    {
      key: "settingsSkills",
      name: "Settings: Skills",
      commandMode: CommandMode.Setting,
      payload: "skills",
      keywords: "settings skills prompts slash commands library team ai",
    },
    {
      key: "settingsBoardGeneral",
      name: "Settings: Time tracking (board)",
      commandMode: CommandMode.Setting,
      payload: "board-general",
      keywords: "settings board time tracking timers enable disable project",
    },
    {
      key: "settingsBoardMembers",
      name: "Settings: Members (board)",
      commandMode: CommandMode.Setting,
      payload: "board-members",
      keywords: "settings board members people permissions access project",
    },
    {
      key: "settingsBoardAgents",
      name: "Settings: Agents (board)",
      commandMode: CommandMode.Setting,
      payload: "board-agents",
      keywords: "settings board agents assistants bots project",
    },
    {
      key: "settingsBoardAi",
      name: "Settings: Custom instructions",
      commandMode: CommandMode.Setting,
      payload: "board-ai",
      keywords: "settings board custom instructions prompt behavior configure",
    },
    {
      key: "settingsBoardSkills",
      name: "Settings: Skills (board)",
      commandMode: CommandMode.Setting,
      payload: "board-skills",
      keywords: "settings board skills prompts slash commands library ai",
    },
    {
      key: "settingsBoardFiles",
      name: "Settings: Files",
      commandMode: CommandMode.Setting,
      payload: "board-files",
      keywords: "settings board files uploads custom instructions context",
    },
    {
      key: "settingsSlack",
      name: "Settings: Slack",
      commandMode: CommandMode.Setting,
      payload: "slack",
      keywords: "settings slack integration connect workspace thread summaries",
    },
    {
      key: "settingsMcp",
      name: "Settings: MCP",
      commandMode: CommandMode.Setting,
      payload: "mcp",
      keywords: "settings mcp model context protocol integration tools token connect",
    },
    {
      key: "settingsCli",
      name: "Settings: CLI",
      commandMode: CommandMode.Setting,
      payload: "cli",
      keywords: "settings cli terminal command line shell install connect",
    },
    {
      key: "settingsApi",
      name: "Settings: REST API",
      commandMode: CommandMode.Setting,
      payload: "api",
      keywords: "settings rest api developer endpoints integration connect",
    },
    {
      key: "settingsShortcuts",
      name: "Settings: Shortcuts",
      commandMode: CommandMode.Setting,
      payload: "shortcuts",
      keywords: "settings shortcuts keyboard hotkeys keybindings cheatsheet help",
    },
    {
      key: "settingsLearn",
      name: "Settings: Learn Hypertask",
      commandMode: CommandMode.Setting,
      payload: "learn",
      keywords: "settings learn hypertask onboarding tutorial guide docs help",
    },
  ],
};

const help: CommandGroup = {
  group: "Help",
  commandLists: [
    {
      key: "shortcuts",
      name: "Keyboard shortcuts",
      keyboard: ["?"],
      commandMode: CommandMode.Shortcut,
      keywords: "keyboard shortcuts hotkeys keybindings commands keys cheatsheet help reference",
    },
    {
      key: "settings",
      name: "Settings",
      keyboard: ["\\"],
      commandMode: CommandMode.Setting,
      keywords: "settings preferences configuration options account application customize setup",
    },
    {
      key: "boardSettings",
      name: "Board settings",
      commandMode: CommandMode.BoardSettings,
      keywords: "board settings preferences configuration options project customize setup",
    },
    {
      key: "helpCenter",
      name: "Help center",
      commandMode: CommandMode.HelpCenter,
      keywords: "help center support docs documentation guide questions answers contact",
    },
    {
      key: "onboardingTour",
      name: "Onboarding tour",
      commandMode: CommandMode.GoToOnboarding,
      keywords: "onboarding tour setup connect ai restart replay redo getting started welcome walkthrough",
    },
    {
      key: "quickTips",
      name: "Quick tips",
      commandMode: CommandMode.QuickTips,
      keywords: "quick tips shortcuts help hints guidance learn keyboard productivity suggestions",
    },
    {
      key: "latestUpdates",
      name: "What's new",
      commandMode: CommandMode.ShowAnnouncements,
      keywords: "whats new latest updates announcements changelog release notes features rocket what is new",
    },
    {
      key: "goToWelcome",
      name: "Welcome tutorial",
      commandMode: CommandMode.GoToWelcome,
      keywords: "welcome tutorial onboarding introduction getting started guide learn walkthrough",
    },
    {
      key: "startKanbanTutorial",
      name: "Start Kanban tutorial",
      commandMode: CommandMode.StartKanbanTutorial,
      keywords: "start kanban tutorial board project walkthrough tour learn onboarding guide",
    },
    {
      key: "startTaskWriterTutorial",
      name: "Start task writer tutorial",
      commandMode: CommandMode.StartTaskWriterTutorial,
      keywords: "start task writer tutorial ai create writing walkthrough tour learn guide",
    },
    {
      key: "generateMcpToken",
      name: "MCP",
      commandMode: CommandMode.GenerateMcpToken,
      keywords: "mcp connect tool integration api token external app protocol",
      isNew: true,
    },
    {
      key: "cliInstall",
      name: "CLI",
      commandMode: CommandMode.CliInstall,
      keywords: "cli terminal command line install npm shell hypertask login",
      isNew: true,
    },
    {
      key: "restApi",
      name: "REST API",
      commandMode: CommandMode.RestApi,
      keywords: "rest api key http curl developer token endpoint integration",
    },
    {
      key: "logout",
      name: "Sign out",
      commandMode: CommandMode.Logout,
      keywords: "logout log out sign off exit account session leave",
    },
  ],
};

const baseTaskCommands: ICommandList[] = [
  {
    key: "createTask",
    name: "Create task",
    keyboard: ["C"],
    commandMode: CommandMode.CreateTask,
    keywords: "create add new task ticket issue todo work item",
  },
  {
    key: "setDueDate",
    name: "Set due date",
    keyboard: ["D"],
    commandMode: CommandMode.SetDueDate,
    keywords: "deadline schedule when tomorrow date calendar remind due time",
  },
  {
    key: "setStartDate",
    name: "Set start date",
    commandMode: CommandMode.SetStartDate,
    keywords: "start begin kickoff scheduled from date when planned",
    isNew: true,
  },
  {
    key: "setRecurrence",
    name: "Repeat task",
    commandMode: CommandMode.SetRecurrence,
    keywords: "repeat recurring recurrence every daily weekly monthly weekdays cadence schedule routine",
    isNew: true,
  },
  {
    key: "saveTaskTemplate",
    name: "Save task as template",
    commandMode: CommandMode.SaveTaskTemplate,
    keywords: "template save reuse boilerplate preset shape repeatable",
    isNew: true,
  },
  {
    key: "assignUser",
    name: "Assign task",
    keyboard: ["A"],
    commandMode: CommandMode.OpenAssignModal,
    keywords: "assign assignee owner user member person delegate responsibility who",
  },
  {
    key: "blockedByPerson",
    name: "Blocked by person…",
    keyboard: ["SHIFT", "B"],
    commandMode: CommandMode.OpenBlockedByModal,
    keywords: "blocked waiting blocker block person stuck",
  },
  {
    key: "assignToMe",
    name: "Assign to me",
    commandMode: CommandMode.AssignToMe,
    keywords: "assign me self take claim mine my task i'll do it",
    isNew: true,
  },
  {
    key: "addSubTask",
    name: "Create subtask",
    keyboard: ["CTRL", "SHIFT", "+"],
    commandMode: CommandMode.CreateSubTask,
    keywords: "create add new subtask sub-task child checklist nested task",
  },
  {
    key: "viewSubTask",
    name: "View subtasks",
    keyboard: ["CTRL", "O"],
    commandMode: CommandMode.ViewSubTasks,
    keywords: "view show open subtasks sub-tasks children checklist nested tasks",
  },
  {
    key: "addRelatedTask",
    name: "Add related task",
    commandMode: CommandMode.AddRelatedTask,
    keywords: "add link related task relation associate connect",
  },
  {
    key: "markBlockedBy",
    name: "Mark blocked by",
    commandMode: CommandMode.MarkBlockedBy,
    keywords: "mark blocked by dependency waiting prerequisite task relation",
  },
  {
    key: "markAsBlocking",
    name: "Mark as blocking",
    commandMode: CommandMode.MarkAsBlocking,
    keywords: "mark blocking blocks dependency task relation",
  },
  {
    key: "markDuplicateOf",
    name: "Mark duplicate of",
    commandMode: CommandMode.MarkDuplicateOf,
    keywords: "mark duplicate of same repeated task relation",
  },
  {
    key: "labelmodal",
    name: "Set tags",
    keyboard: ["T"],
    commandMode: CommandMode.LabelModal,
    keywords: "set add edit tags labels categories organize classify task metadata",
  },
  {
    key: "estimateModal",
    name: "Set task size",
    keyboard: ["S"],
    commandMode: CommandMode.EstimateModal,
    keywords: "set task size estimate effort points scope complexity duration",
  },
  {
    key: "priorityModal",
    name: "Set priority",
    keyboard: ["P"],
    commandMode: CommandMode.PriorityModal,
    keywords: "set priority urgent important severity rank order critical task",
  },
  {
    key: "moveToColumn",
    name: "Move task to column",
    keyboard: ["M"],
    commandMode: CommandMode.MoveToColumn,
    keywords: "move task status column section stage kanban workflow change",
  },
  {
    key: "movetasktodifferentboard",
    name: "Move task to board",
    keyboard: ["SHIFT", "M"],
    commandMode: CommandMode.MoveTaskToBoard,
    keywords: "move transfer task board project workspace relocate change destination",
  },
  {
    key: "followtask",
    name: "Follow task",
    keyboard: ["F"],
    commandMode: CommandMode.FollowTask,
    keywords: "follow watch subscribe track task notifications updates activity alert",
  },
  {
    key: "unfollowtask",
    name: "Unfollow task",
    keyboard: ["ALT", "F"],
    commandMode: CommandMode.UnFollowTask,
    keywords: "unfollow unwatch unsubscribe stop task notifications updates mute leave",
  },
  {
    key: "openAiTaskWriter",
    name: "Open AI task writer",
    commandMode: CommandMode.OpenAiTaskWriter,
    keywords: "open ai task writer write generate draft create improve description",
  },
  {
    key: "summarizeTicket",
    name: "Summarize ticket",
    commandMode: CommandMode.SummarizeTicket,
    keywords: "summarize summary ticket task ai chat recap tldr overview digest brief",
    isNew: true,
  },
  {
    key: "remindMe",
    name: "Remind me",
    keyboard: ["H"],
    commandMode: CommandMode.RemindMe,
    keywords: "remind me reminder alert notify later snooze schedule followup",
  },
  {
    key: "markAsUnread",
    name: "Mark unread",
    keyboard: ["U"],
    commandMode: CommandMode.MarkUnread,
    keywords: "mark unread unseen reminder inbox notification revisit later flag",
  },
];

const getCommentCommands = (commandOptions?: IAllCommands): CommandGroup => {
  const commentProps = commandOptions?.commentOptions;
  const commandLists: Array<ICommandList | null> = commentProps
    ? [
        commentProps.isCurrentUserCreator
          ? {
              key: "editcomment",
              name: "Edit comment",
              commandMode: CommandMode.EditComment,
              keywords: "edit modify change update rewrite comment message text content",
            }
          : null,
        {
          key: "summarizeComment",
          name: "Summarize comment",
          commandMode: CommandMode.SummarizeComment,
          keywords: "summarize summary tldr shorten ai comment recap condense explain",
          isNew: true,
        },
        {
          key: "fastLikeComment",
          name: "Fast like",
          commandMode: CommandMode.FastLikeComment,
          keywords: "like thumbs up react quick fast acknowledge upvote agree love",
        },
        {
          key: "replyToComment",
          name: "Reply to comment",
          commandMode: CommandMode.ReplyToComment,
          keyboard: ["ENTER"],
          keywords: "reply respond answer comment message thread conversation write send",
        },
        {
          key: "reactToComment",
          name: "React to comment",
          commandMode: CommandMode.ReactToComment,
          keyboard: ["R"],
          keywords: "react emoji response comment message acknowledge like celebrate reply",
        },
        {
          key: "pinComment",
          name: `${commentProps.isPinned ? "Unpin" : "Pin"} comment`,
          commandMode: CommandMode.PinComment,
          keyboard: ["CTRL", "SHIFT", "P"],
          keywords: "pin unpin comment message top important fixed save highlight",
        },
        {
          key: "copyCommentContent",
          name: "Copy comment content",
          commandMode: CommandMode.CopyCommentContent,
          keywords: "copy comment content text message body clipboard duplicate paste",
        },
        {
          key: "copyCommentLink",
          name: "Copy comment URL",
          commandMode: CommandMode.CopyCommentURL,
          keywords: "copy comment url link address share message reference clipboard",
        },
        {
          key: "starComment",
          name: `${commentProps.isStarred ? "Unstar" : "Star"} comment`,
          commandMode: CommandMode.StarComment,
          keyboard: ["CTRL", "SHIFT", "S"],
          keywords: "star unstar favorite favourite bookmark save comment message important",
        },
        {
          key: "createTaskFromComment",
          name: "Create task from comment",
          commandMode: CommandMode.CreateTaskFromComment,
          keywords: "create convert comment into task ticket issue action item",
        },
        {
          key: "branchInNewChat",
          name: "Branch in new chat",
          commandMode: CommandMode.BranchInNewChat,
          keywords: "branch new ai chat comment context ask discuss conversation",
          isNew: true,
        },
        {
          key: "copyCommentToAiChat",
          name: "Copy comment to AI chat",
          commandMode: CommandMode.CopyCommentToAiChat,
          keywords: "copy comment ai chat paste insert quote ask context send message",
          isNew: true,
        },
        {
          key: "deletemessage",
          name: "Delete comment",
          commandMode: CommandMode.DeleteMessage,
          keywords: "delete remove erase trash comment message reply destroy discard",
        },
      ]
    : [];

  return {
    group: "Comment",
    commandLists: commandLists.filter(
      (command): command is ICommandList => command !== null
    ),
  };
};

const getTaskCommands = (commandOptions?: IAllCommands): CommandGroup => {
  const taskProps = commandOptions?.taskOptions;
  const browsableTaskCommands = commandOptions?.context === "Task"
    ? baseTaskCommands.filter((command) =>
        (["addSubTask", "viewSubTask", "openAiTaskWriter"].includes(command.key) ||
          // Summarize ticket only works on the detail page (the AI chat sends
          // default_context.task_id there); hide it on a Kanban-focused task.
          (command.key === "summarizeTicket" && !taskProps?.isKanban))
      )
    : baseTaskCommands.filter((command) => {
        return commandOptions?.context === "Inbox"
          && ["remindMe", "markAsUnread"].includes(command.key);
      });
  const renameTaskCommand: ICommandList = {
    key: "renameTask",
    name: "Rename task",
    commandMode: CommandMode.RenameTask,
    keywords: "rename edit change task title name subject heading update",
  };

  const taskActions: ICommandList[] = [
    {
      key: "acceptTask",
      name: "Accept task",
      commandMode: CommandMode.AcceptTask,
      keywords: "accept task triage approve backlog ready next column intake",
    },
    {
      key: "declineTask",
      name: "Decline task",
      commandMode: CommandMode.DeclineTask,
      keywords: "decline task triage reject dismiss archive intake",
    },
    {
      key: "declineAsDuplicateOf",
      name: "Decline as duplicate of…",
      commandMode: CommandMode.DeclineAsDuplicateOf,
      keywords: "decline duplicate task triage reject dismiss archive relation merge repeated",
    },
    {
      key: "duplicateTask",
      name: "Duplicate task",
      commandMode: CommandMode.DuplicateTask,
      keywords: "duplicate copy clone task ticket issue repeat recreate template",
    },
    {
      key: "duplicateTaskToBoard",
      name: "Copy task to another board",
      commandMode: CommandMode.DuplicateTaskToBoard,
      keywords: "copy duplicate clone task another board project move transfer cross",
    },
    {
      key: "archiveTask",
      name: `${taskProps?.isArchived ? "Unarchive" : "Archive"} task`,
      keyboard: ["CTRL", "E"],
      commandMode: CommandMode.ArchiveTask,
      keywords: "archive unarchive done complete finish task close move finished",
    },
    {
      key: "deleteTask",
      name: "Delete task",
      keyboard: ["SHIFT", "3"],
      commandMode: CommandMode.DeleteTask,
      keywords: "delete remove trash discard destroy task ticket issue erase",
    },
    {
      key: "copyformattedTaskLink",
      name: "Copy private task link (title + URL)",
      keyboard: ["CTRL", ":"],
      commandMode: CommandMode.CopyFormattedURLTask,
      keywords: "copy private task link title url formatted share internal address",
    },
    {
      key: "copyLink",
      name: "Copy private task URL",
      keyboard: ["CTRL", "SHIFT", ":"],
      commandMode: CommandMode.CopyUrlTask,
      keywords: "copy private task ticket issue url link address share internal",
    },
    {
      key: "copypublicformattedTaskLink",
      name: "Copy public task link (title + URL)",
      keyboard: ["CTRL", "."],
      commandMode: CommandMode.CopyPublicFormattedUrlTask,
      keywords: "copy public task link title url formatted share external address",
    },
    {
      key: "copyPublicLink",
      name: "Copy public task URL",
      keyboard: ["CTRL", "SHIFT", "."],
      commandMode: CommandMode.CopyPublicUrlTask,
      keywords: "copy public task ticket issue url link address share external",
    },
  ];

  const getTaskCommand = (key: string) =>
    [...baseTaskCommands, ...taskActions].find((command) => command.key === key)!;
  const contextualTaskCommands: Array<ICommandList | null> =
    commandOptions?.context === "Task"
      ? [
          ...(!taskProps?.isArchived
            ? [
                getTaskCommand("acceptTask"),
                getTaskCommand("declineTask"),
                getTaskCommand("declineAsDuplicateOf"),
              ]
            : []),
          getTaskCommand("assignUser"),
          getTaskCommand("blockedByPerson"),
          getTaskCommand("assignToMe"),
          getTaskCommand("setDueDate"),
          getTaskCommand("setStartDate"),
          getTaskCommand("setRecurrence"),
          getTaskCommand("saveTaskTemplate"),
          getTaskCommand("priorityModal"),
          getTaskCommand("labelmodal"),
          getTaskCommand("estimateModal"),
          getTaskCommand("moveToColumn"),
          getTaskCommand("movetasktodifferentboard"),
          getTaskCommand("addRelatedTask"),
          getTaskCommand("markBlockedBy"),
          getTaskCommand("markAsBlocking"),
          getTaskCommand("markDuplicateOf"),
          getTaskCommand("archiveTask"),
          !taskProps?.isKanban
            ? {
                key: "setReminder",
                name: "Set reminder",
                commandMode: CommandMode.SetReminder,
                keyboard: ["H"],
                keywords: "reminder remind alert",
              }
            : null,
          {
            key: "starTask",
            name: `${taskProps?.isStarred ? "Unstar" : "Star"} task`,
            commandMode: CommandMode.StarTask,
            keyboard: ["ALT", "S"],
            keywords: "star favorite bookmark",
          },
          {
            key: "shareTaskPublicly",
            name: "Share task",
            commandMode: CommandMode.ShareTaskPublic,
            keyboard: ["CTRL", "S"],
            keywords: "share public link",
          },
          getTaskCommand("followtask"),
          getTaskCommand("unfollowtask"),
          getTaskCommand("copyformattedTaskLink"),
          getTaskCommand("copyLink"),
          getTaskCommand("copypublicformattedTaskLink"),
          getTaskCommand("copyPublicLink"),
          {
            key: "copyTaskId",
            name: "Copy task ID",
            keyboard: ["CTRL", "SHIFT", "I"],
            commandMode: CommandMode.CopyTaskID,
            keywords: "copy ID number",
          },
          {
            key: "copyTaskTitleId",
            name: "Copy task title and ID",
            keyboard: ["CTRL", "I"],
            commandMode: CommandMode.CopyTaskTitleAndID,
            keywords: "copy title ID",
          },
          {
            key: "copyBranchName",
            name: "Copy branch name",
            commandMode: CommandMode.CopyBranchName,
            keywords: "git branch name copy github",
          },
          getTaskCommand("duplicateTask"),
          getTaskCommand("duplicateTaskToBoard"),
          {
            key: "toggleHistory",
            name: `${taskProps?.showHistory ? "Hide" : "Show"} history`,
            commandMode: CommandMode.ToggleHistory,
            keyboard: ["CTRL", "SHIFT", "H"],
            keywords:
              "show hide history activity events updates log timeline changes feed",
          },
          !taskProps?.isKanban
            ? {
                key: "taskDescriptionVersions",
                name: "Description version history",
                commandMode: CommandMode.TaskDescriptionVersions,
                keywords:
                  "description version history restore recover previous earlier content",
              }
            : null,
          {
            key: "toggleAllComments",
            name: "Expand / collapse all comments",
            commandMode: CommandMode.ToggleAllComments,
            keyboard: ["SHIFT", "O"],
            keywords:
              "expand collapse fold unfold open close all comments stack unstack",
          },
          taskProps?.hasNotifications
            ? {
                key: "removeTaskNotification",
                name: "Remove task notification",
                commandMode: CommandMode.RemoveTaskNotification,
                keyboard: ["E"],
                keywords: "remove notification mute",
              }
            : null,
          taskProps?.hasSubtasks
            ? {
                key: "removeSubtask",
                name: "Remove a sub-task",
                commandMode: CommandMode.RemoveSubtask,
                keywords: "remove delete subtask",
              }
            : null,
          taskProps?.hasParent
            ? {
                key: "removeParenttask",
                name: "Remove as sub-task",
                commandMode: CommandMode.RemoveParent,
                keywords: "remove parent unlink",
              }
            : null,
          renameTaskCommand,
          {
            key: "showInInbox",
            name: "Move task to inbox",
            commandMode: CommandMode.ShowInInbox,
            keywords: "inbox activity move notifications",
          },
          {
            key: "subtaskSettings",
            name: "Sub-task Settings",
            commandMode: CommandMode.SubtaskSettings,
            keywords: "subtask checklist settings",
          },
          !taskProps?.isKanban
            ? {
                key: "suggestReply",
                name: "Suggest reply",
                keyboard: ["SHIFT", "R"],
                commandMode: CommandMode.SuggestReply,
                keywords: "AI reply suggest respond draft comment answer",
              }
            : null,
          !taskProps?.isKanban
            ? {
                key: "speechToText",
                name: "Speech to text",
                keyboard: ["CTRL", "SHIFT", "D"],
                commandMode: CommandMode.SpeechToText,
                keywords: "voice dictation speech microphone",
              }
            : null,
          getTaskCommand("deleteTask"),
        ]
      : [];

  return {
    group: "Task",
    commandLists: [
      ...contextualTaskCommands,
      ...browsableTaskCommands,
    ].filter((command): command is ICommandList => command !== null),
  };
};

/**
 * Returns the command registry, putting task actions first in task context.
 */
export const getAllCommands = (
  commandOptions: IAllCommands = { context: "Others" }
): CommandGroup[] => {
  const navigate = getNavigateCommands(commandOptions);
  const time = getTimeCommands(commandOptions);
  const bulk = getBulkTaskCommands(commandOptions);
  const comment = getCommentCommands(commandOptions);
  const task = getTaskCommands(commandOptions);
  const board = getBoardCommands(commandOptions);
  const appShell = getAppShellCommands();
  const agentChat = getAgentChatCommands();
  const groups = [
    navigate,
    inbox,
    time,
    ...(bulk ? [bulk] : []),
    ...(commandOptions.appShellRailOn ? [appShell] : []),
    ...(commandOptions.agentChatOn ? [agentChat] : []),
    task,
    board,
    teamAndBilling,
    snippets,
    ai,
    appearance,
    settings,
    help,
  ].filter((group) => group.commandLists.length > 0);

  if (commandOptions.commentOptions) {
    return [comment, task, ...groups.filter((group) => group !== task)];
  }

  if (commandOptions.context === "Task") {
    return [
      task,
      time,
      ...groups.filter((group) => group !== task && group !== time),
    ];
  }

  if (commandOptions.context === "Kanban") {
    return [
      ...(bulk ? [bulk] : []),
      board,
      ...groups.filter((group) => group !== board && group !== bulk),
    ];
  }

  return groups;
};

const BOARD_MENU_COMMAND_TARGETS = [
  { commandMode: CommandMode.BoardSettings },
  { commandMode: CommandMode.SortKanbanBoard, key: "sortBoard" },
  { commandMode: CommandMode.ShowFilterHTC, key: "ShowFilterHtc" },
  { commandMode: CommandMode.ManageColumn },
  { commandMode: CommandMode.RenameColumn },
  { commandMode: CommandMode.HideColumn },
  { commandMode: CommandMode.GoToBoardSurface },
  { commandMode: CommandMode.GoToTableSurface },
  { key: "saveView" },
  { commandMode: CommandMode.ManageViews },
  { commandMode: CommandMode.ToggleEmptyColumns },
] as const satisfies ReadonlyArray<{
  commandMode?: CommandMode;
  key?: string;
}>;

// On the Table view, table-scoped actions lead the menu instead of the
// board-only column/section actions (HTPR-3805). Sort/filter apply to both
// surfaces, so they're shared between this lead group and the board list below.
const TABLE_LEAD_COMMAND_TARGETS = [
  { commandMode: CommandMode.ConfigureTableColumns },
  { commandMode: CommandMode.SortKanbanBoard, key: "sortBoard" },
  { commandMode: CommandMode.ShowFilterHTC, key: "ShowFilterHtc" },
] as const satisfies ReadonlyArray<{
  commandMode?: CommandMode;
  key?: string;
}>;

const targetId = (target: { commandMode?: CommandMode; key?: string }) =>
  target.commandMode ?? target.key;

export const getBoardMenuCommands = (
  commandGroups: CommandGroup[],
  activeSurface: "board" | "table" = "board"
): CommandGroup[] => {
  const commands = commandGroups.flatMap((group) => group.commandLists);
  const resolve = (target: { commandMode?: CommandMode; key?: string }) =>
    commands.find(
      (candidate) =>
        (!("commandMode" in target) ||
          candidate.commandMode === target.commandMode) &&
        (!("key" in target) || candidate.key === target.key)
    );

  const leadIds = new Set(TABLE_LEAD_COMMAND_TARGETS.map(targetId));
  const targets =
    activeSurface === "table"
      ? [
          ...TABLE_LEAD_COMMAND_TARGETS,
          ...BOARD_MENU_COMMAND_TARGETS.filter(
            (target) => !leadIds.has(targetId(target))
          ),
        ]
      : BOARD_MENU_COMMAND_TARGETS;

  return [
    {
      group: "Board",
      commandLists: targets.flatMap((target) => {
        const command = resolve(target);
        return command ? [command] : [];
      }),
    },
  ];
};

// Kept for legacy imports; callers should use getAllCommands for context-aware rows.
export const AllCommands: CommandGroup[] = [];
