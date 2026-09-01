import axios from "axios";
import toast from "react-hot-toast";
import { ComponentType, useEffect, useRef, useState } from "react";
import { useRecoilState } from "@/lib/state";
import { useQueryClient } from "@tanstack/react-query";
import { ToggleSwitch, ToggleSwitchProps } from "./Single section items";
import { showTaskHistoryAtom } from "@/store";
import {
  useGetUserPreferences,
  USER_PREFERENCES_QUERY_KEY,
} from "@/hooks/General/useGetUserPreferences";
import {
  DEFAULT_DICTATION_LANGUAGE,
  DICTATION_LANGUAGE_OPTIONS,
} from "@/lib/dictationProvider";
import {
  DisplayAvatar,
  MentionPreference,
  ScrollSetting,
} from "@prisma/client";
import { userPreferencesRoute } from "@/lib/constants/APIRouteConstants";

interface IUserPreferences {
  displayAvatar: DisplayAvatar;
  commentsStacked: boolean;
  shareReadReceipts: boolean;
  scrollSetting: ScrollSetting;
  notification: boolean;
  notificationPreference: MentionPreference;
  playGifs: boolean;
  autoDescriptionSuggestions: boolean;
  dictationLanguage: string;
  inboxAdvanceOnSend: boolean;
}

