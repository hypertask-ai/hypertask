"use client";

import toast from "react-hot-toast";
import { PROMPT_MAX } from "./agentDetailTypes";
import type { useAgentDetailState } from "./useAgentDetailState";
import type { useAgentProviderKey } from "./useAgentProviderKey";

type Props = Pick<
  ReturnType<typeof useAgentDetailState>,
  | "nameDraft"
  | "agent"
  | "setEditingName"
  | "setSavingName"
  | "setAgent"
  | "agentId"
  | "router"
  | "promptDraft"
  | "setSavingPrompt"
  | "setEditingPrompt"
  | "savingModel"
  | "setSavingModel"
  | "savingVisibility"
  | "savingProviderKey"
  | "setSavingVisibility"
  | "setVisibilityNotice"
  | "providerKey"
  | "setConfirmTeamVisibility"
  | "savingImportant"
  | "setSavingImportant"
> &
  Pick<
  ReturnType<typeof useAgentProviderKey>,
  | "patchAgent"
>;

export function useAgentConfig({
  nameDraft, agent, setEditingName, setSavingName, patchAgent, setAgent, agentId, router,
  promptDraft, setSavingPrompt, setEditingPrompt, savingModel, setSavingModel, savingVisibility,
  savingProviderKey, setSavingVisibility, setVisibilityNotice, providerKey,
  setConfirmTeamVisibility, savingImportant, setSavingImportant,
}: Props) {
  const handleSaveName = async () => {
    const next = nameDraft.trim();
    if (!agent || !next || next === agent.displayName) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    try {
      const updated = await patchAgent({ displayName: next });
      setAgent((prev) =>
        prev
          ? {
              ...prev,
              displayName: updated.displayName ?? next,
              slug: updated.slug ?? prev.slug,
            }
          : prev,
      );
      if (updated.slug && updated.slug !== agentId) {
        router.replace(`/agents/${updated.slug}`, { scroll: false });
      }
      setEditingName(false);
    } catch {
    } finally {
      setSavingName(false);
    }
  };

  const handleSavePrompt = async () => {
    if (!agent || promptDraft.length > PROMPT_MAX) return;
    setSavingPrompt(true);
    try {
      const updated = await patchAgent({ prompt: promptDraft });
      setAgent((prev) =>
        prev ? { ...prev, prompt: updated.prompt ?? null } : prev,
      );
      setEditingPrompt(false);
    } catch {
    } finally {
      setSavingPrompt(false);
    }
  };

  const handleModelChange = async (value: string) => {
    if (!agent || savingModel) return;
    const prevModelOptionId = agent.modelOptionId;
    setSavingModel(true);
    setAgent({ ...agent, modelOptionId: value || null });
    try {
      await patchAgent({ modelOptionId: value || null });
    } catch {
      setAgent((prev) =>
        prev ? { ...prev, modelOptionId: prevModelOptionId } : prev,
      );
    } finally {
      setSavingModel(false);
    }
  };

  const saveVisibility = async (visibility: "PRIVATE" | "TEAM") => {
    if (!agent || savingVisibility || savingProviderKey) return;

    setSavingVisibility(true);
    setVisibilityNotice(null);
    try {
      const updated = await patchAgent({ visibility });
      const savedVisibility =
        updated.visibility === "TEAM" ? "TEAM" : "PRIVATE";
      setAgent((current) =>
        current ? { ...current, visibility: savedVisibility } : current,
      );
    } catch (error) {
      setVisibilityNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Could not change visibility",
      });
    } finally {
      setSavingVisibility(false);
    }
  };

  const handleVisibilityChange = (value: string) => {
    if (
      !agent ||
      savingVisibility ||
      savingProviderKey ||
      (value !== "PRIVATE" && value !== "TEAM") ||
      value === agent.visibility
    ) {
      return;
    }
    if (value === "TEAM" && agent.runtimeType === "NATIVE" && !providerKey) {
      setConfirmTeamVisibility(true);
      return;
    }
    void saveVisibility(value);
  };

  const handleImportantToggle = async () => {
    if (!agent || savingImportant) return;
    const next = agent.postsToImportant === false;
    setSavingImportant(true);
    setAgent((prev) => (prev ? { ...prev, postsToImportant: next } : prev));
    try {
      await patchAgent({ postsToImportant: next });
    } catch (e) {
      setAgent((prev) => (prev ? { ...prev, postsToImportant: !next } : prev));
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSavingImportant(false);
    }
  };


  return {
    handleSaveName, handleSavePrompt, handleModelChange, saveVisibility, handleVisibilityChange,
    handleImportantToggle,
  };
}
