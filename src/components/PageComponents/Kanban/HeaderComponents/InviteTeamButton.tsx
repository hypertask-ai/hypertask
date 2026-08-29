import React from "react";
import { cn } from "@/utils/undoActions/helperFuncs";
import { UserRoundPlus } from "lucide-react";
import HeaderIconWrapper from "./HeaderIconWrapper";
import Tooltip from "@/components/Common/Tooltip";
import { CLASS_NAME_CONSTANTS } from "@/lib/configs/general.config";
import { useSetRecoilState } from "@/lib/state";
import { showCommandsAtom } from "@/store";
import { CommandMode } from "@/models/enums";
interface InviteTeamButtonProps {
  isTrialUser: boolean;
  isMobile?: boolean;
}

export const InviteTeamButton: React.FC<InviteTeamButtonProps> = ({
  isTrialUser,
  isMobile = false,
}) => {
  const setShowCommands = useSetRecoilState(showCommandsAtom);

  const toggleInviteModal = () =>
    setShowCommands({ show: true, mode: CommandMode.InviteMember });

  // For trial users: show prominent button
  return (
    <>
      <HeaderIconWrapper
        // id={DIV_ID_CONSTANTS.inviteTeamButton}
        className={cn(
          " hover:text-icon-hover-gray text-white-black",
          CLASS_NAME_CONSTANTS.inviteTeamButton,
        )}
        onClick={toggleInviteModal}
      >
        <UserRoundPlus size={16} strokeWidth={1.75} fill="none" />
        {!isMobile && isTrialUser && (
          <span className="text-content hidden sm:block font-medium">
            Invite Team
          </span>
        )}
        <Tooltip
          left={-10}
          bottom={-40}
          text="Invite team members"
          keyCombination={[]}
        />
      </HeaderIconWrapper>
    </>
  );
};
