"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays, isSameDay, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ITask } from "@/models/model";
import { Calendar as CalendarCommon } from "@/components/Common/Calendar";
import { useCalendarContext } from "@/lib/contexts/Calendar/calendar.context";
import {
  calendarSettingsAtom,
  currentUserAtom,
  mobileTopBarTitleAtom,
} from "@/store";
import { useRecoilValue, useSetRecoilState } from "@/lib/state";
import { calendarConfig } from "@/lib/configs/ calendar.config";
import { cn } from "@/utils/undoActions/helperFuncs";
import KanbanTaskCard from "@/components/PageComponents/Kanban/KanbanTaskComponents/KanbanTaskCard";
import { useGetUserDrafts } from "@/hooks/General/useGetUserDrafts";
import CalendarSplitsRow from "./CalendarSplitsRow";
import { splitAssignees } from "@/lib/assignees";

const WeekStrip = () => {
  const { currentDate, currentDay, handleDateSelect, getTasksForDate } =
    useCalendarContext();
  const calendarSettings = useRecoilValue(calendarSettingsAtom);
  const [monthOpen, setMonthOpen] = useState(false);
  // react-day-picker's defaultMonth only applies on mount, so with the expander
  // open the picker kept showing its old month while day/week navigation moved
  // the calendar on (HTPR-4761). Controlled month + follow currentDate.
  const [pickerMonth, setPickerMonth] = useState(currentDate);
  useEffect(() => setPickerMonth(currentDate), [currentDate]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate, {
      weekStartsOn: calendarSettings.weekStartsOn === "monday" ? 1 : 0,
    });
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    return calendarSettings.showWeekends
      ? days
      : days.filter((date) => date.getDay() !== 0 && date.getDay() !== 6);
  }, [currentDate, calendarSettings]);

  const shiftWeek = (deltaDays: number) =>
    handleDateSelect(addDays(currentDate, deltaDays));

  return (
    <div className="flex-none border-b border-border-light-gray-thin bg-containerBackground">
      {monthOpen ? (
        <div className="flex justify-center pb-2">
          <CalendarCommon
            initialFocus={false}
            mode="single"
            month={pickerMonth}
            onMonthChange={setPickerMonth}
            selected={currentDay}
            onSelect={(date) => {
              handleDateSelect(date);
              setMonthOpen(false);
            }}
            numberOfMonths={1}
          />
        </div>
      ) : (
        <div className="flex items-center">
          <button
            type="button"
            aria-label="Previous week"
            onClick={() => shiftWeek(-7)}
            className="flex h-11 w-11 shrink-0 items-center justify-center text-text-light-gray"
          >
            <ChevronLeft size={18} strokeWidth={1.75} />
          </button>

          <div className="min-w-0 flex-1">
            <div
              className={cn(
                "mb-[6px] grid",
                calendarSettings.showWeekends ? "grid-cols-7" : "grid-cols-5",
              )}
            >
              {weekDays.map((day) => (
                <span
                  key={`label-${day.toISOString()}`}
                  className="text-center text-micro text-text-light-gray"
                >
                  {calendarConfig.constants.day_names[day.getDay()].slice(0, 3)}
                </span>
              ))}
            </div>
            <div
              className={cn(
                "grid",
                calendarSettings.showWeekends ? "grid-cols-7" : "grid-cols-5",
              )}
            >
              {weekDays.map((day) => {
                const selected = isSameDay(day, currentDay);
                const load = getTasksForDate(day).length;
                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => handleDateSelect(day)}
                    className="flex min-h-[44px] min-w-0 flex-col items-center justify-center gap-[3px]"
                  >
                    <span
                      className={cn(
                        "flex h-[30px] w-[30px] items-center justify-center rounded-[5px] text-dense font-semibold",
                        selected
                          ? "bg-[#2383E2] text-white"
                          : "text-white-black",
                      )}
                    >
                      {day.getDate()}
                    </span>
                    {/* Load dots: capped at three, so a busy day reads at a glance. */}
                    <span className="flex h-1 gap-[2px]">
                      {Array.from({ length: Math.min(load, 3) }, (_, i) => (
                        <span
                          key={i}
                          className={cn(
                            "block h-1 w-1 rounded-full",
                            selected ? "bg-[#51A4F1]" : "bg-text-light-gray",
                          )}
                        />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            aria-label="Next week"
            onClick={() => shiftWeek(7)}
            className="flex h-11 w-11 shrink-0 items-center justify-center text-text-light-gray"
          >
            <ChevronRight size={18} strokeWidth={1.75} />
          </button>
        </div>
      )}

      {/* Grab handle: pull down for the month grid. */}
      <button
        type="button"
        aria-label={monthOpen ? "Collapse month" : "Expand month"}
        aria-expanded={monthOpen}
        onClick={() => setMonthOpen((open) => !open)}
        className="flex h-11 w-full items-center justify-center"
      >
        <span className="h-1 w-9 rounded-[4px] bg-label-span" />
      </button>
    </div>
  );
};

const AgendaRow = ({
  task,
  project,
  hasDraft,
  onOpen,
}: {
  task: ITask;
  project: ITask["project"];
  hasDraft: boolean;
  onOpen: () => void;
}) => {
  const openFromCardControl = () => onOpen();
  const { humanAssignees, agentAssignees } = splitAssignees(task.assignees);

  return (
    <KanbanTaskCard
      task={task}
      project={project}
      currentSetting="None"
      assignedUsers={humanAssignees}
      agentAssignees={agentAssignees}
      active={false}
      hover={false}
      hasDraft={hasDraft}
      openDetail={onOpen}
      updateActiveItemAndItemInView={() => {}}
      setShowAssignModal={openFromCardControl}
      setShowEstimateModal={openFromCardControl}
      setShowPriorityModal={openFromCardControl}
      setShowCreateLabelModal={openFromCardControl}
      toggleDueDate={openFromCardControl}
      toggleDelete={openFromCardControl}
      markTaskAsDone={openFromCardControl}
      archiveNotificationCallback={openFromCardControl}
      handleStarTask={openFromCardControl}
      eHandler={openFromCardControl}
      onParentTaskClick={openFromCardControl}
      onSubtaskClick={openFromCardControl}
    />
  );
};

const Agenda = () => {
  const { currentDay, getTasksForDate, handleTaskClick } = useCalendarContext();
  const currentUser = useRecoilValue(currentUserAtom);
  const { draftTaskIds } = useGetUserDrafts(currentUser?.id);
  const tasksForSelectedDay = getTasksForDate(currentDay);

  if (tasksForSelectedDay.length === 0)
    return (
      <p className="px-4 py-10 text-center text-content text-text-light-gray">
        Nothing scheduled for this day.
      </p>
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-1 overflow-y-auto px-[14px] pb-[14px] pt-1">
      {tasksForSelectedDay.map((task) => (
        <AgendaRow
          key={task.id}
          task={task}
          project={task.project}
          hasDraft={draftTaskIds.has(task.id)}
          onOpen={() => handleTaskClick(new Date(task.dueDate as Date), task)}
        />
      ))}
    </div>
  );
};

/** Publishes the scrolled-to month as the shell top bar title. */
const usePublishMonth = () => {
  const { currentDate } = useCalendarContext();
  const setTitle = useSetRecoilState(mobileTopBarTitleAtom);
  useEffect(() => {
    setTitle(calendarConfig.constants.month_names[currentDate.getMonth()]);
    return () => setTitle(null);
  }, [currentDate, setTitle]);
};

const MobileCalendar = () => {
  usePublishMonth();
  return (
    // Top-bar and dock spacing come from the shell wrapper, not from here. The
    // mobile-calendar class is what globals.scss bounds so only the agenda
    // scrolls and the week strip stays put. Board filtering is the header's
    // checkbox sheet (calendarBoardsSidebarOpenAtom), same as desktop.
    <div className="mobile-calendar flex min-h-0 flex-col bg-containerBackground">
      <CalendarSplitsRow mobile />
      <WeekStrip />
      <Agenda />
    </div>
  );
};

export default MobileCalendar;
