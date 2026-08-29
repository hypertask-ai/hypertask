"use client"

import React from "react"
import { cn } from "@/utils/undoActions/helperFuncs"

interface TokenStatusBarProps {
  token: string | null
  expiresAt: string | null
  isLoading: boolean
  isGenerating: boolean
  onGenerate: () => void
  label?: string
}

export function TokenStatusBar({
  token,
  expiresAt,
  isLoading,
  isGenerating,
  onGenerate,
  label = "MCP",
}: TokenStatusBarProps) {
  const isActive = !!token && !isLoading && !isGenerating

  return (
    <div className="flex items-center justify-between p-2 rounded bg-cardBackground border-b  border-border-light-gray-thin mb-4">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "relative w-10 h-6 rounded-full transition-colors flex-shrink-0",
            isActive ? "bg-green-500" : "bg-[#4F545C]"
          )}
        >
          <div
            className={cn(
              "absolute top-1 w-4 h-4 rounded-full bg-white transition-transform",
              isActive ? "left-5" : "left-1"
            )}
          />
        </div>
        {isLoading || isGenerating ? (
          <span className="text-content text-text-light-gray">Loading...</span>
        ) : isActive ? (
          <>
            <span className="text-content font-medium text-green-500 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              {label} active
            </span>
            {expiresAt && (
              <span className="text-meta text-text-light-gray">
                Expires {new Date(expiresAt).toLocaleDateString()}
              </span>
            )}
          </>
        ) : (
          <span className="text-content text-text-light-gray">{label} inactive</span>
        )}
      </div>
      <button
        type="button"
        onClick={onGenerate}
        disabled={isGenerating || isLoading}
        className={cn(
          "px-4 py-2 text-content font-medium rounded transition-all",
          "bg-[#3B82F6] hover:bg-[#2563EB] text-white",
          "disabled:opacity-50 disabled:cursor-not-allowed"
        )}
      >
        {isGenerating ? "Generating..." : isActive ? "Renew" : "Generate"}
      </button>
    </div>
  )
}
