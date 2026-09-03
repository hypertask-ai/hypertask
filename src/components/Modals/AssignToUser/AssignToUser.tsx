import { useEffect, useRef, useState } from "react";
import { Bot, Check } from "lucide-react";
 // Import a robot icon for agents
import { ModalBody } from "reactstrap";
import { useRecoilValue } from "@/lib/state";
import styles from "@/styles/linksModal.module.scss";
import { currentUserAtom } from "@/store";
import { IAgent, IProject, IUser } from "@/models/model";
import { currentProjectAtom } from "@/store";
import { useGetAllMembersForAssign } from "@/hooks/MultiPages/useGetMembersForAssignees";
import {
  ModalContainerCustom,
  ModalHeaderComp,
  ModalInput,
  ModalListContainer,
  ModalRowElementContainer,
} from "@/components/Common/CommonModalComponents";
import useHandleMouseGlobal from "@/hooks/General/useHandleMouse";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import {
  assigneeIntentForOption,
  toAssigneeRows,
  useAssignTaskUser,
} from "@/hooks/Task Detail/useAssignTaskUser";
import { isAgentOption } from "@/lib/assignees";
import { preserveHiddenAssignedOptions } from "@/lib/assignees";
import {
  getAssigneeRecencyLockManager,
  getAssigneeRecencyStorage,
  readRecentAssigneeKeys,
  recordRecentAssigneeUse,
  sortAssigneeOptionsByRecency,
} from "@/lib/assigneeRecency";
import UserAvatar from "@/components/Common/UserAvatar";

interface IProps {
  onClose: any; // Change 'any' to the specific function type if possible
  project?: IProject;
  task?: {
    id: number;
    title: string;
    link: string;
  };
  assignees: (IUser | IAgent)[];
  mode?: "Create" | "Default";
  title?: string;
  includePeople?: boolean;
  includeAgents?: boolean;
  selectedUserIds?: number[];
  selectedAgentIds?: string[];
  extraUsers?: IUser[];
  bulkTaskIds?: number[];
  onBulkAssign?: (user: IUser | IAgent) => Promise<void>;
}

