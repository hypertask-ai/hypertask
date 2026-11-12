import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import {
  USER_PREFERENCES_QUERY_KEY,
  useGetUserPreferences,
  type IUserPreferences,
} from "@/hooks/General/useGetUserPreferences";
import { parseCardParts, resolveCardParts, type CardPart, type CardParts } from "@/lib/kanban/cardParts";
import { useFirstScreenSurface } from "@/lib/firstScreen/SurfaceContext";

export const useCardParts = (): CardParts | null => {
  const { data } = useGetUserPreferences();
  const surface = useFirstScreenSurface();
  const saved = data?.cardParts;
  const boot = surface?.display.cardParts;
  return useMemo(() => resolveCardParts(saved, boot), [saved, boot]);
};

export const useSetCardPart = () => {
  const queryClient = useQueryClient();
  const writeParts = (parts: CardParts) =>
    queryClient.setQueryData<IUserPreferences>(USER_PREFERENCES_QUERY_KEY, (previous) =>
      previous ? { ...previous, cardParts: parts } : previous,
    );
  return async (part: CardPart, shown: boolean) => {
    const current = parseCardParts(
      queryClient.getQueryData<IUserPreferences>(USER_PREFERENCES_QUERY_KEY)?.cardParts,
    );
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
