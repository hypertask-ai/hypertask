/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @next/next/no-img-element */
"use client";
import { FC, ReactNode, useContext, useEffect, useRef, useState } from "react";

import { Circle } from "lucide-react";
import {
  INotification,
  QueryParams,
  TRemoveFromInboxMode,
  IUser,
} from "@/models/model";
import Goback from "@/assets/gobackicon.svg";
const InboxSplit = dynamic(
  () => import("@/components/notifications/inboxSplit"),
  { ssr: false },
);

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useGetAgentNotifications } from "@/hooks/Inbox/useGetAgentNotifications";
import dynamic from "next/dynamic";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import { showCommandsAtom, globalNotificationFocusAtom } from "@/store";
// Keep the command center in the page bundle: a pull-down must mount and focus
// its input during the committing touchend, before mobile user activation ends.
import HypertasksCommands from "@/components/commands";
import { useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import useHypertasksRecoilStates from "@/hooks/RecoilRoot/useHypertasksRecoilStates";
import { BulkSelectionProvider } from "@/lib/contexts/Inbox/BulkSelectionContext";
import { inboxConfig } from "@/lib/configs/inbox.config";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { useInboxZeroStyling } from "@/hooks/Inbox/useInboxZeroStyling";
import InboxZeroState from "@/components/Common/InboxZeroState";
import useHypertasksNavigate from "@/hooks/MultiPages/Route/useHypertasksNavigate";
import { useWarmProjectsAllQuery } from "@/hooks/Homepage/useGetBoards";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import MobileInboxSplitDock from "@/components/notifications/MobileInboxSplitDock";

const AgentInbox = ({
  agent,
  currentUser,
  queryParams,
  homepageRouter,
  originProject,
}: {
  agent: {
    id: string;
    displayName: string;
    photoURL?: string | null;
    revokedAt?: Date | string | null;
    createdAt?: Date | string;
  };
  currentUser: IUser;
  queryParams: QueryParams;
  homepageRouter: string;
  originProject: string;
}) => {
  const isMbl = useContext(MobileViewContext);
  const queryClient = useQueryClient();
  const [globalFocus, setGlobalFocus] = useRecoilState(
    globalNotificationFocusAtom,
  );
  const [trigger, setTrigger] = useState<"ShowAll" | undefined>(
    queryParams?.showAll === "true" ? "ShowAll" : undefined,
  );
  const lastgClick = useRef<number | null>(null);
  const router = useRouter();
  useWarmProjectsAllQuery({ user: currentUser, projectId: originProject });
  const { data: _notificationsTQ } = useGetAgentNotifications(agent.id);
  const { toggleShowCommands } = useHypertasksRecoilStates();
  const showCommands = useRecoilValue(showCommandsAtom);
  const [__notifications, _setNotifications] = useState<INotification[][]>();
  const [_notifications, setNotifications] = useState<INotification[]>();
  const [_selectedInbox, setSelectedInbox] = useState<INotification | null>();
  const [initialIndexReset, setInitialIndexReset] = useState<number>(
    globalFocus.currIdx ?? 0,
  );
  const classNamesToReturnFrom = [
    "modal-open",
    "ProseMirror ProseMirror-focused",
    undefined,
  ];
  const { navigate } = useHypertasksNavigate();
  const isApple = useDeviceContext();

  const handleKeyDown = async (e: KeyboardEvent) => {
    const cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);
    const shouldPreventEscape = document.querySelector(".bulk-active");
    const modalOpenOrCarouselExists =
      document.querySelector(".modal") ||
      document.getElementById("carousel-container");
    const isAIChatTiptapFocused = document
      .getElementById("ai-chat-tiptap-editor")
      ?.contains(document.activeElement);

    if (
      showCommands.show ||
      modalOpenOrCarouselExists ||
      document?.activeElement?.role === "dialog" ||
      document?.activeElement?.id === "modalButtons" ||
      document.activeElement?.tagName === "INPUT" ||
      document.activeElement?.id === "htc" ||
      classNamesToReturnFrom.includes(document?.activeElement?.className) ||
      document.activeElement?.id === "boardManager" ||
      isAIChatTiptapFocused
    )
      return;

    // Mobile exposes the split dock as real tabs. Preserve native Tab and
    // Shift+Tab traversal there; Arrow/Home/End switch splits inside the dock.
    if (isMbl && e.keyCode === KeyCodes.TAB) return;

    if (e.keyCode === KeyCodes.ESCAPE && !shouldPreventEscape) {
      router.back();
      queryClient.refetchQueries({
        queryKey: inboxConfig.navigation.queryKeys.inbox,
      });
    }

    if (e.keyCode === KeyCodes.K && cmdControl) {
      e.preventDefault();
      toggleShowCommands();
    }

    if (e.keyCode === KeyCodes.G) {
      const now = new Date().getTime();
      lastgClick.current = now;
    }

    if (e.keyCode === KeyCodes.I) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < inboxConfig.scroll.debounceGKeyMs
      ) {
        lastgClick.current = null;
        navigateTabs(inboxConfig.navigation.defaultSplitIndex);
      }
    }

    if (e.keyCode === KeyCodes.C) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < inboxConfig.scroll.debounceGKeyMs
      ) {
        lastgClick.current = null;
        navigate("Calendar");
        return;
      }
    }

    if (e.keyCode === KeyCodes.D) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < inboxConfig.scroll.debounceGKeyMs
      ) {
        lastgClick.current = null;
        navigate("Drafts");
        return;
      }
    }

    if (e.keyCode === KeyCodes.U) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < inboxConfig.scroll.debounceGKeyMs
      ) {
        lastgClick.current = null;
        navigate("Scheduled");
        return;
      }
    }

    if (e.keyCode === KeyCodes.TAB) {
      e.preventDefault();

      let newValue;
      if (e.shiftKey) {
        newValue =
          globalFocus.currSplit !== 0
            ? globalFocus.currSplit - 1
            : _notificationsTQ?.structuredData?.data.length - 1;
      } else {
        newValue =
          globalFocus.currSplit !==
          _notificationsTQ?.structuredData?.data.length - 1
            ? globalFocus.currSplit + 1
            : 0;
      }

      navigateTabs(newValue);
    }
  };

  const navigateTabs = (newValue: number) => {
    document.getElementById(`tab-${newValue}`)?.scrollIntoView({
      behavior: inboxConfig.scroll.desktopBehavior,
      inline: "center",
      block: "center",
    });

    setGlobalFocus({ currSplit: newValue, currIdx: 0 });
    const tab = _notificationsTQ?.structuredData?.tabs?.[newValue];
    const isProjectSplit = tab?.projectId != null;
    const projectIdParam = isProjectSplit ? `&projectId=${tab.projectId}` : "";
    router.replace(
      `/inbox/agent/${agent.id}?split=${tab.project}${projectIdParam}`,
    );

    if (trigger !== undefined) setTrigger(undefined);
    setInitialIndexReset(0);
  };

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    lastgClick.current,
    ,
    _selectedInbox,
    globalFocus.currSplit,
    showCommands.show,
    globalFocus,
    trigger,
  ]);

  const initialScroll = async () => {
    if (__notifications) {
      if (!__notifications[globalFocus.currSplit])
        setGlobalFocus({
          currSplit: inboxConfig.navigation.defaultSplitIndex,
          currIdx: 0,
        });
      const notificationId =
        __notifications[globalFocus.currSplit][initialIndexReset]?.id;
      const element = document.getElementById(`inbox-${notificationId}`);
      if (element) {
        if (window.innerWidth < 760) {
          element.scrollIntoView({
            block: "center",
            behavior: inboxConfig.scroll.mobileBehavior,
          });
        } else {
          element.scrollIntoView({
            block: "center",
            behavior: inboxConfig.scroll.desktopBehavior,
          });
        }
      }
    }
  };

  //I dont understand what this is for and it even exists in
  const newCommentsHandler = () => {
    try {
      if (
        _notificationsTQ?.structuredData?.data &&
        !_notificationsTQ?.structuredData?.data[globalFocus?.currSplit]
      ) {
        setGlobalFocus({
          currSplit: inboxConfig.navigation.defaultSplitIndex,
          currIdx: 0,
        });
      } else {
        if (trigger === "ShowAll") {
          setGlobalFocus({
            currSplit: _notificationsTQ?.structuredData?.data.length - 1,
            currIdx: 0,
          });
        }
      }

      _setNotifications(_notificationsTQ?.structuredData?.data);
      setNotifications(_notificationsTQ?.structuredData?.data[0]);
      _notificationsTQ?.structuredData?.data[0] &&
        _notificationsTQ?.structuredData?.data[0][globalFocus.currIdx ?? 0] &&
        setSelectedInbox(
          _notificationsTQ?.structuredData?.data[0][globalFocus.currIdx ?? 0],
        );

      const inboxElement = document.getElementById(
        `inbox-${
          _notificationsTQ?.structuredData?.data &&
          _notificationsTQ?.structuredData?.data[globalFocus?.currSplit ?? 0][
            globalFocus.currIdx ?? 0
          ]?.id
        }`,
      );
      if (!inboxElement)
        document
          .getElementById(`tab-${globalFocus.currSplit}`)
          ?.scrollIntoView({
            behavior: "instant" as ScrollBehavior,
            inline: "center",
            block: "center",
          });
      else {
        inboxElement?.scrollIntoView({
          behavior: "instant" as ScrollBehavior,
          block: "center",
        });
      }
    } catch (error) {
      console.log("🚀 ~ newCommentsHandler ~ error:", error);
    }
  };

  useEffect(() => {
    newCommentsHandler();
  }, [_notificationsTQ?.structuredData?.data, trigger]);

  const { isInboxZero } = useInboxZeroStyling();
  const handleBulkArchive = async (
    selectedNotifications: INotification[],
  ) => {};
  const markAsDone = async (
    notification: INotification,
    index: number,
    mode: TRemoveFromInboxMode,
  ) => {};
  const starTaskUpdateInCache = async (notification: INotification) => {};

  return (
    <>
      <div
        className={`fixed inset-0 z-0 transition-all duration-700 ease-in-out ${
          isInboxZero ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <InboxZeroState className="w-full h-full" showContent={true} />
      </div>

      <div className="inbox_header hidden sm:visible bg-transparent">
        <h1
          className="pb-1 pl-4 block sm:hidden z-10"
          style={{ fontSize: "1.2rem", fontWeight: "500" }}
        >
          {agent.displayName} Inbox
        </h1>
      </div>
      <BulkSelectionProvider
        handleBulkArchive={handleBulkArchive}
        allItems={
          __notifications
            ?.flatMap((inner) => inner.flatMap((n) => n))
            .reduce((acc: INotification[], curr) => {
              if (!acc.some((item) => item.id === curr.id)) acc.push(curr);
              return acc;
            }, []) ?? []
        }
      >
        <div
          className={`flex items-center justify-center flex-col w-full min-h-fit transition-all duration-1000 ease-in-out ${
            isInboxZero ? "bg-transparent" : "bg-taskDetailPage"
          }`}
        >
          <div
            className={`global-view-width min-h-screen inbox_tag_mobile_view pb-9 flex flex-col items-start transition-all duration-1000 ease-in-out ${
              isInboxZero ? "bg-transparent" : "bg-containerBackground"
            }`}
          >
            <SplitTitlesContainer>
              {_notificationsTQ?.structuredData?.tabs.map(
                (
                  tab: {
                    project: any;
                    idx: number;
                    length: number;
                    hasUnseen: boolean;
                  },
                  index: number,
                ) => (
                  <>
                    <SplitTitle
                      isSelected={globalFocus.currSplit !== index}
                      onClick={() => navigateTabs(index)}
                      key={tab.project?.toString()}
                      tab={tab}
                    />
                  </>
                ),
              )}
            </SplitTitlesContainer>

            {__notifications?.map((notification, index) => (
              <>
                <InboxSplit
                  key={`split-${globalFocus.currSplit}`}
                  updateNotification={() => {}}
                  onLoadCallback={initialScroll}
                  selectedReset={_selectedInbox}
                  originProject={originProject}
                  value={globalFocus.currSplit}
                  index={index}
                  selectedSplit={
                    _notificationsTQ?.structuredData?.tabs[
                      globalFocus.currSplit
                    ]?.project ?? ""
                  }
                  _notifications={notification}
                  initialFocus={initialIndexReset}
                  markAsDone={markAsDone}
                  starTaskUpdateInCache={starTaskUpdateInCache}
                  disableRowButtons={true}
                  queryKey={["agent-inbox", agent.id]}
                />
              </>
            ))}
            {isMbl && (
              <MobileInboxSplitDock
                tabs={_notificationsTQ?.structuredData?.tabs ?? []}
                activeIndex={globalFocus.currSplit}
                onSelect={navigateTabs}
              />
            )}
          </div>
          <Link
            href={homepageRouter}
            style={{
              zIndex: 101,
              position: "fixed",
              bottom: 110,
              right: 16,
              borderRadius: 20,
              justifyContent: "center",
            }}
            className={`absolute @md:hidden cursor-pointer shadow-customshadow-2 flex w-fit px-3  py-[2px] h-fit gap-2  items-center bg-modalBackground text-[#8E9093] `}
          >
            <Image src={Goback} alt="icon" width={28} height={28} />
            <span>Back</span>
          </Link>
        </div>
        {showCommands.show && <HypertasksCommands />}
      </BulkSelectionProvider>
    </>
  );
};

export default AgentInbox;

interface IProps {
  children?: ReactNode;
}
const SplitTitlesContainer: FC<IProps> = ({ children }) => {
  return (
    <div className="inbox-text-left relative hidden h-full w-full items-baseline overflow-x-auto pr-[16px] pt-4 inbox_title responsive-inbox-padding @md:flex @md:gap-[9px] scrollbar-none no-scrollbar">
      <div className="group relative flex grow flex-wrap items-center gap-[9px]">
        {children}
      </div>
    </div>
  );
};

const SplitTitle = ({
  tab,
  isSelected,
  onClick,
}: {
  tab: {
    idx: number;
    project: string;
    length: number;
    hasUnseen: boolean;
  };
  isSelected: boolean;
  onClick: any;
}) => {
  const { classes } = useInboxZeroStyling();

  return (
    <div
      key={tab.project?.toString()}
      className={` cursor-pointer relative group @md:h-8
                        justify-start
                        whitespace-nowrap footer_tags_main items-center
                        @md:pr-[10px] @lg:pr-[15px]
                        text-subheading  flex  gap-1 `}
      onClick={onClick}
    >
      <div
        className={`flex items-baseline gap-1 ${
          isSelected ? "text-text-light-gray" : classes.textPrimary
        }`}
      >
        <span className="footer_tags">{tab.project}</span>

        {tab.length > 0 && (
          <p
            className={`font-normal footer_tags text-meta ${classes.textSecondary}`}
          >
            {tab.length}
          </p>
        )}
      </div>

      <Circle
        size={7}
        className={`fill-current ${
          !tab.hasUnseen ? "text-[#5896F1]" : "hidden"
        } w-new-notification`}
        strokeWidth={1.75}
        fill="currentColor"
      />
    </div>
  );
};
