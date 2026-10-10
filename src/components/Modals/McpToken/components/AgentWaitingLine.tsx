"use client"

import React, { useEffect, useState } from "react"
import { useFlag } from "@/hooks/useFlag"
import { HTPR_7041_AGENT_CONNECT_OVERLAY_FLAG } from "@/lib/flags/keys"
import { cn } from "@/utils/undoActions/helperFuncs"

/** Live line under the status bar: waits for the user's first agent connection (HTPR-7041). */
export function AgentWaitingLine() {
  const overlayOn = useFlag(HTPR_7041_AGENT_CONNECT_OVERLAY_FLAG)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!overlayOn || connected) return
    let cancelled = false
    let pending = false
    const controller = new AbortController()
    const check = async () => {
      if (pending || document.hidden) return
      pending = true
      try {
        const response = await fetch("/api/users/ai-connection-status?mode=first", {
          cache: "no-store",
          signal: controller.signal,
        })
        if (!response.ok) return
        const data = (await response.json()) as { connected?: boolean }
        if (!cancelled && data.connected) setConnected(true)
      } catch {
        // Best effort: keep polling after a transient error.
      } finally {
        pending = false
      }
    }
    void check()
    const intervalId = setInterval(() => void check(), 4000)
    return () => {
      cancelled = true
      controller.abort()
      clearInterval(intervalId)
    }
  }, [connected, overlayOn])

  if (!overlayOn) return null
  return (
    <div role="status" className="flex items-center gap-2 text-content mb-4">
      <span
        className={cn(
          "h-2 w-2 flex-shrink-0 rounded-full",
          connected ? "bg-hypertasks-green" : "bg-text-light-gray motion-safe:animate-pulse",
        )}
      />
      <span className={connected ? "text-hypertasks-green" : "text-text-light-gray"}>
        {connected ? "Connected!" : "Waiting for your agent..."}
      </span>
    </div>
  )
}
