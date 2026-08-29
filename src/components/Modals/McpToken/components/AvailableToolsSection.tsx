"use client"

import React, { useState } from "react"
import { cn } from "@/utils/undoActions/helperFuncs"
import { MCP_TOOLS } from "../utils"
import { ChevronDown } from "lucide-react";

const COLOR_CLASSES = {
  blue: "bg-[#3B82F6]",
  purple: "bg-[#8B5CF6]",
  green: "bg-[#22C55E]",
  yellow: "bg-[#EAB308]",
}

const INITIAL_VISIBLE = 6

export function AvailableToolsSection() {
  const [expanded, setExpanded] = useState(false)
  const visibleTools = expanded ? MCP_TOOLS : MCP_TOOLS.slice(0, INITIAL_VISIBLE)
  const hasMore = MCP_TOOLS.length > INITIAL_VISIBLE
  const hiddenCount = MCP_TOOLS.length - INITIAL_VISIBLE

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-content font-medium text-white-black">Available Tools</h3>
        <span className="text-meta text-[#3B82F6]">{MCP_TOOLS.length} tools</span>
      </div>
      <ul className="space-y-2  rounded bg-cardBackground border-thin border-border-light-gray-thin">
        {visibleTools.map((tool) => (
          <li key={tool.name} className="flex px-2 py-1 border-b border-border-light-gray-thin items-baseline gap-2">
            <span
              className={cn(
                "w-2 h-2 rounded-full flex-shrink-0 mt-1.5",
                COLOR_CLASSES[tool.color]
              )}
            />
            <div className="flex w-full justify-between items-center gap-1">
              <span className="text-content font-medium text-white-black">{tool.name}</span>
              <span className="text-meta text-text-light-gray">{tool.description}</span>
            </div>
          </li>
        ))}
      </ul>
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className={cn(
            "flex items-center justify-center w-full gap-2 mt-2 px-3 py-2.5 rounded-lg text-meta font-medium transition-colors",
            "bg-cardBackground hover:bg-hover-active text-white-black"
          )}
        >
          {expanded ? (
            <>Show less</>
          ) : (
            <>
              Show {hiddenCount} more tools
              <ChevronDown strokeWidth={1.75} size={14} />
            </>
          )}
        </button>
      )}
    </div>
  )
}
