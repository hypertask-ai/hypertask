"use client";

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import toast from "react-hot-toast";
import SettingsCard from "@/components/Modals/Settings/SettingsCard";
import SettingsSectionShell from "@/components/Modals/Settings/SettingsSectionShell";
import ConfirmDialog from "@/components/Modals/Common Modals/ConfirmDialog";
import MultiSelectDropdown from "@/components/TimeTracking/MultiSelectDropdown";
import useCurrentUser from "@/hooks/General/useCurrentUserCheckFromCookies";
import { useGetAllProjectsMinimal } from "@/hooks/MultiPages/useGetAllProjectsMinimal";
import { useGetAllTeamMembers } from "@/hooks/MultiPages/useGetAllTeamMembers";
import {
  BoardTaskSearchResult,
  TimeReportEntry,
  useBoardTaskSearch,
  useCreateTimeEntry,
  useDeleteTimeEntries,
  useDeleteTimeEntry,
  usePauseTimer,
  useResumeTimer,
  useStopTimer,
  useTimeReport,
  useTimerNow,
  useUpdateTimeEntry,
} from "@/hooks/Task Detail/useTimeTracking";
import { formatElapsed, hoursMinutesToMinutes } from "@/lib/timeDuration";
import {
  shouldHydrateTimeQuickLog,
  timeQuickLogRequestKey,
} from "@/lib/timeQuickLog";
import TimeLogModal from "@/components/Modals/TimeLog/TimeLogModal";
import AppShellRail from "@/components/PageComponents/Kanban/HeaderComponents/AppShellRail";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useRecoilValue } from "@/lib/state";
import { appShellRailAtom, currentProjectAtom } from "@/store";

type GroupMode = "day" | "task" | "user";
type PresetRange =
  | "today"
  | "yesterday"
  | "week"
  | "lastWeek"
  | "month"
  | "lastMonth";
type RangeMode = PresetRange | "all" | "custom";

interface MinimalBoard {
  id: number;
  title?: string | null;
  name?: string | null;
  teamId?: string | null;
  team?: {
    id: string;
    title: string;
  } | null;
}

interface TeamMember {
  id: number;
  displayName?: string | null;
  email?: string | null;
  name?: string | null;
}

interface TeamMembersResponse {
  owner?: TeamMember | null;
  members?: TeamMember[];
}

const dayFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const selectClassName =
  "h-9 w-full rounded-[5px] border-x-0 border-t-0 border-b border-border bg-containerBackground px-3 text-[14px] text-white-black outline-none";
const inputClassName =
  "h-9 w-full border-x-0 border-t-0 border-b border-border bg-transparent px-1 text-[14px] text-white-black outline-none placeholder:text-text-light-gray disabled:cursor-not-allowed disabled:opacity-50 dark:[&::-webkit-calendar-picker-indicator]:invert";
const buttonClassName =
  "inline-flex h-9 items-center justify-center gap-2 rounded-[5px] border border-border px-3 text-[14px] font-medium text-white-black transition hover:bg-hover-active disabled:cursor-not-allowed disabled:opacity-50";
const timeReportSurfaceClassName =
  "flex flex-col gap-8 rounded-[5px] bg-cardBackground p-4 shadow-md sm:p-5";

function localDayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function dayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (localDayKey(date) === localDayKey(today)) return "Today";
  if (localDayKey(date) === localDayKey(yesterday)) return "Yesterday";
  return dayFormatter.format(date);
}

function ticketLabel(entry: TimeReportEntry) {
  return entry.task.ticketNumber ?? String(entry.task.uniqueIndex);
}

function taskSearchLabel(task: BoardTaskSearchResult) {
  return `${task.ticketNumber ?? task.uniqueIndex} ${task.title}`;
}

function entrySeconds(entry: TimeReportEntry, now: number) {
  return entry.endedAt || entry.pausedAt
    ? entry.seconds
    : Math.max(0, Math.floor((now - new Date(entry.startedAt).getTime()) / 1000));
}

function buildRange(kind: PresetRange) {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(from);

  if (kind === "yesterday") {
    from.setDate(from.getDate() - 1);
    to.setTime(from.getTime());
  } else if (kind === "week" || kind === "lastWeek") {
    const daysSinceMonday = (from.getDay() + 6) % 7;
    from.setDate(from.getDate() - daysSinceMonday - (kind === "lastWeek" ? 7 : 0));
    to.setTime(from.getTime());
    to.setDate(to.getDate() + 6);
  } else if (kind === "month" || kind === "lastMonth") {
    from.setDate(1);
    if (kind === "lastMonth") from.setMonth(from.getMonth() - 1);
    to.setFullYear(from.getFullYear(), from.getMonth() + 1, 0);
  }

  to.setHours(23, 59, 59, 999);
  return { from: from.toISOString(), to: to.toISOString() };
}

function startOfDayIso(dayKey: string) {
  return new Date(`${dayKey}T00:00:00`).toISOString();
}

function endOfDayIso(dayKey: string) {
  return new Date(`${dayKey}T23:59:59.999`).toISOString();
}

