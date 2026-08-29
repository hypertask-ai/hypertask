/**
 * Helper Functions Configuration
 * Centralized configuration for utility functions across the application
 */

export const helperFunctionsConfig = {
  dateTime: {
    dueDateGroups: {
      overdue: "Overdue",
      today: "Today",
      tomorrow: "Tomorrow",
      thisWeek: "This Week",
      later: "Later",
    },
    subscription: {
      remainingMonthsOffset: 12,
    },
    defaultTime: {
      hour: 9,
      minute: 0,
      second: 0,
    },
    todayOptions: {
      maxHoursAhead: 8,
      laterHour: 20, // 8 PM
    },
    thresholds: {
      hoursInDay: 24,
      midnightHour: 0,
      noonHour: 12,
      secondsForTimeDifference: 60,
    },
    dateKeywords: {
      today: "today",
      tomorrow: "tomorrow",
      later: "later",
    },
    formatting: {
      time: {
        am: "AM",
        pm: "PM",
        midnight: "12",
      },
    },
    freemium: {
      daysDuration: 7,
      millisecondsPerDay: 24 * 60 * 60 * 1000,
    },
  },
  regex: {
    timePattern: /\d{1,2}:\d{2}\s*(am|pm|AM|PM)?/i,
    base64Pattern: /^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,/,
    mentionPattern: /data-type="mention"[^>]*data-id="(\d+)"/g,
    mentionPatternAlt: /<span[^>]*data-id="(\d+)"[^>]*data-type="mention"/g,
    imageSrcPattern: /<img[^>]*src="([^"]+)"/g,
  },
  files: {
    sizeUnits: ["Bytes", "KB", "MB", "GB", "TB"],
    image: {
      maxSizeMB: 5,
      resizer: {
        maxWidth: 1920,
        maxHeight: 1080,
        format: "JPEG",
        quality: 0.8,
      },
    },
  },
  scroll: {
    thresholds: {
      nearBottom: 20, // percentage
      nearTop: 20, // percentage
      nearHorizontal: 15, // percentage
    },
  },
  notifications: {
    translates: {
      TASK_ASSIGNED: "Assigned",
      TASK_MENTIONED: "Mentions",
      TASK_STATUS_CHANGED: "Status",
      TASK_REACTION: "Reactions",
      TASK_COMMENTED: "Comments",
      TASK_DUE_DATE_CHANGED: "Due Date",
      TASK_PRIORITY_CHANGED: "Priority",
      TASK_LABEL_ADDED: "Labels",
      TASK_LABEL_REMOVED: "Labels",
      TASK_MOVED: "Moved",
      TASK_ARCHIVED: "Archived",
      TASK_DELETED: "Deleted",
      TASK_RESTORED: "Restored",
      TASK_CREATED: "Created",
      TASK_UPDATED: "Updated",
    },
    categories: {
      important: "Important",
      mentions: "Mentions",
    },
    priority: {
      important: 1,
      mentions: 2,
      other: 3,
    },
  },
  errors: {
    localStorage: {
      keyAndValueRequired: "Key and value are required",
      keyRequired: "Key is required",
    },
    file: {
      canvasContext: "Failed to get canvas context",
      canvasToBlob: "Failed to convert canvas to blob",
      imageLoading: "Failed to load image",
      fileReading: "Failed to read file",
    },
  },
} as const;

export type HelperFunctionsConfig = typeof helperFunctionsConfig;
