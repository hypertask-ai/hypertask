

import { useEffect, useRef, useState } from 'react';
import { Bot, Check } from "lucide-react";

import { ModalBody } from 'reactstrap';
import styles from '@/styles/linksModal.module.scss'
import { IAgent, IUser } from '@/models/model';
import { ModalContainerCustom, ModalHeaderComp, ModalInput, ModalListContainer, ModalRowElementContainer } from '@/components/Common/CommonModalComponents';
import useHandleMouseGlobal from '@/hooks/General/useHandleMouse';
import UserAvatar from '@/components/Common/UserAvatar';
import type { CalendarUserSummary } from "@/lib/calendarSync/contract";

export type UserSelectionUser = IUser | CalendarUserSummary;
export type UserSelectionEntry = UserSelectionUser | IAgent;

export type UserSelectionMode = "single" | "multiple";
export type UserSelectionContext = "assignees" | "followers" | "updatedBy" | "createdBy" | "custom";

interface IUserSelectionModalProps {
  display: boolean;
  onClose: (selectedUsers?: UserSelectionEntry | UserSelectionEntry[]) => void;
  users: UserSelectionEntry[];
  selectedUsers?: (number | string)[];
  mode?: UserSelectionMode;
  context: UserSelectionContext;
  title?: string;
  placeholder?: string;
  allowDeselect?: boolean;
}

const UserSelectionModal = ({ 
  display, 
  onClose, 
  users = [], 
  selectedUsers = [],
  mode = "multiple",
  context,
  title,
  placeholder = "Type user name",
  allowDeselect = true
}: IUserSelectionModalProps) => {

  const [selectedIndex, setSelectedIndex] = useState(0);
  const { handleMouseEnter, handleMouseLeave, handleMouseMove } = useHandleMouseGlobal({ setSelectedIndex });
  const [modal, setModal] = useState<boolean>(display);
  const inputRef = useRef<HTMLInputElement>(null);
  const [searchKeyword, setSearchKeyword] = useState<string>("");
  const [internalSelectedUsers, setInternalSelectedUsers] = useState<Set<number | string>>(new Set());
  const [filteredUsers, setFilteredUsers] = useState<UserSelectionEntry[]>([]);

  function isAgent(entry: UserSelectionEntry): entry is IAgent {
    return typeof entry.id === "string";
  }

  useEffect(() => {
    const selectedIds = new Set(selectedUsers);
    setInternalSelectedUsers(selectedIds);
  }, [selectedUsers]);

  useEffect(() => {
    const filtered = users.filter((user) =>
      !searchKeyword || user.displayName?.toLowerCase().includes(searchKeyword.toLowerCase())
    );
    setFilteredUsers(filtered);
  }, [searchKeyword, users]);

  const getModalTitle = () => {
    if (title) return title;
    switch (context) {
      case "assignees": return "Assign";
      case "followers": return "Add Followers";
      case "updatedBy": return "Filter by Updated By";
      case "createdBy": return "Filter by Created By";
      default: return "Select Users";
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchKeyword(e.target.value);
  };

  const toggle = () => {
    setModal(!modal);
    setSearchKeyword("");
    onClose();
  };

  const handleUserSelection = (user: UserSelectionEntry) => {
    const isSelected = internalSelectedUsers.has(user.id);
    
    if (mode === "single") {
      onClose(user);
      toggle();
    } else {
      const newSelectedUsers = new Set(internalSelectedUsers);
      
      if (isSelected && allowDeselect) {
        newSelectedUsers.delete(user.id);
      } else if (!isSelected) {
        newSelectedUsers.add(user.id);
      }
      
      setInternalSelectedUsers(newSelectedUsers);
      
      const selectedUserArray = users.filter(u => newSelectedUsers.has(u.id));
      onClose(selectedUserArray);
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      toggle();
    }
    
    if (filteredUsers.length === 0) return;

    if (event.key === "ArrowDown") {
      if (selectedIndex < filteredUsers.length - 1) {
        setSelectedIndex(prev => prev + 1);
        document.getElementById(`user_${filteredUsers[selectedIndex + 1]?.id}`)?.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        });
      }
    } else if (event.key === "ArrowUp") {
      if (selectedIndex > 0) {
        setSelectedIndex(prev => prev - 1);
        document.getElementById(`user_${filteredUsers[selectedIndex - 1]?.id}`)?.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        });
      }
    } else if (event.key === "Enter" && filteredUsers[selectedIndex]) {
      handleUserSelection(filteredUsers[selectedIndex]);
    }
  };

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [filteredUsers, selectedIndex]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredUsers]);

  useEffect(() => {
    inputRef?.current?.focus();
  }, []);

  return (
    <ModalContainerCustom
      id="userSelectionModal"
      isOpen={modal}
      toggle={toggle}
      className={`${styles.links_modal}`}
    >
      <ModalHeaderComp header={getModalTitle()} />
      <ModalBody className='p-0 rounded-[4px]'>
        <ModalInput
          ref={inputRef}
          onChange={handleChange}
          value={searchKeyword}
          placeholder={placeholder}
          autoFocus={true}
        />
        <ModalListContainer
          handleMouseMove={handleMouseMove}
          id="filteredUsersList"
        >
          {filteredUsers.map((user: UserSelectionEntry, index: number) => (
            <ModalRowElementContainer
              id={`user_${user.id}`}
              handleMouseLeave={handleMouseLeave}
              onMouseEnter={() => handleMouseEnter(index)}
              key={`user-${user.id}`}
              onClick={() => handleUserSelection(user)}
              isSelected={selectedIndex === index}
            >
              <UserRow
                userAvatar={user.photoURL ?? undefined}
                displayName={user.displayName ?? undefined}
                isChecked={internalSelectedUsers.has(user.id)}
                isAgent={isAgent(user)}
                agentId={isAgent(user) ? user.id : undefined}
              />
            </ModalRowElementContainer>
          ))}
        </ModalListContainer>
      </ModalBody>
    </ModalContainerCustom>
  );
};

type TUserRow = {
  isChecked?: boolean;
  userAvatar?: string | null;
  displayName?: string;
  isAgent?: boolean;
  agentId?: string;
}

const UserRow: React.FC<TUserRow> = ({ userAvatar, displayName = "User", isChecked = false, isAgent = false, agentId }) => {
  return (
    <>
      <div className="flex-grow flex space-x-2 items-center">
        <UserAvatar
          agentId={agentId}
          alt=""
          compactOnMobile
          name={displayName}
          photoURL={userAvatar}
          size={32}
          title={displayName}
        />
        <p className='font-medium'>{displayName}</p>
        {isAgent && <Bot strokeWidth={1.75} className="mr-1 w-4 h-4" />}
      </div>
      {isChecked && <Check size={16} strokeWidth={1.75} />}
    </>
  );
};

export default UserSelectionModal;
