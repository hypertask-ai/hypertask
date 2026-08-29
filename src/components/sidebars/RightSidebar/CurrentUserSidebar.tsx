import { useRecoilValue } from "@/lib/state";
import { currentUserAtom } from "@/store";
import { useSettingsNavigation } from "@/components/Modals/Settings/settingsNavigation";
import UserAvatar from "@/components/Common/UserAvatar";

const CurrentUserSidebar = ({
  toggleSideBar,
}: {
  toggleSideBar: () => void;
}) => {
  const currentUser = useRecoilValue(currentUserAtom);
  const { openSettings } = useSettingsNavigation();

  return (
    currentUser && (
      <div className="flex xs:gap-[6px] sm:gap-3 items-center">
        <div
          className="cursor-pointer"
          onClick={() => {
            toggleSideBar();
            openSettings("general");
          }}
        >
          <UserAvatar
            alt={`${currentUser.displayName || currentUser.email || "Current user"} avatar`}
            className="sm:!h-7 sm:!w-7"
            compactOnMobile
            name={currentUser.displayName || currentUser.email}
            photoURL={currentUser.photoURL}
            size={28}
            title={currentUser.displayName || currentUser.email}
          />
        </div>
        <div className="text-content">{currentUser.email}</div>
      </div>
    )
  );
};

export default CurrentUserSidebar;
