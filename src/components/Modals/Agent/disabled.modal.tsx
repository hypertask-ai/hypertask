"use client";
import React, { useMemo, useState } from "react";
import UserAvatar from "@/components/Common/UserAvatar";
import {
  ModalContainerCustom,
  ModalFooterComp,
  ModalHeaderComp,
} from "@/components/Common/CommonModalComponents";
import { ModalBody } from "reactstrap";
import { Copy, Undo2 } from "lucide-react";
import { boardAgentsQueryKey, useAgents } from "@/hooks/MultiPages/useAgents";
import Tooltip from "@/components/Common/Tooltip";
import { useQueryClient } from "@tanstack/react-query";
import { currentProjectAtom, currentUserAtom } from "@/store";
import { useRecoilValue } from "@/lib/state";
import toast from "react-hot-toast";
import { MCP_SERVER_URL } from "@/components/Modals/McpToken/utils";

const AVATAR_PLACEHOLDER_BGS = [
  "bg-violet-400/40",
  "bg-teal-400/40",
  "bg-orange-300/45",
  "bg-sky-400/40",
  "bg-pink-300/45",
] as const;

function placeholderBgClass(agentId: string): string {
  let h = 0;
  for (let i = 0; i < agentId.length; i++) {
    h = (h + agentId.charCodeAt(i)) % 997;
  }
  return AVATAR_PLACEHOLDER_BGS[Math.abs(h) % AVATAR_PLACEHOLDER_BGS.length];
}

function formatAgentCreatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

interface DisabledAgentsModalProps {
  closeHandler: () => void;
}

const DisabledAgentsModal: React.FC<DisabledAgentsModalProps> = ({
  closeHandler,
}) => {
  const { agents, revokeAgent, isLoading: loading } = useAgents();
  const queryClient = useQueryClient();
  const currentProject = useRecoilValue(currentProjectAtom);
  const currentUser = useRecoilValue(currentUserAtom);
  const [reenabledCredential, setReenabledCredential] = useState<{
    displayName: string;
    token: string;
  } | null>(null);

  const disabledAgents = useMemo(
    () => agents.filter((a) => a.revokedAt),
    [agents],
  );

  const unrevokeAgent = async (
    agentId: string,
    displayName: string,
    runtimeType: "EXTERNAL" | "NATIVE" | undefined,
  ) => {
    const result = await revokeAgent.mutateAsync({ agentId, revoked: false });
    if (!result.token) {
      toast.success(
        runtimeType === "NATIVE"
          ? "Agent re-enabled"
          : "Agent already active. Regenerate its token to reconnect.",
      );
      return;
    }
    setReenabledCredential({ displayName, token: result.token });
    queryClient.refetchQueries({ queryKey: ["projectsAll"] });
    queryClient.refetchQueries({
      queryKey: boardAgentsQueryKey(currentProject?.id!),
    });
  };

  const configSnippet = reenabledCredential
    ? JSON.stringify(
        {
          mcpServers: {
            "hypertask-mcp": {
              url: MCP_SERVER_URL,
              headers: {
                Authorization: `Bearer ${reenabledCredential.token}`,
              },
            },
          },
        },
        null,
        2,
      )
    : "";

  const copyConfig = () => {
    navigator.clipboard.writeText(configSnippet).then(
      () => toast.success("Config copied"),
      () => toast.error("Failed to copy"),
    );
  };

  const subHeadline =
    disabledAgents.length === 1
      ? "1 disabled agent"
      : `${disabledAgents.length} disabled agents`;

  return (
    <ModalContainerCustom
      fade={false}
      show
      isOpen
      id="disabledAgentsModal"
      toggle={closeHandler}
      shouldCloseOnClickOutside
      className="font-bold sm:min-w-[480px] sm:max-w-[560px]"
    >
      <ModalHeaderComp
        header="Disabled agents"
        subHeadline={subHeadline}
        subHeadlineClassName="text-text-light-gray block text-content font-normal"
        className="border-none mb-4"
      />
      <ModalBody className="max-h-[60vh] py-0 overflow-y-auto">
        {reenabledCredential && (
          <div className="mb-4 space-y-2 rounded-md border border-border-light-gray-thin bg-active-modal-element p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-content font-semibold text-white-black">
                  {reenabledCredential.displayName} is active
                </p>
                <p className="text-meta font-normal text-text-light-gray">
                  Copy this new MCP configuration now. It will not be shown
                  again.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm inline-flex shrink-0 items-center gap-1.5"
                onClick={copyConfig}
              >
                <Copy className="h-3.5 w-3.5" aria-hidden />
                Copy
              </button>
            </div>
            <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all rounded bg-cardBackground p-2 font-mono text-meta font-normal text-white-black">
              {configSnippet}
            </pre>
          </div>
        )}
        {loading && (
          <p className="text-content text-text-light-gray mb-2">Loading…</p>
        )}
        {!loading && disabledAgents.length === 0 && (
          <p className="text-content text-text-light-gray">
            No agents disabled.
          </p>
        )}
        {!loading && disabledAgents.length > 0 && (
          <ul className="space-y-3 p-1">
            {disabledAgents.map((a) => {
              const createdLabel = formatAgentCreatedAt(a.createdAt);

              return (
                <li
                  key={a.id}
                  className={`overflow-hidden rounded-lg border-thin border-border-light-gray-thin bg-cardBackground text-content transition-shadow duration-700`}
                >
                  <div className="flex gap-3 px-3 pt-3 pb-3">
                    <UserAvatar
                      agentId={a.id}
                      alt={a.displayName}
                      fallbackClassName={placeholderBgClass(a.id)}
                      name={a.displayName}
                      photoURL={a.photoURL}
                      size={44}
                      title={a.displayName}
                    />

                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-semibold text-white-black">
                            {a.displayName}
                          </span>
                        </div>
                        {createdLabel ? (
                          <div className="text-meta text-text-light-gray">
                            Created {createdLabel}
                          </div>
                        ) : null}
                      </div>

                      {a.userId === currentUser?.id && (
                        <div className="flex shrink-0 gap-2 self-center">
                          <button
                            type="button"
                            className="relative group btn btn-outline-secondary btn-sm inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                            disabled={revokeAgent.isPending}
                            onClick={() =>
                              void unrevokeAgent(
                                a.id,
                                a.displayName,
                                a.runtimeType,
                              )
                            }
                          >
                            <Undo2
                              strokeWidth={1.75}
                              className="h-3.5 w-3.5 shrink-0"
                              aria-hidden
                            />
                            <Tooltip
                              left={-100}
                              bottom={-7}
                              text="Re-enable"
                              keyCombination={[]}
                            />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </ModalBody>
      <ModalFooterComp className="border-t border-border-light-gray-thin justify-end gap-2">
        <button
          type="button"
          className="btn btn-secondary btn-sm rounded-md"
          onClick={() => closeHandler()}
        >
          Done
        </button>
      </ModalFooterComp>
    </ModalContainerCustom>
  );
};

export default DisabledAgentsModal;
