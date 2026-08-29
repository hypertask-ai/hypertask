"use client"

import React from "react"
import { Bot, Code2 } from "lucide-react"
import type { IntegrationId } from "../utils"

/** SVG paths from simple-icons (cdn.jsdelivr.net/npm/simple-icons) - MIT license */
const ANTHROPIC_PATH =
  "M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z"
const CURSOR_PATH =
  "M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23"
const LOVABLE_HEART_PATH =
  "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"

interface IntegrationIconProps {
  id: IntegrationId
  className?: string
  size?: number
}

export function IntegrationIcon({ id, className, size = 20 }: IntegrationIconProps) {
  const svgProps = {
    viewBox: "0 0 24 24",
    width: size,
    height: size,
    className,
    fill: "currentColor",
  }

  switch (id) {
    case "claude":
    case "claude-code":
      return (
        <svg {...svgProps} xmlns="http://www.w3.org/2000/svg" aria-hidden>
          <path d={ANTHROPIC_PATH} />
        </svg>
      )
    case "cursor":
      return (
        <svg {...svgProps} xmlns="http://www.w3.org/2000/svg" aria-hidden>
          <path d={CURSOR_PATH} />
        </svg>
      )
    case "vscode":
      return <Code2 size={size} className={className} strokeWidth={1.75} aria-hidden />
    case "chatgpt":
    case "codex":
      return <Bot size={size} className={className} strokeWidth={1.75} aria-hidden />
    case "lovable":
      return (
        <svg {...svgProps} xmlns="http://www.w3.org/2000/svg" aria-hidden>
          <path d={LOVABLE_HEART_PATH} />
        </svg>
      )
    default:
      return null
  }
}
