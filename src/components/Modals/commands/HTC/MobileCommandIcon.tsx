import {
  Archive,
  ArrowUpDown,
  Bot,
  Calendar,
  Circle,
  Clock,
  Copy,
  Funnel,
  Inbox,
  Link,
  MessageCircle,
  Mic,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Share2,
  Sparkles,
  SquareKanban,
  Star,
  Trash2,
  UserPlus,
  UserRoundPlus,
  type LucideIcon,
} from "lucide-react";
import { CommandMode } from "@/models/enums";
import type { ICommandList } from "./HTCTypes";

const iconForCommand = (command: ICommandList): LucideIcon => {
  switch (command.commandMode) {
    case CommandMode.ReloadApp:
      return RefreshCw;
    case CommandMode.GotoInbox:
    case CommandMode.GotoProjectInbox:
    case CommandMode.GotoInboxArchives:
    case CommandMode.ShowInInbox:
    case CommandMode.SwipeThroughUnread:
      return Inbox;
    case CommandMode.GoToCalender:
    case CommandMode.GoToDueDates:
    case CommandMode.SetDueDate:
    case CommandMode.SetStartDate:
    case CommandMode.SetRecurrence:
    case CommandMode.GoToMyTasks:
    case CommandMode.CalendarSettings:
    case CommandMode.ToggleCalendarWeekends:
    case CommandMode.CalendarWeekStartsMonday:
    case CommandMode.CalendarWeekStartsSunday:
    case CommandMode.SubscribeGoogleCalendar:
      return Calendar;
    case CommandMode.SearchTask:
      return Search;
    case CommandMode.ShowFilterHTC:
      return Funnel;
    case CommandMode.CreateTask:
    case CommandMode.CreateSubTask:
    case CommandMode.AddColumn:
    case CommandMode.NewBoard:
    case CommandMode.CreateSnippet:
    case CommandMode.CreateSnippetFromDraft:
      return Plus;
    case CommandMode.SortKanbanBoard:
    case CommandMode.SortByTimeInColumn:
    case CommandMode.SortByLastComment:
      return ArrowUpDown;
    case CommandMode.RemindMe:
    case CommandMode.SetReminder:
    case CommandMode.GotoReminders:
    case CommandMode.GoToTimers:
    case CommandMode.GoToTimeThisTask:
    case CommandMode.GoToTimeThisBoard:
    case CommandMode.GoToTimeMyWeek:
    case CommandMode.LogTimeOnTask:
    case CommandMode.ToggleTimeTracking:
    case CommandMode.ToggleBoardTimeTracking:
      return Clock;
    case CommandMode.DeleteTask:
    case CommandMode.DeleteMessage:
    case CommandMode.DeleteBoard:
    case CommandMode.DeleteColumn:
    case CommandMode.DeleteAllChats:
    case CommandMode.GotoTrash:
      return Trash2;
    case CommandMode.ArchiveTask:
    case CommandMode.ArchiveBoard:
    case CommandMode.GotoTaskArchives:
    case CommandMode.ToggleArchivedOnBoard:
      return Archive;
    case CommandMode.EditBoard:
    case CommandMode.EditComment:
    case CommandMode.RenameTask:
    case CommandMode.RenameColumn:
      return Pencil;
    case CommandMode.CopyUrlTask:
    case CommandMode.CopyFormattedURLTask:
    case CommandMode.CopyPublicUrlTask:
    case CommandMode.CopyPublicFormattedUrlTask:
    case CommandMode.CopyTaskID:
    case CommandMode.CopyTaskTitleAndID:
    case CommandMode.CopyCommentContent:
      return Copy;
    case CommandMode.CopyCommentURL:
    case CommandMode.CopyViewURL:
    case CommandMode.BoardJoinResetLink:
      return Link;
    case CommandMode.ShareTaskPublic:
      return Share2;
    case CommandMode.StarTask:
    case CommandMode.StarComment:
    case CommandMode.GoToStarred:
    case CommandMode.ManageFavorites:
      return Star;
    case CommandMode.PinComment:
    case CommandMode.GoToPinned:
    case CommandMode.PinAIChatOpen:
      return Pin;
    case CommandMode.ReplyToComment:
    case CommandMode.ReactToComment:
    case CommandMode.CreateTaskFromComment:
      return MessageCircle;
    case CommandMode.SpeechToText:
      return Mic;
    case CommandMode.AIChatInterface:
    case CommandMode.FullScreenAIChat:
    case CommandMode.ToggleAIChatView:
    case CommandMode.OpenAiTaskWriter:
    case CommandMode.BranchInNewChat:
    case CommandMode.CopyCommentToAiChat:
    case CommandMode.SummarizeComment:
    case CommandMode.SummarizeTicket:
      return Sparkles;
    case CommandMode.CreateAgent:
    case CommandMode.ManageAgents:
    case CommandMode.DisabledAgents:
    case CommandMode.GoToAgents:
      return Bot;
    case CommandMode.InviteMember:
      return UserRoundPlus;
    case CommandMode.OpenAssignModal:
    case CommandMode.AssignToMe:
      return UserPlus;
    case CommandMode.ManageMembers:
    case CommandMode.ManageTeamMembers:
      return UserPlus;
    case CommandMode.LabelModal:
    case CommandMode.PriorityModal:
    case CommandMode.EstimateModal:
    case CommandMode.ManageLabels:
      return Circle;
    case CommandMode.Setting:
    case CommandMode.BoardSettings:
    case CommandMode.TeamSettings:
    case CommandMode.SubtaskSettings:
    case CommandMode.ManageColumn:
    case CommandMode.ManageViews:
      return Settings;
    case CommandMode.GoToBoard:
    case CommandMode.GoToBoardSurface:
    case CommandMode.GoToTableSurface:
    case CommandMode.ToggleBoardLayout:
    case CommandMode.ShowBoardViews:
    case CommandMode.ManageBoards:
    case CommandMode.ManageTeams:
      return SquareKanban;
    default:
      return MoreHorizontal;
  }
};

export const MobileCommandIcon = ({ command }: { command: ICommandList }) => {
  const Icon = iconForCommand(command);

  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-label-span text-text-light-gray">
      <Icon size={16} strokeWidth={1.75} aria-hidden />
    </span>
  );
};
