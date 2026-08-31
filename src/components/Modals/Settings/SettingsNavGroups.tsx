import React from "react";
import { cn } from "@/utils/undoActions/helperFuncs";
import { MobileAnnouncementIndicator } from "./announcementIndicator";
import {
  SettingsNavGroup,
  SettingsSectionId,
  isSettingsNavLink,
} from "./settingsNavigation";

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
              {item.id === "announcements" && (
                <MobileAnnouncementIndicator
                  visible={mobile && hasUnreadAnnouncements}
                />
              )}
            </button>
          ),
        )}
      </div>
    ))}
  </div>
);

export default SettingsNavGroups;
