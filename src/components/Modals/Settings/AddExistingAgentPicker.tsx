"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  HintKey,
  ModalContainerCustom,
  ModalHeaderComp,
  ModalInput,
  ModalListContainer,
  ModalRowElementContainer,
} from "@/components/Common/CommonModalComponents";
import UserAvatar from "@/components/Common/UserAvatar";
import { boardAgentsQueryKey, useAgents } from "@/hooks/MultiPages/useAgents";
import { addExistingAgentGroups, type OwnedAgentForBoard } from "@/lib/agents/addExistingAgentGroups";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { useRecoilValue } from "@/lib/state";
import { currentUserAtom } from "@/store";

type Props = {
  projectId: number;
  boardName: string;
  boardTeamId: string | null;
  onClose: () => void;
};

const AddExistingAgentPicker = ({ projectId, boardName, boardTeamId, onClose }: Props) => {
  const currentUser = useRecoilValue(currentUserAtom);
  const queryClient = useQueryClient();
  const router = useRouter();
  const { addAgentToBoard } = useAgents({ projectId, teamId: boardTeamId });
  const [keyword, setKeyword] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedAgent, setSelectedAgent] = useState<OwnedAgentForBoard | null>(null);
  const submitting = useRef(false);
  const { data: ownedAgents = [], isLoading, error } = useQuery({
    queryKey: ["htpr-7577-owned-agents", currentUser?.id],
    queryFn: async (): Promise<OwnedAgentForBoard[]> => {
      const response = await fetch("/api/agents/owned");
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.agents)) {
        throw new Error(data.error ?? "Could not load agents");
      }
      return data.agents;
    },
    enabled: Boolean(currentUser?.id),
    refetchOnWindowFocus: false,
  });
  const groups = addExistingAgentGroups(ownedAgents, projectId, boardTeamId, keyword);
  const enabledAgents = [...groups.onThisTeam, ...groups.notOnAnyBoard];

  const pickAgent = (agent: OwnedAgentForBoard) => {
    setSelectedAgent(agent);
    setSelectedIndex(0);
  };

  const addAgent = async () => {
    if (!selectedAgent || submitting.current) return;
    submitting.current = true;
    try {
      await addAgentToBoard.mutateAsync({ projectId, agentId: selectedAgent.id });
      await queryClient.invalidateQueries({ queryKey: boardAgentsQueryKey(projectId) });
      toast.success(`${selectedAgent.displayName} added to ${boardName}`);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add agent to board");
    } finally {
      submitting.current = false;
    }
  };

  const handleKeydownRef = useRef<(event: KeyboardEvent) => void>(undefined);
  handleKeydownRef.current = (event) => {
    if (event.keyCode === KeyCodes.ESCAPE) {
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
      return;
    }
    if (event.keyCode === KeyCodes.ENTER) {
      if (event.target instanceof HTMLElement && event.target.closest("a, button")) return;
      event.preventDefault();
      if (selectedAgent) {
        if (selectedIndex === 0) void addAgent();
        else onClose();
      } else if (enabledAgents[selectedIndex]) {
        pickAgent(enabledAgents[selectedIndex]);
      }
    }
    const length = selectedAgent ? 2 : enabledAgents.length;
    if (length === 0) return;
    if (event.keyCode === KeyCodes.ARROW_DOWN || event.keyCode === KeyCodes.ARROW_UP) {
      event.preventDefault();
      const offset = event.keyCode === KeyCodes.ARROW_DOWN ? 1 : -1;
      const nextIndex = (selectedIndex + length + offset) % length;
      setSelectedIndex(nextIndex);
      document.getElementById(`add-existing-agent-${nextIndex}`)?.scrollIntoView({ block: "nearest" });
    }
  };

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => handleKeydownRef.current?.(event);
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [ownedAgents]);

  return (
    <ModalContainerCustom
      id="addExistingAgentModal"
      isOpen={true}
      show={true}
      toggle={onClose}
      keyboard={false}
      // eslint-disable-next-line tailwindcss/no-custom-classname
      className="paletteModalSizing min-w-0 w-[calc(100%-24px)] sm:min-w-[560px] sm:top-[24%]"
    >
      <ModalHeaderComp
        header={selectedAgent ? `Add ${selectedAgent.displayName} to ${boardName}?` : "Add existing agent"}
      />
      {selectedAgent ? (
        <ModalListContainer id="addExistingAgentConfirm" className="pb-2">
          <ModalRowElementContainer
            id="add-existing-agent-0"
            isSelected={selectedIndex === 0}
            aria-disabled={addAgentToBoard.isPending}
            onMouseEnter={() => setSelectedIndex(0)}
            onClick={() => void addAgent()}
          >
            <span>Add</span>
            <HintKey>Enter</HintKey>
          </ModalRowElementContainer>
          <ModalRowElementContainer
            id="add-existing-agent-1"
            isSelected={selectedIndex === 1}
            onMouseEnter={() => setSelectedIndex(1)}
            onClick={onClose}
          >
            <span>Cancel</span>
            <HintKey>Esc</HintKey>
          </ModalRowElementContainer>
        </ModalListContainer>
      ) : (
        <>
          <ModalInput
            value={keyword}
            placeholder="Search agents you own..."
            onChange={(event) => {
              setKeyword(event.target.value);
              setSelectedIndex(0);
            }}
          />
          {isLoading || error || enabledAgents.length + groups.unavailable.length === 0 ? (
            <p className="px-6 py-4 text-dense text-text-light-gray">
              {isLoading ? "Loading agents..." : error ? error.message : "No agents you own can be added to this board"}
            </p>
          ) : (
            <ModalListContainer id="addExistingAgentList" className="max-h-[364px] pb-2">
              {[
                { title: "ON THIS TEAM", agents: groups.onThisTeam },
                { title: "NOT ON ANY BOARD", agents: groups.notOnAnyBoard },
              ].filter((group) => group.agents.length > 0).map((group) => (
                <Fragment key={group.title}>
                  <li role="presentation" className="px-6 py-2 text-meta font-semibold text-text-light-gray">
                    {group.title}
                  </li>
                  {group.agents.map((agent) => {
                    const index = enabledAgents.findIndex((item) => item.id === agent.id);
                    return (
                      <ModalRowElementContainer
                        key={agent.id}
                        id={`add-existing-agent-${index}`}
                        isSelected={selectedIndex === index}
                        onMouseEnter={() => setSelectedIndex(index)}
                        onClick={() => pickAgent(agent)}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <UserAvatar agentId={agent.id} name={agent.displayName} photoURL={agent.photoURL} size={24} />
                          <span className="truncate">{agent.displayName}</span>
                        </div>
                      </ModalRowElementContainer>
                    );
                  })}
                </Fragment>
              ))}
              {groups.unavailable.length > 0 && (
                <>
                  <li role="presentation" className="px-6 py-2 text-meta font-semibold text-text-light-gray">
                    UNAVAILABLE
                  </li>
                  {groups.unavailable.map(({ agent, reason }) => (
                    <ModalRowElementContainer
                      key={agent.id}
                      isSelected={false}
                      onClick={() => router.push(`/agents/${agent.id}`)}
                      aria-disabled={true}
                      className="h-auto min-h-11 cursor-default py-2 text-text-light-gray"
                    >
                      <div className="min-w-0">
                        <p className="truncate">{agent.displayName}</p>
                        <p className="text-meta">{reason}</p>
                      </div>
                      <Link href={`/agents/${agent.id}`} className="shrink-0 text-hypertasks-purple">
                        View agent
                      </Link>
                    </ModalRowElementContainer>
                  ))}
                </>
              )}
            </ModalListContainer>
          )}
        </>
      )}
    </ModalContainerCustom>
  );
};

export default AddExistingAgentPicker;
