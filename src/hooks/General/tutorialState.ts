import { DisplayDate } from "@/components/Modals/RemindMe/RemindMeComponent";
import useTiptap from "@/components/RTE/Tiptap";
import {
  defaultOptions,
  getBoards,
  getSidebarInfo,
  moveColumns,
  priorities,
  sceneStates,
  staticNotifications,
  staticSplitTitles,
  tutorialUsers,
} from "@/lib/constants/InteractiveOnboarding/constants";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import {
  IBoard,
  IBoardHeader,
  INotification,
  ISplitTitle,
} from "@/models/InteractiveOnboarding/model";
import { currentUserAtom, tutorialActiveSceneAtom } from "@/store";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useRef, useMemo } from "react";
import { useRecoilState, useResetRecoilState } from "@/lib/state";
import { useScene } from "./useScenes";
import { IUser } from "@/models/model";
import useFunnelCookies from "../MultiPages/useFunnelCookies";

export const useTutorialState = () => {
  const [currentUser, setCurrentUser] = useRecoilState(currentUserAtom);
  // Provide a dummy user for display purposes only
  const displayUser: IUser = currentUser ?? {
    id: 0,
    displayName: "You",
    email: "you-demo@hypertask.ai",
    photoURL:
      "https://ui-avatars.com/api/?name=John+Doe&background=0066cc&color=fff&size=150",
    UserSetting: { onboardingTutorialStatus: false },
  };

  const sidebarInfo = useMemo(() => getSidebarInfo(displayUser), []);
  const [showExit, setShowExit] = useState<boolean>(false);
  const [activeBoard, setActiveBoard] = useState(0);
  const [activeColumn, setActiveColumn] = useState(0);
  const [activeHint, setActiveHint] = useState<number>(0);
  const [activeModalIndex, setActiveModalIndex] = useState<number>(0);
  const [activeNotification, setActiveNotification] = useState(0);
  const [activeScene, setActiveScene] = useRecoilState(tutorialActiveSceneAtom);
  const [activeTask, setActiveTask] = useState(0);
  const [activeTaskPage, setActiveTaskPage] = useState(0);
  const [addColumnInput, setAddColumnInput] = useState("");
  const [exitURL, setExitURL] = useState<string>("");

  const [board, setBoard] = useState<IBoard>(
    getBoards(displayUser)[activeBoard]
  );
  const [assigneeInput, setAssigneeInput] = useState<string>("");
  const [filteredAssignees, setFilteredAssignees] = useState(tutorialUsers);
  const [commentInput, setCommentInput] = useState<string>("");
  const [filteredOptions, setFilteredOptions] =
    useState<(DisplayDate | undefined)[]>(defaultOptions);
  const [filterMoveColumnsOptions, setFilterMoveOptions] =
    useState<string[]>(moveColumns);
  const [filterPriorityOptions, setFilterPriorityOptions] =
    useState<any[]>(priorities);
  const [filteredSideBarOptions, setFilteredSideBarOptions] =
    useState<IBoardHeader[]>(sidebarInfo);
  const [moveTaskModalInput, setMoveTaskModalInput] = useState("");
  const [priorityModalInput, setPriorityInput] = useState("");
  const [notifications, setNotifications] =
    useState<INotification[]>(staticNotifications);
  const [remindMeModalInput, setRemindMeModalInput] = useState("");
  const resetActiveScene = useResetRecoilState(tutorialActiveSceneAtom);
  const [sceneState, setSceneState] =
    useState<{ [key in string]: any }>(sceneStates);
  const [shake, setShake] = useState(false);
  const [sideBarInput, setSideBarInput] = useState("");
  const [splitTitles, _] = useState<ISplitTitle[]>(staticSplitTitles);
  const [description, setDescription] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const lastGPress = useRef<number | null>(null);
  const { editor: commentEditor } = useTiptap({
    mode: "create-comment",
    defaultContent: commentInput,
  });
  const { editor: descriptionEditor } = useTiptap({
    mode: "read-edit-description",
    defaultContent: "",
  });
  const isApple = useDeviceContext();
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { scenes } = useScene({
    sceneState,
    isApple,
  });
  // Funnel user detection
  const {
    isFunnelUser,
    isLoggedIn,
    isFunnelUserAndTutorialCompleted: funnelTutorialCompleted,
    markTutorialCompleted,
  } = useFunnelCookies();
  return {
    currentUser,
    setCurrentUser,
    displayUser,
    sidebarInfo,
    showExit,
    setShowExit,
    activeBoard,
    setActiveBoard,
    activeColumn,
    setActiveColumn,
    activeHint,
    setActiveHint,
    activeModalIndex,
    setActiveModalIndex,
    activeNotification,
    setActiveNotification,
    activeScene,
    setActiveScene,
    activeTask,
    setActiveTask,
    activeTaskPage,
    setActiveTaskPage,
    addColumnInput,
    setAddColumnInput,
    exitURL,
    setExitURL,
    board,
    setBoard,
    assigneeInput,
    setAssigneeInput,
    filteredAssignees,
    setFilteredAssignees,
    commentInput,
    setCommentInput,
    filteredOptions,
    setFilteredOptions,
    filterMoveColumnsOptions,
    setFilterMoveOptions,
    filterPriorityOptions,
    setFilterPriorityOptions,
    filteredSideBarOptions,
    setFilteredSideBarOptions,
    moveTaskModalInput,
    setMoveTaskModalInput,
    priorityModalInput,
    setPriorityInput,
    notifications,
    setNotifications,
    remindMeModalInput,
    setRemindMeModalInput,
    resetActiveScene,
    sceneState,
    setSceneState,
    shake,
    setShake,
    sideBarInput,
    setSideBarInput,
    splitTitles,
    _,
    description,
    setDescription,
    title,
    setTitle,
    lastGPress,
    commentEditor,
    descriptionEditor,
    isApple,
    params,
    pathname,
    router,
    scenes,
    isFunnelUser,
    isLoggedIn,
    funnelTutorialCompleted,
    markTutorialCompleted,
  };
};

export type TutorialState = ReturnType<typeof useTutorialState>;
