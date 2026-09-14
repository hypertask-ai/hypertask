"use client"

import * as React from "react"
import { DayPicker } from "react-day-picker"

import { cn } from "@/utils/undoActions/helperFuncs"
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
} from "lucide-react"
import { useRecoilValue } from "@/lib/state"
import { calendarSettingsAtom } from "@/store"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

const monthNavClass =
  "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"

function CalendarChevron({
  className,
  orientation = "left",
  size = 16,
  disabled,
  ...props
}: {
  className?: string
  orientation?: "up" | "down" | "left" | "right"
  size?: number
  disabled?: boolean
  style?: React.CSSProperties
}) {
  const iconProps = {
    className: cn("h-4 w-4", className),
    strokeWidth: 1.75,
    size,
    "aria-disabled": disabled || undefined,
    ...props,
  }

  if (orientation === "right") return <ChevronRight {...iconProps} />
  if (orientation === "up") return <ChevronUp {...iconProps} />
  if (orientation === "down") return <ChevronDown {...iconProps} />
  return <ChevronLeft {...iconProps} />
}

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
        months:
          "flex flex-col sm:flex-row justify-around space-y-4 sm:space-x-4 sm:space-y-0",
        month: "relative space-y-4",
        month_caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-content font-medium",
        nav: "absolute inset-x-0 top-0 flex items-center justify-between",
        button_previous: cn(monthNavClass, "absolute left-1"),
        button_next: cn(monthNavClass, "absolute right-1"),
        month_grid: "w-full border-collapse space-y-1",
        weekdays: "flex",
        weekday:
          "text-muted-foreground text-center rounded-md w-[42px] font-normal text-dense",
        week: "flex w-full mt-2",
        day: cn(
          "relative p-0 text-center text-content focus-within:relative focus-within:z-20",
          props.mode === "range"
            ? "[&[aria-selected=true]]:bg-accent first:[&[aria-selected=true]]:rounded-l-md last:[&[aria-selected=true]]:rounded-r-md [&.day-range-start]:rounded-l-md [&.day-range-end]:rounded-r-md"
            : "[&[aria-selected=true]]:rounded-md"
        ),
        range_start: "day-range-start",
        range_end: "day-range-end",
        today: "",
        outside:
          "day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30",
        disabled: "text-muted-foreground opacity-50",
        range_middle:
          "bg-accent text-accent-foreground [&>button]:bg-accent [&>button]:text-accent-foreground",
        hidden: "invisible",
        ...classNames,
        selected: cn(
          "[&:not(.rdp-range_middle)]:bg-shadcn-primary [&:not(.rdp-range_middle)]:text-primary-foreground [&:not(.rdp-range_middle)>button]:bg-shadcn-primary [&:not(.rdp-range_middle)>button]:text-primary-foreground [&:not(.rdp-range_middle)>button]:hover:bg-shadcn-primary [&:not(.rdp-range_middle)>button]:focus:bg-shadcn-primary",
          classNames?.selected
        ),
        day_button: cn(
          "h-8 w-[42px] p-0 font-normal",
          classNames?.day_button
        ),
      }}
      components={{
        Chevron: CalendarChevron,
      }}
      {...props}
    />
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
