"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import { aiChatAutoOpenPreferencesAtom, currentUserAtom } from "@/store";
import { useFlag, useFlagReady } from "@/hooks/useFlag";
import { HTPR_7650_AI_CHAT_OPEN_SWITCHES_FLAG } from "@/lib/flags/definitions/htpr-7650-ai-chat-open-switches";
import { AI_CHAT_AUTO_OPEN_DEFAULTS, AI_CHAT_AUTO_OPEN_KEYS, readLocalAiChatAutoOpenPreferences, type AiChatAutoOpenKey, type AiChatAutoOpenPreferences } from "@/lib/aiChat/autoOpenPreferences";
import { useHydrated } from "./useHydrated";
import { useGetUserPreferences, type IUserPreferences } from "./useGetUserPreferences";

export function useAiChatOpenPreferences() {
  const enabled = useFlag(HTPR_7650_AI_CHAT_OPEN_SWITCHES_FLAG);
  const flagReady = useFlagReady(HTPR_7650_AI_CHAT_OPEN_SWITCHES_FLAG);
  const hydrated = useHydrated();
  const user = useRecoilValue(currentUserAtom);
  const [saved, setSaved] = useRecoilState(aiChatAutoOpenPreferencesAtom);
  const queryClient = useQueryClient();
  const migrated = useMemo(() => hydrated ? readLocalAiChatAutoOpenPreferences() : AI_CHAT_AUTO_OPEN_DEFAULTS, [hydrated, user?.id]);
  const values = user?.id ? { ...migrated, ...saved[user.id] } : migrated;
  const setPreference = useCallback((key: AiChatAutoOpenKey, value: boolean) => {
    if (!enabled || !user?.id) return;
    setSaved((previous) => ({ ...previous, [user.id]: { ...migrated, ...previous[user.id], [key]: value } }));
    queryClient.setQueryData<IUserPreferences>(["user-preferences", "ai-chat-auto-open", String(user.id)], (previous) =>
      previous ? { ...previous, [key]: value } : previous);
    void axios.post("/api/users/preferences", { [key]: value }).catch(() => {});
  }, [enabled, user?.id, migrated, setSaved, queryClient]);
  return { enabled, flagReady, ready: hydrated && flagReady, values, setPreference };
}

export function useSyncAiChatOpenPreferences() {
  const { enabled, ready } = useAiChatOpenPreferences();
  const user = useRecoilValue(currentUserAtom);
  const [saved, setSaved] = useRecoilState(aiChatAutoOpenPreferencesAtom);
  const queryKey = useMemo(() => ["user-preferences", "ai-chat-auto-open", String(user?.id ?? "anonymous")], [user?.id]);
  const { data, dataUpdatedAt, isSuccess } = useGetUserPreferences(queryKey, undefined, { enabled: enabled && ready && !!user?.id });
  const attempted = useRef(new Set<string>());
  const applied = useRef<{ userId: number; data: IUserPreferences } | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || !ready || !user?.id || !isSuccess || !dataUpdatedAt || !data) return;
    if (applied.current?.userId === user.id && applied.current.data === data) return;
    applied.current = { userId: user.id, data };
    const local = { ...readLocalAiChatAutoOpenPreferences(), ...saved[user.id] };
    const next: AiChatAutoOpenPreferences = { ...local };
    const missing: Partial<AiChatAutoOpenPreferences> = {};
    for (const key of AI_CHAT_AUTO_OPEN_KEYS) {
      if (typeof data[key] === "boolean") next[key] = data[key];
      else if (data[key] === null && !attempted.current.has(`${user.id}:${key}`)) {
        attempted.current.add(`${user.id}:${key}`);
        missing[key] = local[key];
      }
    }
    setSaved((previous) => ({ ...previous, [user.id]: next }));
    if (Object.keys(missing).length) {
      queryClient.setQueryData<IUserPreferences>(queryKey, (previous) => previous ? { ...previous, ...missing } : previous);
      void axios.post("/api/users/preferences", missing).catch(() => {});
    }
  }, [enabled, ready, user?.id, isSuccess, dataUpdatedAt, data, saved, setSaved, queryClient, queryKey]);
}
