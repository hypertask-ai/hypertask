import { useProjectQuery } from "@/hooks/General/useProjectQuery";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { IProject } from "@/models/model";
import { showCommandsAtom } from "@/store";
import React, { useContext } from "react";
import { useSetRecoilState } from "@/lib/state";
import { CommandMode } from "@/models/enums";
import UserAvatar from "@/components/Common/UserAvatar";

const InviteNewMembers: React.FC<{ currentProject: IProject }> = ({
  currentProject,
}) => {
  const setShowCommands = useSetRecoilState(showCommandsAtom);
  const { hyperAI } = useProjectQuery();
  const isMbl = useContext(MobileViewContext);

  const toggleInviteModal = () =>
    setShowCommands({ show: true, mode: CommandMode.InviteMember });

  return (
    <>
      <div
        className="board-header-avatars"
        onClick={toggleInviteModal}
        style={{
          flexDirection: "row",
          display: "flex",
          alignItems: "center",
          cursor: "pointer",
        }}
      >
        {currentProject.owner && (
          <UserAvatar
            alt={currentProject.owner.displayName || "Board owner"}
            name={currentProject.owner.displayName || currentProject.owner.email}
            photoURL={currentProject.owner.photoURL}
            size={isMbl ? 16 : 24}
            title={currentProject.owner.displayName || currentProject.owner.email}
          />
        )}
        {hyperAI && (
          <UserAvatar
            key={hyperAI.id}
            className="board-header-avatar dark:border-[#212429] border-[#f7f7f7] border-[2px]  ml-[-8px] "
            alt={hyperAI.displayName || "Hypertask AI"}
            name={hyperAI.displayName || "Hypertask AI"}
            photoURL={hyperAI.photoURL}
            size={isMbl ? 20 : 28}
            title={hyperAI.displayName || "Hypertask AI"}
          />
        )}
        {!isMbl
          ? currentProject.members?.length > 0 && (
              <>
                {currentProject.members.slice(0, 2).map((member) => (
                  <UserAvatar
                    key={member.id}
                    agentId={member.agent?.id}
                    className="board-header-avatar w-[30px] h-[30px] dark:border-[#212429] border-[#f7f7f7] border-[3px]  ml-[-8px] rounded-[600px]  overflow-hidden "
                    alt={member.agent?.displayName ?? member.user?.displayName ?? "Board member"}
                    name={member.agent?.displayName ?? member.user?.displayName ?? member.user?.email}
                    photoURL={member.agent?.photoURL ?? member.user?.photoURL}
                    size={30}
                    title={member.agent?.displayName ?? member.user?.displayName ?? member.user?.email}
                  />
                ))}
                {currentProject.members.length > 2 && (
                  <div
                    key="extra-members"
                    className="board-header-avatar w-[30px] h-[30px] dark:border-[#212429] border-[#f7f7f7] bg-[#4F5765]  border-[3px]  ml-[-8px] rounded-[600px]  overflow-hidden flex items-center justify-center text-micro leading-[10.98px] font-normal text-white"
                  >
                    +{currentProject.members.length - 2}
                  </div>
                )}
              </>
            )
          : currentProject.members.length > 0 && (
              <div
                key="extra-members"
                className="board-header-avatar w-[20px] h-[20px] dark:border-[#212429] border-[#f7f7f7] bg-[#4F5765]  border-[3px]  ml-[-8px] rounded-[600px]  overflow-hidden flex items-center justify-center text-micro font-normal text-white"
              >
                +{currentProject.members.length}
              </div>
            )}
      </div>
    </>
  );
};

export default InviteNewMembers;
