"use client";

import toast from "react-hot-toast";
import type { useAgentDetailState } from "./useAgentDetailState";

type Props = Pick<
  ReturnType<typeof useAgentDetailState>,
  | "agent"
  | "togglePending"
  | "setTogglePending"
  | "setAgent"
  | "agentId"
  | "openingChat"
  | "setOpeningChat"
  | "router"
  | "tokenBusy"
  | "setTokenBusy"
>;

export function useAgentDetailLifecycle({
  agent, togglePending, setTogglePending, setAgent, agentId, openingChat, setOpeningChat, router,
  tokenBusy, setTokenBusy,
}: Props) {
  const handleToggle = async () => {
    if (!agent || togglePending) return;
    setTogglePending(true);
    const wasRevoked = agent.revokedAt;
    setAgent({
      ...agent,
      revokedAt: wasRevoked ? null : new Date().toISOString(),
      // Turning an agent off destroys its key server-side, so the Access block
      // must not keep showing one that no longer works.
      mcpToken: wasRevoked ? agent.mcpToken : null,
      hasMcpToken: wasRevoked ? agent.hasMcpToken : false,
    });
    try {
      // The request states the wanted result rather than asking for a flip, so
      // this page and an open register tab cannot cancel each other out.
      const res = await fetch(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revoked: !wasRevoked }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        token?: string;
        error?: string;
      };
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? "Failed to update agent");
      }
      // Re-enabling an external agent mints a fresh key and reveals it in this
      // one response. Dropping it is not fatal (the key is stored, and can be
      // regenerated) but it is the only time the value can be read, so keep it.
      if (data.token) {
        setAgent((prev) =>
          prev ? { ...prev, mcpToken: data.token, hasMcpToken: true } : prev,
        );
      }
    } catch {
      // Roll back everything the optimistic update touched, not just the
      // switch: leaving the key fields cleared reports "no key" for an agent
      // whose key is still live, and the obvious next move is to regenerate,
      // which breaks the runtime that was authenticating fine.
      setAgent((prev) =>
        prev
          ? {
              ...prev,
              revokedAt: wasRevoked,
              mcpToken: agent.mcpToken,
              hasMcpToken: agent.hasMcpToken,
            }
          : prev,
      );
    } finally {
      setTogglePending(false);
    }
  };

  // Talking to a native agent means a chat session pointed at it. The manage
  // modal opened one the same way; this page replaced that modal, so it has to
  // keep the door open or native agents become unreachable.
  const handleOpenChat = async () => {
    if (openingChat) return;
    setOpeningChat(true);
    try {
      const res = await fetch("/api/ai-chat/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: agent?.id ?? agentId }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        session?: { id: string };
        error?: string;
      };
      if (!res.ok || !data.success || !data.session) {
        throw new Error(data.error ?? "Could not open agent chat");
      }
      router.push(`/chat/${data.session.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open agent chat");
      setOpeningChat(false);
    }
  };

  const handleGenerateToken = async () => {
    if (!agent || tokenBusy) return;
    setTokenBusy(true);
    try {
      const res = await fetch(`/api/agents/${agent?.id ?? agentId}/mcp-token`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        success?: boolean;
        token?: string;
        error?: string;
      };
      if (!res.ok || !data.success || !data.token) {
        throw new Error(data.error ?? "Failed to generate token");
      }
      setAgent((prev) =>
        prev ? { ...prev, mcpToken: data.token, hasMcpToken: true } : prev,
      );
      toast.success("Token generated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate token");
    } finally {
      setTokenBusy(false);
    }
  };

  const handleRevokeToken = async () => {
    if (!agent || tokenBusy) return;
    if (
      !confirm(
        "Revoke this key? Anything connecting with it loses access immediately.",
      )
    ) {
      return;
    }
    setTokenBusy(true);
    try {
      const res = await fetch(`/api/agents/${agent?.id ?? agentId}/mcp-token`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? "Failed to revoke token");
      }
      setAgent((prev) =>
        prev ? { ...prev, mcpToken: null, hasMcpToken: false } : prev,
      );
      toast.success("Key revoked");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not revoke key");
    } finally {
      setTokenBusy(false);
    }
  };


  return {
    handleToggle, handleOpenChat, handleGenerateToken, handleRevokeToken,
  };
}
