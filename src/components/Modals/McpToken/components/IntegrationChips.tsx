"use client"

import React from "react"
import { cn } from "@/utils/undoActions/helperFuncs"
import type { IntegrationId } from "../utils"
import { MCP_INTEGRATIONS } from "../utils"
import { IntegrationIcon } from "./IntegrationIcons"

interface IntegrationChipsProps {
  selectedId: IntegrationId
  onSelect: (id: IntegrationId) => void
}

export function getIntegrationChipClassName(isSelected: boolean) {
  return cn(
    "inline-flex items-center gap-2 px-4 py-2  rounded text-meta font-medium transition-colors border-thin",
    isSelected
      ? "bg-active-elementBg text-white-black  border-text-light-gray"
      : "bg-taskDetal-container text-text-light-gray hover:text-white-black hover:bg-hover-active border-border-light-gray-thin"
  )
}

export function IntegrationChips({ selectedId, onSelect }: IntegrationChipsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {MCP_INTEGRATIONS.map((integration) => {
        const isSelected = selectedId === integration.id
        return (
          <button
            key={integration.id}
            type="button"
            onClick={() => onSelect(integration.id)}
            className={getIntegrationChipClassName(isSelected)}
          >
            <IntegrationIcon id={integration.id} size={20} className="flex-shrink-0" />
            {integration.label}
          </button>
        )
      })}
    </div>
  )
}
