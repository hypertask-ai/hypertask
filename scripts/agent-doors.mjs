#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const COMMANDS_DIR = "src/components/Modals/commands/HTC";
const DOC = "docs/agent-doors.tsv";

const ACTIONS = [
  {
    id: "task.create",
    person: "Create a task, subtask, copy of a task, or a task from a comment",
    commands: /^(createTask|createTaskWithAiWriter|newTaskFromTemplate|addSubTask|createTaskFromComment|duplicateTask|duplicateTaskToBoard)$/,
    cli: "task create",
    mcp: "/mcp/tasks/create",
    ai: "create_task",
  },
  {
    id: "task.update",
    person: "Rename a task and change its dates, priority, size, tags or description",
    commands: /^(renameTask|setDueDate|setStartDate|priorityModal|estimateModal|labelmodal|setRecurrence|taskDescriptionVersions|saveTaskTemplate)$/,
    cli: "task update",
    mcp: "/mcp/tasks/update",
    ai: "update_task",
  },
  {
    id: "task.move",
    person: "Move a task to another column or board",
    commands: /^(moveToColumn|bulkMoveToColumn|movetasktodifferentboard)$/,
    cli: "task move",
    mcp: "/mcp/tasks/move",
    ai: "move_task_between_boards",
    note: "Column moves have no AI chat tool",
  },
  {
    id: "task.assign",
    person: "Assign a task to a person or agent",
    commands: /^(assignUser|assignToMe|bulkAssignUser)$/,
    cli: "task assign",
    mcp: "/mcp/assignees/assign",
    ai: "assign_user",
  },
  {
    id: "task.archive",
    person: "Archive, delete or bulk-archive tasks",
    commands: /^(archiveTask|bulkArchive|deleteTask|archiveColumn)$/,
    note: "Gap HTPR-8215: /mcp/tasks is GET only and the CLI has no task archive or delete",
  },
  {
    id: "task.blocked",
    person: "Mark a task blocked by a person, blocking, or clear the red border",
    commands: /^(blockedByPerson|blockerComment|markBlockedBy|markAsBlocking|acceptTask|declineTask|declineAsDuplicateOf|markDuplicateOf)$/,
    cli: "task waiting-on",
    mcp: "/mcp/tasks/waiting-on",
    note: "Accept, decline and duplicate-mark have no door",
  },
  {
    id: "task.relations",
    person: "Link tasks as related, remove a subtask, view subtasks",
    commands: /^(addRelatedTask|removeSubtask|removeParenttask|viewSubTask)$/,
    cli: "task link",
    mcp: "/mcp/tasks/relations",
    ai: "link_tasks",
  },
  {
    id: "task.follow",
    person: "Follow, star, mark unread or set a reminder on a task",
    commands: /^(followtask|unfollowtask|starTask|markAsUnread|remindMe|setReminder)$/,
    mcp: "/mcp/tasks/follow",
    ai: "follow_task",
    note: "Mark unread has no door; the CLI door is planned on HTPR-8217",
  },
  {
    id: "task.inbox",
    person: "Send a task to the inbox",
    commands: /^(showInInbox)$/,
    cli: "task move-to-inbox",
    mcp: "/mcp/inbox/move",
    ai: "move_task_to_inbox",
  },
  {
    id: "comment.create",
    person: "Reply to a ticket or write a comment",
    commands: /^(replyToComment)$/,
    cli: "comment add",
    mcp: "/mcp/comments",
    ai: "add_comment",
  },
  {
    id: "comment.update",
    person: "Edit a comment",
    commands: /^(editcomment)$/,
    cli: "comment update",
    mcp: "/mcp/comments/([^/]+)",
    ai: "update_comment",
  },
  {
    id: "comment.delete",
    person: "Delete a comment",
    commands: /^(deletemessage)$/,
    cli: "comment delete",
    mcp: "/mcp/comments/([^/]+)",
    ai: "delete_comment",
  },
  {
    id: "comment.react",
    person: "React to a comment or like it",
    commands: /^(reactToComment|fastLikeComment)$/,
    cli: "comment react",
    mcp: "/mcp/comments/([^/]+)/reactions",
  },
  {
    id: "comment.marker",
    person: "Pin or star a comment",
    commands: /^(pinComment|starComment)$/,
    ai: "hypertask_comments",
    note: "Pin and star ride the hypertask_comments pin and star actions; the CLI and REST doors are still missing",
  },
  {
    id: "inbox.archive",
    person: "Archive inbox items, triage or clear the inbox",
    commands: /^(triageInbox|swipeThroughUnread|clearInboxToZero|archiveAllReadNotifications|archiveReactionNotifications|removeTaskNotification)$/,
    cli: "inbox archive",
    mcp: "/mcp/inbox/archive",
    ai: "inbox_archive",
    note: "One task per call; no bulk inbox archive door",
  },
  {
    id: "board.create",
    person: "Create a board or team",
    commands: /^(createBoard|createTeam|boardCreationAssistant)$/,
    cli: "project create-board",
    mcp: "/mcp/teams/([^/]+)/boards",
    ai: "create_board",
    note: "Creating a team has no door",
  },
  {
    id: "board.update",
    person: "Rename, archive or delete a board, change its settings",
    commands: /^(renameBoard|archiveBoards|deleteBoard|boardSettings|teamSettings|copyBoardLink|resetBoardLink|inviteBoard)$/,
    cli: "project update",
    mcp: "/mcp/projects/([^/]+)",
    ai: "rename_board",
    note: "Join-link copy and reset have no door; delete goes through the CLI only",
  },
  {
    id: "task.search",
    person: "Search tasks and jump to a task",
    commands: /^(searchTask|searchTasksHandover)$/,
    cli: "search",
    mcp: "/mcp/tasks/search",
    ai: "search_tasks",
  },
  {
    id: "board.report",
    person: "Board velocity report and generated status update",
    commands: /^(boardVelocityReport|generateStatusUpdate)$/,
    note: "Gap HTPR-8219: pieces exist for hand-written reports only",
  },
  {
    id: "column.manage",
    person: "Add, rename, hide or delete a board column",
    commands: /^(addColumn|renameColumn|hideColumn|deleteColumn|manageColumns|autoAssignColumn|createSmartSplit)$/,
    cli: "section create",
    mcp: "/mcp/projects/([^/]+)/sections",
    ai: "section",
  },
  {
    id: "column.bulk",
    person: "Select all tickets in a column or on the board",
    commands: /^(bulkSelectAllInColumn|bulkSelectAllOnBoard|bulkClearSelection)$/,
    noDoorNeeded: true,
    note: "Selection is a screen state; agents act on one ticket at a time",
  },
  {
    id: "label.manage",
    person: "Create, rename, merge or apply tags",
    commands: /^(manageLabels|bulkSetLabels)$/,
    cli: "labels create",
    mcp: "/mcp/projects/([^/]+)/labels",
    ai: "create_label",
  },
  {
    id: "field.custom",
    person: "Create a custom field and set its value on a task",
    commands: /^(createCustomField|manageCustomFields)$/,
    cli: "fields create",
    mcp: "/mcp/custom-fields",
    ai: "list_custom_fields",
    note: "AI chat can set a value but cannot create the field",
  },
  {
    id: "view.manage",
    person: "Save, switch and manage board views",
    commands: /^(saveView|manageViews|goToViews)$/,
    cli: "view create",
    mcp: "/mcp/view",
    ai: "create_view",
  },
  {
    id: "time.track",
    person: "Start, stop or log time on a task",
    commands: /^(toggleTimeTracking|toggleBoardTimeTracking|logTimeOnTask|GoToTimers|goToTimeMyWeek|goToTimeThisBoard|goToTimeThisTask)$/,
    cli: "time start",
    mcp: "/mcp/time/start",
    ai: "start_timer",
  },
  {
    id: "report.manage",
    person: "Create, update or delete a report",
    commands: /^(GotoReports|reportSettings)$/,
    cli: "report create",
    mcp: "/mcp/reports/create",
    ai: "create_report",
  },
  {
    id: "page.manage",
    person: "Create, edit, archive or delete a page",
    commands: /^(deletePage|GotoSnippets|createSnippet|createSnippetFromDraft|useSnippet)$/,
    cli: "pages create",
    mcp: "/mcp/pages/create",
    ai: "create_page",
    note: "Snippets are skills: create_skill covers them",
  },
  {
    id: "agent.manage",
    person: "Create, rename, revoke or archive an agent",
    commands: /^(createAgent|manageAgents|disabledAgents|agentChatAddAgent)$/,
    cli: "agents create",
    mcp: "/mcp/agents/create",
    ai: "create_agent",
  },
  {
    id: "member.manage",
    person: "Invite or remove team and board members",
    commands: /^(manageMembers|ManageTeamMembers|manageTeams)$/,
    cli: "project invite",
    mcp: "/mcp/projects/([^/]+)/members",
    note: "No AI chat tool",
  },
  {
    id: "task.share",
    person: "Share a task publicly or copy its public link",
    commands: /^(shareTaskPublicly|copyPublicLink|copypublicformattedTaskLink)$/,
    note: "Gap HTPR-8216: no public share door",
  },
  {
    id: "filter.view",
    person: "Filter, sort or group the board and switch table columns",
    commands: /^(ShowFilterHtc|toggleFilterValueMatch|sortBoard|sortByLastComment|sortByTimeInColumn|myTasksSort|myTasksGroup|myTasksScope|myTasksInvolvement|configureTableColumns|toggleEmptyColumns|toggleArchivedOnBoard|toggleArchivedSearchResults|toggleAutoArchive|toggleStaleness|toggleStalenessView|toggleHistory|archiveShowActiveBoardsOnly|archiveShowAllBoards|archiveShowArchivedBoardsOnly)$/,
    noDoorNeeded: true,
    note: "Screen state and saved-view settings; no door needed",
  },
];

