import { useCallback, useEffect } from "react";
import { useRecoilState, useRecoilValue, useSetRecoilState } from "@/lib/state";
import { currentProjectAtom, dockedChatScopeAtom, dockedChatScopePickedOnBoardAtom } from "@/store";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7685_CHAT_FOLLOWS_BOARD_FLAG } from "@/lib/flags/definitions/htpr-7685-chat-follows-board";

export type DockedChatScope = number | "all" | "ticket" | null;

export function useDockedChatScope() {
  const followsBoard = useFlag(HTPR_7685_CHAT_FOLLOWS_BOARD_FLAG);
  const currentBoardId = useRecoilValue(currentProjectAtom)?.id ?? null;
  const [savedScope, setSavedScope] = useRecoilState(dockedChatScopeAtom);
  const pickedOn = useRecoilValue(dockedChatScopePickedOnBoardAtom);
  const setPickedOn = useSetRecoilState(dockedChatScopePickedOnBoardAtom);
  const pickIsForAnotherBoard = pickedOn?.boardId !== currentBoardId;
  let dockedScope: DockedChatScope = savedScope;
  if (followsBoard && pickIsForAnotherBoard) dockedScope = null;
  useEffect(() => {
    if (pickedOn && pickIsForAnotherBoard) setPickedOn(null);
  }, [pickedOn, pickIsForAnotherBoard, setPickedOn]);
  const setDockedScope = useCallback((scope: DockedChatScope) => {
    setPickedOn({ boardId: currentBoardId });
    setSavedScope(scope);
  }, [currentBoardId, setPickedOn, setSavedScope]);
  return [dockedScope, setDockedScope] as const;
}
