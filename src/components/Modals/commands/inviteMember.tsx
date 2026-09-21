import { IAgent, IProject, IUser } from "@/models/model";
import { currentProjectAtom, currentUserAtom } from "@/store";
import { ChangeEvent, useEffect, useRef, useState } from "react";
import { useRecoilValue } from "@/lib/state";
import { emailPattern } from "@/utils";
import toast from "react-hot-toast";
import {
  ModalContainerCustom,
  ModalHeaderComp,
  ModalInput,
  ModalListContainer,
  ModalRowElementContainer,
} from "@/components/Common/CommonModalComponents";
import {
  prefixInviteForProject,
  useGetBoardInviteURL,
} from "@/hooks/Homepage/Invites/useGetBoardInviteURL";
import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { Bot, Copy, RefreshCw, Share2 } from "lucide-react";


import { useAgents } from "@/hooks/MultiPages/useAgents";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import GuestSignupOverlay from "@/components/Common/GuestLock/GuestSignupOverlay";
import { isGuestCookieUser } from "@/lib/demo/isGuestClient";
import UserAvatar from "@/components/Common/UserAvatar";

type TMemberInviteItem = IUser | IAgent | string;

type TOptions = "Copy" | "Reset" | "InviteViaEmail" | "Share";
type TStartingScreen =
  | "Home"
  | "InviteOrRemove"
  | "PendingScreen"
  | "ShareLink";

interface IShareScreenOptions {
  title: string;
  icon: React.ReactNode;
  type: TOptions;
}

type Props = {
  removeMember: (member: IUser) => void;
  addAgentToBoard: (agent: IAgent) => void;
  removeAgentFromBoard: (agent: IAgent) => void;
  inviteNewMember: (emails: string[]) => void;
  optionalProjectId?: number | null;
  reSendInvite: (
    email: string,
    _currentProject: IProject,
    currentUser: IUser,
  ) => Promise<void>;
  cancelInvite: (email: string, _currentProject: IProject) => Promise<void>;
  closeHandler: () => void;
  startingScreen: TStartingScreen;
};

const defaultOptions = ["Copy board join link", "Read only view"];

const ShareScreenOptions: IShareScreenOptions[] = [
  { title: "Copy board join link", icon: <Copy size={16} strokeWidth={1.75} />, type: "Copy" },
  { title: "Read only view", icon: <Share2 size={16} strokeWidth={1.75} />, type: "Share" },
  { title: "Reset board join link", icon: <RefreshCw size={16} strokeWidth={1.75} />, type: "Reset" },
  { title: "Invite via email", icon: null, type: "InviteViaEmail" },
];

function isAgent(item: TMemberInviteItem): item is IAgent {
  return typeof item === "object" && !("uid" in item);
}

function isUser(item: TMemberInviteItem): item is IUser {
  return typeof item === "object" && "uid" in item;
}