const SECONDARY = [
  {
    id: "chat.control",
    person: "AI chat controls: open, pin, switch mode, add agent, delete sessions",
    commands: /^(aiChatInterface|pinAiChatOpen|toggleAIChatView|fullScreenAiChat|appShellAIChat|appShellAIChatAlternative|branchInNewChat|deleteAllChats|agentChatSendMessage|agentChatNextAgent|agentChatPreviousAgent|agentChatNextTeam|agentChatPreviousTeam|agentChatOpenLinks|copyCommentToAiChat|suggestReply|summarizeComment|summarizeTicket|openAiTaskWriter)$/,
  },
  {
    id: "settings.pane",
    person: "Settings panes, AI model picks, API keys, notifications and plans",
    commands: /^(settings|billing|manageSubscriptions|manageTeamAIAPIKeys|profilePicture|shortcuts|quickTips|helpCenter|latestUpdates|onboardingTour|startKanbanTutorial|startTaskWriterTutorial|goToWelcome|sendFeedback|logout|switchAccount|generateMcpToken|cliInstall|restApi|speechToText|undoLatest|reloadApp|subtaskSettings)/,
  },
  {
    id: "navigate",
    person: "Go to a screen, switch the app shell or expand the sidebar",
    commands: /^(GoTo|Goto|goTo|appShellBoard|appShellCalendar|appShellInbox|appShellTable|toggleAppShellRail|toggleRailExpanded|manageFavorites)/,
  },
  {
    id: "appearance",
    person: "Theme, layout and zoom switches",
    commands: /(Theme$|^toggleBoardLayout$|^toggleBoardZoom$|^toggleTableTitleWrap$|^calendarWeekStartsMonday$|^calendarWeekStartsSunday$|^toggleCalendarWeekends$|^calendarSettings$|^copyCurrentPageUrl$)/,
  },
  {
    id: "calendar.subscribe",
    person: "Subscribe the board calendar in Google Calendar",
    commands: /^subscribeGoogleCalendar$/,
  },
  {
    id: "copy",
    person: "Copy a link, ID or comment text to the clipboard",
    commands: /^(copy|Copy)/,
  },
  {
    id: "comment.read",
    person: "Expand, collapse or copy a comment thread",
    commands: /^(toggleAllComments|copyCommentContent|copyCommentLink)$/,
  },
];

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(entry) ? [full] : [];
  });
}

