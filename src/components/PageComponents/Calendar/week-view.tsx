"use client";

import { useContext, useMemo } from "react";
import { Draggable, Droppable } from "@hello-pangea/dnd";
import { DaySection } from "./task-card";
import { useCalendarContext } from "@/lib/contexts/Calendar/calendar.context";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { calendarConfig } from "@/lib/configs/ calendar.config";
import { buildWeekTaskBars } from "@/lib/calendarSync/weekLayout";

const dateLabel = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

const gridColumnsClass = (dayCount: number) => {
  if (dayCount === 1) return "grid-cols-1";
  if (dayCount === 5) return "grid-cols-5";
  return "grid-cols-7";
};

export function WeekView() {
  const {
    currentDay,
    currentTask,
    currentView,
    weeks,
    tasks,
    getTasksForDate,
    handleTaskClick,
    setCurrentDay,
    setCurrentTask,
    toggleDueDateModal,
  } = useCalendarContext();
  const isMbl = useContext(MobileViewContext);
  const visibleDays = weeks[0] ?? [];
  const dayCount = visibleDays.length;
  const bars = useMemo(
    () =>
      currentView === "week" && !isMbl
        ? buildWeekTaskBars(visibleDays, tasks)
        : [],
    [currentView, isMbl, tasks, visibleDays],
  );
  const barTaskIds = useMemo(
    () => new Set(bars.map((bar) => bar.task.id)),
    [bars],
  );

  return (
    <div
      id={calendarConfig.element_ids.week_view}
      className="flex h-full flex-1 flex-col overflow-hidden"
    >
      {currentView !== "day" && (
        <div
          className={`grid ${gridColumnsClass(dayCount)} flex-shrink-0 border-b border-border bg-muted/30`}
        >
          {visibleDays.map((day, dayIndex) => {
            const dueTasks = getTasksForDate(day).filter(
              (task) => !barTaskIds.has(task.id),
            ).length;
            const rangeTasks = bars.filter(
              (bar) =>
                bar.startColumn <= dayIndex && bar.endColumn >= dayIndex,
            ).length;
            const taskCount = dueTasks + rangeTasks;
            return (
              <div
                key={day.toISOString()}
                className="border-r border-border p-1 text-center last:border-r-0 xl:p-3"
              >
                <div className="flex items-center justify-center gap-1.5 font-semibold text-content">
                  <span className="hidden xl:inline">
                    {calendarConfig.constants.day_names_full[day.getDay()]}
                  </span>
                  <span className="xl:hidden">
                    {calendarConfig.constants.day_names[day.getDay()]}
                  </span>
                  {taskCount > 0 && (
                    <span className="font-medium text-meta text-text-light-gray">
                      {taskCount} {taskCount === 1 ? "task" : "tasks"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {bars.length > 0 && (
        <Droppable
          droppableId={calendarConfig.element_ids.week_timeframes}
          isDropDisabled
        >
          {(dropProvided) => (
            <div
              ref={dropProvided.innerRef}
              {...dropProvided.droppableProps}
              id={calendarConfig.element_ids.week_timeframes}
              className={`grid ${gridColumnsClass(dayCount)} max-h-[40%] flex-shrink-0 gap-y-1 overflow-y-auto border-b border-border bg-muted/30 py-2 scrollbar-thin`}
              aria-label="Task timeframes"
            >
              {bars.map((bar, index) => {
                const selected = currentTask === bar.task.id;
                const visibleDueDay = visibleDays[bar.endColumn];
                const start = dateLabel.format(bar.startDate);
                const due = dateLabel.format(bar.dueDate);
                return (
                  <Draggable
                    key={bar.task.id}
                    draggableId={calendarConfig.element_ids.task_card(bar.task.id)}
                    index={index}
                  >
                    {(dragProvided) => (
                      <button
                        ref={dragProvided.innerRef}
                        {...dragProvided.draggableProps}
                        {...dragProvided.dragHandleProps}
                        id={calendarConfig.element_ids.task_card(bar.task.id)}
                        type="button"
                        aria-label={`${bar.task.ticketNumber ?? "Task"} ${bar.task.title}, ${start} to ${due}`}
                        onFocus={() => {
                          setCurrentTask(bar.task.id);
                          setCurrentDay(visibleDueDay);
                        }}
                        onClick={() => {
                          setCurrentTask(bar.task.id);
                          setCurrentDay(visibleDueDay);
                          handleTaskClick(bar.dueDate, bar.task);
                        }}
                        style={{
                          ...dragProvided.draggableProps.style,
                          gridColumn: `${bar.startColumn + 1} / ${bar.endColumn + 2}`,
                          gridRow: bar.lane + 1,
                        }}
                        className={`mx-1 flex min-w-0 items-center gap-2 px-2 py-1 text-left shadow-sm outline-none ${
                          bar.continuesBefore ? "rounded-l-none" : "rounded-l-[5px]"
                        } ${bar.continuesAfter ? "rounded-r-none" : "rounded-r-[5px] border-r-2 border-hypertasks-purple"} ${
                          selected
                            ? "bg-active-elementBg"
                            : "bg-cardBackground hover:bg-hoverCardBackground"
                        }`}
                      >
                        <span className="shrink-0 text-micro font-medium text-text-light-gray">
                          {bar.continuesBefore ? "← " : ""}
                          {start}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-dense text-white-black">
                          <span className="mr-1 font-medium text-text-light-gray">
                            {bar.task.ticketNumber}
                          </span>
                          {bar.task.title}
                        </span>
                        <span className="shrink-0 text-micro font-medium text-text-light-gray">
                          {due}
                          {bar.continuesAfter ? " →" : ""}
                        </span>
                      </button>
                    )}
                  </Draggable>
                );
              })}
              {dropProvided.placeholder}
            </div>
          )}
        </Droppable>
      )}

      <div
        className={`${calendarConfig.ui.week_view.parent_classname(dayCount)} flex-1`}
        id={calendarConfig.element_ids.week_row(0)}
      >
        {visibleDays.map((day, dayIndex) => (
          <Droppable
            droppableId={calendarConfig.element_ids.day_section(day)}
            key={calendarConfig.element_ids.day_section(day)}
          >
            {(provided) => (
              <DaySection
                day={day}
                provided={provided}
                currentDay={currentDay}
                currentTask={currentTask}
                toggleDueDateModal={() => toggleDueDateModal("Create")}
                view={currentView === "day" ? "day" : "week"}
                getTasksForDate={getTasksForDate}
                handleTaskClick={handleTaskClick}
                dayIndex={dayIndex}
                excludedTaskIds={barTaskIds}
              />
            )}
          </Droppable>
        ))}
      </div>
    </div>
  );
}
