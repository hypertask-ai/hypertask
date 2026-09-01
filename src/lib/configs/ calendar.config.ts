export const calendarConfig = {
  element_ids: {
    sidebar: "calendar-sidebar",
    projects_section: "projects-section",
    month_view: "calendar-month-view",
    week_view: "calendar-week-view",
    week_timeframes: "calendar-week-timeframes",
    week_row: (weekIndex: number) => `week-${weekIndex}`,
    day_section: (day: Date) => `day-${day.toISOString()}`,
    task_card: (taskId: number) => `task-${taskId}`,
    more_tasks_indicator: (day: Date) => `more-tasks-${day.toISOString()}`,
    calendar_modal: {
      parent: "calendar-due-date-modal",
      list_container: "calendar-modal-list",
      label_prefix: "label-calendar-option-",
    },
  },
  ui: {
    day_section: {
      parent_classname: (isActive: boolean, hasTasks: boolean = false) =>
        `border-r border-b border-border p-2 ${isActive ? "bg-cardBackground hover:bg-hover-active" : ""
        } ${!hasTasks ? "hover:bg-hoverCardBackground" : ""}`,
      tooltip: {
        add_button: {
          left: -190,
          bottom: -10,
          text: "Add task to calendar",
          keyCombination: ["C"],
          shouldReAdjustToViewport: true,
        },
      },
    },
    task_card: {
      parent_classname:
        "outline-none rounded-[5px] xs:border-[1px] md:border-none xs:border-light-black-border-1",
      saved_classname:
        "text-[#FFCB33] w-new-notification relative z-10 hidden sm:block",
      overdue_classname: (taskSaved: boolean) =>
        `text-[#e2415c] w-new-notification relative hidden sm:block z-0 ${taskSaved ? "-ml-[7px]" : "-ml-[0px]"
        }`,
      ticket_number_classname: (view: "month" | "week") => {
        const isMonth = view === "month";
        return `font-medium text-text-light-gray uppercase text-left min-w-0 ${isMonth ? "truncate text-micro" : "text-meta"
          }`;
      },

      task_title_classname: (view: "month" | "week") => {
        const isMonth = view === "month";
        return `text-white-black whitespace-pre-line text-left ${isMonth ? "text-micro line-clamp-1 " : "text-dense break-words"
          }`;
      },
    },
    week_view: {
      parent_classname: (dayCount: number = 7) =>
        `grid ${dayCount === 1 ? "grid-cols-1" : dayCount === 5 ? "grid-cols-5" : "grid-cols-7"} h-full overflow-hidden flex-1`,
      active_day_classname: (isSame: boolean) =>
        `text-content mt-1  ${isSame
          ? "dark:bg-[#f9f9f9] bg-[#2F343C] text-white-black-inverted rounded px-2 py-1 w-fit place-self-center"
          : "text-muted-foreground"
        }`,
    },
    month_view: {
      parent_classname: "grid grid-cols-7",
    },
    back_button: {
      parent_classname: "bottom-0 left-0",
    },
    calendar_modal: {
      header: {
        title: "Add task to calendar",
        className: "px-[20px]",
      },
      body: {
        className: "p-0",
        input_placeholder: "Search task",
      },
      list_container: {
        className: "max-h-[230px]",
      },
    },
  },
  api_endpoints: {
    addTaskToDueDate: "/api/tasks/setDueDate",
    getUnscheduledTasks: "/api/tasks/getUnscheduled",
  },
  toast_messages: {
    error: {
      update: "Failed to update due date",
      add: "Unable to add task to calendar",
    },
    success: {
      update: "Due date updated!",
      add: "Task added to calendar!",
    },
  },
  constants: {
    focus_more_indicator: -2,
    day_names: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    day_names_full: [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ],
    month_names: [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ],
  },
} as const;
