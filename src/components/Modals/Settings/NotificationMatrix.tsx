"use client";

import axios from "axios";
import { useEffect, useState } from "react";
import SettingsToggle from "./SettingsToggle";

const notificationRows = [
  {
    category: "mentions",
    label: "Mentions",
    description: "When someone @mentions you or adds you to a task",
  },
  {
    category: "comments",
    label: "Comments",
    description: "New comments and reactions on tasks you follow",
  },
  {
    category: "assignments",
    label: "Assignments",
    description: "When a task is assigned to you",
  },
  {
    category: "moves",
    label: "Task updates",
    description: "When a task you follow is moved, archived or edited",
  },
  {
    category: "dueDates",
    label: "Due dates",
    description: "Reminders and overdue alerts",
  },
] as const;

type NotificationCategory = (typeof notificationRows)[number]["category"];
type NotificationChannel = "email" | "push";
type NotificationPreference = "all" | "direct" | "nothing";
type NotificationChannelSettings = Record<NotificationChannel, boolean>;
type NotificationMatrixState = Record<
  NotificationCategory,
  NotificationChannelSettings
>;

interface NotificationMatrixResponse {
  matrix: Partial<NotificationMatrixState>;
  notificationPreference: NotificationPreference;
}

const matrixFromLegacyPreference = (
  preference: NotificationPreference
): NotificationMatrixState => {
  const allEnabled = preference === "all";
  const directEnabled = preference !== "nothing";

  return {
    mentions: { email: directEnabled, push: directEnabled },
    comments: { email: allEnabled, push: allEnabled },
    assignments: { email: directEnabled, push: directEnabled },
    moves: { email: allEnabled, push: allEnabled },
    dueDates: { email: allEnabled, push: allEnabled },
  };
};

const seedNotificationMatrix = ({
  matrix,
  notificationPreference,
}: NotificationMatrixResponse): NotificationMatrixState => {
  const legacyMatrix = matrixFromLegacyPreference(notificationPreference);

  return {
    mentions: matrix.mentions ?? legacyMatrix.mentions,
    comments: matrix.comments ?? legacyMatrix.comments,
    assignments: matrix.assignments ?? legacyMatrix.assignments,
    moves: matrix.moves ?? legacyMatrix.moves,
    dueDates: matrix.dueDates ?? legacyMatrix.dueDates,
  };
};

const NotificationMatrix = () => {
  const [matrix, setMatrix] = useState<NotificationMatrixState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isActive = true;

    const loadNotificationMatrix = async () => {
      try {
        const response = await axios.get<NotificationMatrixResponse>(
          "/api/notifications/matrix"
        );

        if (isActive) {
          setMatrix(seedNotificationMatrix(response.data));
        }
      } catch (error) {
        console.error("Failed to load notification settings:", error);
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };

    void loadNotificationMatrix();

    return () => {
      isActive = false;
    };
  }, []);

  const handleToggle = async (
    category: NotificationCategory,
    channel: NotificationChannel
  ) => {
    if (!matrix || isSaving) return;

    const previousMatrix = matrix;
    const nextMatrix: NotificationMatrixState = {
      ...matrix,
      [category]: {
        ...matrix[category],
        [channel]: !matrix[category][channel],
      },
    };

    setMatrix(nextMatrix);
    setIsSaving(true);

    try {
      await axios.post("/api/notifications/matrix", { matrix: nextMatrix });
    } catch (error) {
      setMatrix(previousMatrix);
      console.error("Failed to update notification settings:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const controlsDisabled = isLoading || isSaving || matrix === null;

  return (
    <fieldset
      aria-busy={isLoading || isSaving}
      className="min-w-0"
      disabled={controlsDisabled}
    >
      <legend className="sr-only">Notification categories and channels</legend>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_48px_48px] items-end gap-x-2 border-b border-border-light-gray-thin px-2 pb-2">
        {/* Holds the first grid column. sr-only is position:absolute, which
            drops out of the grid flow and shifts Email/Push a column left. */}
        <span aria-hidden="true" />
        <span className="text-center text-meta font-semibold text-text-light-gray">
          Email
        </span>
        <span className="text-center text-meta font-semibold text-text-light-gray">
          Push
        </span>
      </div>

      {notificationRows.map(({ category, description, label }) => (
        <div
          className="grid min-w-0 grid-cols-[minmax(0,1fr)_48px_48px] items-center gap-x-2 border-b border-border-light-gray-thin px-2 py-3 last:border-b-0"
          key={category}
        >
          <div className="min-w-0 pr-1">
            <p className="text-dense font-semibold text-white-black">{label}</p>
            <p className="text-meta text-text-light-gray">{description}</p>
          </div>

          {(["email", "push"] as const).map((channel) => (
            <div
              className="flex justify-center [&>div]:min-h-0 [&>div]:justify-center [&>div]:gap-0 [&>div]:px-0 [&_label]:sr-only"
              key={channel}
            >
              <SettingsToggle
                checked={matrix?.[category][channel] ?? false}
                disabled={controlsDisabled}
                inputId={`${category}-${channel}-notifications`}
                label={`${channel === "email" ? "Email" : "Push"} notifications for ${label}`}
                onChange={() => void handleToggle(category, channel)}
              />
            </div>
          ))}
        </div>
      ))}
    </fieldset>
  );
};

export default NotificationMatrix;
