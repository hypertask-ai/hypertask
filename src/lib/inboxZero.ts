export const INBOX_ZERO_THRESHOLD_OPTIONS = [
  { days: 1, label: "1 day" },
  { days: 3, label: "3 days" },
  { days: 7, label: "1 week" },
  { days: 14, label: "2 weeks" },
] as const;

export type InboxZeroThresholdDays = 0 | 1 | 3 | 7 | 14;

export type InboxZeroCategories = {
  read: boolean;
  reactions: boolean;
  ownActions: boolean;
  superseded: boolean;
  pastReminders: boolean;
};

export type InboxZeroKeep = {
  unread: boolean;
  mentions: boolean;
  assignments: boolean;
};

export type InboxZeroRules = {
  threshold: InboxZeroThresholdDays;
  categories: InboxZeroCategories;
  keep: InboxZeroKeep;
};

export type InboxZeroCounts = Record<keyof InboxZeroCategories, number>;

export type InboxZeroPreview = {
  categoryCounts: InboxZeroCounts;
  totalActive: number;
  totalToArchive: number;
  totalLeft: number;
  previewVersion: string;
};

export const DEFAULT_INBOX_ZERO_RULES: InboxZeroRules = {
  threshold: 7,
  categories: {
    read: true,
    reactions: true,
    ownActions: true,
    superseded: true,
    pastReminders: true,
  },
  keep: {
    unread: true,
    mentions: true,
    assignments: true,
  },
};

export const INBOX_ZERO_PRESETS = {
  default: DEFAULT_INBOX_ZERO_RULES,
  allRead: {
    threshold: 0,
    categories: {
      read: true,
      reactions: false,
      ownActions: false,
      superseded: false,
      pastReminders: false,
    },
    keep: {
      unread: true,
      mentions: false,
      assignments: false,
    },
  },
  reactions: {
    threshold: 7,
    categories: {
      read: false,
      reactions: true,
      ownActions: false,
      superseded: false,
      pastReminders: false,
    },
    keep: {
      unread: false,
      mentions: false,
      assignments: false,
    },
  },
} as const satisfies Record<string, InboxZeroRules>;
