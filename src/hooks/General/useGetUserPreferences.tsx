import { useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import type { TAiModelPreferences } from "@/lib/aiModelPreferences";
import type { ISnippet } from "@/lib/snippets";
import type {
  DisplayAvatar,
  MentionPreference,
  ScrollSetting,
} from "@prisma/client";
import type { CalendarViewsPreference } from "@/models/Calendar/model";

export interface IUserPreferences {
  displayAvatar: DisplayAvatar;
  commentsStacked: boolean;
  shareReadReceipts: boolean;
  scrollSetting: ScrollSetting;
  notification: boolean;
  notificationPreference: MentionPreference;
  aiModelPreferences?: TAiModelPreferences | null;
  snippets: ISnippet[];
  muteAnnouncements: boolean;
  playGifs: boolean;
  autoDescriptionSuggestions: boolean;
  dictationLanguage: string;
  inboxAdvanceOnSend: boolean;
  emojiFrequency?: Record<string, number> | null;
  calendarViews: CalendarViewsPreference | null;
}

export const DEFAULT_USER_PREFERENCES: IUserPreferences = {
  displayAvatar: "Hidden",
  commentsStacked: false,
  shareReadReceipts: false,
  scrollSetting: "Bottom",
  notification: false,
  notificationPreference: "direct",
  aiModelPreferences: null,
  snippets: [],
  muteAnnouncements: false,
  playGifs: true,
  autoDescriptionSuggestions: true,
  dictationLanguage: "en",
  inboxAdvanceOnSend: true,
  emojiFrequency: null,
  calendarViews: null,
};

export const USER_PREFERENCES_QUERY_KEY = ["user-preferences"] as const;

export const useGetUserPreferences = (
  queryKey: readonly string[] = USER_PREFERENCES_QUERY_KEY,
  initialData?: IUserPreferences,
  options?: { enabled?: boolean },
) => {
  return useQuery({
    queryKey,
    queryFn: () => fetchUserPreference(),
    enabled: options?.enabled ?? true,
    initialData: initialData ?? DEFAULT_USER_PREFERENCES,
    initialDataUpdatedAt: initialData ? undefined : 0,
    refetchOnWindowFocus: false,
    // Preferences barely change; staleTime 0 made every consumer remount
    // refetch them — measured one fetch per J/E keystroke in the inbox (HTPR-3998).
    staleTime: 5 * 60 * 1000,
  });
};

export const useAnnouncementMute = () => {
  const { data: preferences } = useGetUserPreferences();
  const queryClient = useQueryClient();
  const muted = !!preferences?.muteAnnouncements;

  const setMutedOptimistic = (value: boolean) =>
    queryClient.setQueryData<IUserPreferences>(USER_PREFERENCES_QUERY_KEY, (old) =>
      old ? { ...old, muteAnnouncements: value } : old
    );

  const toggleMute = async () => {
    // Read the latest cached value (not the closed-over one) so rapid clicks flip
    // from the current state; the final invalidate reconciles with the server.
    const current =
      queryClient.getQueryData<IUserPreferences>(USER_PREFERENCES_QUERY_KEY)
        ?.muteAnnouncements ?? muted;
    const next = !current;
    setMutedOptimistic(next); // update the rocket indicator immediately
    try {
      await axios.post("/api/users/preferences", { muteAnnouncements: next });
    } catch {
      setMutedOptimistic(current); // roll back on failure
    } finally {
      queryClient.invalidateQueries({ queryKey: USER_PREFERENCES_QUERY_KEY });
    }
  };

  return { muted, toggleMute };
};

export const fetchUserPreference = async (
  useDefaultOnError = true,
): Promise<IUserPreferences> => {
  try {
    const response = await axios.get("/api/users/preferences");
    if (response.status == 200) {
      return response.data.settings as IUserPreferences;
    } else {
      console.error("🚀 ~ fetchUserPreference ~ error:", response.data.error);
      return response.data.settings as IUserPreferences;
    }
  } catch (error) {
    console.log("🚀 ~ fetchUserPreference ~ error:", error);
    if (!useDefaultOnError) throw error;
    return DEFAULT_USER_PREFERENCES;
  }
};
