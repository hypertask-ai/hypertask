import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import {
  USER_PREFERENCES_QUERY_KEY,
  useGetUserPreferences,
  type IUserPreferences,
} from "@/hooks/General/useGetUserPreferences";
import { DEFAULT_CARD_PARTS, settleCardParts, type CardPart, type CardParts } from "@/lib/kanban/cardParts";
import { useFirstScreenSurface } from "@/lib/firstScreen/SurfaceContext";

export const useCardParts = (): CardParts | null => {
  const { data, isFetched } = useGetUserPreferences();
  const surface = useFirstScreenSurface();
  const saved = data?.cardParts;
  const boot = surface?.display.cardParts;
  return useMemo(() => settleCardParts(saved, boot, isFetched), [saved, boot, isFetched]);
};

export const useSetCardPart = () => {
  const queryClient = useQueryClient();
  const parts = useCardParts();
  const writeParts = (next: CardParts) =>
    queryClient.setQueryData<IUserPreferences>(USER_PREFERENCES_QUERY_KEY, (previous) =>
      previous ? { ...previous, cardParts: next } : previous,
    );
  return async (part: CardPart, shown: boolean) => {
    const current = parts ?? DEFAULT_CARD_PARTS;
    const next: CardParts = { ...current, [part]: shown };
    writeParts(next);
    try {
      await axios.post("/api/users/preferences", { cardParts: next });
    } catch {
      writeParts(current);
    } finally {
      queryClient.invalidateQueries({ queryKey: USER_PREFERENCES_QUERY_KEY });
    }
  };
};
