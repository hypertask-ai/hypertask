"use client";

import {
  ModalContainerCustom,
  ModalHeaderComp,
} from "@/components/Common/CommonModalComponents";
import MultiSelectDropdown from "@/components/TimeTracking/MultiSelectDropdown";
import useCurrentUser from "@/hooks/General/useCurrentUserCheckFromCookies";
import { useGetAllMembersForAssign } from "@/hooks/MultiPages/useGetMembersForAssignees";
import { useGetSingleTask } from "@/hooks/MultiPages/Tasks/useGetTask";
import {
  TaskTimeEntry,
  useCreateTimeEntry,
  useDeleteTimeEntry,
  useTaskTimeEntries,
  useTimerNow,
  useUpdateTimeEntry,
} from "@/hooks/Task Detail/useTimeTracking";
import { formatElapsed, hoursMinutesToMinutes } from "@/lib/timeDuration";
import { IUser } from "@/models/model";
import { Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { ModalBody } from "reactstrap";

type DateRange = "today" | "week" | "month" | "all";

const dateInputClassName =
  "h-9 border-x-0 border-t-0 border-b border-border bg-transparent px-1 text-dense text-white-black outline-none dark:[&::-webkit-calendar-picker-indicator]:invert";

// No shared "no spinner" utility exists in the design system; local to this
// modal per the wireframe (https://hypertask.app/explorations/za7nkf3).
const noSpinnerClassName =
  "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";
const durationInputClassName = `${dateInputClassName} w-10 text-right ${noSpinnerClassName}`;
const noteTextareaClassName =
  "mt-2 min-h-[84px] w-full resize-y rounded-[4px] bg-comment-description px-3 py-2.5 text-dense text-white-black outline-none placeholder:text-text-light-gray";

const focusableElementSelector =
  "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

const dayFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "short",
});

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function localDayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function rangeBounds(range: DateRange) {
  if (range === "all") return null;
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  if (range === "week") {
    from.setDate(from.getDate() - ((from.getDay() + 6) % 7));
    to.setTime(from.getTime());
    to.setDate(to.getDate() + 6);
  } else if (range === "month") {
    from.setDate(1);
    to.setFullYear(from.getFullYear(), from.getMonth() + 1, 0);
  }
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

function entrySeconds(entry: TaskTimeEntry, now: number) {
  return entry.endedAt || entry.pausedAt
    ? entry.seconds
    : Math.max(0, Math.floor((now - new Date(entry.startedAt).getTime()) / 1000));
}

function isManualEntry(entry: TaskTimeEntry) {
  return (
    Math.abs(
      new Date(entry.createdAt).getTime() - new Date(entry.startedAt).getTime()
    ) > 1000
  );
}

const TimeLogModal = ({
  taskId,
  ticketId,
  title,
  onClose,
}: {
  taskId: number;
  ticketId: string;
  title: string;
  onClose: () => void;
}) => {
  const currentUser = useCurrentUser();
  const currentUserId = Number.isInteger(Number(currentUser?.id))
    ? Number(currentUser.id)
    : null;
  const entriesQuery = useTaskTimeEntries(taskId, true);
  const entries = Array.isArray(entriesQuery.data) ? entriesQuery.data : [];
  const { data: task } = useGetSingleTask(taskId);
  const projectId = task?.projectId ?? 0;
  const { data: membersAndOwner } = useGetAllMembersForAssign(
    ["assign", projectId],
    projectId
  );
  const now = useTimerNow(
    entries.some((entry) => !entry.endedAt && !entry.pausedAt)
  );
  const createEntry = useCreateTimeEntry();
  const updateEntry = useUpdateTimeEntry(taskId);
  const deleteEntry = useDeleteTimeEntry(taskId);
  const [dateRange, setDateRange] = useState<DateRange>("month");
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [entryDate, setEntryDate] = useState(() => localDayKey(new Date()));
  const [entryHours, setEntryHours] = useState("");
  const [entryMinutes, setEntryMinutes] = useState("");
  const [entryNote, setEntryNote] = useState("");
  const [editingEntryId, setEditingEntryId] = useState<number | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editHours, setEditHours] = useState("");
  const [editMinutes, setEditMinutes] = useState("");
  const [editNote, setEditNote] = useState("");
  const entryHoursInputRef = useRef<HTMLInputElement>(null);

  const userOptions = useMemo(() => {
    const users = new Map<number, string>();
    membersAndOwner?.members?.forEach(({ user }: { user: IUser }) =>
      users.set(user.id, user.displayName ?? user.email ?? `User ${user.id}`)
    );
    const owner: IUser | undefined = membersAndOwner?.owner;
    if (owner)
      users.set(owner.id, owner.displayName ?? owner.email ?? `User ${owner.id}`);
    return [...users].map(([id, name]) => ({ value: String(id), label: name }));
  }, [membersAndOwner]);

  const filteredEntries = useMemo(() => {
    const range = rangeBounds(dateRange);
    const selectedUserIds = new Set(selectedUsers.map(Number));
    return entries.filter(
      (entry) =>
        (!range ||
          (new Date(entry.startedAt) >= range.from &&
            new Date(entry.startedAt) <= range.to)) &&
        (selectedUserIds.size === 0 || selectedUserIds.has(entry.userId))
    );
  }, [dateRange, entries, selectedUsers]);

  const groups = useMemo(() => {
    const grouped = new Map<string, TaskTimeEntry[]>();
    filteredEntries.forEach((entry) => {
      const key = localDayKey(new Date(entry.startedAt));
      grouped.set(key, [...(grouped.get(key) ?? []), entry]);
    });
    return [...grouped].map(([key, dayEntries]) => ({
      key,
      entries: dayEntries,
      total: dayEntries.reduce((sum, entry) => sum + entrySeconds(entry, now), 0),
    }));
  }, [filteredEntries, now]);

  const total = filteredEntries.reduce(
    (sum, entry) => sum + entrySeconds(entry, now),
    0
  );

  const addEntry = async () => {
    const minutes = hoursMinutesToMinutes(entryHours, entryMinutes);
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
        taskId,
        date: entryDate,
        minutes,
        timezoneOffsetMinutes: new Date(`${entryDate}T12:00:00`).getTimezoneOffset(),
        note: entryNote,
      });
      setEntryHours("");
      setEntryMinutes("");
      setEntryNote("");
      toast.success("Time entry added");
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to add time entry");
    }
  };

  const removeEntry = async (entryId: number) => {
    try {
      await deleteEntry.mutateAsync(entryId);
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to delete time entry");
    }
  };

  const startEditing = (entry: TaskTimeEntry) => {
    const minutes = Math.max(1, Math.round(entry.seconds / 60));
    setEditingEntryId(entry.id);
    setEditDate(localDayKey(new Date(entry.startedAt)));
    setEditHours(String(Math.floor(minutes / 60)));
    setEditMinutes(String(minutes % 60));
    setEditNote(entry.note ?? "");
  };

  const cancelEditing = () => {
    setEditingEntryId(null);
    setEditDate("");
    setEditHours("");
    setEditMinutes("");
    setEditNote("");
  };

  const saveEntry = async (entry: TaskTimeEntry) => {
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
        note: editNote,
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
      toast.success("Time entry updated");
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to edit time entry");
    }
  };

  const handleModalKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();

      const focusableElements = Array.from(
        event.currentTarget.querySelectorAll<HTMLElement>(focusableElementSelector)
      ).filter((element) => element.offsetParent !== null);
      if (focusableElements.length === 0) return;

      const currentIndex = focusableElements.indexOf(
        document.activeElement as HTMLElement
      );
      const nextIndex =
        currentIndex === -1
          ? event.shiftKey
            ? focusableElements.length - 1
            : 0
          : (currentIndex + (event.shiftKey ? -1 : 1) +
              focusableElements.length) %
            focusableElements.length;
      focusableElements[nextIndex].focus();
      return;
    }

    if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    event.stopPropagation();

    const editingEntry = filteredEntries.find(
      (entry) => entry.id === editingEntryId
    );
    if (editingEntry) {
      if (!updateEntry.isPending) void saveEntry(editingEntry);
    } else if (!createEntry.isPending) {
      void addEntry();
    }
  };

  return (
    <ModalContainerCustom
      fade={false}
      show={true}
      isOpen={true}
      id="task-time-log-modal"
      onOpened={() => entryHoursInputRef.current?.focus()}
      toggle={onClose}
      trapFocus={true}
      shouldCloseOnClickOutside={true}
      scrollable={false}
      className="sm:min-w-[680px] sm:top-[7.5vh]"
      contentClassName="h-[85vh] overflow-hidden rounded-[5px] border-0 bg-modalBackground"
      onKeyDownCapture={handleModalKeyDown}
    >
      {/* Bootstrap's .modal-title ships 1.25rem and the long ticket title wraps
          into the filter row below; force the app's 16px + one-line truncate. */}
      <ModalHeaderComp
        header={`Time log — ${ticketId} | ${title}`}
        className="px-4"
        headerClassName="min-w-0 max-w-full overflow-hidden [&>div]:min-w-0 [&>div]:overflow-hidden [&_.modal-title]:block [&_.modal-title]:min-w-0 [&_.modal-title]:truncate [&_.modal-title]:text-emphasis"
      />
      <ModalBody className="flex min-h-0 flex-1 flex-col p-0">
        <div className="flex flex-wrap items-end gap-4 border-b border-light-black-border-1 px-4 pb-4">
          <div className="mr-auto">
            <p className="text-micro text-text-light-gray">Total tracked</p>
            <p className="mt-1 text-emphasis font-medium tabular-nums">
              {formatElapsed(total)}
            </p>
          </div>
          <div className="flex min-w-40 flex-col gap-1">
            <span className="text-micro font-medium text-text-light-gray">
              Assignee
            </span>
            <MultiSelectDropdown
              ariaLabel="Filter time entries by assignee"
              options={userOptions}
              selected={selectedUsers}
              onChange={setSelectedUsers}
            />
          </div>
          <label className="flex min-w-36 flex-col gap-1">
            <span className="text-micro font-medium text-text-light-gray">
              Date range
            </span>
            <select
              className="h-9 border-x-0 border-t-0 border-b border-border bg-containerBackground px-3 text-dense text-white-black outline-none"
              value={dateRange}
              onChange={(event) => setDateRange(event.target.value as DateRange)}
            >
              <option value="today">Today</option>
              <option value="week">This week</option>
              <option value="month">This month</option>
              <option value="all">All</option>
            </select>
          </label>
          <Link
            className="text-micro text-text-light-gray hover:text-white-black"
            href={
              projectId
                ? `/time?board=${projectId}&task=${taskId}`
                : `/time?task=${taskId}`
            }
          >
            See all time entries
          </Link>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          {entriesQuery.isLoading && (
            <p className="py-4 text-dense text-text-light-gray">Loading…</p>
          )}
          {!entriesQuery.isLoading && groups.length === 0 && (
            <p className="py-4 text-dense text-text-light-gray">No time entries.</p>
          )}
          {groups.map((group) => (
            <section key={group.key} className="py-2">
              <h3 className="flex items-center justify-between py-2 text-dense font-medium text-text-light-gray">
                <span>{dayFormatter.format(new Date(`${group.key}T12:00:00`))}</span>
                <span className="tabular-nums">{formatElapsed(group.total)}</span>
              </h3>
              {group.entries.map((entry) => {
                const seconds = entrySeconds(entry, now);
                const canManageEntry =
                  entry.userId === currentUserId || entriesQuery.canManage;
                const isEditing = editingEntryId === entry.id;
                return (
                  <div
                    key={entry.id}
                    className={
                      isEditing
                        ? "border-b border-light-black-border-1 py-2 text-dense"
                        : "group flex min-h-10 items-center gap-3 border-b border-light-black-border-1 py-2 text-dense"
                    }
                  >
                    {isEditing ? (
                      <>
                        <div className="flex items-center gap-3">
                          <span className="min-w-0 flex-1 truncate">
                            {entry.userName}
                          </span>
                          <input
                            aria-label="Date for time entry"
                            className={`${dateInputClassName} w-32 shrink-0`}
                            onChange={(event) => setEditDate(event.target.value)}
                            onClick={(event) => event.currentTarget.showPicker?.()}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") void saveEntry(entry);
                              if (event.key === "Escape") cancelEditing();
                            }}
                            type="date"
                            value={editDate}
                          />
                          <div className="flex shrink-0 items-center gap-1">
                            <input
                              autoFocus
                              aria-label="Hours for time entry"
                              className={durationInputClassName}
                              min="0"
                              onChange={(event) => setEditHours(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") void saveEntry(entry);
                                if (event.key === "Escape") cancelEditing();
                              }}
                              placeholder="0"
                              step="1"
                              type="number"
                              value={editHours}
                            />
                            <span className="text-micro text-text-light-gray">h</span>
                            <input
                              aria-label="Minutes for time entry"
                              className={durationInputClassName}
                              max="59"
                              min="0"
                              onChange={(event) => setEditMinutes(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") void saveEntry(entry);
                                if (event.key === "Escape") cancelEditing();
                              }}
                              placeholder="0"
                              step="1"
                              type="number"
                              value={editMinutes}
                            />
                            <span className="text-micro text-text-light-gray">m</span>
                          </div>
                        </div>
                        <textarea
                          aria-label="Note for time entry"
                          className={noteTextareaClassName}
                          maxLength={500}
                          onChange={(event) => setEditNote(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") cancelEditing();
                          }}
                          placeholder="What did you do? (optional)"
                          value={editNote}
                        />
                        <div className="mt-2 flex justify-end gap-2">
                          <button
                            className="text-text-light-gray hover:text-white-black"
                            disabled={updateEntry.isPending}
                            onClick={() => void saveEntry(entry)}
                            type="button"
                          >
                            Save
                          </button>
                          <button
                            className="text-text-light-gray hover:text-white-black"
                            onClick={cancelEditing}
                            type="button"
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 truncate">
                          {entry.userName}
                        </span>
                        {entry.note && (
                          <span
                            className="min-w-0 flex-1 truncate text-text-light-gray"
                            title={entry.note}
                          >
                            {entry.note}
                          </span>
                        )}
                        <span className="shrink-0 text-text-light-gray">
                          {isManualEntry(entry)
                            ? "manual"
                            : `${timeFormatter.format(new Date(entry.startedAt))} – ${
                                entry.endedAt
                                  ? timeFormatter.format(new Date(entry.endedAt))
                                  : entry.pausedAt
                                    ? "Paused"
                                    : "Now"
                              }`}
                        </span>
                        <span className="w-20 shrink-0 text-right tabular-nums">
                          {formatElapsed(seconds)}
                        </span>
                        {canManageEntry && (
                          <div className="flex items-center gap-2 text-text-light-gray transition sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                            {entry.endedAt && (
                              <button
                                aria-label={`Edit ${formatElapsed(seconds)} entry by ${entry.userName}`}
                                className="transition hover:text-white-black"
                                onClick={() => startEditing(entry)}
                                type="button"
                              >
                                <Pencil size={14} strokeWidth={1.75} />
                              </button>
                            )}
                            <button
                              aria-label={`Delete ${formatElapsed(seconds)} entry by ${entry.userName}`}
                              className="transition hover:text-white-black"
                              disabled={deleteEntry.isPending}
                              onClick={() => void removeEntry(entry.id)}
                              type="button"
                            >
                              <Trash2 size={14} strokeWidth={1.75} />
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </div>

        <div className="border-t border-light-black-border-1 px-4 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-36 flex-1 flex-col gap-1">
              <span className="text-micro font-medium text-text-light-gray">Date</span>
              <input
                type="date"
                value={entryDate}
                onChange={(event) => setEntryDate(event.target.value)}
                onClick={(event) => event.currentTarget.showPicker?.()}
                className={dateInputClassName}
              />
            </label>
            <div className="flex flex-col gap-1">
              <span className="text-micro font-medium text-text-light-gray">
                Duration
              </span>
              <div className="flex items-center gap-1">
                <input
                  ref={entryHoursInputRef}
                  aria-label="Hours"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  value={entryHours}
                  onChange={(event) => setEntryHours(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !createEntry.isPending)
                      void addEntry();
                  }}
                  placeholder="0"
                  className={durationInputClassName}
                />
                <span className="text-micro text-text-light-gray">h</span>
                <input
                  aria-label="Minutes"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="59"
                  step="1"
                  value={entryMinutes}
                  onChange={(event) => setEntryMinutes(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !createEntry.isPending)
                      void addEntry();
                  }}
                  placeholder="0"
                  className={durationInputClassName}
                />
                <span className="text-micro text-text-light-gray">m</span>
              </div>
            </div>
          </div>
          <textarea
            aria-label="Note for time entry"
            value={entryNote}
            maxLength={500}
            onChange={(event) => setEntryNote(event.target.value)}
            placeholder="What did you do? (optional)"
            className={noteTextareaClassName}
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              disabled={createEntry.isPending}
              onClick={() => void addEntry()}
              className="h-9 px-3 text-dense font-medium text-white-black hover:bg-hover-active disabled:cursor-not-allowed disabled:opacity-50"
            >
              {createEntry.isPending ? "Adding…" : "Add"}
            </button>
          </div>
        </div>
      </ModalBody>
    </ModalContainerCustom>
  );
};

export default TimeLogModal;
