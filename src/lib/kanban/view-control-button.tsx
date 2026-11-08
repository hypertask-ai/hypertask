'use client'

import Tooltip from "@/components/Common/Tooltip"

export const ViewControlButton = ({
  active = false,
  children,
  keyCombination = [],
  label,
  tooltipText = label,
  onClick,
  tooltipLeft,
  expanded,
  className = "",
}: {
  active?: boolean
  children: React.ReactNode
  keyCombination?: (string | null)[]
  label: string
  tooltipText?: string
  onClick: () => void
  tooltipLeft: number
  expanded?: boolean
  className?: string
}) => (
  <button
    type="button"
    aria-label={label}
    aria-expanded={expanded}
    onClick={onClick}
    className={`group relative flex size-8 items-center justify-center transition-colors ${active ? "text-view-control-active hover:text-view-control-active-hover" : "text-text-light-gray hover:text-white-black"} ${className}`}
  >
    {children}
    <Tooltip
      text={tooltipText}
      left={tooltipLeft}
      bottom={-34}
      keyCombination={keyCombination}
    />
  </button>
)
