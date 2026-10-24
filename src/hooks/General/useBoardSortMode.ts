import { useEffect, useRef } from "react";
import axios from "axios";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRecoilState } from "@/lib/state";
import { boardSortModeAtom } from "@/store";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7649_SIDEBAR_VIEW_SAVED_FLAG } from "@/lib/flags/definitions/htpr-7649-sidebar-view-saved";
import {
  isBoardSortMode,
  type BoardSortMode,
} from "@/lib/configs/boardSortMode.config";
import {
  USER_PREFERENCES_QUERY_KEY,
  useGetUserPreferences,
  type IUserPreferences,
} from "./useGetUserPreferences";

type BoardSortModeSave =
  | { boardSortMode: BoardSortMode }
  | { boardSortModeIfUnset: BoardSortMode };

const BOARD_SORT_MODE_MUTATION_KEY = ["user-preferences", "board-sort-mode"] as const;

export const useBoardSortMode = () => {
  const enabled = useFlag(HTPR_7649_SIDEBAR_VIEW_SAVED_FLAG);
  const [boardSortMode, setBoardSortMode] = useRecoilState(boardSortModeAtom);
  const { data: preferences, dataUpdatedAt } = useGetUserPreferences(
    undefined,
    undefined,
    { enabled },
  );
  const queryClient = useQueryClient();
  const pendingSaves = useIsMutating({ mutationKey: BOARD_SORT_MODE_MUTATION_KEY });
  const copiedLocalChoice = useRef(false);
  const serverMode = preferences.boardSortMode;

  const { mutate: saveBoardSortMode } = useMutation({
    mutationKey: BOARD_SORT_MODE_MUTATION_KEY,
    scope: { id: "sidebar-board-sort-mode" },
    mutationFn: (save: BoardSortModeSave) => axios.post("/api/users/preferences", save),
    onMutate: (save) => {
      if (!("boardSortMode" in save) || !dataUpdatedAt) return;
      void queryClient.cancelQueries(
        { queryKey: USER_PREFERENCES_QUERY_KEY },
        { revert: false },
      );
      queryClient.setQueryData<IUserPreferences>(
        USER_PREFERENCES_QUERY_KEY,
        (current) => ({
          ...(current ?? preferences),
          boardSortMode: save.boardSortMode,
        }),
      );
    },
    onError: (error) => console.error("Could not save sidebar view", error),
    onSettled: async (response) => {
      if (queryClient.isMutating({ mutationKey: BOARD_SORT_MODE_MUTATION_KEY }) !== 1) return;
      await queryClient.cancelQueries(
        { queryKey: USER_PREFERENCES_QUERY_KEY },
        { revert: false },
      );
      const savedMode = response?.data?.settings?.boardSortMode;
      if (isBoardSortMode(savedMode)) {
        queryClient.setQueryData<IUserPreferences>(
          USER_PREFERENCES_QUERY_KEY,
          (current) => ({ ...(current ?? preferences), boardSortMode: savedMode }),
        );
      }
      await queryClient
        .invalidateQueries({ queryKey: USER_PREFERENCES_QUERY_KEY })
        .catch((error) => console.error("Could not refresh sidebar view", error));
    },
  });

  useEffect(() => {
    if (!enabled || !dataUpdatedAt || pendingSaves) return;
    if (isBoardSortMode(serverMode)) {
      setBoardSortMode((current) => (current === serverMode ? current : serverMode));
    } else if (boardSortMode !== "teams" && !copiedLocalChoice.current) {
      copiedLocalChoice.current = true;
      saveBoardSortMode({ boardSortModeIfUnset: boardSortMode });
    }
  }, [enabled, dataUpdatedAt, serverMode, boardSortMode, pendingSaves, setBoardSortMode, saveBoardSortMode]);

  const changeBoardSortMode = (mode: BoardSortMode) => {
    setBoardSortMode(mode);
    if (enabled) saveBoardSortMode({ boardSortMode: mode });
  };

  return [boardSortMode, changeBoardSortMode] as const;
};
