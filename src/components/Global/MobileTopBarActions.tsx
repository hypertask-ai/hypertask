"use client";

import { MoreHorizontal, SlidersHorizontal } from "lucide-react";
import { useSetRecoilState } from "@/lib/state";
import { calendarBoardsSidebarOpenAtom } from "@/store";
import type { IUser } from "@/models/model";
import useHypertasksRecoilStates from "@/hooks/RecoilRoot/useHypertasksRecoilStates";
import { useSettingsNavigation } from "@/components/Modals/Settings/settingsNavigation";
import { MOBILE_TARGET } from "@/lib/configs/general.config";
import UserAvatar from "@/components/Common/UserAvatar";

const MobileTopBarActions = ({
  currentUser,
  onCalendar,
}: {
  currentUser: IUser;
  onCalendar: boolean;
}) => {
  const setCalendarBoardsOpen = useSetRecoilState(
    calendarBoardsSidebarOpenAtom,
  );
  const { toggleShowCommands } = useHypertasksRecoilStates();
  const { openSettings } = useSettingsNavigation();

  return (
    <>
      {onCalendar && (
        <button
          type="button"
          aria-label="Filter boards"
          onClick={() => setCalendarBoardsOpen(true)}
          className={`${MOBILE_TARGET} text-white-black`}
        >
          <SlidersHorizontal size={18} strokeWidth={1.75} />
        </button>
      )}

      <button
        type="button"
        aria-label="Menu"
        onClick={() => toggleShowCommands()}
        className={`${MOBILE_TARGET} text-white-black`}
      >
        <MoreHorizontal size={20} strokeWidth={1.75} />
      </button>

      <button
        type="button"
        aria-label="Settings"
        onClick={() => openSettings("general")}
        className={MOBILE_TARGET}
      >
        <UserAvatar
          alt="Settings"
          name={currentUser.displayName || currentUser.email}
          photoURL={currentUser.photoURL}
          size={28}
          title={currentUser.displayName || currentUser.email}
        />
      </button>
    </>
  );
};

export default MobileTopBarActions;
