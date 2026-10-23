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
  const serverMode = preferences.boardSortMode;

  useEffect(() => {
    if (!enabled || !dataUpdatedAt || pendingSaves.current) return;
    const mode = isBoardSortMode(serverMode) ? serverMode : "teams";
    setBoardSortMode((current) => (current === mode ? current : mode));
  }, [enabled, dataUpdatedAt, serverMode, setBoardSortMode]);

  const changeBoardSortMode = (mode: BoardSortMode) => {
    setBoardSortMode(mode);
    if (!enabled) return;

    pendingSaves.current += 1;
    void queryClient.cancelQueries(
      { queryKey: USER_PREFERENCES_QUERY_KEY },
      { revert: false },
    );
    queryClient.setQueryData<IUserPreferences>(
      USER_PREFERENCES_QUERY_KEY,
      (current) => ({
        ...(current ?? preferences),
        boardSortMode: mode,
      }),
    );
    saveQueue.current = saveQueue.current
      .catch(() => {})
      .then(() => axios.post("/api/users/preferences", { boardSortMode: mode }))
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

  return [boardSortMode, changeBoardSortMode] as const;
};
