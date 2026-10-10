"use client";

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7041_AGENT_CONNECT_OVERLAY_FLAG } from "@/lib/flags/keys";

const McpTokenModal = dynamic(() => import("@/components/Modals/McpToken/McpTokenModal"), { ssr: false });

/**
 * HTPR-7041: opens the MCP dialog by itself for a user who never connected an agent,
 * on their first board. Close, Escape or a click outside dismisses it for good (same
 * server-side dismissal the old card used). The dialog is a fixed overlay, so the board never shifts.
 */
export function AgentConnectOverlay({ projectId, userId }: { projectId: number; userId: number }) {
  const flagEnabled = useFlag(HTPR_7041_AGENT_CONNECT_OVERLAY_FLAG);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!flagEnabled) {
      setOpen(false);
      return;
    }
    const controller = new AbortController();
    void fetch("/api/users/ai-connection-status?mode=first", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json();
        if (!controller.signal.aborted) setOpen(!data.connected && !data.dismissed && data.boardId === projectId);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [flagEnabled, projectId, userId]);

  const close = () => {
    setOpen(false);
    void fetch("/api/users/ai-connection-status", { method: "POST" }).catch(() => undefined);
  };

  if (!flagEnabled || !open) return null;
  return <McpTokenModal closeHandler={close} waitingForAgent />;
}