const InviteMember = (props: Props) => {
  const {
    removeMember,
    addAgentToBoard,
    removeAgentFromBoard,
    inviteNewMember,
    closeHandler,
    cancelInvite,
    reSendInvite,
    startingScreen,
  } = props;

  const [keyword, setKeyword] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const currentUser = useRecoilValue(currentUserAtom);
  const currentProject = useRecoilValue(currentProjectAtom);
  const { data: inviteURL } = useGetBoardInviteURL(
    currentProject?.id!,
    currentUser.id,
  );
  const [selectedUser, setSelectedUser] = useState<IUser | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<IAgent | null>(null);
  const [pendingInvite, setPendingInvite] = useState<string>("");
  const [toggleConfirmView, setToggleConfirmView] =
    useState<TStartingScreen>(startingScreen);
  const [membersAndInvites, setMembersAndInvites] = useState<
    TMemberInviteItem[]
  >([]);
  const [filteredMembersAndInvites, setFilteredMembersAndInvites] = useState<
    TMemberInviteItem[]
  >([]);
  const queryClient = useQueryClient();
  const { agents: ownedAgents } = useAgents();

  const ulRef = useRef<HTMLUListElement | null>(null);
  const debounceTimeout = useRef<NodeJS.Timeout | null>(null);
  const currentHoveredDiv = useRef<number | null>(null);

  const onKeyChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSelectedIndex(0);
    setKeyword(e.target.value);
    setFilteredMembersAndInvites(filterMembersAndInvites(e.target.value));
  };

  useEffect(() => {
    if (!currentProject) return;
    const projectId = props.optionalProjectId ?? currentProject.id;
    fetch(
      `/api/members/getAll?projectId=${projectId}&teamMembers=true&teamId=${currentProject.teamId}`,
      { method: "GET" },
    ).then(async (response) => {
      if (response && response.ok) {
        const data = await response.json();
        const boardAgentIds = new Set(
          (data.boardAgents ?? []).map((a: IAgent) => a.id)
        );
        const boardAgentItems: IAgent[] = (data.boardAgents ?? []).map(
          (a: IAgent) => ({ ...a, type: "boardAgent" as const })
        );
        const addableAgentItems: IAgent[] = (ownedAgents ?? [])
          .filter((a) => !boardAgentIds.has(a.id) && !a.revokedAt)
          .map((a) => ({ ...a, type: "addableAgent" as const }));

        const newState: TMemberInviteItem[] = [
          ...defaultOptions,
          ...data.members.map((item: any) => ({
            ...item.user,
            type: "boardMember" as const,
          })),
          ...boardAgentItems,
          ...data.teamMembers.map((u: any) => ({
            ...u.user,
            type: "teamMember" as const,
          })),
          ...data.emailsInvited,
          ...addableAgentItems,
        ];
        setMembersAndInvites(newState);
        setFilteredMembersAndInvites(newState);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownedAgents, currentProject?.id]);

  const handleKeydownRef = useRef<(e: KeyboardEvent) => void>(undefined);
  handleKeydownRef.current = (e: KeyboardEvent) => {
    if (isGuestCookieUser()) return;

    const length =
      toggleConfirmView === "ShareLink"
        ? ShareScreenOptions.length
        : membersAndInvites.length;

    if (e.keyCode === KeyCodes.ESCAPE && (selectedUser || selectedAgent)) {
      e.preventDefault();
      setSelectedUser(null);
      setSelectedAgent(null);
    }
    if (filteredMembersAndInvites.length === 0) return;
    if (e.keyCode === KeyCodes.ENTER && toggleConfirmView === "ShareLink") {
      return enterHandlerShareLinkView(ShareScreenOptions[selectedIndex]);
    }
    if (e.keyCode === KeyCodes.ENTER && selectedAgent) {
      if (selectedAgent.type === "boardAgent") {
        removeAgentFromBoard(selectedAgent);
        closeHandler();
      } else {
        addAgentToBoard(selectedAgent);
        closeHandler();
      }
    }
    if (e.keyCode === KeyCodes.ENTER && selectedUser) {
      if (selectedUser.type === "boardMember") removeMember(selectedUser);
      else if (selectedUser.email) inviteNewMember([selectedUser.email]);
      else toast("Something went wrong");
    }
    if (e.keyCode === KeyCodes.ARROW_DOWN) {
      const selectedIdx = (selectedIndex + 1) % length;
      setSelectedIndex(selectedIdx);
      document
        .getElementById(`member_invite-${selectedIdx}`)
        ?.scrollIntoView({ behavior: "smooth", inline: "center" });
    }
    if (e.keyCode === KeyCodes.ARROW_UP) {
      const selectedIdx = (selectedIndex + length - 1) % length;
      setSelectedIndex(selectedIdx);
      document
        .getElementById(`member_invite-${selectedIdx}`)
        ?.scrollIntoView({ behavior: "smooth", inline: "center" });
    }
  };

  const handleKeydown = (e: KeyboardEvent) => handleKeydownRef.current?.(e);

  useEffect(() => {
    document.addEventListener("keydown", handleKeydown);
    return () => {
      document.removeEventListener("keydown", handleKeydown);
    };
  }, []);

  const onSubmit = () => {
    if (isGuestCookieUser()) return;

    const matches = keyword.match(emailPattern);
    if (matches && matches.length > 0) {
      inviteNewMember(matches);
    }
  };

  const filterMembersAndInvites = (kw: string): TMemberInviteItem[] => {
    if (!kw) return membersAndInvites;
    return membersAndInvites.filter((item) => {
      if (typeof item === "string") {
        return item.toLowerCase().includes(kw.toLowerCase());
      }
      if (
        item.displayName &&
        item.displayName.toLowerCase().includes(kw.toLowerCase())
      ) {
        return true;
      }
      if (
        isUser(item) &&
        item.email &&
        item.email.toLowerCase().includes(kw.toLowerCase())
      ) {
        return true;
      }
      return false;
    });
  };

  const toggleConfirmRemove = (item: TMemberInviteItem) => {
    setTimeout(() => {
      if (isAgent(item)) {
        setSelectedAgent(item);
        setToggleConfirmView("InviteOrRemove");
        return;
      }
      if (isUser(item)) {
        if (item.id) {
          setSelectedUser(item);
          setToggleConfirmView("InviteOrRemove");
        }
      } else {
        if (defaultOptions.includes(item)) {
          setToggleConfirmView("ShareLink");
        } else {
          setToggleConfirmView("PendingScreen");
          setPendingInvite(item);
        }
      }
    }, 10);
  };

  const onOpenHandler = () => {
    document.getElementById("inviteInput")?.focus();
  };

  const handleMouseLeave = () => {
    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
      debounceTimeout.current = null;
    }
    debounceTimeout.current = setTimeout(() => {
      currentHoveredDiv.current = null;
    }, 100);
  };

  const handleMouseEnter = (index: number) => {
    currentHoveredDiv.current = index;
  };

  const handleMouseMove = () => {
    if (debounceTimeout.current) {
      setSelectedIndex(currentHoveredDiv.current ?? 0);
      clearTimeout(debounceTimeout.current);
      debounceTimeout.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (debounceTimeout.current) clearTimeout(debounceTimeout.current);
    };
  }, []);

  const pendingCallback = async (email: string, flag: "resend" | "cancel") => {
    if (isGuestCookieUser()) return;

    closeHandler();
    flag === "cancel"
      ? cancelInvite(email, currentProject!)
      : reSendInvite(email, currentProject!, currentUser);
  };

  const copyboardlink = () => {
    if (isGuestCookieUser()) return;

    navigator.clipboard.writeText(inviteURL?.inviteLink);
    toast.success("Invite link copied to clipboard");
  };

  const copyReadOnlyView = () => {
    if (isGuestCookieUser()) return;

    const baseURL =
      String(process.env.NEXT_PUBLIC_BASEURL) ?? "https://app.hypertask.ai";
    let key: string | null = null;
    if (inviteURL?.inviteLink) {
      try {
        const url = new URL(inviteURL.inviteLink);
        key = url.searchParams.get("key");
      } catch {
        // malformed URL — key stays null
      }
    }
    navigator.clipboard.writeText(`${baseURL}/share/project?id=${key}`);
    toast.success("Read only view link copied");
  };

  const resetLink = async () => {
    if (isGuestCookieUser()) return;

    await axios.post(`/api/invite/generatePublicInvite`, {
      projectId: currentProject?.id!,
      userId: currentUser.id,
    });
    queryClient.refetchQueries({
      queryKey: [prefixInviteForProject, currentProject?.id!],
    });
    toast.success("Invite link reset successfull! Previous links are invalid");
  };

  const enterHandlerShareLinkView = (x: IShareScreenOptions) => {
    if (x.type === "Copy") copyboardlink();
    else if (x.type === "InviteViaEmail") {
      setToggleConfirmView("Home");
      setSelectedIndex(0);
    } else if (x.type === "Share") copyReadOnlyView();
    else resetLink();
  };

  return (
    <ModalContainerCustom
      fade={false}
      onOpened={onOpenHandler}
      toggle={closeHandler}
      show={true}
      isOpen={true}
      id="inviteMemberModal"
      className="paletteModalSizing sm:min-w-[560px] sm:top-[24%]"
    >
      <GuestSignupOverlay onSignup={closeHandler}>
        {toggleConfirmView === "Home" ? (
          <>
            <ModalHeaderComp header="Invite to Board (share)" />
            <div className="rounded-[5px] p-0">
            <ModalInput
              value={keyword}
              placeholder="Email, comma separated"
              onKeyDown={(e: any) => {
                if (
                  e.key === "Enter" &&
                  filteredMembersAndInvites.length === 0
                ) {
                  onSubmit();
                } else if (e.key === "Enter") {
                  toggleConfirmRemove(filteredMembersAndInvites[selectedIndex]);
                }
              }}
              onChange={onKeyChange}
            />
            <ul
              ref={ulRef}
              onMouseMove={handleMouseMove}
              className="max-h-[364px] overflow-y-auto rounded-b-[5px] scrollbar-none"
            >
              {filteredMembersAndInvites.map(
                (item: TMemberInviteItem, index: number) => {
                  if (typeof item === "string") {
                    return (
                      <ModalRowElementContainer
                        key={index}
                        onMouseEnter={() => handleMouseEnter(index)}
                        handleMouseLeave={handleMouseLeave}
                        onClick={() => toggleConfirmRemove(item)}
                        id={`member_invite-${index}`}
                        index={index}
                        isSelected={selectedIndex === index}
                      >
                        {defaultOptions.includes(item) ? (
                          <div className="flex justify-between items-center">
                            <span>{item}</span>
                          </div>
                        ) : (
                          <div className="flex-grow flex space-x-2 items-center cursor-pointer">
                            <span className="bg-active-modal-element w-8 h-8 rounded-full" />
                            <p className="font-medium">{item}</p>
                            <span className="flex-grow text-end">Pending</span>
                          </div>
                        )}
                      </ModalRowElementContainer>
                    );
                  } else if (isAgent(item)) {
                    return (
                      <ModalRowElementContainer
                        key={index}
                        onMouseEnter={() => handleMouseEnter(index)}
                        handleMouseLeave={handleMouseLeave}
                        onClick={() => toggleConfirmRemove(item)}
                        id={`member_invite-${index}`}
                        index={index}
                        isSelected={selectedIndex === index}
                      >
                        <div className="flex-grow flex space-x-2 items-center cursor-pointer">
                          <UserAvatar
                            agentId={item.id}
                            alt=""
                            name={item.displayName}
                            photoURL={item.photoURL}
                            size={32}
                            title={item.displayName}
                          />
                          <p className="font-medium">
                            {item.displayName}
                          </p>
                          <Bot strokeWidth={1.75} className="w-4 h-4 text-text-light-gray" />
                        </div>
                        {item.type === "boardAgent" ? (
                          <span className="font-semibold">Remove</span>
                        ) : (
                          <span className="font-semibold text-hypertasks-purple">
                            Add to board
                          </span>
                        )}
                      </ModalRowElementContainer>
                    );
                  } else {
                    return (
                      <ModalRowElementContainer
                        key={index}
                        onMouseEnter={() => handleMouseEnter(index)}
                        handleMouseLeave={handleMouseLeave}
                        onClick={() => toggleConfirmRemove(item)}
                        id={`member_invite-${index}`}
                        index={index}
                        isSelected={selectedIndex === index}
                      >
                        <div className="flex-grow flex space-x-2 items-center cursor-pointer">
                          <UserAvatar
                            alt=""
                            name={item.displayName}
                            photoURL={item.photoURL}
                            size={32}
                            title={item.displayName}
                          />
                          <p className="font-medium capitalize">
                            {item.displayName}
                          </p>
                        </div>
                        {item.type === "boardMember" ? (
                          <span className="font-semibold">Remove</span>
                        ) : (
                          <span className="font-semibold text-hypertasks-purple">
                            Invite
                          </span>
                        )}
                      </ModalRowElementContainer>
                    );
                  }
                },
              )}
            </ul>
            </div>
          </>
        ) : toggleConfirmView === "InviteOrRemove" ? (
          <>
          <div className="h-[48px] rounded-t-[5px] border-transparent px-4 font-medium">
            <div className="grid h-[48px] items-center gap-2 px-[6px] py-[8px] text-emphasis">
              <span className="w-full">
                {selectedAgent?.displayName ?? selectedUser?.displayName}
              </span>
            </div>
          </div>
          {selectedAgent ? (
            selectedAgent.type === "boardAgent" ? (
              <ModalRowElementContainer
                isSelected={true}
                onClick={() => {
                  removeAgentFromBoard(selectedAgent);
                  closeHandler();
                }}
              >
                Remove {selectedAgent.displayName} from the board
              </ModalRowElementContainer>
            ) : (
              <ModalRowElementContainer
                isSelected={true}
                onClick={() => {
                  addAgentToBoard(selectedAgent);
                  closeHandler();
                }}
              >
                Add {selectedAgent.displayName} to the board
              </ModalRowElementContainer>
            )
          ) : selectedUser && selectedUser.type === "boardMember" ? (
            <ModalRowElementContainer
              isSelected={true}
              onClick={() => removeMember(selectedUser)}
            >
              Remove {selectedUser.displayName} from the board
            </ModalRowElementContainer>
          ) : (
            <ModalRowElementContainer
              isSelected={true}
              onClick={() =>
                selectedUser && inviteNewMember([selectedUser.email!])
              }
            >
              Invite {selectedUser?.displayName} to the board
            </ModalRowElementContainer>
          )}
          </>
        ) : toggleConfirmView === "ShareLink" ? (
          <>
          <ModalHeaderComp header="Share invite link to your team" />
          <div className="p-4">
            <span
              onClick={copyboardlink}
              className="text-text-light-gray whitespace-nowrap truncate line-clamp-1 overflow-x-auto scrollbar-none cursor-pointer"
            >
              {inviteURL?.inviteLink}
            </span>
          </div>
          <ModalListContainer
            ref={ulRef}
            handleMouseMove={handleMouseMove}
            id="filteredCommandsList"
          >
            {ShareScreenOptions.map((item, index) => (
              <ModalRowElementContainer
                key={`share-screen-${index}`}
                onMouseEnter={() => handleMouseEnter(index)}
                handleMouseLeave={handleMouseLeave}
                onClick={() => enterHandlerShareLinkView(item)}
                id={`member_invite-${index}`}
                index={index}
                isSelected={selectedIndex === index}
              >
                <div className="flex w-full justify-between items-center">
                  <span className="cursor-pointer">{item.title}</span>
                  <div>{item.icon}</div>
                </div>
              </ModalRowElementContainer>
            ))}
          </ModalListContainer>
          </>
        ) : (
          <PendingInviteRow callback={pendingCallback} email={pendingInvite} />
        )}
      </GuestSignupOverlay>
    </ModalContainerCustom>
  );
};

