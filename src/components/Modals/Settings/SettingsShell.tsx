"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  ComponentType,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ArrowLeft,
  LogOut,
  Mail,
  MessageSquare,
  Search,
} from "lucide-react";
import Tooltip from "@/components/Common/Tooltip";
import { useSignout } from "@/hooks/MultiPages/HTC/useSignout";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { SidebarContextProvider } from "@/lib/contexts/Sidebars/SidebarProvider";
import { currentUserAtom } from "@/store";
import { cn } from "@/utils/undoActions/helperFuncs";
import { useRecoilValue } from "@/lib/state";
import { useGetUserPreferences } from "@/hooks/General/useGetUserPreferences";
import { useGetAnnouncements } from "@/hooks/MultiPages/Sidebar/useGetAnnouncements";
import type { IAnnouncement } from "@/models/Announcements/model";
import SettingsBoardPicker from "./SettingsBoardPicker";
import SettingsTeamPicker from "./SettingsTeamPicker";
import { useSettingsTeam } from "./useSettingsTeam";
import {
  SETTINGS_CROSS_TAB_GROUPS,
  SETTINGS_NAV_GROUPS,
  SETTINGS_TABS,
  SettingsNavGroup,
  SettingsSectionId,
  SettingsTabId,
  getSettingsPath,
  getSettingsTabForSection,
  isSettingsNavLink,
  normalizeSettingsSection,
  useSettingsNavigation,
} from "./settingsNavigation";

interface SettingsShellProps {
  section?: string;
}

