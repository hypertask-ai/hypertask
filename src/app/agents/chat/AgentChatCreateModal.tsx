"use client";

import { ModalContainerCustom, ModalHeaderComp, ModalInput, } from "@/components/Common/CommonModalComponents";
import type { useAgentChatState } from "./useAgentChatState";
import type { useAgentLifecycle } from "./useAgentLifecycle";

type Props = Pick<
  ReturnType<typeof useAgentChatState>,
  | "creatingAgent"
  | "setShowCreateAgent"
  | "setCreateAgentError"
  | "setNewAgentName"
  | "setNewAgentToken"
  | "setTokenCopied"
  | "newAgentToken"
  | "showCreateAgent"
  | "tokenCopied"
  | "newAgentName"
  | "createAgentError"
> &
  Pick<
  ReturnType<typeof useAgentLifecycle>,
  | "createAgent"
>;

export function AgentChatCreateModal({
  creatingAgent, setShowCreateAgent, setCreateAgentError, setNewAgentName, setNewAgentToken,
  setTokenCopied, newAgentToken, showCreateAgent, tokenCopied, newAgentName, createAgent,
  createAgentError,
}: Props) {
  const closeCreateAgent = () => {
    if (creatingAgent) return;
    // A token is showing only right after a successful create; closing here
    // always means the user has seen it (or chose not to), never mid-request.
    setShowCreateAgent(false);
    setCreateAgentError(null);
    setNewAgentName("");
    setNewAgentToken(null);
    setTokenCopied(false);
  };

  const copyNewAgentToken = async () => {
    if (!newAgentToken) return;
    try {
      await navigator.clipboard.writeText(newAgentToken);
      setTokenCopied(true);
    } catch {
      // Clipboard access can be blocked (permissions, insecure context); the
      // token stays selectable in the input either way.
    }
  };

  const createAgentModal = showCreateAgent ? (
    <ModalContainerCustom
      id="create-agent-modal"
      isOpen={true}
      show={true}
      toggle={closeCreateAgent}
      // Once the one-time token is showing, an accidental outside click or
      // Escape press must not discard it: force the explicit Done/copy
      // affordance instead.
      shouldCloseOnClickOutside={!newAgentToken}
      keyboard={!newAgentToken}
      className="sm:min-w-[400px]"
    >
      <ModalHeaderComp header="Add agent" />
      <div className="px-6 pb-4">
        {newAgentToken ? (
          <>
            <p className="text-dense text-white-black">
              Agent created. Copy its token now, it will not be shown again.
            </p>
            <input
              readOnly
              value={newAgentToken}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Agent token"
              className="mt-2 w-full border-b border-light-black-border-1 bg-transparent px-0 py-1.5 text-meta text-white-black"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => void copyNewAgentToken()}
                className="rounded-[4px] px-3 py-1.5 text-dense text-text-light-gray hover:bg-hoverCardBackground"
              >
                {tokenCopied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={closeCreateAgent}
                className="rounded-[4px] bg-shadcn-primary px-3 py-1.5 text-dense font-medium text-primary-foreground hover:opacity-80"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <ModalInput
              value={newAgentName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewAgentName(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === "Enter") void createAgent();
                if (e.key === "Escape") closeCreateAgent();
              }}
              placeholder="Agent name"
              aria-label="Agent name"
              className="border-b border-light-black-border-1 px-0"
            />
            {createAgentError && (
              <p className="mt-2 text-meta text-red-500">{createAgentError}</p>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeCreateAgent}
                disabled={creatingAgent}
                className="rounded-[4px] px-3 py-1.5 text-dense text-text-light-gray hover:bg-hoverCardBackground disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void createAgent()}
                disabled={creatingAgent || !newAgentName.trim()}
                className="rounded-[4px] bg-shadcn-primary px-3 py-1.5 text-dense font-medium text-primary-foreground hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creatingAgent ? "Creating…" : "Create"}
              </button>
            </div>
          </>
        )}
      </div>
    </ModalContainerCustom>
  ) : null;

  return createAgentModal;
}