const PendingInviteRow = ({
  email,
  callback,
}: {
  email: string;
  callback: (email: string, flag: "resend" | "cancel") => Promise<void>;
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const handleKeydownRef = useRef<(e: KeyboardEvent) => void>(undefined);
  handleKeydownRef.current = (e: KeyboardEvent) => {
    if (isGuestCookieUser()) return;

    if (e.keyCode === KeyCodes.ARROW_DOWN) {
      e.preventDefault();
      setSelectedIndex(1);
    }
    if (e.keyCode === KeyCodes.ARROW_UP) {
      e.preventDefault();
      setSelectedIndex(0);
    }
    if (e.keyCode === KeyCodes.ENTER) {
      callback(email, selectedIndex === 0 ? "resend" : "cancel");
    }
  };

  const handleKeydown = (e: KeyboardEvent) => handleKeydownRef.current?.(e);

  useEffect(() => {
    document.addEventListener("keydown", handleKeydown);
    return () => {
      document.removeEventListener("keydown", handleKeydown);
    };
  }, []);

  return (
    <>
      <div className="h-[48px] rounded-t-[5px] border-transparent bg-modalBackground px-4 font-medium text-white-black">
        <div className="grid h-[48px] items-center gap-2 px-[6px] py-[8px] text-emphasis">
          <span className="w-full">Choose what to do with this invite</span>
        </div>
      </div>
      <span
        onMouseOver={() => setSelectedIndex(0)}
        className={`mx-1.5 flex h-[36px] cursor-pointer items-center rounded-sm px-3 text-dense ${
          selectedIndex === 0 ? "bg-active-modal-element" : "bg-transparent"
        }`}
        onClick={() => callback(email, "resend")}
      >
        Resend Invite
      </span>
      <span
        onMouseOver={() => setSelectedIndex(1)}
        className={`mx-1.5 flex h-[36px] cursor-pointer items-center rounded-sm px-3 text-dense ${
          selectedIndex === 1 ? "bg-active-modal-element" : "bg-transparent"
        }`}
        onClick={() => callback(email, "cancel")}
      >
        Cancel Invite
      </span>
    </>
  );
};

export default InviteMember;
