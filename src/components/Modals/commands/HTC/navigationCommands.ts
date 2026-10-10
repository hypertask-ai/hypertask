import { CommandMode } from "@/models/enums";
import { IAllCommands } from "@/models/model";
import { CommandGroup, ICommandList } from "./HTCTypes";



export const getNavigateCommands = (commandOptions: IAllCommands): CommandGroup => ({
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
      key: "copyCurrentPageUrl",
      name: "Copy current page URL",
      commandMode: CommandMode.CopyViewURL,
      keywords: "copy current page URL link board view task address clipboard",
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
    ...(commandOptions.agentChatOwner ? [
      {
        key: "GoToAgentChat",
        name: "Agent Chat",
        commandMode: CommandMode.GoToAgentChat,
        keywords: "agents chat talk message",
      }
    ] : []),
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


export const getTimeCommands = (commandOptions: IAllCommands): CommandGroup => {
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


export const getBulkTaskCommands = (
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
export const getAgentChatCommands = (): CommandGroup => ({
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
    {
      key: "agentChatNextTeam",
      name: "Next team",
      keyboard: ["ALT", "SHIFT", "⭣"],
      commandMode: CommandMode.AgentChatNextTeam,
      keywords: "agent chat next team cycle filter",
    },
    {
      key: "agentChatPreviousTeam",
      name: "Previous team",
      keyboard: ["ALT", "SHIFT", "⭡"],
      commandMode: CommandMode.AgentChatPreviousTeam,
      keywords: "agent chat previous team cycle filter",
    },
  ],
});


export const getAppShellCommands = (): CommandGroup => ({
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