export function registryCommands() {
  const commands = new Map();
  for (const file of walk(path.join(ROOT, COMMANDS_DIR))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/key:\s*"([^"]+)"/g)) {
      const tail = source.slice(match.index + match[0].length, match.index + 600);
      if (!/commandMode:\s*CommandMode\./.test(tail)) continue;
      const label = tail.match(/^\s*,\s*name:\s*"((?:[^"\\]|\\.)*)"/);
      commands.set(match[1], label ? label[1] : match[1]);
    }
  }
  return commands;
}

function normalizeDoor(value) {
  return value.replace(/\(\[\^\/\]\+\)/g, "*").replace(/\[[^\]]+\]/g, "*");
}

function catalogues() {
  const api = new Set(
    walk(path.join(ROOT, "src/app/api"))
      .filter((file) => file.endsWith(`${path.sep}route.ts`))
      .map((file) => normalizeDoor("/api/" + path.relative(path.join(ROOT, "src/app/api"), path.dirname(file)).split(path.sep).join("/")))
  );
  const chatSource = readFileSync(path.join(ROOT, "src/lib/ai/tools/index.ts"), "utf8");
  const chat = new Set([...chatSource.matchAll(/hypertask_([a-z0-9_]+)/g)].map((m) => m[1]));
  return { api, chat };
}