const UserPreferenceSidebar = ({
  ToggleComponent = ToggleSwitch,
  variant = "task-page",
}: {
  ToggleComponent?: ComponentType<ToggleSwitchProps>;
  // Which slice of the preferences to render. Both slices share the same
  // query + POST plumbing, they just live in different settings sections.
  variant?: "task-page" | "inbox";
} = {}) => {
  const queryClient = useQueryClient();
  const { data, isFetching } = useGetUserPreferences();
  const autoDescriptionUpdateQueue = useRef(Promise.resolve());
  const autoDescriptionUpdateVersion = useRef(0);
  const autoDescriptionUpdatesPending = useRef(0);
  const autoDescriptionConfirmedValue = useRef(
    data.autoDescriptionSuggestions ?? true,
  );

  useEffect(() => {
    if (!isFetching && autoDescriptionUpdatesPending.current === 0) {
      autoDescriptionConfirmedValue.current =
        data.autoDescriptionSuggestions ?? true;
    }
  }, [data.autoDescriptionSuggestions, isFetching]);

  const [isStacked, setIsStacked] = useState<boolean>(data.commentsStacked);
  const [displayAvatar, setDisplayAvatar] = useState<boolean>(
    data.displayAvatar === "Show" ? true : false,
  );
  const [showTaskHistory, setShowTaskHistory] =
    useRecoilState(showTaskHistoryAtom);
  const shareReadReceipts = data.shareReadReceipts ?? false;
  const playGifs = data.playGifs ?? true;
  const autoDescriptionSuggestions = data.autoDescriptionSuggestions ?? true;
  const advanceOnSend = data.inboxAdvanceOnSend ?? true;
  const dictationLanguage = data.dictationLanguage ?? DEFAULT_DICTATION_LANGUAGE;

  const handleDictationLanguageSetting = (
    e: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const nextLanguage = e.target.value;
    queryClient.setQueryData<IUserPreferences>(
      USER_PREFERENCES_QUERY_KEY,
      (previous) => ({
        ...(previous ?? data),
        dictationLanguage: nextLanguage,
      }),
    );
    updateUserPreferences({ dictationLanguage: nextLanguage });
  };

  const handleStackSetting = (e: any) => {
    if (isStacked) {
      setIsStacked(false);
      updateUserPreferences({ commentsStacked: false });
    } else {
      setIsStacked(true);
      updateUserPreferences({ commentsStacked: true });
    }
  };

  const handleDisplayAvatarSetting = (e: any) => {
    if (displayAvatar) {
      setDisplayAvatar(false);
      updateUserPreferences({ displayAvatar: "Hidden" });
    } else {
      setDisplayAvatar(true);
      updateUserPreferences({ displayAvatar: "Show" });
    }
  };

  const handleAdvanceOnSendSetting = () => {
    const nextAdvanceOnSend = !advanceOnSend;
    queryClient.setQueryData<IUserPreferences>(
      USER_PREFERENCES_QUERY_KEY,
      (previous) => ({
        ...(previous ?? data),
        inboxAdvanceOnSend: nextAdvanceOnSend,
      }),
    );
    updateUserPreferences({ inboxAdvanceOnSend: nextAdvanceOnSend });
  };

  const handlePlayGifsSetting = () => {
    const nextPlayGifs = !playGifs;
    queryClient.setQueryData<IUserPreferences>(
      USER_PREFERENCES_QUERY_KEY,
      (previous) => ({
        ...(previous ?? data),
        playGifs: nextPlayGifs,
      }),
    );
    updateUserPreferences({ playGifs: nextPlayGifs });
  };

  const handleAutoDescriptionSuggestionsSetting = () => {
    const updateVersion = ++autoDescriptionUpdateVersion.current;
    autoDescriptionUpdatesPending.current += 1;
    let nextValue = true;
    queryClient.setQueryData<IUserPreferences>(
      USER_PREFERENCES_QUERY_KEY,
      (previous) => {
        nextValue = !(
          previous?.autoDescriptionSuggestions ??
          data.autoDescriptionSuggestions ??
          true
        );
        return {
          ...(previous ?? data),
          autoDescriptionSuggestions: nextValue,
        };
      },
    );
    autoDescriptionUpdateQueue.current = autoDescriptionUpdateQueue.current
      .catch(() => undefined)
      .then(async () => {
        try {
          const updated = await updateUserPreferences(
            { autoDescriptionSuggestions: nextValue },
            false,
          );
          if (updated) {
            autoDescriptionConfirmedValue.current = nextValue;
            if (updateVersion === autoDescriptionUpdateVersion.current) {
              queryClient.setQueryData<IUserPreferences>(
                USER_PREFERENCES_QUERY_KEY,
                (previous) => ({
                  ...(previous ?? data),
                  autoDescriptionSuggestions: nextValue,
                }),
              );
            }
            return;
          }
          if (updateVersion !== autoDescriptionUpdateVersion.current) return;

          toast.error("Could not update description suggestions");
          try {
            await queryClient.invalidateQueries(
              { queryKey: USER_PREFERENCES_QUERY_KEY },
              { throwOnError: true },
            );
          } catch {
            queryClient.setQueryData<IUserPreferences>(
              USER_PREFERENCES_QUERY_KEY,
              (previous) => ({
                ...(previous ?? data),
                autoDescriptionSuggestions:
                  autoDescriptionConfirmedValue.current,
              }),
            );
          }
        } finally {
          autoDescriptionUpdatesPending.current -= 1;
        }
      });
  };

  const handleReadReceiptsSetting = () => {
    const nextShareReadReceipts = !shareReadReceipts;
    queryClient.setQueryData<IUserPreferences>(
      USER_PREFERENCES_QUERY_KEY,
      (previous) => ({
        ...(previous ?? data),
        shareReadReceipts: nextShareReadReceipts,
      }),
    );
    updateUserPreferences({ shareReadReceipts: nextShareReadReceipts });
  };

  const updateUserPreferences = async (
    toUpdate: Partial<IUserPreferences>,
    reconcileResponse = true,
  ) => {
    try {
      const response = await axios.post(userPreferencesRoute, toUpdate);
      if (response.status !== 200 || !response.data.settings) return false;
      if (reconcileResponse) {
        queryClient.setQueryData(USER_PREFERENCES_QUERY_KEY, (prev) => ({
          ...(prev ?? data),
          ...response.data.settings,
        }));
      }
      return true;
    } catch (error) {
      console.log("🚀 ~ updateUserPreferences ~ error:", error);
      return false;
    }
  };

  if (variant === "inbox") {
    return (
      <>
        <ToggleComponent
          label="Archive and go to next task after sending a comment"
          inputId="inbox-advance-on-send-toggle"
          value={advanceOnSend}
          checked={advanceOnSend}
          onChange={handleAdvanceOnSendSetting}
        />
        <ToggleComponent
          label="Display avatar in inbox"
          inputId="display-avatar-toggle"
          value={displayAvatar}
          checked={displayAvatar}
          onChange={handleDisplayAvatarSetting}
        />
      </>
    );
  }

  return (
    <>
      <ToggleComponent
        label="Collapse Comments"
        inputId="collapse-comments-toggle"
        value={isStacked}
        checked={isStacked}
        onChange={handleStackSetting}
      />
      <ToggleComponent
        label="Play GIFs"
        inputId="play-gifs-toggle"
        value={playGifs}
        checked={playGifs}
        onChange={handlePlayGifsSetting}
      />
      <ToggleComponent
        label="Suggest descriptions from task titles"
        description="Show an AI draft below empty task descriptions"
        inputId="auto-description-suggestions-toggle"
        value={autoDescriptionSuggestions}
        checked={autoDescriptionSuggestions}
        onChange={handleAutoDescriptionSuggestionsSetting}
      />
      <ToggleComponent
        label="Show task history"
        inputId="flexSwitchShowTaskHistory"
        value={showTaskHistory}
        checked={showTaskHistory}
        onChange={() => setShowTaskHistory((prev) => !prev)}
      />
      <ToggleComponent
        label="Read receipts"
        description="Share when you've seen comments, and see who's seen yours"
        inputId="read-receipts-toggle"
        value={shareReadReceipts}
        checked={shareReadReceipts}
        onChange={handleReadReceiptsSetting}
      />
      <div className="flex min-h-[28px] items-center justify-between gap-4 px-2 py-1">
        <label
          htmlFor="dictation-language-select"
          className="text-content font-semibold text-white-black"
        >
          Dictation language
        </label>
        <select
          id="dictation-language-select"
          value={dictationLanguage}
          onChange={handleDictationLanguageSetting}
          className="cursor-pointer rounded-[4px] border-0 bg-active-modal-element px-2 py-1 text-content font-semibold text-white-black outline-none"
        >
          {DICTATION_LANGUAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </>
  );
};

export default UserPreferenceSidebar;
