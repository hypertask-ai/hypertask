"use client";

import type { TAgentBoardAccess } from "@/lib/agents/boardAccess";
import { applySequencedError, applySequencedResponse } from "@/lib/agents/responseSequence";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useRecoilValue } from "@/lib/state";
import { appShellRailAtom } from "@/store";
import { useRouter } from "next/navigation";
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, } from "react";
import { IProp, TActivityItem, TDetailAgent } from "./agentDetailTypes";

export function useAgentDetailState(props: IProp) {
  const { agentId, currentUser, embedded } = props;
  const isMbl = useContext(MobileViewContext);
  const railEnabled = useRecoilValue(appShellRailAtom);
  const appShellRailOn = !embedded && railEnabled && !isMbl;
  const router = useRouter();

  const [agent, setAgent] = useState<TDetailAgent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<TActivityItem[] | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [togglePending, setTogglePending] = useState(false);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  // A native agent can carry its own provider key, so its turns bill that
  // provider account instead of the team's shared key (HTPR-5389).
  const [providerKey, setProviderKey] = useState<{
    provider: string;
    maskedKey: string | null;
  } | null>(null);
  const [providerKeyLoaded, setProviderKeyLoaded] = useState(false);
  const [confirmTeamVisibility, setConfirmTeamVisibility] = useState(false);
  const [editingProviderKey, setEditingProviderKey] = useState(false);
  const [providerKeyDraft, setProviderKeyDraft] = useState("");
  const [savingProviderKey, setSavingProviderKey] = useState(false);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [visibilityNotice, setVisibilityNotice] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);
  const [openingChat, setOpeningChat] = useState(false);
  const [boardAccessOpen, setBoardAccessOpen] = useState(false);
  const [pendingBoardId, setPendingBoardId] = useState<number | null>(null);
  const [boardErrors, setBoardErrors] = useState<Record<number, string>>({});
  const [boardToRemove, setBoardToRemove] = useState<TAgentBoardAccess | null>(
    null,
  );
  const [manageOpen, setManageOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [savingImportant, setSavingImportant] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const responseSeq = useRef(0);
  const latestResponseSeq = useRef(new Map<string, number>());
  const bootstrappedAgentId = useRef<string | null>(null);
  const renderedAgentIdentity = useRef<{ id: string; slug: string | null } | null>(
    null,
  );
  const agentRouteRef = useRef(agentId);

  useLayoutEffect(() => {
    agentRouteRef.current = agentId;
  }, [agentId]);

  useEffect(() => {
    renderedAgentIdentity.current = agent
      ? { id: agent.id, slug: agent.slug ?? null }
      : null;
  }, [agent?.id, agent?.slug]);

  const applyResponse = useCallback(
    (seq: number, keys: string[], apply: () => void) =>
      applySequencedResponse(latestResponseSeq.current, seq, keys, apply),
    [],
  );
  const applyError = useCallback(
    (seq: number, keys: string[], apply: () => void) =>
      applySequencedError(latestResponseSeq.current, seq, keys, apply),
    [],
  );


  return {
    agentId, currentUser, embedded, isMbl, appShellRailOn, router, agent, setAgent, error, setError,
    activity, setActivity, activityError, setActivityError, editingName, setEditingName, nameDraft,
    setNameDraft, savingName, setSavingName, editingPrompt, setEditingPrompt, promptDraft,
    setPromptDraft, savingPrompt, setSavingPrompt, togglePending, setTogglePending, tokenBusy,
    setTokenBusy, savingModel, setSavingModel, providerKey, setProviderKey, providerKeyLoaded,
    setProviderKeyLoaded, confirmTeamVisibility, setConfirmTeamVisibility, editingProviderKey,
    setEditingProviderKey, providerKeyDraft, setProviderKeyDraft, savingProviderKey,
    setSavingProviderKey, savingVisibility, setSavingVisibility, visibilityNotice,
    setVisibilityNotice, openingChat, setOpeningChat, boardAccessOpen, setBoardAccessOpen,
    pendingBoardId, setPendingBoardId, boardErrors, setBoardErrors, boardToRemove, setBoardToRemove,
    manageOpen, setManageOpen, archiving, setArchiving, savingImportant, setSavingImportant,
    deleting, setDeleting, now, setNow, responseSeq, latestResponseSeq, bootstrappedAgentId,
    renderedAgentIdentity, agentRouteRef, applyResponse, applyError,
  };
}
