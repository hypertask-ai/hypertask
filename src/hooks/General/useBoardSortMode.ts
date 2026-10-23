import { useEffect, useRef } from "react";
import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
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

export const useBoardSortMode = () => {
  const enabled = useFlag(HTPR_7649_SIDEBAR_VIEW_SAVED_FLAG);
  const [boardSortMode, setBoardSortMode] = useRecoilState(boardSortModeAtom);
  const { data: preferences, dataUpdatedAt } = useGetUserPreferences(
    undefined,
    undefined,
    { enabled },
  );
  const queryClient = useQueryClient();
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const pendingSaves = useRef(0);
  const copiedLocalChoice = useRef(false);
  const serverMode = preferences.boardSortMode;

  const saveBoardSortMode = (save: BoardSortModeSave) => {
    pendingSaves.current += 1;
    if ("boardSortMode" in save && dataUpdatedAt) {
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
    }
    saveQueue.current = saveQueue.current
      .catch(() => {})
      .then(() => axios.post("/api/users/preferences", save))
      .catch((error) => console.error("Could not save sidebar view", error))
      .finally(() => {
        pendingSaves.current -= 1;
        if (!pendingSaves.current) {
          void queryClient
            .invalidateQueries({ queryKey: USER_PREFERENCES_QUERY_KEY })
            .catch((error) => console.error("Could not refresh sidebar view", error));
        }
      });
  };

  useEffect(() => {
    if (!enabled || !dataUpdatedAt || pendingSaves.current) return;
    if (isBoardSortMode(serverMode)) {
      setBoardSortMode((current) => (current === serverMode ? current : serverMode));
    } else if (boardSortMode !== "teams" && !copiedLocalChoice.current) {
      copiedLocalChoice.current = true;
      saveBoardSortMode({ boardSortModeIfUnset: boardSortMode });
    }
  }, [enabled, dataUpdatedAt, serverMode, boardSortMode, setBoardSortMode]);

  const changeBoardSortMode = (mode: BoardSortMode) => {
    setBoardSortMode(mode);
    if (enabled) saveBoardSortMode({ boardSortMode: mode });
  };

  return [boardSortMode, changeBoardSortMode] as const;
};
