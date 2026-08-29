"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import UserAvatar from "@/components/Common/UserAvatar";
import {
  ModalContainerCustom,
  ModalFooterComp,
  ModalHeaderComp,
} from "@/components/Common/CommonModalComponents";
import { ModalBody } from "reactstrap";
import toast from "react-hot-toast";
import {
  Copy,
  Inbox,
  MessageCircle,
  Pencil,
  PlugZap,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { IAgent } from "@/models/model";
import { boardAgentsQueryKey, useAgents } from "@/hooks/MultiPages/useAgents";
import { MCP_SERVER_URL } from "@/components/Modals/McpToken/utils";
import ConfirmModal from "../Common Modals/ConfirmActionModal";
import { useQueryClient } from "@tanstack/react-query";
import { currentProjectAtom, currentUserAtom } from "@/store";
import { useRecoilValue } from "@/lib/state";
import { formatDistanceToNow } from "date-fns";
import GuestSignupOverlay from "@/components/Common/GuestLock/GuestSignupOverlay";
import AgentWebhookPanel from "./AgentWebhookPanel";

const ROW_ACTION_CLASS =
  "relative group inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] border-0 text-text-light-gray transition-colors hover:bg-hover-active hover:text-white-black focus-visible:bg-hover-active focus-visible:text-white-black focus-visible:outline-none";
const TEXT_ACTION_CLASS =
  "inline-flex min-h-7 items-center gap-1.5 rounded-[4px] border-0 px-2 py-1 text-meta font-medium text-white-black transition-colors hover:bg-hover-active focus-visible:bg-hover-active focus-visible:outline-none disabled:cursor-not-allowed disabled:text-text-light-gray";

/**
 * OAuth sign-in when we have one; otherwise the creation date. Agents on
 * static MCP tokens never OAuth, so "never connected" would wrongly mark
 * daily-active agents as dead.
 */
function agentActivityLine(agent: IAgent): string {
  if (agent.runtimeType === "NATIVE") {
    if (agent.heartbeatAt) {
      const d = new Date(agent.heartbeatAt);
      if (!Number.isNaN(d.getTime()))
        return `Active · heartbeat ${formatDistanceToNow(d)} ago`;
    }
    return "Native agent · not yet running";
  }
  const oauthIso = agent.lastOAuthMcpClient?.lastAuthorizedAt;
  if (oauthIso) {
    const d = new Date(oauthIso);
    if (!Number.isNaN(d.getTime()))
      return `Active ${formatDistanceToNow(d)} ago`;
  }
  const created = new Date(agent.createdAt);
  if (!Number.isNaN(created.getTime())) {
    return `Created ${created.toLocaleDateString(undefined, { dateStyle: "medium" })}`;
  }
  return "";
}

function agentLastPostedLine(agent: IAgent): string {
  if (!agent.lastPostedAt) return "";
  const posted = new Date(agent.lastPostedAt);
  if (Number.isNaN(posted.getTime())) return "";
  return `Last posted ${formatDistanceToNow(posted)} ago`;
}

function copyToClipboard(text: string, label: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${label} copied`),
    () => toast.error("Failed to copy"),
  );
}

interface AgentConnectPanelProps {
  agent: IAgent;
  token: string | null;
  hasToken: boolean;
  isLoading: boolean;
  onGenerate: () => Promise<void>;
  onTokenChange: (token: string | null) => void;
}

function AgentConnectPanel({
  agent,
  token,
  hasToken,
  isLoading,
  onGenerate,
  onTokenChange,
}: AgentConnectPanelProps) {
  const configSnippet = token
    ? JSON.stringify(
        {
          mcpServers: {
            "hypertask-mcp": {
              url: MCP_SERVER_URL,
              headers: { Authorization: `Bearer ${token}` },
            },
          },
        },
        null,
        2,
      )
    : "";

  const handleRevoke = async () => {
    if (
      !confirm(
        "Revoke this agent's MCP token? Any MCP clients using it will lose access.",
      )
    )
      return;
    try {
      const res = await fetch(`/api/agents/${agent.id}/mcp-token`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!data.success) throw new Error(data.error ?? "Failed");
      onTokenChange(null);
      toast.success("Token revoked");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not revoke token");
    }
  };

  return (
    <div className="space-y-3 px-3 pb-3 pt-1 text-content">
      {!token && !isLoading && !hasToken && (
        <p className="text-meta text-text-light-gray">
          No token yet. Click <strong>Generate</strong> to create one.
        </p>
      )}
      {!token && !isLoading && hasToken && (
        <p className="text-meta text-text-light-gray">
          This agent has an active token. Regenerate it to reveal a new
          configuration.
        </p>
      )}
      {isLoading && !token && (
        <p className="text-meta text-text-light-gray">Generating token…</p>
      )}

      {token && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-meta font-medium text-text-light-gray uppercase tracking-wide">
              Configuration snippet
            </p>
            <button
              type="button"
              className={ROW_ACTION_CLASS}
              title="Copy config"
              onClick={() => copyToClipboard(configSnippet, "Config")}
            >
              <Copy strokeWidth={1.75} className="h-4 w-4" />
            </button>
          </div>
          <div className="rounded-[4px] bg-active-modal-element px-3 py-2.5">
            <pre className="whitespace-pre-wrap break-all font-mono text-meta text-white-black">
              {configSnippet}
            </pre>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          className={TEXT_ACTION_CLASS}
          disabled={isLoading}
          onClick={() => void onGenerate()}
        >
          <RefreshCw
            strokeWidth={1.75}
            className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`}
            aria-hidden
          />
          {isLoading
            ? "Generating…"
            : token || hasToken
              ? "Regenerate"
              : "Generate"}
        </button>
        {hasToken && (
          <button
            type="button"
            className={TEXT_ACTION_CLASS}
            disabled={isLoading}
            onClick={() => void handleRevoke()}
          >
            Revoke
          </button>
        )}
      </div>
    </div>
  );
}

