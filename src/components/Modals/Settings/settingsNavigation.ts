"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { parseCookies } from "nookies";
import { useCallback } from "react";
import { useSetRecoilState } from "@/lib/state";
import { showGuestLoginAtom } from "@/store";
import { isGuestCookieUser } from "@/lib/demo/isGuestClient";

export type SettingsSectionId =
  | "general"
  | "appearance"
  | "calendar"
  | "inbox"
  | "task-page"
  | "notifications"
  | "my-ai-usage"
  | "accounts"
  | "board-general"
  | "board-planning"
  | "board-staleness"
  | "board-ai"
  | "board-memory"
  | "board-skills"
  | "board-files"
  | "board-members"
  | "board-agents"
  | "members"
  | "team-agents"
  | "apiKeys"
  | "ai-usage"
  | "member-usage"
  | "ai-models"
  | "ai-features"
  | "default-models"
  | "skills"
  | "billing"
  | "plans"
  | "mcp"
  | "slack"
  | "developer-access"
  | "management-keys"
  | "cli"
  | "api"
  | "shortcuts"
  | "learn"
  | "feedback"
  | "announcements";

export interface SettingsNavItem {
  id: SettingsSectionId;
  label: string;
}

// An external destination (docs, legal) that lives in the nav next to the
// real sections instead of a pinned footer, so it scrolls with the list.
export interface SettingsNavLink {
  href: string;
  label: string;
}

export type SettingsNavEntry = SettingsNavItem | SettingsNavLink;

export const isSettingsNavLink = (
  entry: SettingsNavEntry,
): entry is SettingsNavLink => "href" in entry;

export interface SettingsNavGroup {
  title: string;
  description?: string;
  items: SettingsNavEntry[];
}

export type SettingsTabId =
  | "profile"
  | "team"
  | "board"
  | "connect"
  | "help";

export interface SettingsTab {
  id: SettingsTabId;
  label: string;
  description: string;
  defaultSection: SettingsSectionId;
  groups: SettingsNavGroup[];
}

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = "general";

export const SETTINGS_BASE_PATH = "/settings";

const SETTINGS_RETURN_TO_STORAGE_KEY = "hypertasks-settings-return-to";

export const SETTINGS_TABS: SettingsTab[] = [
  {
    id: "profile",
    label: "Profile",
    description: "Only affects you",
    defaultSection: "general",
    groups: [
      {
        title: "Profile",
        description: "Only affects you",
        items: [
          { id: "general", label: "General" },
          { id: "appearance", label: "Appearance" },
          { id: "calendar", label: "Calendar" },
          { id: "inbox", label: "Inbox" },
          { id: "task-page", label: "Task page" },
          { id: "notifications", label: "Notifications" },
          { id: "my-ai-usage", label: "AI usage" },
          { id: "accounts", label: "Accounts" },
        ],
      },
    ],
  },
  {
    id: "team",
    label: "Team",
    description: "People, plan & AI",
    defaultSection: "members",
    groups: [
      {
        title: "Team",
        description: "People & permissions",
        items: [
          { id: "members", label: "Members" },
          { id: "team-agents", label: "Agents" },
          { id: "skills", label: "Skills" },
        ],
      },
      {
        title: "Billing",
        items: [
          { id: "billing", label: "Billing" },
          { id: "plans", label: "Plans" },
        ],
      },
      {
        title: "AI",
        items: [
          { id: "ai-usage", label: "AI usage" },
          { id: "member-usage", label: "Usage by member" },
          { id: "ai-models", label: "AI models" },
          { id: "ai-features", label: "AI features" },
          { id: "default-models", label: "Default models" },
          { id: "apiKeys", label: "Bring your own key" },
        ],
      },
    ],
  },
  {
    id: "board",
    label: "Board",
    description: "Only this board",
    defaultSection: "board-general",
    groups: [
      {
        title: "Board",
        description: "Only this board",
        items: [
          { id: "board-general", label: "General" },
          { id: "board-planning", label: "Planning" },
          { id: "board-staleness", label: "Staleness" },
          { id: "board-members", label: "Members" },
          { id: "board-agents", label: "Agents" },
          { id: "board-ai", label: "Custom instructions" },
          { id: "board-memory", label: "Memory" },
          { id: "board-skills", label: "Skills" },
          { id: "board-files", label: "Files" },
        ],
      },
    ],
  },
  {
    id: "connect",
    label: "Connect",
    description: "Tokens & integrations",
    defaultSection: "mcp",
    groups: [
      {
        title: "Connect",
        description: "Tokens & integrations",
        items: [
          { id: "developer-access", label: "Developer access" },
          { id: "slack", label: "Slack" },
          { id: "mcp", label: "MCP" },
          { id: "management-keys", label: "Management keys" },
          { id: "cli", label: "CLI" },
          { id: "api", label: "REST API" },
        ],
      },
    ],
  },
  {
    id: "help",
    label: "Help",
    description: "Learn & reference",
    defaultSection: "shortcuts",
    groups: [
      {
        title: "Help",
        description: "Learn & reference",
        items: [
          { id: "shortcuts", label: "Shortcuts" },
          { id: "learn", label: "Learn Hypertask" },
          { id: "feedback", label: "Send feedback" },
        ],
      },
      {
        title: "About",
        items: [
          { id: "announcements", label: "Latest updates" },
          { href: "https://docs.hypertask.ai/changelog", label: "Changelog" },
          { href: "https://hypertask.ai/terms", label: "Terms of Service" },
          { href: "https://hypertask.ai/privacy", label: "Privacy" },
        ],
      },
    ],
  },
];

