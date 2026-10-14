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
      mcpToken: wasRevoked ? agent.mcpToken : null,
      hasMcpToken: wasRevoked ? agent.hasMcpToken : false,
    });
    try {
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
      if (data.token) {
        setAgent((prev) =>
          prev ? { ...prev, mcpToken: data.token, hasMcpToken: true } : prev,
        );
      }
    } catch {
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