interface ManageModalProps {
  closeHandler: (callback?: string, agent?: IAgent) => void;
  highlightedAgentId?: string | null;
}

interface AgentGroup {
  key: string;
  label: string;
  boardId: number | null;
  isCurrentBoard: boolean;
  agents: IAgent[];
}

function sortedAgentBoards(agent: IAgent) {
  return Array.from(
    new Map((agent.boards ?? []).map((board) => [board.id, board])).values(),
  ).sort(
    (a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
      a.id - b.id,
  );
}

const ManageAgentsModal: React.FC<ManageModalProps> = ({
  closeHandler,
  highlightedAgentId,
}) => {
  const {
    agents,
    revokeAgent,
    addAgentToBoard,
    isLoading: loading,
    error: agentsError,
  } = useAgents();
  const queryClient = useQueryClient();
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [agentTokenOverrides, setAgentTokenOverrides] = useState<
    Record<string, string | null>
  >({});
  const [generatingAgentIds, setGeneratingAgentIds] = useState<Set<string>>(
    () => new Set(),
  );
  const currentProject = useRecoilValue(currentProjectAtom);
  const currentUser = useRecoilValue(currentUserAtom);
  const [flashId, setFlashId] = useState<string | null>(
    highlightedAgentId ?? null,
  );
  const [showConfirm, setShowConfirm] = useState<boolean>(false);
  const [agentToDelete, setAgentToDelete] = useState<string | null>(null);
  const disableInFlightRef = useRef(false);
  const tokenRequestsInFlightRef = useRef<Set<string>>(new Set());

  const generateAgentToken = useCallback(async (agentId: string) => {
    if (tokenRequestsInFlightRef.current.has(agentId)) return;

    tokenRequestsInFlightRef.current.add(agentId);
    setGeneratingAgentIds((current) => new Set(current).add(agentId));

    try {
      const res = await fetch(`/api/agents/${agentId}/mcp-token`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        success?: boolean;
        token?: string;
        error?: string;
      };
      const token = data.token;
      if (!data.success || !token) {
        throw new Error(data.error ?? "Failed to generate token");
      }
      setAgentTokenOverrides((current) => ({
        ...current,
        [agentId]: token,
      }));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not generate token",
      );
    } finally {
      tokenRequestsInFlightRef.current.delete(agentId);
      setGeneratingAgentIds((current) => {
        const next = new Set(current);
        next.delete(agentId);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    if (!highlightedAgentId) return;
    setFlashId(highlightedAgentId);
    const t = setTimeout(() => setFlashId(null), 2500);
    return () => clearTimeout(t);
  }, [highlightedAgentId]);

  const highlightRef = useCallback((node: HTMLLIElement | null) => {
    if (node) node.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (agentsError) {
      toast.error(
        agentsError instanceof Error
          ? agentsError.message
          : "Failed to load agents",
      );
    }
  }, [agentsError]);

  const activeAgents = useMemo(
    () => agents.filter((a) => !a.revokedAt),
    [agents],
  );

  // `name` is the slug ("project-15"); `title` is the board's real name.
  const currentBoardName = currentProject
    ? (currentProject.title ?? currentProject.name)
    : "";

  const agentGroups = useMemo<AgentGroup[]>(() => {
    const currentBoardAgents: IAgent[] = [];
    const otherBoardGroups = new Map<
      number,
      { board: { id: number; name: string }; agents: IAgent[] }
    >();
    const agentsWithoutBoards: IAgent[] = [];

    for (const agent of activeAgents) {
      const boards = sortedAgentBoards(agent);
      const isOnCurrentBoard =
        currentProject != null &&
        boards.some((board) => board.id === currentProject.id);

      if (isOnCurrentBoard) {
        currentBoardAgents.push(agent);
        continue;
      }

      const primaryBoard = boards[0];
      if (!primaryBoard) {
        agentsWithoutBoards.push(agent);
        continue;
      }

      const existingGroup = otherBoardGroups.get(primaryBoard.id);
      if (existingGroup) {
        existingGroup.agents.push(agent);
      } else {
        otherBoardGroups.set(primaryBoard.id, {
          board: primaryBoard,
          agents: [agent],
        });
      }
    }

    const groups: AgentGroup[] = [];
    if (currentProject) {
      groups.push({
        key: `current-${currentProject.id}`,
        label: `On this board · ${currentProject.title ?? currentProject.name}`,
        boardId: currentProject.id,
        isCurrentBoard: true,
        agents: currentBoardAgents,
      });
    }

    groups.push(
      ...Array.from(otherBoardGroups.values())
        .sort(
          (a, b) =>
            a.board.name.localeCompare(b.board.name, undefined, {
              sensitivity: "base",
            }) || a.board.id - b.board.id,
        )
        .map(({ board, agents: groupedAgents }) => ({
          key: `board-${board.id}`,
          label: board.name,
          boardId: board.id,
          isCurrentBoard: false,
          agents: groupedAgents,
        })),
    );

    if (agentsWithoutBoards.length > 0) {
      groups.push({
        key: "no-board",
        label: "Not on any board",
        boardId: null,
        isCurrentBoard: false,
        agents: agentsWithoutBoards,
      });
    }

    return groups;
  }, [activeAgents, currentProject]);

  const confirmDisable = async () => {
    if (!agentToDelete || revokeAgent.isPending || disableInFlightRef.current)
      return;
    disableInFlightRef.current = true;

    try {
      await revokeAgent.mutateAsync({ agentId: agentToDelete, revoked: true });
      setAgentToDelete(null);
      setShowConfirm(false);
      toast.success("Agent disabled");

      // These dependent caches can refresh in the background. The agent cache
      // is already updated synchronously by the mutation, so a secondary
      // refetch failure must not make a successful disable look unsuccessful.
      void Promise.all([
        queryClient.refetchQueries({ queryKey: ["projectsAll"] }),
        ...(currentProject
          ? [
              queryClient.refetchQueries({
                queryKey: boardAgentsQueryKey(currentProject.id),
              }),
              queryClient.refetchQueries({
                queryKey: ["assign", currentProject.id],
              }),
            ]
          : []),
      ]).catch(() => undefined);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not disable agent",
      );
    } finally {
      disableInFlightRef.current = false;
    }
  };

  const agentsOnCurrentBoard = currentProject
    ? activeAgents.filter((agent) =>
        agent.boards?.some((board) => board.id === currentProject.id),
      ).length
    : 0;
  const subHeadline = currentProject
    ? `${agentsOnCurrentBoard} on this board · ${activeAgents.length} total`
    : `${activeAgents.length} ${activeAgents.length === 1 ? "agent" : "agents"}`;

  return (
    <ModalContainerCustom
      fade={false}
      show
      isOpen
      id="agentManageModal"
      toggle={closeHandler}
      shouldCloseOnClickOutside
      contentClassName="rounded-[4px] border-0 bg-modalBackground"
      className="rounded-[4px] font-bold sm:min-w-[480px] sm:max-w-[560px] sm:top-[250px] xs:max-h-[450px] sm:max-h-[450px]"
    >
      <GuestSignupOverlay onSignup={() => closeHandler()}>
        <ModalHeaderComp
          header="Manage agents"
          subHeadline={subHeadline}
          subHeadlineClassName="text-text-light-gray block text-content font-normal"
          className="!h-auto border-none px-5 pb-3 pt-4"
          headerClassName="!h-auto p-0"
        >
          <button
            type="button"
            className={`${TEXT_ACTION_CLASS} shrink-0 bg-active-modal-element`}
            onClick={() => {
              closeHandler("create");
            }}
          >
            <Plus strokeWidth={1.75} className="h-3.5 w-3.5" aria-hidden />
            New agent
          </button>
        </ModalHeaderComp>
        <ModalBody className="max-h-[450px] overflow-y-auto px-5 pb-4 pt-0">
          {loading && (
            <p className="text-content text-text-light-gray mb-2">Loading…</p>
          )}
          {!loading && activeAgents.length === 0 && (
            <p className="text-content text-text-light-gray">No agents yet.</p>
          )}
          {!loading && activeAgents.length > 0 && (
            <div className="space-y-4">
              {agentGroups.map((group) => (
                <section key={group.key}>
                  <div className="sticky top-0 z-10 flex items-center gap-2 bg-modalBackground px-1 py-2">
                    <span className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-text-light-gray">
                      {group.label}
                    </span>
                    <span className="text-[10px] font-medium tabular-nums text-text-light-gray">
                      {group.agents.length}
                    </span>
                  </div>
                  {group.agents.length === 0 && group.isCurrentBoard && (
                    <p className="px-2.5 py-1.5 text-[11px] text-text-light-gray">
                      No agents on this board yet. Add one from below.
                    </p>
                  )}
                  {group.agents.length > 0 && (
                    <ul className="space-y-1.5">
                      {group.agents.map((a) => {
                        const lastActivity = agentActivityLine(a);
                        const lastPosted = agentLastPostedLine(a);
                        const isExpanded = expandedAgentId === a.id;
                        const isOnCurrentBoard =
                          currentProject != null &&
                          a.boards?.some(
                            (board) => board.id === currentProject.id,
                          );
                        const ownsAgent = a.userId === currentUser?.id;
                        const canAddToBoard =
                          ownsAgent &&
                          currentProject != null &&
                          !isOnCurrentBoard;
                        const additionalBoards = sortedAgentBoards(a).filter(
                          (board) => board.id !== group.boardId,
                        );
                        const isAdding =
                          addAgentToBoard.isPending &&
                          addAgentToBoard.variables?.agentId === a.id;
                        const agentToken = Object.prototype.hasOwnProperty.call(
                          agentTokenOverrides,
                          a.id,
                        )
                          ? agentTokenOverrides[a.id]
                          : null;
                        const agentHasToken =
                          Object.prototype.hasOwnProperty.call(
                            agentTokenOverrides,
                            a.id,
                          )
                            ? Boolean(agentTokenOverrides[a.id])
                            : Boolean(a.hasMcpToken);

                        return (
                          <li
                            key={a.id}
                            ref={a.id === flashId ? highlightRef : undefined}
                            className={`group/agent overflow-hidden rounded-[5px] text-content transition-colors duration-200 hover:bg-hover-active ${
                              a.id === flashId
                                ? "bg-active-modal-element"
                                : "bg-cardBackground"
                            }`}
                          >
                            <div className="flex min-h-12 items-center gap-3 px-3 py-2.5">
                              <UserAvatar
                                alt={a.displayName}
                                name={a.displayName}
                                photoURL={a.photoURL}
                                size={28}
                                title={a.displayName}
                              />

                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[13.5px] font-semibold leading-4 text-white-black">
                                  {a.displayName}
                                </div>
                                <div className="mt-0.5 truncate text-[11px] font-normal leading-4 text-text-light-gray">
                                  {lastActivity}
                                </div>
                                {lastPosted ? (
                                  <div className="truncate text-[11px] font-normal leading-4 text-text-light-gray">
                                    {lastPosted}
                                  </div>
                                ) : null}
                              </div>

                              {/* Board metadata and actions share the right slot so
                                hover actions never squeeze the agent name. */}
                              {additionalBoards.length > 0 && (
                                <span
                                  className="max-w-36 shrink-0 truncate text-[10px] font-medium leading-4 text-text-light-gray group-hover/agent:hidden group-focus-within/agent:hidden"
                                  title={additionalBoards
                                    .map((board) => board.name)
                                    .join(", ")}
                                >
                                  {additionalBoards
                                    .map((board) => board.name)
                                    .join(" · ")}
                                </span>
                              )}

                              {ownsAgent && (
                                <div className="hidden shrink-0 items-center gap-1 self-center group-hover/agent:flex group-focus-within/agent:flex">
                                  {canAddToBoard && (
                                    <button
                                      type="button"
                                      className={`${TEXT_ACTION_CLASS} mr-1 max-w-[190px] shrink-0`}
                                      disabled={isAdding}
                                      onClick={() => {
                                        if (!currentProject) return;
                                        addAgentToBoard.mutate(
                                          {
                                            projectId: currentProject.id,
                                            agentId: a.id,
                                          },
                                          {
                                            onSuccess: () =>
                                              toast.success(
                                                `${a.displayName} was added to ${currentBoardName}`,
                                              ),
                                            onError: (error) =>
                                              toast.error(
                                                error instanceof Error
                                                  ? error.message
                                                  : "Could not add agent to board",
                                              ),
                                          },
                                        );
                                      }}
                                    >
                                      <Plus
                                        strokeWidth={1.75}
                                        className="h-3.5 w-3.5 shrink-0"
                                        aria-hidden
                                      />
                                      <span className="truncate">
                                        {isAdding
                                          ? "Adding…"
                                          : `Add to ${currentBoardName || "board"}`}
                                      </span>
                                    </button>
                                  )}
                                  {a.runtimeType === "NATIVE" ? (
                                    <button
                                      type="button"
                                      className={ROW_ACTION_CLASS}
                                      aria-label="Chat"
                                      title="Chat"
                                      onClick={() => {
                                        closeHandler("chat", a);
                                      }}
                                    >
                                      <MessageCircle
                                        strokeWidth={1.75}
                                        className="h-3.5 w-3.5 shrink-0"
                                        aria-hidden
                                      />
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      className={ROW_ACTION_CLASS}
                                      aria-label="Check inbox"
                                      title="Check inbox"
                                      onClick={() => {
                                        closeHandler("inbox", a);
                                      }}
                                    >
                                      <Inbox
                                        strokeWidth={1.75}
                                        className="h-3.5 w-3.5 shrink-0"
                                        aria-hidden
                                      />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className={ROW_ACTION_CLASS}
                                    aria-label="Edit agent"
                                    title="Edit agent"
                                    onClick={() => {
                                      closeHandler("edit", a);
                                    }}
                                  >
                                    <Pencil
                                      strokeWidth={1.75}
                                      className="h-3.5 w-3.5 shrink-0"
                                      aria-hidden
                                    />
                                  </button>
                                  {a.runtimeType !== "NATIVE" && (
                                    <button
                                      type="button"
                                      className={`${ROW_ACTION_CLASS} ${
                                        isExpanded
                                          ? "bg-active-modal-element text-white-black"
                                          : ""
                                      }`}
                                      aria-label="Connect and push events"
                                      title="Connect and push events"
                                      onClick={() =>
                                        setExpandedAgentId(
                                          isExpanded ? null : a.id,
                                        )
                                      }
                                    >
                                      <PlugZap
                                        strokeWidth={1.75}
                                        className="h-3.5 w-3.5 shrink-0"
                                        aria-hidden
                                      />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className={ROW_ACTION_CLASS}
                                    aria-label="Disable agent"
                                    title="Disable agent"
                                    onClick={() => {
                                      setAgentToDelete(a.id);
                                      setShowConfirm(true);
                                    }}
                                  >
                                    <Trash2
                                      strokeWidth={1.75}
                                      className="h-3.5 w-3.5 shrink-0"
                                      aria-hidden
                                    />
                                  </button>
                                </div>
                              )}
                            </div>

                            {isExpanded && (
                              <div className="max-h-[900px] overflow-hidden opacity-100 transition-all duration-300 ease-in-out">
                                <AgentConnectPanel
                                  agent={a}
                                  token={agentToken}
                                  hasToken={agentHasToken}
                                  isLoading={generatingAgentIds.has(a.id)}
                                  onGenerate={() => generateAgentToken(a.id)}
                                  onTokenChange={(token) =>
                                    setAgentTokenOverrides((current) => ({
                                      ...current,
                                      [a.id]: token,
                                    }))
                                  }
                                />
                                <AgentWebhookPanel agent={a} />
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          )}
        </ModalBody>
        <ModalFooterComp className="m-0 justify-end px-5 pb-4 pt-0">
          <button
            type="button"
            className={TEXT_ACTION_CLASS}
            onClick={() => closeHandler()}
          >
            Done
          </button>
        </ModalFooterComp>
        {showConfirm && (
          <ConfirmModal
            header="Disable Agent?"
            content="Disabling this agent will terminate active connections, revoke its token, and hide it from its boards. Re-enable it from the disabled agents modal."
            confirmButtonContent="Disable"
            loading={revokeAgent.isPending}
            loadingLabel="Disabling…"
            confirmDisabled={!agentToDelete}
            onConfirm={confirmDisable}
            onCancel={() => setShowConfirm(false)}
            customClassName="sm:min-w-[500px] xs:max-h-[600px] z-[90000000] relative sm:top-[10px]"
            compact="my-[-15px]"
          />
        )}
      </GuestSignupOverlay>
    </ModalContainerCustom>
  );
};

export default ManageAgentsModal;