const GeneralSection = dynamic(() => import("./GeneralSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const AppearanceSection = dynamic(() => import("./AppearanceSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const CalendarSection = dynamic(() => import("./CalendarSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const InboxSection = dynamic(() => import("./InboxSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const TaskPageSection = dynamic(() => import("./TaskPageSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const NotificationsSection = dynamic(() => import("./NotificationsSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const MyAiUsageSection = dynamic(() => import("./MyAiUsageSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const FeedbackModal = dynamic(
  () => import("@/components/Modals/Feedback/FeedbackModal"),
  { ssr: false },
);
const AccountsSection = dynamic(() => import("./AccountsSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const BoardGeneralSection = dynamic(() => import("./BoardGeneralSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const BoardPlanningSection = dynamic(() => import("./BoardPlanningSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const BoardStalenessSection = dynamic(
  () => import("./BoardStalenessSection"),
  {
    ssr: false,
    loading: () => <SettingsSectionLoading />,
  },
);
const BoardAiSection = dynamic(() => import("./BoardAiSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const BoardMemorySection = dynamic(() => import("./BoardMemorySection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const BoardSkillsSection = dynamic(() => import("./BoardSkillsSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const BoardFilesSection = dynamic(() => import("./BoardFilesSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const MembersSection = dynamic(() => import("./MembersSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const TeamAgentsSection = dynamic(() => import("./TeamAgentsSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const BoardMembersSection = dynamic(() => import("./BoardMembersSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const BoardAgentsSection = dynamic(() => import("./BoardAgentsSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const ApiKeysSection = dynamic(() => import("./ApiKeysSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const AiUsageSection = dynamic(() => import("./AiUsageSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const MemberUsageSection = dynamic(() => import("./MemberUsageSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const AiModelsSection = dynamic(() => import("./AiModelsSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const AiFeaturesSection = dynamic(() => import("./AiFeaturesSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const AiDefaultModelsSection = dynamic(
  () => import("./AiDefaultModelsSection"),
  {
    ssr: false,
    loading: () => <SettingsSectionLoading />,
  },
);
const SkillsSection = dynamic(() => import("./SkillsSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const BillingSection = dynamic(() => import("./BillingSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const PlansSection = dynamic(() => import("./PlansSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const ShortcutsSection = dynamic(() => import("./ShortcutsSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const LearnHypertaskSection = dynamic(() => import("./LearnHypertaskSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const FeedbackSection = dynamic(() => import("./FeedbackSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const AnnouncementsSection = dynamic(() => import("./AnnouncementsSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const McpSection = dynamic(() => import("./McpSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const SlackSection = dynamic(() => import("./SlackSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const ManagementKeysSection = dynamic(
  () => import("./ManagementKeysSection"),
  {
    ssr: false,
    loading: () => <SettingsSectionLoading />,
  },
);
const DeveloperAccessSection = dynamic(
  () => import("./DeveloperAccessSection"),
  {
    ssr: false,
    loading: () => <SettingsSectionLoading />,
  },
);
const CliSection = dynamic(() => import("./CliSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});
const ApiSection = dynamic(() => import("./ApiSection"), {
  ssr: false,
  loading: () => <SettingsSectionLoading />,
});

const SECTION_COMPONENTS: Record<SettingsSectionId, ComponentType> = {
  accounts: AccountsSection,
  announcements: AnnouncementsSection,
  appearance: AppearanceSection,
  calendar: CalendarSection,
  api: ApiSection,
  apiKeys: ApiKeysSection,
  "ai-usage": AiUsageSection,
  "member-usage": MemberUsageSection,
  "ai-models": AiModelsSection,
  "ai-features": AiFeaturesSection,
  "default-models": AiDefaultModelsSection,
  "board-ai": BoardAiSection,
  "board-memory": BoardMemorySection,
  "board-skills": BoardSkillsSection,
  "board-files": BoardFilesSection,
  "board-general": BoardGeneralSection,
  "board-planning": BoardPlanningSection,
  "board-staleness": BoardStalenessSection,
  "board-members": BoardMembersSection,
  "board-agents": BoardAgentsSection,
  skills: SkillsSection,
  billing: BillingSection,
  plans: PlansSection,
  cli: CliSection,
  feedback: FeedbackSection,
  general: GeneralSection,
  learn: LearnHypertaskSection,
  members: MembersSection,
  "team-agents": TeamAgentsSection,
  "developer-access": DeveloperAccessSection,
  "management-keys": ManagementKeysSection,
  mcp: McpSection,
  slack: SlackSection,
  "my-ai-usage": MyAiUsageSection,
  notifications: NotificationsSection,
  shortcuts: ShortcutsSection,
  "task-page": TaskPageSection,
  inbox: InboxSection,
};

const NAV_ENTRY_CLASS =
  "w-full rounded-[5px] px-2 py-1.5 text-left text-content font-medium text-white-black transition hover:bg-hover-active focus-visible:bg-hover-active focus-visible:outline-none";

interface SettingsNavGroupsProps {
  activeSection?: SettingsSectionId;
  compact?: boolean;
  groups: SettingsNavGroup[];
  hasUnreadAnnouncements?: boolean;
  mobile?: boolean;
  onSelect: (section: SettingsSectionId) => void;
}

const SettingsNavGroups: React.FC<SettingsNavGroupsProps> = ({
  activeSection,
  compact = false,
  groups,
  hasUnreadAnnouncements = false,
  mobile = false,
  onSelect,
}) => (
  <div className={cn("flex flex-col", compact ? "gap-3" : "gap-5")}>
    {groups.map((group) => (
      <div key={group.title} className="flex flex-col gap-1">
        <div className="px-2 pb-1">
          <h3 className="text-meta font-semibold uppercase tracking-wide text-text-light-gray">
            {group.title}
          </h3>
          {group.description && (
            <p className="mt-0.5 text-micro text-text-light-gray">
              {group.description}
            </p>
          )}
        </div>
        {group.items.map((item) =>
          isSettingsNavLink(item) ? (
            <a
              key={item.href}
              className={cn(NAV_ENTRY_CLASS, "block")}
              href={item.href}
              rel="noopener noreferrer"
              target="_blank"
            >
              {item.label}
            </a>
          ) : (
            <button
              key={item.id}
              type="button"
              className={cn(
                NAV_ENTRY_CLASS,
                mobile && "flex items-center justify-between gap-2 py-3",
                activeSection === item.id && "bg-active-modal-element",
              )}
              onClick={() => onSelect(item.id)}
            >
              <span>{item.label}</span>
              {mobile &&
                item.id === "announcements" &&
                hasUnreadAnnouncements && (
                  <span
                    aria-hidden="true"
                    className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#51A4F1]"
                  />
                )}
            </button>
          ),
        )}
      </div>
    ))}
  </div>
);

const SettingsShell: React.FC<SettingsShellProps> = ({ section }) => {
  const activeSection = normalizeSettingsSection(section);
  const activeTab = getSettingsTabForSection(activeSection);
  const mbl = useContext(MobileViewContext);
  const currentUser = useRecoilValue(currentUserAtom);
  const { data: announcementsData } = useGetAnnouncements(currentUser?.id);
  const { data: userPreferences, isFetched: userPreferencesFetched } =
    useGetUserPreferences();
  const hasUnreadAnnouncements = useMemo(
    () =>
      userPreferencesFetched &&
      !userPreferences?.muteAnnouncements &&
      Array.isArray(announcementsData) &&
      (announcementsData as IAnnouncement[]).some(
        (announcement) => !announcement.readAt,
      ),
    [
      announcementsData,
      userPreferences?.muteAnnouncements,
      userPreferencesFetched,
    ],
  );
  const { billing } = useSettingsTeam();
  const { clearSettingsSection, closeSettings, setSettingsSection } =
    useSettingsNavigation();
  const { handleHardReset } = useSignout(closeSettings);
  const router = useRouter();
  const [showFeedback, setShowFeedback] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [mobileTabId, setMobileTabId] = useState<SettingsTabId>(activeTab.id);

  const hasSelectedSection = Boolean(section);
  const navigationTab =
    mbl && !hasSelectedSection
      ? (SETTINGS_TABS.find((tab) => tab.id === mobileTabId) ?? activeTab)
      : activeTab;

  useEffect(() => {
    if (section) setMobileTabId(activeTab.id);
  }, [activeTab.id, section]);

  useEffect(() => {
    if (section && section !== activeSection) {
      router.replace(getSettingsPath(activeSection));
    }
  }, [activeSection, router, section]);

  // The shell is a fixed full-viewport surface; stray overflow (portals,
  // top-layer elements) must never let the document itself scroll under it.
  useEffect(() => {
    const html = document.documentElement;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    html.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      html.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, []);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (showFeedback) {
          setShowFeedback(false);
        } else {
          closeSettings();
        }
      }
    };

    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [closeSettings, showFeedback]);

  const { bottomGroups, primaryGroups } = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const filterGroups = (groups: SettingsNavGroup[]) =>
      groups
        .map((group) => ({
          ...group,
          items: group.items.filter(
            (item) =>
              (isSettingsNavLink(item) ||
                item.id !== "apiKeys" ||
                Boolean(billing && billing.storePlanId !== "Free")) &&
              (!normalizedSearch ||
                item.label.toLowerCase().includes(normalizedSearch)),
          ),
        }))
        .filter((group) => group.items.length > 0);

    if (normalizedSearch) {
      return {
        bottomGroups: [],
        primaryGroups: filterGroups(SETTINGS_NAV_GROUPS),
      };
    }

    return {
      bottomGroups: filterGroups(SETTINGS_CROSS_TAB_GROUPS),
      primaryGroups: filterGroups(navigationTab.groups),
    };
  }, [billing, navigationTab.groups, searchTerm]);

  const isSearching = searchTerm.trim().length > 0;
  const hasVisibleGroups = primaryGroups.length > 0 || bottomGroups.length > 0;

  const ActiveSection = SECTION_COMPONENTS[activeSection];
  const activeSectionTitle = SETTINGS_NAV_GROUPS.flatMap(
    (group) => group.items,
  ).find(
    (item) => !isSettingsNavLink(item) && item.id === activeSection,
  )?.label;

  return (
    <div
      className={cn(
        "flex h-[100svh] w-full overflow-hidden bg-modalBackground pt-[env(safe-area-inset-top)] text-white-black",
        mbl ? "flex-col" : "flex-row",
      )}
    >
      {(!mbl || !hasSelectedSection) && (
        <aside
          className={cn(
            "flex min-h-0 shrink-0 flex-col overflow-hidden bg-modalBackground",
            mbl
              ? "h-full w-full"
              : "h-full w-[250px] border-r border-border-light-gray-thin",
          )}
        >
          <div className="border-b border-border-light-gray-thin p-4">
            <button
              type="button"
              className="mb-4 flex w-full items-center gap-2 rounded-[5px] px-2 py-2 text-left text-content font-medium text-white-black transition hover:bg-hover-active focus-visible:bg-hover-active focus-visible:outline-none"
              onClick={closeSettings}
            >
              <ArrowLeft strokeWidth={1.75} className="h-4 w-4 shrink-0" />
              <span className="truncate">Back to app</span>
            </button>
            <div className="relative border-b border-light-black-border-1">
              <Search
                strokeWidth={1.75}
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-light-gray"
              />
              <input
                autoComplete="off"
                className="h-9 w-full border-0 bg-modalBackground py-2 pl-9 pr-3 text-dense text-white-black outline-none placeholder:text-text-light-gray focus:bg-active-modal-element"
                data-1p-ignore
                data-form-type="other"
                data-lpignore="true"
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search settings"
                value={searchTerm}
              />
            </div>
          </div>

          {mbl && (
            <div className="border-b border-border-light-gray-thin px-3 py-3">
              <div
                aria-label="Settings scopes"
                className="no-scrollbar flex w-full items-center gap-1 overflow-x-auto"
                role="tablist"
              >
                {SETTINGS_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    aria-selected={navigationTab.id === tab.id}
                    className={cn(
                      "shrink-0 rounded-[5px] px-3 py-2 text-content font-medium text-text-light-gray transition hover:text-white-black focus-visible:bg-hover-active focus-visible:outline-none",
                      navigationTab.id === tab.id &&
                        "bg-active-modal-element text-white-black",
                    )}
                    onClick={() => setMobileTabId(tab.id)}
                    role="tab"
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              {navigationTab.id !== "profile" && (
                <div className="mt-3">
                  <SettingsTeamPicker className="w-full" />
                </div>
              )}
            </div>
          )}

          <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
            <div className="flex min-h-full flex-col">
              {hasVisibleGroups ? (
                <>
                  {!isSearching && navigationTab.id === "board" && (
                    <div className="mb-4">
                      <SettingsBoardPicker />
                    </div>
                  )}
                  <SettingsNavGroups
                    activeSection={mbl ? undefined : activeSection}
                    groups={primaryGroups}
                    hasUnreadAnnouncements={hasUnreadAnnouncements}
                    mobile={mbl}
                    onSelect={setSettingsSection}
                  />
                  {bottomGroups.length > 0 && (
                    <div className="mt-auto pt-5">
                      <SettingsNavGroups
                        activeSection={mbl ? undefined : activeSection}
                        compact
                        groups={bottomGroups}
                        hasUnreadAnnouncements={hasUnreadAnnouncements}
                        mobile={mbl}
                        onSelect={setSettingsSection}
                      />
                    </div>
                  )}
                </>
              ) : (
                <div className="px-2 py-3 text-dense text-text-light-gray">
                  No sections found
                </div>
              )}
            </div>
          </nav>
          <div className="flex shrink-0 items-center justify-between border-t border-border-light-gray-thin px-3 py-2 text-text-light-gray">
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Send feedback"
                className="group relative flex h-8 w-8 items-center justify-center rounded-[5px] transition hover:bg-hover-active hover:text-white-black focus-visible:bg-hover-active focus-visible:text-white-black focus-visible:outline-none"
                onClick={() => setShowFeedback(true)}
              >
                <MessageSquare strokeWidth={1.75} className="h-4 w-4" />
                <Tooltip
                  bottom={36}
                  keyCombination={[]}
                  left={0}
                  text="Send feedback"
                />
              </button>
              <a
                aria-label="Contact us"
                className="group relative flex h-8 w-8 items-center justify-center rounded-[5px] transition hover:bg-hover-active hover:text-white-black focus-visible:bg-hover-active focus-visible:text-white-black focus-visible:outline-none"
                href="mailto:help@hypertask.ai"
              >
                <Mail strokeWidth={1.75} className="h-4 w-4" />
                <Tooltip
                  bottom={36}
                  keyCombination={[]}
                  left={0}
                  text="Contact us"
                />
              </a>
            </div>
            <button
              type="button"
              className="flex items-center gap-2 rounded-[5px] px-2 py-1.5 text-content font-medium transition hover:bg-destructive/90 hover:text-destructive-foreground focus-visible:bg-destructive/90 focus-visible:text-destructive-foreground focus-visible:outline-none"
              onClick={() => void handleHardReset()}
            >
              <LogOut strokeWidth={1.75} className="h-4 w-4" />
              <span>Sign out</span>
            </button>
          </div>
        </aside>
      )}

      {(!mbl || hasSelectedSection) && (
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-modalBackground">
          {mbl ? (
            <div className="flex w-full shrink-0 items-center gap-2 border-b border-border-light-gray-thin px-3 py-2">
              <button
                type="button"
                aria-label="Back to settings"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[5px] text-white-black transition hover:bg-hover-active focus-visible:bg-hover-active focus-visible:outline-none"
                onClick={clearSettingsSection}
              >
                <ArrowLeft strokeWidth={1.75} className="h-4 w-4" />
              </button>
              <h1 className="truncate text-emphasis font-semibold text-white-black">
                {activeSectionTitle}
              </h1>
            </div>
          ) : (
            <div className="w-full shrink-0">
              <div className="mx-auto flex w-full max-w-[760px] items-center gap-4 px-6 py-3">
                <div
                  aria-label="Settings scopes"
                  className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
                  role="tablist"
                >
                  {SETTINGS_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      aria-selected={activeTab.id === tab.id}
                      className={cn(
                        "shrink-0 rounded-[5px] px-3 py-1.5 text-content font-medium text-text-light-gray transition hover:text-white-black focus-visible:bg-hover-active focus-visible:outline-none",
                        activeTab.id === tab.id &&
                          "bg-active-modal-element text-white-black",
                      )}
                      onClick={() => setSettingsSection(tab.defaultSection)}
                      role="tab"
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                {/* The Profile tab is user-global ("only affects you"), so the
                    team picker is a no-op there and misleadingly implies
                    per-project scoping — hide it. (HTPR notification-scope fix) */}
                {activeTab.id !== "profile" && <SettingsTeamPicker />}
              </div>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <SidebarContextProvider _appHandler={closeSettings}>
              <div
                className={cn(
                  "mx-auto flex h-full min-h-full w-full max-w-[760px] flex-col pb-8",
                  mbl ? "px-4 pt-2" : "px-6 pt-5",
                )}
              >
                {currentUser ? <ActiveSection /> : <SettingsSectionLoading />}
              </div>
            </SidebarContextProvider>
          </div>
        </main>
      )}
      {showFeedback && (
        <FeedbackModal closeHandler={() => setShowFeedback(false)} />
      )}
    </div>
  );
};

const SettingsSectionLoading = () => {
  return (
    <div className="flex w-full flex-col gap-5">
      <div className="h-8 w-40 rounded-[5px] bg-active-modal-element opacity-50" />
      <div className="h-24 rounded-[5px] bg-active-modal-element opacity-50" />
      <div className="h-32 rounded-[5px] bg-active-modal-element opacity-40" />
    </div>
  );
};

export default SettingsShell;
