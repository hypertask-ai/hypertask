import { CommandMode } from "@/models/enums";
import { IAllCommands } from "@/models/model";
import { CommandGroup, ICommandList } from "./HTCTypes";



export const baseTaskCommands: ICommandList[] = [
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


export const getCommentCommands = (commandOptions?: IAllCommands): CommandGroup => {
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


export const getTaskCommands = (commandOptions?: IAllCommands): CommandGroup => {
  const taskProps = commandOptions?.taskOptions;
  const browsableTaskCommands = commandOptions?.context === "Task"
    ? baseTaskCommands.filter((command) =>
        (["addSubTask", "viewSubTask"].includes(command.key) ||
          (command.key === "openAiTaskWriter" && !taskProps?.isKanban) ||
          // Summarize ticket only works on the detail page (the AI chat sends
          // default_context.task_id there); hide it on a Kanban-focused task.
          (command.key === "summarizeTicket" && !taskProps?.isKanban) ||
          (command.key === "remindMe" && taskProps?.isMyTasks))
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