// About's external links live inside the Help tab: a dedicated About tab
// would have no content pane behind it (all three entries leave the app).
export const SETTINGS_CROSS_TAB_GROUPS: SettingsNavGroup[] = [];

export const SETTINGS_NAV_GROUPS: SettingsNavGroup[] = [
  ...SETTINGS_TABS.flatMap((tab) => tab.groups),
  ...SETTINGS_CROSS_TAB_GROUPS,
];

const SETTINGS_SECTION_IDS = SETTINGS_NAV_GROUPS.flatMap((group) =>
  group.items
    .filter((item): item is SettingsNavItem => !isSettingsNavLink(item))
    .map((item) => item.id),
);

export const normalizeSettingsSection = (
  section: string | null | undefined,
): SettingsSectionId => {
  if (SETTINGS_SECTION_IDS.includes(section as SettingsSectionId)) {
    return section as SettingsSectionId;
  }

  return DEFAULT_SETTINGS_SECTION;
};

export const isSettingsSectionId = (
  section: string | null | undefined,
): section is SettingsSectionId =>
  SETTINGS_SECTION_IDS.includes(section as SettingsSectionId);

export const getSettingsTabForSection = (section: SettingsSectionId) =>
  SETTINGS_TABS.find((tab) =>
    tab.groups.some((group) =>
      group.items.some(
        (item) => !isSettingsNavLink(item) && item.id === section,
      ),
    ),
  ) ?? SETTINGS_TABS[0];

export const getSettingsPath = (
  section: SettingsSectionId = DEFAULT_SETTINGS_SECTION,
) => `${SETTINGS_BASE_PATH}/${section}`;

const isSettingsPath = (path: string) =>
  path === SETTINGS_BASE_PATH || path.startsWith(`${SETTINGS_BASE_PATH}/`);

const sanitizeReturnTo = (path: string | null | undefined) => {
  if (!path || !path.startsWith("/") || isSettingsPath(path)) return null;
  return path;
};

const getCurrentPath = (
  pathname: string | null,
  searchParams: { toString: () => string } | null,
) => {
  const query = searchParams?.toString() ?? "";
  const hash = typeof window !== "undefined" ? window.location.hash : "";

  return `${pathname ?? "/"}${query ? `?${query}` : ""}${hash}`;
};

export const rememberSettingsReturnTo = (path: string | null | undefined) => {
  const returnTo = sanitizeReturnTo(path);

  if (!returnTo || typeof window === "undefined") return;

  window.sessionStorage.setItem(SETTINGS_RETURN_TO_STORAGE_KEY, returnTo);
};

const consumeSettingsReturnTo = () => {
  if (typeof window === "undefined") return null;

  const returnTo = sanitizeReturnTo(
    window.sessionStorage.getItem(SETTINGS_RETURN_TO_STORAGE_KEY),
  );

  window.sessionStorage.removeItem(SETTINGS_RETURN_TO_STORAGE_KEY);

  return returnTo;
};

export const getLastBoardOrHomePath = () => {
  if (typeof window === "undefined") return "/";

  const previousBoard = parseCookies().previousBoard;

  if (!previousBoard) return "/";

  const [projectId, view] = previousBoard.split("|&|");
  const projectIdNumber = projectId?.split("-")[1];

  if (
    !projectIdNumber ||
    projectIdNumber === "undefined" ||
    projectIdNumber === "null"
  ) {
    return "/";
  }

  const params = new URLSearchParams({ id: projectIdNumber });

  if (view && view.length > 0 && view !== "undefined") {
    params.set("view", view);
  }

  return `/project?${params.toString()}`;
};

export const useSettingsNavigation = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const setShowGuestLogin = useSetRecoilState(showGuestLoginAtom);

  const openSettings = useCallback(
    (section?: SettingsSectionId) => {
      // HTPR-4890: guests get no settings — every entry point (rail, floating
      // gear, Ctrl+K, the "\" shortcut) routes through here, so this one guard
      // turns them all into a sign-in prompt.
      if (isGuestCookieUser()) {
        setShowGuestLogin(true);
        return;
      }
      rememberSettingsReturnTo(getCurrentPath(pathname, searchParams));
      router.push(section ? getSettingsPath(section) : SETTINGS_BASE_PATH);
    },
    [pathname, router, searchParams, setShowGuestLogin],
  );

  const closeSettings = useCallback(() => {
    router.push(consumeSettingsReturnTo() ?? getLastBoardOrHomePath());
  }, [router]);

  const setSettingsSection = useCallback(
    (section: SettingsSectionId) => {
      router.push(getSettingsPath(section));
    },
    [router],
  );

  const clearSettingsSection = useCallback(() => {
    router.replace(SETTINGS_BASE_PATH);
  }, [router]);

  return {
    clearSettingsSection,
    closeSettings,
    openSettings,
    setSettingsSection,
  };
};
