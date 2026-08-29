"use client";

import type React from "react";
import { DaySection } from "./task-card";
import { Droppable } from "@hello-pangea/dnd";
import { useCalendarContext } from "@/lib/contexts/Calendar/calendar.context";
import { useContext } from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { calendarConfig } from "@/lib/configs/ calendar.config";

export function WeekView() {
  const {
    currentDay,
    currentTask,
    currentView,
    weeks,
    getTasksForDate,
    handleTaskClick,
    toggleDueDateModal,
  } = useCalendarContext();
  const isMbl = useContext(MobileViewContext);
  const dayCount = weeks[0].length;


  return (
    <div 
      id={calendarConfig.element_ids.week_view}
      className="flex flex-col flex-1 h-full overflow-hidden"
    >
      {currentView !== "day" && (
        <div
          className={`grid ${dayCount === 1 ? "grid-cols-1" : dayCount === 5 ? "grid-cols-5" : "grid-cols-7"} border-b border-border bg-muted/30 flex-shrink-0`}
        >
          {weeks[0].map((day) => (
            <div
              key={day.toISOString()}
              className="p-1 xl:p-3 text-center border-r border-border last:border-r-0"
            >
              <div className="flex items-center justify-center gap-1.5 font-semibold text-content">
                <span className="hidden xl:inline">
                  {calendarConfig.constants.day_names_full[day.getDay()]}
                </span>
                <span className="xl:hidden">
                  {calendarConfig.constants.day_names[day.getDay()]}
                </span>
                {getTasksForDate(day).length > 0 && (
                  <span className="text-meta font-medium text-text-light-gray">
                    {getTasksForDate(day).length}{" "}
                    {getTasksForDate(day).length === 1 ? "task" : "tasks"}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div
        className={`${calendarConfig.ui.week_view.parent_classname(dayCount)} flex-1 h-full`}
        id={calendarConfig.element_ids.week_row(0)}
      >
        {weeks[0].map((day, dayIndex) => (
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
                view={currentView === "day" ? "day" : "week"}
                getTasksForDate={getTasksForDate}
                handleTaskClick={handleTaskClick}
                dayIndex={dayIndex}
              />
            )}
          </Droppable>
        ))}
      </div>
    </div>
  );
}