function formatCsvDuration(seconds: number) {
  const totalMinutes = Math.floor(seconds / 60);
  return `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

function csvField(value: string | number) {
  // Neutralize spreadsheet formula injection (CWE-1236): teammate-controlled
  // titles/names starting with = + - @ would execute when opened in Excel/Sheets.
  const raw = String(value);
  const safe = /^[=+\-@\t\r\n]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

function filenameSlug(value: string) {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "board"
  );
}

function memberLabel(member: TeamMember) {
  return member.displayName || member.email || member.name || `User ${member.id}`;
}

function TimeEntryRow({
  entry,
  now,
  currentUserId,
  hideTask,
  hideUser,
  onPause,
  onResume,
  onStop,
  isPausing,
  isResuming,
  isStopping,
  selected,
  onSelect,
  onOpenTimeLog,
}: {
  entry: TimeReportEntry;
  now: number;
  currentUserId: number | null;
  hideTask?: boolean;
  hideUser?: boolean;
  onPause: (taskId: number) => Promise<void>;
  onResume: (taskId: number) => Promise<void>;
  onStop: (taskId: number) => Promise<void>;
  isPausing: boolean;
  isResuming: boolean;
  isStopping: boolean;
  selected: boolean;
  onSelect: (entryId: number, selected: boolean) => void;
  onOpenTimeLog: (entry: TimeReportEntry) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editHours, setEditHours] = useState("");
  const [editMinutes, setEditMinutes] = useState("");
  const updateEntry = useUpdateTimeEntry(entry.taskId);
  const deleteEntry = useDeleteTimeEntry(entry.taskId);
  const isOwnEntry = currentUserId === entry.userId;
  const canManageEntry = isOwnEntry || entry.canManage;
  const seconds = entrySeconds(entry, now);

  const startEditing = () => {
    const minutes = Math.max(1, Math.round(seconds / 60));
    setEditDate(localDayKey(new Date(entry.startedAt)));
    setEditHours(String(Math.floor(minutes / 60)));
    setEditMinutes(String(minutes % 60));
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditDate("");
    setEditHours("");
    setEditMinutes("");
  };

  const save = async () => {
    const minutes = hoursMinutesToMinutes(editHours, editMinutes);
    if (!editDate) {
      toast.error("Pick a date");
      return;
    }
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      toast.error("Enter a duration from 1 minute to 24 hours");
      return;
    }

    const originalDate = localDayKey(new Date(entry.startedAt));
    try {
      await updateEntry.mutateAsync({
        entryId: entry.id,
        minutes,
        ...(editDate !== originalDate
          ? {
              date: editDate,
              timezoneOffsetMinutes: new Date(
                `${editDate}T12:00:00`
              ).getTimezoneOffset(),
            }
          : {}),
      });
      cancelEditing();
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to edit time entry");
    }
  };

  const remove = async () => {
    try {
      await deleteEntry.mutateAsync(entry.id);
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to delete time entry");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border py-3 text-[14px]">
      <input
        type="checkbox"
        aria-label={`Select time entry by ${entry.userName}`}
        checked={selected}
        onChange={(event) => onSelect(entry.id, event.target.checked)}
        className="h-4 w-4 shrink-0 accent-hypertasks-purple"
      />
      {/* The duration opens the same time log as B on the ticket, so a number
          you want to correct is one click from the place that edits it. */}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`Open time log for ${ticketLabel(entry)}`}
        className={`w-20 shrink-0 text-left tabular-nums hover:text-text-light-gray ${
          entry.endedAt ? "" : "text-hypertasks-green"
        }`}
        onClick={() => onOpenTimeLog(entry)}
      >
        {formatElapsed(seconds)}
      </button>
      {!hideTask && (
        <Link
          href={`/detail/project-${entry.task.projectId}/${entry.task.uniqueIndex}`}
          className="min-w-[12rem] flex-1 truncate font-medium hover:text-text-light-gray"
        >
          {ticketLabel(entry)} {entry.task.title}
        </Link>
      )}
      {!hideUser && (
        <span className="min-w-28 truncate text-text-light-gray">{entry.userName}</span>
      )}
      <span className="shrink-0 tabular-nums text-text-light-gray">
        {timeFormatter.format(new Date(entry.startedAt))} – {entry.endedAt
          ? timeFormatter.format(new Date(entry.endedAt))
          : entry.pausedAt
            ? "Paused"
            : "Now"}
      </span>
      {isEditing ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            aria-label="Hours for time entry"
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            value={editHours}
            onChange={(event) => setEditHours(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void save();
              if (event.key === "Escape") cancelEditing();
            }}
            className="w-16 border-x-0 border-t-0 border-b border-border bg-transparent px-1.5 py-0.5 text-white-black outline-none"
            placeholder="Hours"
          />
          <input
            aria-label="Minutes for time entry"
            type="number"
            inputMode="numeric"
            min="0"
            max="59"
            step="1"
            value={editMinutes}
            onChange={(event) => setEditMinutes(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void save();
              if (event.key === "Escape") cancelEditing();
            }}
            className="w-16 border-x-0 border-t-0 border-b border-border bg-transparent px-1.5 py-0.5 text-white-black outline-none"
            placeholder="Minutes"
          />
          <input
            aria-label="Date for time entry"
            type="date"
            value={editDate}
            onChange={(event) => setEditDate(event.target.value)}
            onClick={(event) => event.currentTarget.showPicker?.()}
            onKeyDown={(event) => {
              if (event.key === "Enter") void save();
              if (event.key === "Escape") cancelEditing();
            }}
            className="w-32 border-x-0 border-t-0 border-b border-border bg-transparent px-1.5 py-0.5 text-white-black outline-none dark:[&::-webkit-calendar-picker-indicator]:invert"
          />
          <button
            type="button"
            className="text-text-light-gray hover:text-white-black"
            disabled={updateEntry.isPending}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void save()}
          >
            Save
          </button>
          <button
            type="button"
            className="text-text-light-gray hover:text-white-black"
            onClick={cancelEditing}
          >
            Cancel
          </button>
        </div>
      ) : (
        canManageEntry && (
          <div className="flex items-center gap-3">
            {!entry.endedAt && isOwnEntry && (
              <>
                <button
                  type="button"
                  className="text-text-light-gray hover:text-white-black"
                  disabled={entry.pausedAt ? isResuming : isPausing}
                  onClick={() =>
                    void (entry.pausedAt
                      ? onResume(entry.taskId)
                      : onPause(entry.taskId))
                  }
                >
                  {entry.pausedAt ? "Resume" : "Pause"}
                </button>
                <button
                  type="button"
                  className="text-text-light-gray hover:text-white-black"
                  disabled={isStopping}
                  onClick={() => void onStop(entry.taskId)}
                >
                  Stop
                </button>
              </>
            )}
            {entry.endedAt && (
              <button
                type="button"
                className="text-text-light-gray hover:text-white-black"
                onClick={startEditing}
              >
                Edit
              </button>
            )}
            <button
              type="button"
              className="text-text-light-gray hover:text-white-black"
              disabled={deleteEntry.isPending}
              onClick={() => void remove()}
            >
              Delete
            </button>
          </div>
        )
      )}
    </div>
  );
}

function ScopeField({
  label,
  children,
  containerOnly = false,
}: {
  label: string;
  children: React.ReactNode;
  containerOnly?: boolean;
}) {
  const content = (
    <>
      <span className="text-[12px] font-medium text-text-light-gray">{label}</span>
      {children}
    </>
  );
  if (containerOnly) {
    return <div className="flex min-w-0 flex-col gap-1.5">{content}</div>;
  }
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      {content}
    </label>
  );
}

const TimeComp = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentUser = useCurrentUser();
  const currentProject = useRecoilValue(currentProjectAtom);
  const isMbl = useContext(MobileViewContext);
  // The report had no rail, so the only way out was the Back button
  // (HTPR-4715).
  const appShellRailOn = useRecoilValue(appShellRailAtom) && !isMbl;
  const currentUserId = Number.isInteger(Number(currentUser?.id))
    ? Number(currentUser.id)
    : null;
  const boardValues = (searchParams?.getAll("board") ?? [])
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  const task = searchParams?.get("task") || undefined;
  const quickAdd = searchParams?.get("add") === "1";
  const userValues = (searchParams?.getAll("user") ?? [])
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  const from = searchParams?.get("from") || undefined;
  const to = searchParams?.get("to") || undefined;
  const runningValue = searchParams?.get("running")?.toLowerCase();
  const running = runningValue === "1" || runningValue === "true";
  const groupValue = searchParams?.get("group");
  const group: GroupMode = groupValue === "task" || groupValue === "user" ? groupValue : "day";
  const { data: projectsData = [] } = useGetAllProjectsMinimal(["projects-minimal"]);
  const boards = Array.isArray(projectsData) ? (projectsData as MinimalBoard[]) : [];
  // Recomputed when the calendar day rolls over, so a page left open overnight
  // does not keep querying yesterday's "today".
  const todayKey = localDayKey(new Date());
  const ranges = useMemo(
    () => ({
      today: buildRange("today"),
      yesterday: buildRange("yesterday"),
      week: buildRange("week"),
      lastWeek: buildRange("lastWeek"),
      month: buildRange("month"),
      lastMonth: buildRange("lastMonth"),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todayKey]
  );

  const replaceParams = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams?.toString());
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null) next.delete(key);
        else next.set(key, value);
      });
      const query = next.toString();
      router.replace(`/time${query ? `?${query}` : ""}`, { scroll: false });
    },
    [router, searchParams]
  );

  const teams = useMemo(() => {
    const result = new Map<string, { teamId: string; title: string }>();
    boards.forEach((candidate) => {
      if (!candidate.teamId || result.has(candidate.teamId)) return;
      const currentTeamTitle =
        currentProject?.teamId === candidate.teamId ? currentProject.team?.title : undefined;
      result.set(candidate.teamId, {
        teamId: candidate.teamId,
        title: candidate.team?.title ?? currentTeamTitle ?? "Team",
      });
    });
    return [...result.values()];
  }, [boards, currentProject]);

  const boardFromUrl = boards.find((candidate) =>
    boardValues.includes(String(candidate.id))
  );
  const teamFromUrl = searchParams?.get("team") ?? undefined;
  const selectedTeamId =
    teams.find((teamOption) => teamOption.teamId === teamFromUrl)?.teamId ??
    boardFromUrl?.teamId ??
    teams.find((teamOption) => teamOption.teamId === currentProject?.teamId)?.teamId ??
    teams[0]?.teamId ??
    "";
  const boardsForTeam = boards.filter((candidate) => candidate.teamId === selectedTeamId);
  const selectedBoardIds = [
    ...new Set(
      boardValues.filter((value) => {
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed > 0;
      })
    ),
  ];
  const selectedBoard =
    selectedBoardIds.length === 1
      ? boards.find((candidate) => String(candidate.id) === selectedBoardIds[0])
      : undefined;
  const entryBoard = selectedBoardIds.length === 1 ? selectedBoardIds[0] : undefined;
  const teamMembersQuery = useGetAllTeamMembers(
    ["team-members", selectedTeamId],
    selectedTeamId,
    { owner: null, members: [] }
  );
  const members = useMemo(() => {
    const response = teamMembersQuery.data as TeamMembersResponse | undefined;
    const candidates = [
      ...(response?.owner ? [response.owner] : []),
      ...(Array.isArray(response?.members) ? response.members : []),
    ];
    const unique = new Map<number, TeamMember>();
    candidates.forEach((member) => unique.set(member.id, member));
    return [...unique.values()];
  }, [teamMembersQuery.data]);
  const report = useTimeReport({
    team: selectedTeamId || undefined,
    board: selectedBoardIds.length ? selectedBoardIds : undefined,
    task,
    user: userValues.length ? userValues : undefined,
    from,
    to,
    running,
  });
  const entries = report.data ?? [];
  const pauseTimer = usePauseTimer();
  const resumeTimer = useResumeTimer();
  const stopTimer = useStopTimer();
  const createEntry = useCreateTimeEntry();
  const bulkDeleteEntries = useDeleteTimeEntries();
  const now = useTimerNow(
    entries.some((entry) => !entry.endedAt && !entry.pausedAt)
  );

  useEffect(() => {
    if (searchParams?.toString() || !selectedTeamId) return;
    replaceParams({
      team: selectedTeamId,
      board: null,
      user: null,
      from: ranges.week.from,
      to: ranges.week.to,
      group: "day",
    });
  }, [ranges.week.from, ranges.week.to, replaceParams, searchParams, selectedTeamId]);

  useEffect(() => {
    if (report.error) {
      toast.error(report.error.message ?? "Unable to load time entries");
    }
  }, [report.error]);

  const totals = useMemo(() => {
    const perUser = new Map<number, { id: number; name: string; seconds: number }>();
    let total = 0;
    entries.forEach((entry) => {
      const seconds = entrySeconds(entry, now);
      total += seconds;
      const subtotal = perUser.get(entry.userId) ?? {
        id: entry.userId,
        name: entry.userName,
        seconds: 0,
      };
      subtotal.seconds += seconds;
      perUser.set(entry.userId, subtotal);
    });
    return { total, perUser: [...perUser.values()] };
  }, [entries, now]);

  const runningEntries = entries.filter((entry) => !entry.endedAt);
  const completedEntries = entries.filter((entry) => entry.endedAt);
  const groups = useMemo(() => {
    const result = new Map<
      string,
      { key: string; label: string; entries: TimeReportEntry[] }
    >();
    completedEntries.forEach((entry) => {
      const key =
        group === "day"
          ? localDayKey(new Date(entry.startedAt))
          : group === "task"
            ? String(entry.taskId)
            : String(entry.userId);
      const label =
        group === "day"
          ? dayLabel(entry.startedAt)
          : group === "task"
            ? `${ticketLabel(entry)} ${entry.task.title}`
            : entry.userName;
      const existing = result.get(key);
      if (existing) existing.entries.push(entry);
      else result.set(key, { key, label, entries: [entry] });
    });
    return [...result.values()];
  }, [completedEntries, group]);

  const stop = async (taskIdToStop: number) => {
    try {
      await stopTimer.mutateAsync(taskIdToStop);
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to stop timer");
    }
  };

  const pause = async (taskIdToPause: number) => {
    try {
      await pauseTimer.mutateAsync(taskIdToPause);
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to pause timer");
    }
  };

  const resume = async (taskIdToResume: number) => {
    try {
      await resumeTimer.mutateAsync(taskIdToResume);
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to resume timer");
    }
  };

  // Custom is flagged in the URL: deriving it from the dates alone hid the
  // pickers whenever a hand-picked range happened to match a preset.
  const activeRange: RangeMode =
    searchParams?.get("range") === "custom"
      ? "custom"
      : !from && !to
        ? "all"
        : ((Object.keys(ranges) as PresetRange[]).find(
            (preset) => ranges[preset].from === from && ranges[preset].to === to
          ) ?? "custom");
  const selectedUserValues = userValues.map((value) =>
    value === "me" && currentUserId ? String(currentUserId) : value
  );
  const truncated = entries.length >= 1000;

  const [addEntryOpen, setAddEntryOpen] = useState(false);
  const [taskQuery, setTaskQuery] = useState("");
  const [selectedTask, setSelectedTask] = useState<BoardTaskSearchResult | null>(null);
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);
  const quickAddHydrated = useRef<string | null>(null);
  const [entryDate, setEntryDate] = useState(() => localDayKey(new Date()));
  const [entryHours, setEntryHours] = useState("");
  const [entryMinutes, setEntryMinutes] = useState("");
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<number>>(
    () => new Set()
  );
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  // Held here, not in the row: editing an entry re-groups or removes its row,
  // which would unmount the modal mid-edit.
  const [timeLogTask, setTimeLogTask] = useState<{
    taskId: number;
    ticketId: string;
    title: string;
  } | null>(null);
  const taskSearch = useBoardTaskSearch(
    entryBoard,
    taskQuery,
    quickAdd && !selectedTask && !taskQuery ? task : undefined
  );
  const quickAddRequestKey = timeQuickLogRequestKey(
    entryBoard,
    task,
    quickAdd
  );

  useEffect(() => {
    setTaskQuery("");
    setSelectedTask(null);
    setTaskPickerOpen(false);
  }, [entryBoard]);

  useEffect(() => {
    if (!quickAdd) return;
    setAddEntryOpen(true);
  }, [quickAdd]);

  useEffect(() => {
    quickAddHydrated.current = null;
    setSelectedTask(null);
    setTaskQuery("");
    setTaskPickerOpen(false);
  }, [quickAddRequestKey]);

  useEffect(() => {
    if (
      !quickAdd ||
      !shouldHydrateTimeQuickLog(
        quickAddRequestKey,
        quickAddHydrated.current
      )
    ) {
      return;
    }
    const matchingTask = taskSearch.data?.find(
      (candidate) => String(candidate.id) === task
    );
    if (!matchingTask) return;
    quickAddHydrated.current = quickAddRequestKey;
    setSelectedTask(matchingTask);
    setTaskQuery(taskSearchLabel(matchingTask));
    setTaskPickerOpen(false);
  }, [quickAdd, quickAddRequestKey, task, taskSearch.data]);

  useEffect(() => {
    const visibleIds = new Set(entries.map((entry) => entry.id));
    setSelectedEntryIds((previous) => {
      const next = new Set([...previous].filter((id) => visibleIds.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [entries]);

  useEffect(() => {
    if (selectedEntryIds.size === 0) return;
    const clearSelection = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setSelectedEntryIds(new Set());
    };
    document.addEventListener("keydown", clearSelection);
    return () => document.removeEventListener("keydown", clearSelection);
  }, [selectedEntryIds.size]);

  const openTimeLog = (entry: TimeReportEntry) =>
    setTimeLogTask({
      taskId: entry.taskId,
      ticketId: ticketLabel(entry),
      title: entry.task.title,
    });

  const selectEntry = (entryId: number, selected: boolean) => {
    setSelectedEntryIds((previous) => {
      const next = new Set(previous);
      if (selected) next.add(entryId);
      else next.delete(entryId);
      return next;
    });
  };

  const selectEntries = (entryIds: number[], selected: boolean) => {
    setSelectedEntryIds((previous) => {
      const next = new Set(previous);
      entryIds.forEach((entryId) =>
        selected ? next.add(entryId) : next.delete(entryId)
      );
      return next;
    });
  };

  const addEntry = async () => {
    const minutes = hoursMinutesToMinutes(entryHours, entryMinutes);
    if (!selectedTask) {
      toast.error("Pick a task");
      return;
    }
    if (!entryDate) {
      toast.error("Pick a date");
      return;
    }
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      toast.error("Enter a duration from 1 minute to 24 hours");
      return;
    }

    try {
      await createEntry.mutateAsync({
        taskId: selectedTask.id,
        date: entryDate,
        minutes,
        timezoneOffsetMinutes: new Date(`${entryDate}T12:00:00`).getTimezoneOffset(),
      });
      setTaskQuery("");
      setSelectedTask(null);
      setTaskPickerOpen(false);
      setEntryDate(localDayKey(new Date()));
      setEntryHours("");
      setEntryMinutes("");
      toast.success("Time entry added");
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to add time entry");
    }
  };

  const exportCsv = useCallback((exportEntries: TimeReportEntry[] = entries) => {
    if (exportEntries.length === 0) return;

    const rows = exportEntries.map((entry) => {
      const seconds = entrySeconds(entry, now);
      return [
        localDayKey(new Date(entry.startedAt)),
        timeFormatter.format(new Date(entry.startedAt)),
        entry.endedAt ? timeFormatter.format(new Date(entry.endedAt)) : "",
        formatCsvDuration(seconds),
        (seconds / 3600).toFixed(2),
        ticketLabel(entry),
        entry.task.title,
        entry.task.projectName,
        entry.userName,
      ];
    });
    const csv = [
      ["Date", "Start", "End", "Duration", "Hours", "Ticket", "Task", "Board", "User"],
      ...rows,
    ]
      .map((row) => row.map(csvField).join(","))
      .join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const scope = selectedBoard
      ? filenameSlug(selectedBoard.title ?? selectedBoard.name ?? "board")
      : "all-boards";
    link.href = url;
    link.download = `time-${scope}-${localDayKey(new Date())}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [entries, now, selectedBoard]);

  const selectedEntries = entries.filter((entry) =>
    selectedEntryIds.has(entry.id)
  );

  const requestBulkDelete = () => {
    if (
      selectedEntries.some(
        (entry) => entry.userId !== currentUserId && !entry.canManage
      )
    ) {
      toast.error("You can only delete entries you manage");
      return;
    }
    setShowBulkDeleteConfirm(true);
  };

  const deleteSelected = async () => {
    try {
      const results = await bulkDeleteEntries.mutateAsync(
        selectedEntries.map((entry) => ({
          entryId: entry.id,
          taskId: entry.taskId,
        }))
      );
      const deletedIds = new Set(
        results.filter((result) => result.success).map((result) => result.entryId)
      );
      const deleted = deletedIds.size;
      const failed = results.length - deleted;
      setSelectedEntryIds(
        new Set(selectedEntries.map((entry) => entry.id).filter((id) => !deletedIds.has(id)))
      );
      setShowBulkDeleteConfirm(false);
      const message = `Deleted ${deleted}, failed ${failed}`;
      if (failed === 0) toast.success(message);
      else if (deleted > 0) toast(message, { icon: "⚠️" });
      else toast.error(message);
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to delete time entries");
    }
  };

  return (
    <>
      <div className="flex min-h-[100svh] w-full flex-col items-center justify-center overflow-y-auto bg-pageBackground text-white-black">
        <div className="global-view-width relative min-h-[100svh] w-full bg-containerBackground">
      {/* The rail reads currentUser.id unguarded, and this page can render
          before the cookie hook resolves. */}
      {appShellRailOn && currentUser && (
        <AppShellRail variant="global" currentUser={currentUser} />
      )}
      {/* Wrapper div for the rail offset, like all-tasks/archived/calendar:
          a pl-[calc(...)] on <main> itself loses to sm:px-6 in the v4 CSS
          order, and the content slides under the rail. */}
      <div
        className={
          appShellRailOn && currentUser ? "pl-[var(--app-shell-rail-w,48px)]" : ""
        }
      >
      <main
        className="mx-auto flex w-full max-w-4xl flex-col px-4 py-6 sm:px-6 sm:py-8"
      >
        <div className="mb-8 flex items-center justify-between gap-4">
          <button type="button" className={buttonClassName} onClick={() => router.back()}>
            <ArrowLeft size={16} strokeWidth={1.75} />
            Back
          </button>
          <button
            type="button"
            className={buttonClassName}
            disabled={entries.length === 0}
            onClick={() => exportCsv()}
          >
            <Download size={16} strokeWidth={1.75} />
            Export CSV
          </button>
        </div>

        <SettingsSectionShell title="Time reports">
          <div
            className={timeReportSurfaceClassName}
            data-time-report-surface="scope"
          >
            <SettingsCard title="Scope">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
              <ScopeField label="Team">
                <select
                  className={selectClassName}
                  value={selectedTeamId}
                  onChange={(event) =>
                    replaceParams({
                      team: event.target.value,
                      board: null,
                      task: null,
                      add: null,
                    })
                  }
                >
                  {teams.map((teamOption) => (
                    <option key={teamOption.teamId} value={teamOption.teamId}>
                      {teamOption.title}
                    </option>
                  ))}
                </select>
              </ScopeField>
              <ScopeField label="Board" containerOnly>
                <MultiSelectDropdown
                  ariaLabel="Filter by board"
                  options={boardsForTeam.map((boardOption) => ({
                    value: String(boardOption.id),
                    label:
                      boardOption.title ??
                      boardOption.name ??
                      `Board ${boardOption.id}`,
                  }))}
                  selected={selectedBoardIds}
                  onChange={(values) =>
                    replaceParams({
                      board: values.length ? values.join(",") : null,
                      task: null,
                      add: null,
                    })
                  }
                />
              </ScopeField>
              <ScopeField label="User" containerOnly>
                <MultiSelectDropdown
                  ariaLabel="Filter by user"
                  options={members.map((member) => ({
                    value: String(member.id),
                    label: memberLabel(member),
                  }))}
                  selected={selectedUserValues}
                  onChange={(values) =>
                    replaceParams({
                      user: values.length ? values.join(",") : null,
                    })
                  }
                />
              </ScopeField>
              <ScopeField label="Date range">
                <select
                  className={selectClassName}
                  value={activeRange}
                  onChange={(event) => {
                    const value = event.target.value as RangeMode;
                    if (value === "all") {
                      replaceParams({ from: null, to: null, range: null });
                      return;
                    }
                    if (value === "custom") {
                      // Seed the pickers with the last 7 days so the report
                      // stays populated while the dates are being chosen.
                      const start = new Date();
                      start.setDate(start.getDate() - 6);
                      replaceParams({
                        from: startOfDayIso(localDayKey(start)),
                        to: endOfDayIso(todayKey),
                        range: "custom",
                      });
                      return;
                    }
                    replaceParams({
                      from: ranges[value].from,
                      to: ranges[value].to,
                      range: null,
                    });
                  }}
                >
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="week">This week</option>
                  <option value="lastWeek">Last week</option>
                  <option value="month">This month</option>
                  <option value="lastMonth">Last month</option>
                  <option value="all">All</option>
                  <option value="custom">Custom range</option>
                </select>
              </ScopeField>
              {activeRange === "custom" && (
                <>
                  <ScopeField label="From">
                    <input
                      type="date"
                      className={inputClassName}
                      value={from ? localDayKey(new Date(from)) : ""}
                      max={to ? localDayKey(new Date(to)) : undefined}
                      onClick={(event) => event.currentTarget.showPicker?.()}
                      onChange={(event) => {
                        if (!event.target.value) {
                          replaceParams({ from: null });
                          return;
                        }
                        const nextFrom = startOfDayIso(event.target.value);
                        replaceParams({
                          from: nextFrom,
                          // A typed date bypasses the picker's min/max, and
                          // from > to silently returns nothing.
                          ...(to && nextFrom > to
                            ? { to: endOfDayIso(event.target.value) }
                            : {}),
                        });
                      }}
                    />
                  </ScopeField>
                  <ScopeField label="To">
                    <input
                      type="date"
                      className={inputClassName}
                      value={to ? localDayKey(new Date(to)) : ""}
                      min={from ? localDayKey(new Date(from)) : undefined}
                      onClick={(event) => event.currentTarget.showPicker?.()}
                      onChange={(event) => {
                        if (!event.target.value) {
                          replaceParams({ to: null });
                          return;
                        }
                        const nextTo = endOfDayIso(event.target.value);
                        replaceParams({
                          to: nextTo,
                          ...(from && nextTo < from
                            ? { from: startOfDayIso(event.target.value) }
                            : {}),
                        });
                      }}
                    />
                  </ScopeField>
                </>
              )}
              <ScopeField label="Timers">
                <select
                  className={selectClassName}
                  value={running ? "running" : "all"}
                  onChange={(event) =>
                    replaceParams({
                      running: event.target.value === "running" ? "1" : null,
                    })
                  }
                >
                  <option value="all">All</option>
                  <option value="running">Running only</option>
                </select>
              </ScopeField>
              <ScopeField label="Group by">
                <select
                  className={selectClassName}
                  value={group}
                  onChange={(event) => replaceParams({ group: event.target.value })}
                >
                  <option value="day">Day</option>
                  <option value="task">Task</option>
                  <option value="user">User</option>
                </select>
              </ScopeField>
              </div>
            </SettingsCard>
          </div>

          <div
            className={timeReportSurfaceClassName}
            data-time-report-surface="report"
          >
            <SettingsCard title="Summary">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 py-1 text-[14px]">
              <span className="font-medium tabular-nums">Total {formatElapsed(totals.total)}</span>
              {totals.perUser.map((subtotal) => (
                <span key={subtotal.id} className="text-text-light-gray">
                  {subtotal.name} <span className="tabular-nums">{formatElapsed(subtotal.seconds)}</span>
                </span>
              ))}
              {truncated && (
                <span className="text-text-light-gray">
                  showing latest 1000 · narrow the range for the full total
                </span>
              )}
              </div>
            </SettingsCard>

            <SettingsCard title="Add time entry">
              <div>
              <button
                type="button"
                className={buttonClassName}
                aria-expanded={addEntryOpen}
                onClick={() => setAddEntryOpen((open) => !open)}
              >
                + Add time entry
              </button>
              </div>
              {addEntryOpen && (
              <div className="flex flex-col gap-4 rounded-[5px] bg-containerBackground p-4">
                {!entryBoard && (
                  <p className="text-[14px] text-text-light-gray">
                    {selectedBoardIds.length > 1
                      ? "Pick one board above to add an entry."
                      : "Pick a board above to add an entry."}
                  </p>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <ScopeField label="Task">
                    <input
                      type="text"
                      className={inputClassName}
                      disabled={!entryBoard}
                      value={taskQuery}
                      placeholder="Search tasks"
                      autoComplete="off"
                      onFocus={() => setTaskPickerOpen(true)}
                      onChange={(event) => {
                        setTaskQuery(event.target.value);
                        setSelectedTask(null);
                        setTaskPickerOpen(true);
                      }}
                    />
                    {entryBoard && taskPickerOpen && (
                      <div className="mt-1 max-h-60 overflow-y-auto rounded-[5px] bg-cardBackground py-1 shadow-md">
                        {taskSearch.isLoading && (
                          <p className="px-3 py-2 text-[14px] text-text-light-gray">Loading…</p>
                        )}
                        {!taskSearch.isLoading && (taskSearch.data?.length ?? 0) === 0 && (
                          <p className="px-3 py-2 text-[14px] text-text-light-gray">No tasks found.</p>
                        )}
                        {taskSearch.data?.map((taskOption) => (
                          <button
                            key={taskOption.id}
                            type="button"
                            className="flex w-full px-3 py-2 text-left text-[14px] text-white-black hover:bg-hover-active"
                            onClick={() => {
                              setSelectedTask(taskOption);
                              setTaskQuery(taskSearchLabel(taskOption));
                              setTaskPickerOpen(false);
                            }}
                          >
                            <span className="truncate">{taskSearchLabel(taskOption)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </ScopeField>
                  <ScopeField label="Date">
                    <input
                      type="date"
                      className={inputClassName}
                      disabled={!entryBoard}
                      value={entryDate}
                      onChange={(event) => setEntryDate(event.target.value)}
                      onClick={(event) => event.currentTarget.showPicker?.()}
                    />
                  </ScopeField>
                  <ScopeField label="Hours">
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      step="1"
                      className={inputClassName}
                      disabled={!entryBoard}
                      value={entryHours}
                      placeholder="0"
                      onChange={(event) => setEntryHours(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void addEntry();
                      }}
                    />
                  </ScopeField>
                  <ScopeField label="Minutes">
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max="59"
                      step="1"
                      className={inputClassName}
                      disabled={!entryBoard}
                      value={entryMinutes}
                      placeholder="0"
                      onChange={(event) => setEntryMinutes(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void addEntry();
                      }}
                    />
                  </ScopeField>
                </div>
                <div>
                  <button
                    type="button"
                    className={buttonClassName}
                    disabled={!entryBoard || !selectedTask || createEntry.isPending}
                    onClick={() => void addEntry()}
                  >
                    {createEntry.isPending ? "Adding…" : "Add"}
                  </button>
                </div>
              </div>
              )}
            </SettingsCard>

            <div>
            {selectedEntryIds.size > 0 && (
              <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 bg-containerBackground px-3 py-2 text-[14px] shadow-md">
                <span>{selectedEntryIds.size} selected</span>
                <span className="text-text-light-gray">·</span>
                <button
                  type="button"
                  className="text-text-light-gray hover:text-white-black"
                  onClick={() => exportCsv(selectedEntries)}
                >
                  Export CSV
                </button>
                <span className="text-text-light-gray">·</span>
                <button
                  type="button"
                  className="text-text-light-gray hover:text-white-black"
                  onClick={requestBulkDelete}
                >
                  Delete
                </button>
                <span className="text-text-light-gray">· Esc clears</span>
              </div>
            )}
            {report.isLoading && <p className="text-text-light-gray">Loading…</p>}
            {/* An empty page under a filter you cannot see reads as lost data.
                The running-only filter arrives from the URL (g then t), so name
                it when it is what emptied the report (HTPR-4711). */}
            {!report.isLoading && entries.length === 0 && (
              <p className="text-text-light-gray">
                {running ? (
                  <>
                    No running timers in this scope.{" "}
                    <button
                      type="button"
                      className="underline hover:text-white-black"
                      onClick={() => replaceParams({ running: null })}
                    >
                      Show all time entries
                    </button>
                  </>
                ) : (
                  "No time entries."
                )}
              </p>
            )}

            {runningEntries.length > 0 && (
              <section className="mb-6">
                <h2 className="mb-1 font-medium text-hypertasks-green">Running</h2>
                {runningEntries.map((entry) => (
                  <TimeEntryRow
                    key={entry.id}
                    entry={entry}
                    now={now}
                    currentUserId={currentUserId}
                    onPause={pause}
                    onResume={resume}
                    onStop={stop}
                    isPausing={pauseTimer.isPending}
                    isResuming={resumeTimer.isPending}
                    isStopping={stopTimer.isPending}
                    selected={selectedEntryIds.has(entry.id)}
                    onSelect={selectEntry}
                    onOpenTimeLog={openTimeLog}
                  />
                ))}
              </section>
            )}

            {groups.map((grouped) => (
              <section key={grouped.key} className="mb-6">
                <h2 className="mb-1 flex items-center gap-3 font-medium text-text-light-gray">
                  {group === "day" && (
                    <input
                      type="checkbox"
                      aria-label={`Select all entries for ${grouped.label}`}
                      checked={grouped.entries.every((entry) =>
                        selectedEntryIds.has(entry.id)
                      )}
                      onChange={(event) =>
                        selectEntries(
                          grouped.entries.map((entry) => entry.id),
                          event.target.checked
                        )
                      }
                      className="h-4 w-4 accent-hypertasks-purple"
                    />
                  )}
                  <span>{grouped.label}</span>
                </h2>
                {grouped.entries.map((entry) => (
                  <TimeEntryRow
                    key={entry.id}
                    entry={entry}
                    now={now}
                    currentUserId={currentUserId}
                    hideTask={group === "task"}
                    hideUser={group === "user"}
                    onPause={pause}
                    onResume={resume}
                    onStop={stop}
                    isPausing={pauseTimer.isPending}
                    isResuming={resumeTimer.isPending}
                    isStopping={stopTimer.isPending}
                    selected={selectedEntryIds.has(entry.id)}
                    onSelect={selectEntry}
                    onOpenTimeLog={openTimeLog}
                  />
                ))}
              </section>
            ))}
            </div>
          </div>
        </SettingsSectionShell>
      </main>
      </div>
        </div>
      </div>
      {timeLogTask && (
        <TimeLogModal
          taskId={timeLogTask.taskId}
          ticketId={timeLogTask.ticketId}
          title={timeLogTask.title}
          onClose={() => setTimeLogTask(null)}
        />
      )}
      {showBulkDeleteConfirm && (
        <ConfirmDialog
          id="delete-time-entries-confirm"
          message={`Delete ${selectedEntries.length} selected time ${
            selectedEntries.length === 1 ? "entry" : "entries"
          }?`}
          confirmLabel="Delete"
          loadingLabel="Deleting…"
          loading={bulkDeleteEntries.isPending}
          onConfirm={() => void deleteSelected()}
          onCancel={() => setShowBulkDeleteConfirm(false)}
          footerVerb="delete"
        />
      )}
    </>
  );
};

export default TimeComp;
