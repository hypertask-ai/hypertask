"use client";

import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { getKeyboardShortcuts } from "@/lib/constants/shortcuts";
import SettingsCard from "./SettingsCard";
import SettingsSectionShell from "./SettingsSectionShell";
import { useContext, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useRecoilValue } from "@/lib/state";
import { appShellRailAtom } from "@/store";
import { useFlag } from "@/hooks/useFlag";

const ShortcutsSection = () => {
  const isApple = useDeviceContext();
  const isMbl = useContext(MobileViewContext);
  const appShellRailOn = useRecoilValue(appShellRailAtom) && !isMbl;
  const consistentCommentShortcuts = useFlag(
    "htpr-5913-consistent-comment-shortcuts",
  );
  const shortcutGroups = getKeyboardShortcuts(
    isApple,
    appShellRailOn,
    consistentCommentShortcuts,
  );
  const [searchTerm, setSearchTerm] = useState("");

  const filteredGroups = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return shortcutGroups;

    return shortcutGroups
      .map((group) => ({
        ...group,
        sub: group.sub.filter(
          (shortcut) =>
            shortcut.shortTitle.toLowerCase().includes(query) ||
            group.title.toLowerCase().includes(query) ||
            shortcut.pressKey.some(
              (key) => key && key.toLowerCase().includes(query)
            )
        ),
      }))
      .filter((group) => group.sub.length > 0);
  }, [searchTerm, shortcutGroups]);

  return (
    <SettingsSectionShell title="Shortcuts">
      <div className="relative">
        <Search
          strokeWidth={1.75}
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-light-gray"
        />
        <input
          autoComplete="off"
          className="h-9 w-full rounded-[8px] border border-border-light-gray-thin bg-modalBackground py-2 pl-9 pr-3 text-dense text-white-black outline-none placeholder:text-text-light-gray focus:bg-active-modal-element"
          data-1p-ignore
          data-lpignore="true"
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Search shortcuts"
          value={searchTerm}
        />
      </div>

      {filteredGroups.length === 0 ? (
        <p className="px-2 text-dense font-medium text-text-light-gray">
          No shortcuts found
        </p>
      ) : (
        filteredGroups.map((group) => (
        <SettingsCard key={group.title} title={group.title}>
          <div className="flex flex-col gap-1">
            {group.sub.map((shortcut) => (
              <div
                className="flex min-h-8 items-center justify-between gap-4 rounded-[5px] px-2 py-1 hover:bg-hover-active"
                key={`${group.title}-${shortcut.shortTitle}`}
              >
                <span className="text-dense font-semibold text-white-black">
                  {shortcut.shortTitle}
                </span>
                <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                  {shortcut.pressKey.map((key, keyIndex) =>
                    key ? (
                      <kbd
                        className="min-w-6 rounded-[2px] bg-hover-active px-[6px] py-[3px] text-center text-meta font-medium text-white-black"
                        key={`${key}-${keyIndex}`}
                      >
                        {key}
                      </kbd>
                    ) : (
                      <span
                        className="px-1 text-meta font-medium text-text-light-gray"
                        key={`then-${keyIndex}`}
                      >
                        then
                      </span>
                    )
                  )}
                </span>
              </div>
            ))}
          </div>
        </SettingsCard>
        ))
      )}
    </SettingsSectionShell>
  );
};

export default ShortcutsSection;