const AssignModal = ({
  onClose,
  project,
  task,
  assignees,
  mode = "Default",
  title = "Assign",
  includePeople = true,
  includeAgents = true,
  selectedUserIds = [],
  selectedAgentIds = [],
  extraUsers = [],
  bulkTaskIds,
  onBulkAssign,
}: IProps) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const { handleMouseEnter, handleMouseLeave, handleMouseMove } =
    useHandleMouseGlobal({
      setSelectedIndex,
      setHoveredIndex,
      preserveSelectedIndexOnHover: true,
    });
  const currentUser = useRecoilValue(currentUserAtom);
  const currentProject = useRecoilValue(currentProjectAtom);
  const [assignKeyword, setAssignKeyword] = useState<string>("");
  const [finalArray, setFinalArray] = useState<(IUser | IAgent)[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<(IUser | IAgent)[]>([]);
  // Mirror of finalArray, plus a counter identifying the newest assign request.
  // Toggles paint before the server replies, so the next toggle can start while
  // the previous one is still in flight and has to build on the optimistic list
  // rather than on a stale render closure.
  const listRef = useRef<(IUser | IAgent)[]>([]);
  const lastRequest = useRef(0);
  const applyList = (list: (IUser | IAgent)[]) => {
    listRef.current = list;
    setFinalArray(list);
  };
  const completeAssigneeRows = (visibleOptions: (IUser | IAgent)[]) =>
    toAssigneeRows(
      preserveHiddenAssignedOptions(
        visibleOptions,
        assignees,
        includePeople,
        includeAgents,
      ),
      task?.id,
    );
  const assignTaskUser = useAssignTaskUser();
  const { data: membersAndOwner } = useGetAllMembersForAssign(
    ["assign", project?.id ?? currentProject?.id],
    project?.id ?? currentProject?.id!,
  );

  const handleChange = (e: any) => {
    setAssignKeyword(e.target.value);
    setSelectedIndex(0);
    setHoveredIndex(null);
    setFilteredUsers(() =>
      finalArray.filter((user) =>
        e.target.value
          ? user.displayName
              ?.toLowerCase()
              .includes(e.target.value.toLowerCase())
          : true,
      ),
    );
  };

  const onAssignUser = async (user: IUser | IAgent) => {
    if (bulkTaskIds?.length && onBulkAssign) {
      try {
        await onBulkAssign(user);
        onClose();
      } catch (error) {
        console.error("Bulk assignment failed", error);
      }
      return;
    }

    if (task?.id && user && currentUser) {
      const flip = (list: (IUser | IAgent)[]) =>
        list.map((u) =>
          u.id === user.id ? { ...u, assigned: !u.assigned } : u,
        );
      // Paint the toggle first. /api/assignees/assign also writes an activity
      // row and a notification and awaits an FCM push before it answers, so
      // waiting on it left the checkmark and the avatars seconds behind the
      // click. Update the task behind the menu but keep the menu open, so
      // several people can be assigned/removed in one go.
      const intent = assigneeIntentForOption(
        listRef.current.find((option) => option.id === user.id) ?? user,
      );
      const optimistic = flip(listRef.current);
      applyList(optimistic);
      setFilteredUsers(flip);
      onClose(completeAssigneeRows(optimistic), true);
      const request = (lastRequest.current += 1);
      try {
        const updatedAssignees = await assignTaskUser(user, task.id, intent);
        // Reconcile with the authoritative rows, but only from the newest
        // request. Responses can land out of order, and an older one still
        // describes the task as it was before the later toggles, so applying
        // it would flicker them back out.
        if (request === lastRequest.current) onClose(updatedAssignees, true);
      } catch (error) {
        console.error("🚀 ~ onAssignUser ~ error:", error);
        // Same guard as the success branch. A newer toggle has either already
        // applied the server's rows, which are authoritative and need no
        // rollback, or is still in flight and will. Undoing this toggle on top
        // of that would flip the wrong person back.
        if (request !== lastRequest.current) return;
        const rolledBack = flip(listRef.current);
        applyList(rolledBack);
        setFilteredUsers(flip);
        onClose(completeAssigneeRows(rolledBack), true);
      }
    }
  };

  const onOpenHandler = () => {
    const members: IUser[] =
      membersAndOwner.members?.map(({ user }: { user: IUser }) => user) || [];
    const owner: IUser | undefined = membersAndOwner.owner;
    // Create a Map to track unique users by their unique identifier (e.g., user.id)
    const uniqueUsersMap = new Map<number, IUser>();
    const uniqueAgentsMap = new Map<string, IAgent>();
    if (includePeople) {
      extraUsers.forEach((user) => uniqueUsersMap.set(user.id, user));
    }
    // Add assignees to the uniqueUsersMap with assigned: true
    assignees.forEach((assignee) => {
      if (isAgentOption(assignee)) {
        if (includeAgents) {
          uniqueAgentsMap.set(assignee.id, { ...assignee, assigned: true });
        }
      } else if (includePeople) {
        uniqueUsersMap.set(assignee.id, { ...assignee, assigned: true });
      }
    });

    const boardAgents: IAgent[] = includeAgents
      ? membersAndOwner?.boardAgents ?? []
      : [];
    boardAgents.forEach((agent) => {
      if (agent && !uniqueAgentsMap.has(agent.id)) {
        uniqueAgentsMap.set(agent.id, {
          ...agent,
          assigned: selectedAgentIds.includes(agent.id),
        });
      }
    });

    // Add members to the uniqueUsersMap with assigned: false
    if (includePeople) {
      members.forEach((user) => {
        if (user) {
          const selected = selectedUserIds.includes(user.id);
          // Only add the user if they are not already in the Map
          if (!uniqueUsersMap.has(user.id))
            uniqueUsersMap.set(user.id, { ...user, assigned: selected });
          else if (selected)
            uniqueUsersMap.set(user.id, {
              ...uniqueUsersMap.get(user.id)!,
              assigned: true,
            });
        }
      });
    }

    // Add owner to the uniqueUsersMap with assigned: false if it's not already present
    if (includePeople && owner && !uniqueUsersMap.has(owner.id)) {
      uniqueUsersMap.set(owner.id, {
        ...owner,
        assigned: selectedUserIds.includes(owner.id),
      });
    }

    // Keep People before Agents while floating assigned entries within each
    // section, then order the rest by this user's most recent selections.
    // The stable fallback preserves the server's existing order for people
    // who have not been selected on this device yet.
    const recentKeys = readRecentAssigneeKeys(
      getAssigneeRecencyStorage(),
      currentUser?.id,
    );
    const allOptions = [
      ...sortAssigneeOptionsByRecency(
        Array.from(uniqueUsersMap.values()),
        recentKeys,
      ),
      ...sortAssigneeOptionsByRecency(
        Array.from(uniqueAgentsMap.values()),
        recentKeys,
      ),
    ];
    applyList(allOptions);
    // Re-apply the current keyword: the members refetch re-runs this after
    // mount, and resetting to the full list mid-typing made Enter hit the
    // wrong row (HTPR-3731).
    setFilteredUsers(
      assignKeyword
        ? allOptions.filter((user) =>
            user.displayName
              ?.toLowerCase()
              .includes(assignKeyword.toLowerCase()),
          )
        : allOptions,
    );
    setSelectedIndex(0);
    setHoveredIndex(null);
  };

  const handleKeyDown = (event: any) => {
    if (event.keyCode === KeyCodes.ESCAPE) {
      event.preventDefault();
      onClose();
    }
    if (filteredUsers.length === 0) return;

    if (event.keyCode === KeyCodes.ARROW_DOWN) {
      event.preventDefault();
      if (filteredUsers[selectedIndex]) {
        if (
          selectedIndex === -1 ||
          selectedIndex === filteredUsers.length - 1
        ) {
        } else {
          setSelectedIndex((prev) => prev + 1);
          document
            .getElementById(`task_${filteredUsers[selectedIndex + 1]?.id}`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      } else {
        if (finalArray.length > 0) {
          setSelectedIndex(0);

          document
            .getElementById(`task_${finalArray[0]?.id}`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    }
    if (event.keyCode === KeyCodes.ARROW_UP) {
      event.preventDefault();
      if (filteredUsers[selectedIndex]) {
        if (selectedIndex <= 0) {
        } else {
          setSelectedIndex((prev) => prev - 1);
          document
            .getElementById(`task_${filteredUsers[selectedIndex - 1]?.id}`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    }
    if (event.keyCode === KeyCodes.ENTER) {
      if (filteredUsers[selectedIndex]) {
        event.preventDefault();
        enterHandler(filteredUsers[selectedIndex]);
      }
    }
  };

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [filteredUsers, selectedIndex]);

  useEffect(() => {
    onOpenHandler();
  }, [membersAndOwner, currentUser?.id]);

  const enterHandler = (user: IUser | IAgent) => {
    void recordRecentAssigneeUse(
      getAssigneeRecencyStorage(),
      currentUser?.id,
      user,
      getAssigneeRecencyLockManager(),
    );
    mode === "Create" ? onClose(user) : onAssignUser(user);
  };

  const people = filteredUsers.filter((user) => !isAgentOption(user));
  const agents = filteredUsers.filter(isAgentOption);

  const renderSection = (
    heading: "People" | "Agents",
    users: (IUser | IAgent)[],
    startIndex: number,
  ) =>
    users.length > 0 && (
      <div>
        <h3 className="px-4 pt-2.5 pb-1 text-text-light-gray font-semibold text-micro uppercase tracking-wider">
          {heading}
        </h3>
        {users.map((user, sectionIndex) => {
          const index = startIndex + sectionIndex;
          return (
            <ModalRowElementContainer
              id={`task_${user.id}`}
              handleMouseLeave={handleMouseLeave}
              onMouseEnter={() => handleMouseEnter(index)}
              key={`${heading.toLowerCase()}-${user.id}`}
              onClick={() => enterHandler(user)}
              isSelected={
                hoveredIndex === index ||
                (hoveredIndex === null && selectedIndex === index)
              }
            >
              <Assignee
                userAvatar={user.photoURL}
                displayName={user.displayName}
                isAssigned={user.assigned}
                isAgent={isAgentOption(user)}
                agentId={isAgentOption(user) ? String(user.id) : undefined}
                isClearOption={user.id === 0}
              />
            </ModalRowElementContainer>
          );
        })}
      </div>
    );

  return (
    <ModalContainerCustom
      id="assignees-modal"
      isOpen={true}
      onOpened={() => {
        onOpenHandler();
      }}
      toggle={onClose}
      className={`paletteModalSizing sm:min-w-[560px] sm:top-[24%] ${styles.links_modal}`}
    >
      <ModalHeaderComp header={title} />
      <ModalBody className=" p-0 rounded-[4px] ">
        <ModalInput
          onChange={handleChange}
          value={assignKeyword}
          placeholder={includePeople ? "Type user name" : "Type agent name"}
          autofocus={true}
        />
        <ModalListContainer className="max-h-[364px]"
          handleMouseMove={handleMouseMove}
          id="assignees-list"
        >
          {renderSection("People", people, 0)}
          {renderSection("Agents", agents, people.length)}
        </ModalListContainer>
      </ModalBody>
    </ModalContainerCustom>
  );
};

type TAssignee = {
  isAssigned?: boolean;
  userAvatar?: string | null;
  displayName?: string;
  isAgent?: boolean;
  agentId?: string;
  isClearOption?: boolean;
};

const Assignee: React.FC<TAssignee> = ({
  userAvatar,
  displayName = "User",
  isAssigned = false,
  isAgent = false,
  agentId,
  isClearOption = false,
}) => {
  return (
    <>
      <div className="flex-grow flex space-x-2 items-center">
        {isClearOption ? (
          <span className="w-4 sm:w-8 h-4 sm:h-8" />
        ) : (
          <UserAvatar
            agentId={agentId}
            alt=""
            compactOnMobile
            name={displayName}
            photoURL={userAvatar}
            size={32}
            title={displayName}
          />
        )}
        <p className="font-medium">{displayName}</p>
        {isAgent && <Bot strokeWidth={1.75} className="mr-1 w-4 h-4" />}
      </div>
      {isAssigned ? <Check size={16} strokeWidth={1.75} /> : null}
    </>
  );
};
export default AssignModal;
