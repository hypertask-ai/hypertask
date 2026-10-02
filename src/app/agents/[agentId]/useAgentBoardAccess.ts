"use client";

import type { TAgentBoardAccess } from "@/lib/agents/boardAccess";
import { isWorking } from "@/lib/agents/registerView";
import toast from "react-hot-toast";
import { healthDotClass, healthLabel } from "./AgentDetailParts";
import type { useAgentDetailRefresh } from "./useAgentDetailRefresh";
import type { useAgentDetailState } from "./useAgentDetailState";
import type { useAgentProviderKey } from "./useAgentProviderKey";

type Props = Pick<
  ReturnType<typeof useAgentDetailState>,
  | "agent"
  | "pendingBoardId"
  | "setPendingBoardId"
  | "setBoardErrors"
  | "setBoardToRemove"
  | "archiving"
  | "setArchiving"
  | "setAgent"
  | "router"
  | "deleting"
  | "setDeleting"
  | "agentId"
  | "isMbl"
> &
  Pick<
  ReturnType<typeof useAgentDetailRefresh>,
  | "fetchAgentRefresh"
> &
  Pick<
  ReturnType<typeof useAgentProviderKey>,
  | "patchAgent"
>;

export function useAgentBoardAccess({
  agent, pendingBoardId, setPendingBoardId, setBoardErrors, fetchAgentRefresh, setBoardToRemove,
  archiving, setArchiving, patchAgent, setAgent, router, deleting, setDeleting, agentId, isMbl,
}: Props) {
  const changeBoardMembership = async (
    board: TAgentBoardAccess,
    member: boolean,
  ) => {
    if (!agent || pendingBoardId !== null) return;
    setPendingBoardId(board.id);
    let failureMessage = "Could not change board access";
    setBoardErrors((errors) => {
      const next = { ...errors };
      delete next[board.id];
      return next;
    });
    try {
      const res = await fetch(
        member ? "/api/members/addAgent" : "/api/members/removeAgent",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: board.id, agentId: agent.id }),
        },
      );
      const data = (await res.json()) as { message?: string };
      if (!res.ok) {
        failureMessage = data.message ?? failureMessage;
        throw new Error(failureMessage);
      }
      const refreshed = await fetchAgentRefresh({
        requestRef: agent.id,
        mergeRuntime: false,
        expectedAgentId: agent.id,
      });
      if (!refreshed) {
        setBoardErrors((errors) => ({
          ...errors,
          [board.id]: "Access changed. Reload this page to refresh the list.",
        }));
      }
      toast.success(
        member
          ? `${agent.displayName} added to ${board.name}`
          : `${agent.displayName} removed from ${board.name}`,
      );
    } catch {
      setBoardErrors((errors) => ({
        ...errors,
        [board.id]: failureMessage,
      }));
    } finally {
      setBoardToRemove(null);
      setPendingBoardId(null);
    }
  };

  const handleArchiveToggle = async () => {
    if (!agent || archiving) return;
    const archiving_ = !agent.archivedAt;
    setArchiving(true);
    try {
      const updated = await patchAgent({ archived: archiving_ });
      setAgent((prev) =>
        prev ? { ...prev, archivedAt: updated.archivedAt ?? null } : prev,
      );
      toast.success(archiving_ ? "Agent archived" : "Agent restored");
      // An archived agent is out of the register, so staying on its page after
      // filing it away leaves you looking at something you just hid.
      if (archiving_) router.push("/agents?active=archived");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not archive agent");
    } finally {
      setArchiving(false);
    }
  };

  const handleDelete = async () => {
    if (!agent || deleting) return;
    if (
      !confirm(
        `Delete ${agent.displayName} for good? Its board memberships and task assignments go with it. Comments it posted stay. This cannot be undone.`,
      )
    )
      return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/agents/${agentId}`, { method: "DELETE" });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? "Failed to delete agent");
      }
      toast.success("Agent deleted");
      router.push("/agents");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete agent");
      setDeleting(false);
    }
  };

  // Same expiry rule the register uses, so a page left open stops spinning at
  // the same moment the grid does.
  const working = agent && isWorking(agent) ? agent.working : null;
  const runtimeQueue = agent?.operations.queue ?? [];
  const runtimeActive = runtimeQueue.find((item) =>
    ["running", "waiting"].includes(item.state),
  );
  const pendingQueue = runtimeQueue.filter((item) => item.state === "pending");
  const activeWork = runtimeActive
    ? runtimeActive
    : working
      ? {
          ticket: working.ticket,
          title: working.title,
          url: working.url,
          boardName: agent?.boards?.[0]?.name ?? "Board",
          section: "In Progress",
          startedAt: working.since,
        }
      : null;
  const visiblePending = pendingQueue.slice(0, isMbl ? 2 : 3);
  const runtimeSnapshot = agent?.operations.snapshot;
  const operationsHealth = agent?.operations.health ?? "offline";
  const workingNowLabel = runtimeActive
    ? healthLabel[operationsHealth]
    : working
      ? "Working"
      : healthLabel[operationsHealth];
  const workingNowDot = runtimeActive
    ? healthDotClass[operationsHealth]
    : working
      ? "bg-hypertasks-green"
      : healthDotClass[operationsHealth];


  return {
    changeBoardMembership, handleArchiveToggle, handleDelete, working, pendingQueue, activeWork,
    visiblePending, runtimeSnapshot, operationsHealth, workingNowLabel, workingNowDot,
  };
}