export function build() {
  const commands = registryCommands();
  const { api, chat } = catalogues();
  const rows = [];
  const unmapped = [];
  const broken = [];
  const actions = new Map([...ACTIONS, ...SECONDARY].map((action) => [action.id, action]));
  for (const [key, label] of commands) {
    const action = [...ACTIONS, ...SECONDARY].find((candidate) => candidate.commands.test(key));
    if (!action) {
      unmapped.push(`${key} (${label})`);
      continue;
    }
    rows.push({ key, action: action.id, label });
  }
  for (const action of actions.values()) {
    if (action.mcp && !api.has(normalizeDoor("/api" + action.mcp))) broken.push(`${action.id}: door /api${action.mcp} has no route under src/app/api`);
    if (action.ai && !chat.has(action.ai)) broken.push(`${action.id}: AI chat tool hypertask_${action.ai} is not registered`);
  }
  const used = new Set(rows.map((row) => row.action));
  const empty = [...actions.keys()].filter((id) => !used.has(id));
  const gaps = [...ACTIONS].filter((action) => !action.mcp && !action.noDoorNeeded).map((action) => action.id);
  return { rows, unmapped, broken, empty, gaps, actions };
}

export function doorTable(actions) {
  const header = ["action", "person_action", "cli", "mcp_api", "ai_chat", "note"];
  const lines = [header.join("\t")];
  for (const action of actions) {
    lines.push(
      [
        action.id,
        action.person,
        action.cli ?? "no",
        action.mcp ?? "no",
        action.ai ?? "no",
        action.note ?? "",
      ].join("\t")
    );
  }
  return lines.join("\n") + "\n";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = build();
  if (process.argv.includes("--write")) {
    writeFileSync(path.join(ROOT, DOC), doorTable([...ACTIONS, ...SECONDARY]));
    console.log(`wrote ${DOC}`);
  }
  const problems = [
    ...result.unmapped.map((entry) => `unmapped command: ${entry}`),
    ...result.broken,
    ...result.empty.map((id) => `action with no command: ${id}`),
  ];
  for (const problem of problems) console.error(problem);
  console.log(
    `commands=${result.rows.length} actions=${result.actions.size} gaps=${result.gaps.length} problems=${problems.length}`
  );
  if (result.gaps.length) console.log(`gaps: ${result.gaps.join(", ")}`);
  process.exit(problems.length ? 1 : 0);
}
