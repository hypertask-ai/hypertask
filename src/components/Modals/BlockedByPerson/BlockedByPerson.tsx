import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Check } from "lucide-react";
import { ModalBody } from "reactstrap";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  ModalContainerCustom,
  ModalHeaderComp,
  ModalInput,
  ModalListContainer,
  ModalRowElementContainer,
} from "@/components/Common/CommonModalComponents";
import useHandleMouseGlobal from "@/hooks/General/useHandleMouse";
import { useGetAllMembersForAssign } from "@/hooks/MultiPages/useGetMembersForAssignees";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import type { IUser } from "@/models/model";
import styles from "@/styles/linksModal.module.scss";
import UserAvatar from "@/components/Common/UserAvatar";

type WaitingOnFields = {
  id: number;
  waitingOnUserId: number | null;
  waitingOnSetById: number | null;
  waitingOnSetAt: string | null;
};

type WaitingOnOption = Pick<IUser, "id" | "displayName" | "photoURL">;

const BlockedByPersonModal = ({
  taskId,
  projectId,
  waitingOnUserId,
  onClose,
}: {
  taskId: number;
  projectId: number;
  waitingOnUserId?: number | null;
  onClose: (fields?: WaitingOnFields) => void;
}) => {
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const { handleMouseEnter, handleMouseLeave, handleMouseMove } =
    useHandleMouseGlobal({ setSelectedIndex });
  const { data: membersAndOwner } = useGetAllMembersForAssign(
    ["waiting-on-members", projectId],
    projectId
  );

  const options = useMemo<WaitingOnOption[]>(() => {
    const users = new Map<number, WaitingOnOption>();
    const owner = membersAndOwner?.owner as IUser | undefined;
    if (owner) users.set(owner.id, owner);
    for (const member of membersAndOwner?.members ?? []) {
      if (member.user) users.set(member.user.id, member.user);
    }
    return [
      { id: 0, displayName: "Nobody (clear)", photoURL: undefined },
      ...users.values(),
    ];
  }, [membersAndOwner]);

  const filteredOptions = useMemo(
    () =>
      options.filter((user) =>
        keyword
          ? user.displayName?.toLowerCase().includes(keyword.toLowerCase())
          : true
      ),
    [keyword, options]
  );

  const selectUser = async (user: WaitingOnOption) => {
    if (saving) return;
    setSaving(true);
    try {
      const response = await axios.post<WaitingOnFields>(
        "/api/tasks/waiting-on",
        { taskId, userId: user.id === 0 ? null : user.id }
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["task-", taskId] }),
        queryClient.invalidateQueries({ queryKey: ["inbox"] }),
      ]);
      onClose(response.data);
    } catch {
      toast.error("Unable to update blocked by person");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.keyCode === KeyCodes.ESCAPE) {
        event.preventDefault();
        onClose();
      } else if (event.keyCode === KeyCodes.ARROW_DOWN) {
        event.preventDefault();
        setSelectedIndex((index) =>
          Math.min(index + 1, filteredOptions.length - 1)
        );
      } else if (event.keyCode === KeyCodes.ARROW_UP) {
        event.preventDefault();
        setSelectedIndex((index) => Math.max(index - 1, 0));
      } else if (
        event.keyCode === KeyCodes.ENTER &&
        filteredOptions[selectedIndex]
      ) {
        event.preventDefault();
        void selectUser(filteredOptions[selectedIndex]);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [filteredOptions, onClose, saving, selectedIndex]);

  useEffect(() => setSelectedIndex(0), [keyword]);

  return (
    <ModalContainerCustom
      id="blocked-by-person-modal"
      isOpen
      toggle={() => onClose()}
      className={`paletteModalSizing sm:min-w-[560px] sm:top-[24%] ${styles.links_modal}`}
    >
      <ModalHeaderComp header="Blocked by person" />
      <ModalBody className="p-0 rounded-[4px]">
        <ModalInput
          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            setKeyword(event.target.value)
          }
          value={keyword}
          placeholder="Type user name"
          autofocus
        />
        <ModalListContainer
          className="max-h-[364px]"
          handleMouseMove={handleMouseMove}
          id="blocked-by-person-list"
        >
          {filteredOptions.map((user, index) => (
            <ModalRowElementContainer
              id={`waiting-on-user-${user.id}`}
              handleMouseLeave={handleMouseLeave}
              onMouseEnter={() => handleMouseEnter(index)}
              key={user.id}
              onClick={() => void selectUser(user)}
              isSelected={selectedIndex === index}
            >
              <div className="flex flex-grow items-center space-x-2">
                {user.id === 0 ? (
                  <span className="w-4 sm:w-8 h-4 sm:h-8" />
                ) : (
                  <UserAvatar
                    alt=""
                    compactOnMobile
                    name={user.displayName}
                    photoURL={user.photoURL}
                    size={32}
                    title={user.displayName}
                  />
                )}
                <p className="font-medium">{user.displayName}</p>
              </div>
              {waitingOnUserId === (user.id || null) && (
                <Check size={16} strokeWidth={1.75} />
              )}
            </ModalRowElementContainer>
          ))}
        </ModalListContainer>
      </ModalBody>
    </ModalContainerCustom>
  );
};

export default BlockedByPersonModal;
