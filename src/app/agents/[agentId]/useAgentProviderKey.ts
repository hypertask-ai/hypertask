"use client";

import toast from "react-hot-toast";
import type { TAgent } from "../AgentsRegister";
import type { useAgentDetailState } from "./useAgentDetailState";

type Props = Pick<
  ReturnType<typeof useAgentDetailState>,
  | "providerKeyDraft"
  | "agent"
  | "savingProviderKey"
  | "savingVisibility"
  | "setEditingProviderKey"
  | "setSavingProviderKey"
  | "setProviderKey"
  | "setProviderKeyDraft"
  | "setVisibilityNotice"
  | "setAgent"
  | "agentId"
>;

export function useAgentProviderKey({
  providerKeyDraft, agent, savingProviderKey, savingVisibility, setEditingProviderKey,
  setSavingProviderKey, setProviderKey, setProviderKeyDraft, setVisibilityNotice, setAgent,
  agentId,
}: Props) {
  const handleSaveProviderKey = async () => {
    const next = providerKeyDraft.trim();
    if (!agent || savingProviderKey || savingVisibility) return;
    if (!next) {
      setEditingProviderKey(false);
      return;
    }
    setSavingProviderKey(true);
    try {
      const res = await fetch(`/api/agents/${agent.id}/provider-key`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "openrouter", apiKey: next }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        maskedKey?: string;
      };
      if (!res.ok || !data.success) return;
      setProviderKey({
        provider: "openrouter",
        maskedKey: data.maskedKey ?? null,
      });
      setProviderKeyDraft("");
      setEditingProviderKey(false);
      setVisibilityNotice(null);
    } catch {
      // leave the field open so the pasted key is not lost
    } finally {
      setSavingProviderKey(false);
    }
  };

  const handleRemoveProviderKey = async () => {
    if (!agent || savingProviderKey || savingVisibility) return;
    setSavingProviderKey(true);
    try {
      const res = await fetch(
        `/api/agents/${agent.id}/provider-key?provider=openrouter`,
        { method: "DELETE" },
      );
      const data = (await res.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
        visibility?: "PRIVATE" | "TEAM";
        visibilityChanged?: boolean;
      } | null;
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error ?? "Could not remove provider key");
      }
      setProviderKey(null);
      if (data?.visibility) {
        setAgent((current) =>
          current ? { ...current, visibility: data.visibility! } : current,
        );
      }
      setVisibilityNotice(
        data?.visibilityChanged
          ? {
              kind: "success",
              text: "Provider key removed. This agent is now private.",
            }
          : null,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not remove provider key",
      );
    } finally {
      setSavingProviderKey(false);
    }
  };

  const patchAgent = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/agents/${agentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as {
      success?: boolean;
      agent?: Partial<TAgent>;
      error?: string;
    };
    if (!res.ok || !data.success || !data.agent) {
      throw new Error(data.error ?? "Failed to update agent");
    }
    return data.agent;
  };


  return {
    handleSaveProviderKey, handleRemoveProviderKey, patchAgent,
  };
}
