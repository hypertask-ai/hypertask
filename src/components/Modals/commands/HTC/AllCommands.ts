
import { getCommentCommands, getTaskCommands } from "./taskCommands";

import { getNavigateCommands, getTimeCommands, getBulkTaskCommands, getAppShellCommands, getAgentChatCommands } from "./navigationCommands";
import { CommandMode } from "@/models/enums";
import { IAllCommands } from "@/models/model";
import { RAIL_TOGGLE_KEY } from "@/lib/constants/railToggleKey";
import { CommandGroup } from "./HTCTypes";

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
      key: "settingsAnnouncementsAnnouncementAlerts",
      name: "Settings: Announcement alerts",
      commandMode: CommandMode.Setting,
      payload: "announcements",
      keywords: "settings announcement alerts announcements",
    },
    {
      key: "settingsCalendarKeepTasksUpdated",
      name: "Settings: Keep tasks updated",
      commandMode: CommandMode.Setting,
      payload: "calendar",
      keywords: "settings keep tasks updated profile",
    },
    {
      key: "settingsCalendarShowWeekends",
      name: "Settings: Show weekends",
      commandMode: CommandMode.Setting,
      payload: "calendar",
      keywords: "settings show weekends profile",
    },
    {
      key: "settingsApiKeysOpenaiApiKey",
      name: "Settings: OpenAI API key",
      commandMode: CommandMode.Setting,
      payload: "apiKeys",
      keywords: "settings openai api key use byok",
    },
    {
      key: "settingsApiKeysAnthropicApiKey",
      name: "Settings: Anthropic API key",
      commandMode: CommandMode.Setting,
      payload: "apiKeys",
      keywords: "settings anthropic api key use byok",
    },
    {
      key: "settingsApiKeysGoogleApiKey",
      name: "Settings: Google API key",
      commandMode: CommandMode.Setting,
      payload: "apiKeys",
      keywords: "settings google api key use byok",
    },
    {
      key: "settingsApiKeysDeepseekApiKey",
      name: "Settings: DeepSeek API key",
      commandMode: CommandMode.Setting,
      payload: "apiKeys",
      keywords: "settings deepseek api key use byok",
    },
    {
      key: "settingsApiKeysMoonshotKimiApiKey",
      name: "Settings: Moonshot (Kimi) API key",
      commandMode: CommandMode.Setting,
      payload: "apiKeys",
      keywords: "settings moonshot (kimi) api key use byok",
    },
    {
      key: "settingsApiKeysZAiGlmApiKey",
      name: "Settings: Z.ai (GLM) API key",
      commandMode: CommandMode.Setting,
      payload: "apiKeys",
      keywords: "settings z.ai (glm) api key use byok",
    },
    {
      key: "settingsApiKeysAlibabaQwenApiKey",
      name: "Settings: Alibaba (Qwen) API key",
      commandMode: CommandMode.Setting,
      payload: "apiKeys",
      keywords: "settings alibaba (qwen) api key use byok",
    },
    {
      key: "settingsApiKeysOpenrouterApiKey",
      name: "Settings: OpenRouter API key",
      commandMode: CommandMode.Setting,
      payload: "apiKeys",
      keywords: "settings openrouter api key use byok",
    },
    {
      key: "settingsApiKeysVercelAiGatewayApiKey",
      name: "Settings: Vercel AI Gateway API key",
      commandMode: CommandMode.Setting,
      payload: "apiKeys",
      keywords: "settings vercel ai gateway api key use byok",
    },
    {
      key: "settingsApiKeysCustomEndpointOperatesUnderAnEuUsDataAgreement",
      name: "Settings: Custom endpoint EU/US agreement",
      commandMode: CommandMode.Setting,
      payload: "apiKeys",
      keywords: "settings custom endpoint operates under an eu/us data agreement byok",
    },
    {
      key: "settingsAiModelsGdprSafeMode",
      name: "Settings: GDPR safe mode",
      commandMode: CommandMode.Setting,
      payload: "ai-models",
      keywords: "settings gdpr safe mode enable disable team",
    },
    {
      key: "settingsAiModelsOpenai",
      name: "Settings: OpenAI",
      commandMode: CommandMode.Setting,
      payload: "ai-models",
      keywords: "settings openai enable disable team",
    },
    {
      key: "settingsAiModelsAnthropic",
      name: "Settings: Anthropic",
      commandMode: CommandMode.Setting,
      payload: "ai-models",
      keywords: "settings anthropic enable disable team",
    },
    {
      key: "settingsAiModelsGoogle",
      name: "Settings: Google",
      commandMode: CommandMode.Setting,
      payload: "ai-models",
      keywords: "settings google enable disable team",
    },
    {
      key: "settingsAiModelsDeepseek",
      name: "Settings: DeepSeek",
      commandMode: CommandMode.Setting,
      payload: "ai-models",
      keywords: "settings deepseek enable disable team",
    },
    {
      key: "settingsAiModelsMoonshotKimi",
      name: "Settings: Moonshot (Kimi)",
      commandMode: CommandMode.Setting,
      payload: "ai-models",
      keywords: "settings moonshot (kimi) enable disable team",
    },
    {
      key: "settingsAiModelsZAiGlm",
      name: "Settings: Z.ai (GLM)",
      commandMode: CommandMode.Setting,
      payload: "ai-models",
      keywords: "settings z.ai (glm) enable disable team",
    },
    {
      key: "settingsAiModelsAlibabaQwen",
      name: "Settings: Alibaba (Qwen)",
      commandMode: CommandMode.Setting,
      payload: "ai-models",
      keywords: "settings alibaba (qwen) enable disable team",
    },
    {
      key: "settingsAiModelsOpenrouter",
      name: "Settings: OpenRouter",
      commandMode: CommandMode.Setting,
      payload: "ai-models",
      keywords: "settings openrouter enable disable team",
    },
    {
      key: "settingsAiFeaturesAiChat",
      name: "Settings: AI chat",
      commandMode: CommandMode.Setting,
      payload: "ai-features",
      keywords: "settings ai chat on off team",
    },
    {
      key: "settingsAiFeaturesTaskWriter",
      name: "Settings: Task writer",
      commandMode: CommandMode.Setting,
      payload: "ai-features",
      keywords: "settings task writer on off team",
    },
    {
      key: "settingsAiFeaturesWriteWithAi",
      name: "Settings: Write with AI",
      commandMode: CommandMode.Setting,
      payload: "ai-features",
      keywords: "settings write with ai on off team",
    },
    {
      key: "settingsAiFeaturesImproveWriting",
      name: "Settings: Improve writing",
      commandMode: CommandMode.Setting,
      payload: "ai-features",
      keywords: "settings improve writing on off team",
    },
    {
      key: "settingsAiFeaturesAskAi",
      name: "Settings: Ask AI",
      commandMode: CommandMode.Setting,
      payload: "ai-features",
      keywords: "settings ask ai on off team",
    },
    {
      key: "settingsAiFeaturesBoardGeneration",
      name: "Settings: Board generation",
      commandMode: CommandMode.Setting,
      payload: "ai-features",
      keywords: "settings board generation on off team",
    },
    {
      key: "settingsAiFeaturesImageGeneration",
      name: "Settings: Image generation",
      commandMode: CommandMode.Setting,
      payload: "ai-features",
      keywords: "settings image generation on off team",
    },
    {
      key: "settingsAiFeaturesHyperai",
      name: "Settings: @HyperAI",
      commandMode: CommandMode.Setting,
      payload: "ai-features",
      keywords: "settings @hyperai on off team",
    },
    {
      key: "settingsAiFeaturesTaskSummaries",
      name: "Settings: Task summaries",
      commandMode: CommandMode.Setting,
      payload: "ai-features",
      keywords: "settings task summaries on off team",
    },
    {
      key: "settingsAiFeaturesQuestionSuggestions",
      name: "Settings: Question suggestions",
      commandMode: CommandMode.Setting,
      payload: "ai-features",
      keywords: "settings question suggestions on off team",
    },
    {
      key: "settingsAiFeaturesDictation",
      name: "Settings: Dictation",
      commandMode: CommandMode.Setting,
      payload: "ai-features",
      keywords: "settings dictation on off team",
    },
    {
      key: "settingsBoardMemoryLearnFromAiCorrections",
      name: "Settings: Learn from AI corrections",
      commandMode: CommandMode.Setting,
      payload: "board-memory",
      keywords: "settings learn from ai corrections board",
    },
    {
      key: "settingsBoardGeneralBoardNotifications",
      name: "Settings: Board notifications",
      commandMode: CommandMode.Setting,
      payload: "board-general",
      keywords: "settings board notifications board",
    },
    {
      key: "settingsBoardGeneralShowTotalTimeOnTasks",
      name: "Settings: Show total time on tasks",
      commandMode: CommandMode.Setting,
      payload: "board-general",
      keywords: "settings show total time on tasks board",
    },
    {
      key: "settingsBoardPlanningEnableCycles",
      name: "Settings: Enable cycles",
      commandMode: CommandMode.Setting,
      payload: "board-planning",
      keywords: "settings enable cycles board",
    },
    {
      key: "settingsBoardStalenessStaleness",
      name: "Settings: Staleness",
      commandMode: CommandMode.Setting,
      payload: "board-staleness",
      keywords: "settings staleness board",
    },
    {
      key: "settingsBoardStalenessStaleReminders",
      name: "Settings: Stale reminders",
      commandMode: CommandMode.Setting,
      payload: "board-staleness",
      keywords: "settings stale reminders board",
    },
    {
      key: "settingsBoardStalenessAutoArchive",
      name: "Settings: Auto-archive",
      commandMode: CommandMode.Setting,
      payload: "board-staleness",
      keywords: "settings auto-archive board",
    },
    {
      key: "settingsNotificationsPushNotificationsOnThisDevice",
      name: "Settings: Push Notifications on this device",
      commandMode: CommandMode.Setting,
      payload: "notifications",
      keywords: "settings push notifications on this device notifications",
    },
    {
      key: "settingsNotificationsMentionsNotifications",
      name: "Settings: Mentions notifications",
      commandMode: CommandMode.Setting,
      payload: "notifications",
      keywords: "settings mentions notifications email push for notifications",
    },
    {
      key: "settingsNotificationsCommentsNotifications",
      name: "Settings: Comments notifications",
      commandMode: CommandMode.Setting,
      payload: "notifications",
      keywords: "settings comments notifications email push for notifications",
    },
    {
      key: "settingsNotificationsAssignmentsNotifications",
      name: "Settings: Assignments notifications",
      commandMode: CommandMode.Setting,
      payload: "notifications",
      keywords: "settings assignments notifications email push for notifications",
    },
    {
      key: "settingsNotificationsTaskUpdatesNotifications",
      name: "Settings: Task updates notifications",
      commandMode: CommandMode.Setting,
      payload: "notifications",
      keywords: "settings task updates notifications email push for notifications",
    },
    {
      key: "settingsNotificationsDueDatesNotifications",
      name: "Settings: Due dates notifications",
      commandMode: CommandMode.Setting,
      payload: "notifications",
      keywords: "settings due dates notifications email push for notifications",
    },
    {
      key: "settingsTaskPageOpenAiChatByDefault",
      name: "Settings: Open AI chat by default",
      commandMode: CommandMode.Setting,
      payload: "task-page",
      keywords: "settings open ai chat by default task page",
    },
    {
      key: "settingsTaskPageCollapseComments",
      name: "Settings: Collapse Comments",
      commandMode: CommandMode.Setting,
      payload: "task-page",
      keywords: "settings collapse comments task page",
    },
    {
      key: "settingsTaskPagePlayGifs",
      name: "Settings: Play GIFs",
      commandMode: CommandMode.Setting,
      payload: "task-page",
      keywords: "settings play gifs task page",
    },
    {
      key: "settingsTaskPageSuggestDescriptionsFromTaskTitles",
      name: "Settings: Suggest descriptions from task titles",
      commandMode: CommandMode.Setting,
      payload: "task-page",
      keywords: "settings suggest descriptions from task titles task page",
    },
    {
      key: "settingsTaskPageShowTaskHistory",
      name: "Settings: Show task history",
      commandMode: CommandMode.Setting,
      payload: "task-page",
      keywords: "settings show task history task page",
    },
    {
      key: "settingsTaskPageReadReceipts",
      name: "Settings: Read receipts",
      commandMode: CommandMode.Setting,
      payload: "task-page",
      keywords: "settings read receipts task page",
    },
    {
      key: "settingsInboxArchiveAndGoToNextTaskAfterSendingAComment",
      name: "Settings: Archive after commenting",
      commandMode: CommandMode.Setting,
      payload: "inbox",
      keywords: "settings archive and go to next task after sending a comment inbox",
    },
    {
      key: "settingsInboxDisplayAvatarInInbox",
      name: "Settings: Display avatar in inbox",
      commandMode: CommandMode.Setting,
      payload: "inbox",
      keywords: "settings display avatar in inbox inbox",
    },
    {
      key: "settingsLearnQuickTips",
      name: "Settings: Quick tips",
      commandMode: CommandMode.Setting,
      payload: "learn",
      keywords: "settings quick tips learning help",
    },
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
      key: "settingsBoardTicketPrefix",
      name: "Settings: Ticket prefix (board)",
      commandMode: CommandMode.Setting,
      payload: "board-general",
      keywords: "settings board ticket prefix identifier id key code letters rename",
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
