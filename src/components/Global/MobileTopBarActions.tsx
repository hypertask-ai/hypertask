"use client";

import { Command as CommandIcon, SlidersHorizontal } from "lucide-react";
import { useSetRecoilState } from "@/lib/state";
import { calendarBoardsSidebarOpenAtom, showGuestLoginAtom } from "@/store";
import type { IUser } from "@/models/model";
import useHypertasksRecoilStates from "@/hooks/RecoilRoot/useHypertasksRecoilStates";
import { useSettingsNavigation } from "@/components/Modals/Settings/settingsNavigation";
import { MOBILE_TARGET } from "@/lib/configs/general.config";
import UserAvatar from "@/components/Common/UserAvatar";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7983_FREE_MODE_SIGNUP_FLAG } from "@/lib/flags/definitions/htpr-7983-free-mode-signup";
import { isGuestUser } from "@/lib/demo/guest";

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
  const setShowGuestLogin = useSetRecoilState(showGuestLoginAtom);
  const freeModeSignupEnabled = useFlag(HTPR_7983_FREE_MODE_SIGNUP_FLAG);
  const guestVisitor = isGuestUser(currentUser);
  const { toggleShowCommands } = useHypertasksRecoilStates();
  const { openSettings } = useSettingsNavigation();

  return (
    <>
      {freeModeSignupEnabled && guestVisitor && (
        <button
          type="button"
          onClick={() => setShowGuestLogin(true)}
          className="self-center rounded-[5px] bg-white-black px-2 py-1 text-meta font-medium text-white-black-inverted"
        >
          Sign up
        </button>
      )}

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
        aria-label="Commands"
        onClick={() => toggleShowCommands()}
        className={`${MOBILE_TARGET} gap-1 px-1 text-white-black`}
      >
        <CommandIcon size={17} strokeWidth={1.75} />
        <span className="text-meta">Commands</span>
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
