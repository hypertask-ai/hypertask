"use client";

import type React from "react";
import { DaySection } from "./task-card";
import { Droppable } from "@hello-pangea/dnd";
import { useCalendarContext } from "@/lib/contexts/Calendar/calendar.context";
import { calendarConfig } from "@/lib/configs/ calendar.config";
import { useRecoilValue } from "@/lib/state";
import { calendarSettingsAtom } from "@/store";

export function MonthView() {
  const {
    weeks,
    currentDay,
    currentTask,
    getTasksForDate,
    handleTaskClick,
    toggleDueDateModal,
    toggleManageTasksModal,
  } = useCalendarContext();
  const calendarSettings = useRecoilValue(calendarSettingsAtom);
  const dayNames =
    calendarSettings.weekStartsOn === "monday"
      ? [
          ...calendarConfig.constants.day_names_full.slice(1),
          calendarConfig.constants.day_names_full[0],
        ]
      : calendarConfig.constants.day_names_full;

  return (
    <div 
      id={calendarConfig.element_ids.month_view} 
      className="flex flex-col flex-1 min-h-full"
    >
      <div className="grid grid-cols-7 border-b border-border bg-muted/30 flex-shrink-0">
        {dayNames.map((day) => (
          <div
            key={day}
            className="sm:p-3 p-1 text-center font-semibold text-content text-muted-foreground border-r border-border last:border-r-0"
          >
            <span className="hidden xl:inline">{day}</span>
            <span className="xl:hidden">{day.slice(0, 3)}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-col flex-1 min-h-full">
        {weeks.map((week, weekIndex) => (
          <div
            key={weekIndex}
            className={`${calendarConfig.ui.week_view.parent_classname()} flex-1`}
            id={calendarConfig.element_ids.week_row(weekIndex)}
          >
            {week.map((day, dayIndex) => (
              <Droppable
                droppableId={calendarConfig.element_ids.day_section(day)}
                key={calendarConfig.element_ids.day_section(day)}
              >
                {(provided, snapshot) => (
                  <DaySection
                    day={day}
                    provided={provided}
                    currentDay={currentDay}
                    currentTask={currentTask}
                    toggleDueDateModal={() => toggleDueDateModal("Create")}
                    toggleManageTasksModal={() => toggleManageTasksModal(day)}
                    view="month"
                    getTasksForDate={getTasksForDate}
                    handleTaskClick={handleTaskClick}
                    dayIndex={dayIndex}
                  />
                )}
              </Droppable>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
