"use client";

import {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { useRecoilState } from "@/lib/state";
import { useFlag } from "@/hooks/useFlag";
import { GOOGLE_CALENDAR_FLAG } from "@/lib/flags/keys";
import {
  GOOGLE_CALENDAR_CONNECTION_PATH,
  GOOGLE_CALENDAR_OAUTH_START_PATH,
  GOOGLE_CALENDAR_SETTINGS_PATH,
  googleCalendarErrorMessage,
} from "@/lib/googleCalendar/paths";
import { calendarSettingsAtom } from "@/store";
import { cn } from "@/utils/undoActions/helperFuncs";
import SettingsCard from "./SettingsCard";
import {
  BillingActionRow,
  BillingRow,
  settingsActionButtonClass,
} from "./SettingsBillingRow";
import SettingsSectionShell from "./SettingsSectionShell";
import SettingsToggle from "./SettingsToggle";

const WEEK_START_OPTIONS = ["monday", "sunday"] as const;
const CONNECTION_POLL_INTERVAL_MS = 5000;

type GoogleCalendarConnection = {
  calendarSummary: string;
  cleanupPending: boolean;
  disconnectRequestedAt: string | null;
  googleEmail: string | null;
  lastSyncedAt: string | null;
  syncEnabled: boolean;
  syncError: string | null;
};

const CONNECT_URL = `${GOOGLE_CALENDAR_OAUTH_START_PATH}?returnTo=${encodeURIComponent(
  GOOGLE_CALENDAR_SETTINGS_PATH,
)}`;

const CalendarSection = () => {
  const [settings, setSettings] = useRecoilState(calendarSettingsAtom);
  const enabled = useFlag(GOOGLE_CALENDAR_FLAG);
  const searchParams = useSearchParams();
  const [connection, setConnection] = useState<GoogleCalendarConnection | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<"disconnect" | "toggle" | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const refreshAbort = useRef<AbortController | null>(null);
  const mutationPending = useRef(false);
  const mutationSequence = useRef(0);

  const refreshConnection = useCallback(async () => {
    if (!enabled || mutationPending.current) return;
    const sequence = mutationSequence.current;
    refreshAbort.current?.abort();
    const controller = new AbortController();
    refreshAbort.current = controller;
    try {
      const response = await fetch(GOOGLE_CALENDAR_CONNECTION_PATH, {
        credentials: "include",
        signal: controller.signal,
      });
      const data = (await response.json().catch(() => null)) as {
        connection?: GoogleCalendarConnection | null;
      } | null;
      if (!response.ok || !data)
        throw new Error("Could not load Google Calendar");
      if (
        controller.signal.aborted ||
        mutationPending.current ||
        sequence !== mutationSequence.current
      )
        return;
      setConnection(data.connection ?? null);
      setConnectionError(null);
    } catch {
      if (controller.signal.aborted) return;
      setConnectionError("Could not load Google Calendar.");
    } finally {
      if (refreshAbort.current === controller) {
        refreshAbort.current = null;
        setLoading(false);
      }
    }
  }, [enabled]);

  useEffect(() => {
    void refreshConnection();
    return () => {
      const controller = refreshAbort.current;
      refreshAbort.current = null;
      controller?.abort();
    };
  }, [refreshConnection]);

  useEffect(() => {
    if (
      !connection?.disconnectRequestedAt &&
      !connection?.cleanupPending &&
      (!connection?.syncEnabled || connection.lastSyncedAt)
    )
      return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      await refreshConnection();
      if (!cancelled)
        timer = window.setTimeout(poll, CONNECTION_POLL_INTERVAL_MS);
    };
    timer = window.setTimeout(poll, CONNECTION_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [
    connection?.cleanupPending,
    connection?.disconnectRequestedAt,
    connection?.lastSyncedAt,
    connection?.syncEnabled,
    refreshConnection,
  ]);

  const oauthError = useMemo(() => {
    const code = searchParams?.get("google_calendar_error");
    return code ? googleCalendarErrorMessage(code) : null;
  }, [searchParams]);

  const lastSynced = useMemo(() => {
    if (!connection?.lastSyncedAt) return "Waiting for first update";
    return new Date(connection.lastSyncedAt).toLocaleString();
  }, [connection?.lastSyncedAt]);
  const visibleError = connectionError ?? (enabled ? oauthError : null);

  const changeSync = async () => {
    if (!connection || pending) return;
    const syncEnabled = !connection.syncEnabled;
    mutationPending.current = true;
    mutationSequence.current += 1;
    const refreshController = refreshAbort.current;
    refreshAbort.current = null;
    refreshController?.abort();
    setPending("toggle");
    setConnectionError(null);
    try {
      const response = await fetch(GOOGLE_CALENDAR_CONNECTION_PATH, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ syncEnabled }),
      });
      if (!response.ok) throw new Error("Could not update Google Calendar");
      setConnection((current) =>
        current
          ? {
              ...current,
              cleanupPending: !syncEnabled,
              disconnectRequestedAt: null,
              lastSyncedAt: syncEnabled ? null : current.lastSyncedAt,
              syncEnabled,
              syncError: null,
            }
          : current,
      );
      toast.success(
        syncEnabled ? "Calendar updates turned on" : "Calendar cleanup started",
      );
    } catch {
      setConnectionError("Could not update Google Calendar.");
    } finally {
      mutationPending.current = false;
      setPending(null);
    }
  };

  const disconnect = async () => {
    if (!connection || pending) return;
    mutationPending.current = true;
    mutationSequence.current += 1;
    const refreshController = refreshAbort.current;
    refreshAbort.current = null;
    refreshController?.abort();
    setPending("disconnect");
    setConnectionError(null);
    try {
      const response = await fetch(GOOGLE_CALENDAR_CONNECTION_PATH, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Could not disconnect Google Calendar");
      setConnection((current) =>
        current
          ? {
              ...current,
              cleanupPending: true,
              disconnectRequestedAt: new Date().toISOString(),
              syncEnabled: false,
            }
          : current,
      );
      toast.success("Google Calendar disconnect started");
    } catch {
      setConnectionError("Could not disconnect Google Calendar.");
    } finally {
      mutationPending.current = false;
      setPending(null);
    }
  };

  let googleCalendarContent: ReactNode;
  if (loading) {
    googleCalendarContent = (
      <p className="px-2 py-3 text-dense font-medium text-text-light-gray">
        Loading Google Calendar…
      </p>
    );
  } else if (connectionError && !connection) {
    googleCalendarContent = (
      <BillingActionRow
        label="Google Calendar status unavailable"
        action={
          <button
            className={settingsActionButtonClass}
            onClick={() => {
              setLoading(true);
              void refreshConnection();
            }}
            type="button"
          >
            Retry
          </button>
        }
      />
    );
  } else if (!connection) {
    googleCalendarContent = (
      <BillingActionRow
        label="Google Calendar"
        action={
          <a className={settingsActionButtonClass} href={CONNECT_URL}>
            Connect
          </a>
        }
      />
    );
  } else {
    googleCalendarContent = (
      <>
        <BillingActionRow
          label={connection.googleEmail || "Google account"}
          action={
            <button
              className={settingsActionButtonClass}
              disabled={Boolean(pending || connection.disconnectRequestedAt)}
              onClick={() => void disconnect()}
              type="button"
            >
              {connection.disconnectRequestedAt || pending === "disconnect"
                ? "Disconnecting…"
                : "Disconnect"}
            </button>
          }
        />
        <BillingRow label="Calendar" value={connection.calendarSummary} />
        <SettingsToggle
          checked={connection.syncEnabled}
          description={
            connection.cleanupPending
              ? "Removing Hypertask events…"
              : "Tasks assigned to you with due dates"
          }
          disabled={Boolean(pending || connection.disconnectRequestedAt)}
          inputId="google-calendar-sync"
          label="Keep tasks updated"
          onChange={() => void changeSync()}
          value={connection.syncEnabled}
        />
        <BillingRow label="Last updated" value={lastSynced} />
        {connection.syncError && (
          <div className="flex items-center justify-between gap-4 px-2 py-2">
            <p className="text-dense font-medium text-destructive" role="alert">
              {connection.syncError}
            </p>
            <a className={settingsActionButtonClass} href={CONNECT_URL}>
              Reconnect
            </a>
          </div>
        )}
      </>
    );
  }

  return (
    <SettingsSectionShell title="Calendar">
      <SettingsCard title="Calendar">
        <div className="flex min-h-[36px] items-center justify-between gap-3 px-2 py-1">
          <span className="text-dense font-semibold text-white-black">
            Week starts on
          </span>
          <div
            aria-label="Week starts on"
            className="flex shrink-0 overflow-hidden rounded-[4px] bg-cardBackground p-0.5"
            role="group"
          >
            {WEEK_START_OPTIONS.map((day) => (
              <button
                key={day}
                aria-pressed={settings.weekStartsOn === day}
                className={cn(
                  "rounded-[4px] px-3 py-1.5 text-dense font-medium capitalize text-white-black outline-none transition hover:bg-hover-active focus-visible:bg-hover-active",
                  settings.weekStartsOn === day && "bg-active-modal-element",
                )}
                onClick={() =>
                  setSettings((current) => ({
                    ...current,
                    weekStartsOn: day,
                  }))
                }
                type="button"
              >
                {day}
              </button>
            ))}
          </div>
        </div>

        <SettingsToggle
          checked={settings.showWeekends}
          inputId="calendar-show-weekends"
          label="Show weekends"
          onChange={() =>
            setSettings((current) => ({
              ...current,
              showWeekends: !current.showWeekends,
            }))
          }
          value={settings.showWeekends}
        />
      </SettingsCard>

      {enabled && (
        <SettingsCard title="Google Calendar">
          {googleCalendarContent}
        </SettingsCard>
      )}

      {visibleError && (
        <p className="text-dense font-medium text-destructive" role="alert">
          {visibleError}
        </p>
      )}
    </SettingsSectionShell>
  );
};

export default CalendarSection;
