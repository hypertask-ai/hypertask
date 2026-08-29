"use client"

import * as React from "react"
import { DayPicker } from "react-day-picker"

import { cn } from "@/utils/undoActions/helperFuncs"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useRecoilValue } from "@/lib/state"
import { calendarSettingsAtom } from "@/store"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  const calendarSettings = useRecoilValue(calendarSettingsAtom)

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      weekStartsOn={calendarSettings.weekStartsOn === "monday" ? 1 : 0}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row justify-around space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4",
        caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-content font-medium",
        nav: "space-x-1 flex items-center",
        nav_button: cn(
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"
        ),
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse space-y-1",
        head_row: "flex",
        head_cell:
          "text-muted-foreground text-center rounded-md w-[42px] font-normal text-dense",
        row: "flex w-full mt-2",
        cell: cn(
          "relative p-0 text-center text-content focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-accent [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected].day-range-end)]:rounded-r-md",
          props.mode === "range"
            ? "[&:has(>.day-range-end)]:rounded-r-md [&:has(>.day-range-start)]:rounded-l-md first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md"
            : "[&:has([aria-selected])]:rounded-md"
        ),
        day: cn(
          "h-8 w-[42px] p-0 font-normal aria-selected:opacity-100"
        ),
        day_range_start: "day-range-start",
        day_range_end: "day-range-end",
        day_selected:
          "bg-shadcn-primary text-primary-foreground hover:bg-shadcn-primary hover:text-primary-foreground focus:bg-shadcn-primary focus:text-primary-foreground",
        day_today: "",
        day_outside:
          "day-outside text-muted-foreground opacity-50  aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30",
        day_disabled: "text-muted-foreground opacity-50",
        day_range_middle:
          "aria-selected:bg-accent aria-selected:text-accent-foreground",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        IconLeft: ({ ...props }) => <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />,
        IconRight: ({ ...props }) => <ChevronRight className="h-4 w-4" strokeWidth={1.75} />,
      }}
      {...props}
    />
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
