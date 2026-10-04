import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CommandMode } from "@/models/enums";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import {
  boardLayoutAtom,
  calendarSettingsAtom,
  currentProjectAtom,
  frequentlyUsedHTCAton,
  tableTitleWrapAtom,
  showCommandsAtom,
} from "@/store";
import { currentPageActionsAtom } from "@/store/currentPageActions";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { ModalBody } from "reactstrap";
import styles from "@/styles/linksModal.module.scss";
import { ICommandList } from "./HTCTypes";
import CommandGroups from "./CommandGroup";
import useHTC from "@/hooks/MultiPages/HTC/useHTC";
import { ModalContainerCustom, ModalHintBar, ModalInput } from "@/components/Common/CommonModalComponents";
import useHypertasksRecoilStates from "@/hooks/RecoilRoot/useHypertasksRecoilStates";
import {
  getAllCommands,
  getBoardMenuCommands,
  getMobileCommandGroups,
} from "./AllCommands";
import { pinCommentGroupFirst } from "@/lib/htc/pinCommentGroupFirst";
import {
  getActiveEmptySectionSettingFromProject,
  getActiveStalenessFromProject,
} from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import TutorialTooltip from "@/components/PageComponents/Interactive-Onboarding/Components/TutorialTip";
import { IAllCommands, IProject } from "@/models/model";
import { useTourContext } from "@/lib/contexts/TourContext";
import {
  getHTCFrecencyScore,
  recordHTCCommandUsage,
} from "./htcFrecency";
import { findCommandPosition } from "./commandSelection";
import type { CommandIdentity } from "./commandSelection";
import { useGetAllProjectsMinimal } from "@/hooks/MultiPages/useGetAllProjectsMinimal";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { MobileBottomSheet } from "@/components/Modals/Sheets";
import { useFlag } from "@/hooks/useFlag";
import {
  INBOX_CLUSTER_COMMAND_GROUP,
  INBOX_CLUSTER_COMMAND_KEY_PREFIX,
  inboxClusterCommandName,
  isInboxClusterCommandKey,
  type InboxCluster,
} from "@/lib/inboxClusters";
import {
  GOOGLE_CALENDAR_FLAG,
  HTPR_6514_COMMENT_LONG_PRESS_FLAG,
  HTPR_6892_CMDK_VERSION_FLAG,
  HTPR_6929_COMPOSE_TASK_WRITER_FLAG,
  HTPR_6868_TICKET_PREFIX_FLAG,
  HTPR_6662_AGENT_LOG_NAME_FLAG,
  HTPR_6861_MOBILE_PAGE_BACK_ROW_FLAG,
  INBOX_ARCHIVE_CLUSTER_FLAG,
  HTPR_6567_COMMAND_SCOPE_PICKER_FLAG,
  MY_TASKS_FILTER_PARITY_FLAG,
  MY_TASKS_TABLE_COLUMNS_FLAG,
  MY_TASKS_VIEWS_FLAG,
} from "@/lib/flags/keys";
import { SettingsScopeTabs } from "../../Settings/SettingsScopeTabs";
import ComposeTaskWriter from "./ComposeTaskWriter";
import { myTasksRoute } from "@/lib/constants/constants";

type Props = {
  handleAction?: (mode?: CommandMode, action?: string) => void;
  isOpen:boolean;
  isDemo?:boolean
  isInteractive?:boolean
  callback?:any;
  contextOptions?: IAllCommands;
  showByokApiKeys?: boolean;
  appShellRailOn?: boolean;
  scope?: "board";
};

const Commands = (props: Props) => {
  const {
    handleAction,
    isOpen,
    isDemo,
    isInteractive,
    callback,
    contextOptions,
    showByokApiKeys,
    appShellRailOn,
    scope,
  } = props;
  const composeTaskWriterEnabled = useFlag(HTPR_6929_COMPOSE_TASK_WRITER_FLAG);
  const composeEnabled = composeTaskWriterEnabled && !props.isDemo && !props.isInteractive;
  const [showCommands, setShowCommands] = useRecoilState(showCommandsAtom);
  const isCompose = composeEnabled && showCommands.paletteTab === "compose";
  const [writing, setWriting] = useState(false);
  const { resetShowCommands } = useHypertasksRecoilStates()
  const isMobile = useContext(MobileViewContext);
  const { endTour } = useTourContext();
  const inputRef = useRef<HTMLInputElement>(null);
  const [boardLayout] = useRecoilState(boardLayoutAtom);
  const [frequentlyUsed, setFrequentlyUsed] = useRecoilState(frequentlyUsedHTCAton);
  const [, setTableTitleWrap] = useRecoilState(tableTitleWrapAtom);
  const calendarSettings = useRecoilValue(calendarSettingsAtom);
  const pathname = usePathname();
  // Applying these off the calendar is a no-op: the calendar hydrates its
  // settings from the applied saved view on mount and overwrites them.
  const onCalendar = !!pathname?.startsWith("/calendar");
  const onAgentChat = !!pathname?.startsWith("/agents/chat");
  const onMyTasks = !!pathname?.startsWith(myTasksRoute);
  const cmdkVersionEnabled = useFlag(HTPR_6892_CMDK_VERSION_FLAG);
  const ticketPrefixEnabled = useFlag(HTPR_6868_TICKET_PREFIX_FLAG);
  const agentLogNameEnabled = useFlag(HTPR_6662_AGENT_LOG_NAME_FLAG);
  const getAgentLogCommands = useCallback(
    (options?: IAllCommands) => getAllCommands(options, true),
    []
  );
  let getCommands = getAllCommands;
  // Keep the label gate in the component body so CI can trace UI coverage.
  if (agentLogNameEnabled) {
    getCommands = getAgentLogCommands;
  }
  const excludeTicketPrefixCommand = useCallback(
    (command: ICommandList) => command.key !== "settingsBoardTicketPrefix",
    []
  );
  const includeTicketPrefixCommand = useCallback(() => true, []);
  let isTicketPrefixCommandVisible = excludeTicketPrefixCommand;
  // Keep the runtime gate in the component body so CI can trace UI coverage.
  if (ticketPrefixEnabled) {
    isTicketPrefixCommandVisible = includeTicketPrefixCommand;
  }
  const buildId = process.env.NEXT_PUBLIC_BUILD_ID?.slice(0, 7) || "dev";
  const buildTime = new Date(process.env.NEXT_PUBLIC_BUILD_TIME || "");
  const buildTimeLabel = buildId !== "dev" && !Number.isNaN(buildTime.getTime())
    ? `${buildTime.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${buildTime.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}`
    : "";
  const googleCalendarSettingsEnabled = useFlag(GOOGLE_CALENDAR_FLAG);
  const autoTaskDescriptionsEnabled = useFlag("htpr-6177-auto-task-descriptions");
  const copyCurrentUrlEnabled = useFlag("htpr-6112-copy-current-url");
  const inboxClusterEnabled = useFlag(INBOX_ARCHIVE_CLUSTER_FLAG);
  const myTasksViewsEnabled = useFlag(MY_TASKS_VIEWS_FLAG);
  const commandScopePickerEnabled = useFlag(HTPR_6567_COMMAND_SCOPE_PICKER_FLAG);
  const myTasksFilterParityEnabled = useFlag(MY_TASKS_FILTER_PARITY_FLAG);
  const myTasksTableColumnsEnabled = useFlag(MY_TASKS_TABLE_COLUMNS_FLAG);
  const commentLongPressEnabled = useFlag(HTPR_6514_COMMENT_LONG_PRESS_FLAG);
  const mobilePageBackRowEnabled = useFlag(HTPR_6861_MOBILE_PAGE_BACK_ROW_FLAG);
  const currentPageActions = useRecoilValue(currentPageActionsAtom);
  const pageActions = mobilePageBackRowEnabled && isMobile && currentPageActions &&
    pathname === `/page/${currentPageActions.publicId}`
    ? currentPageActions
    : null;
  const pinCommentActions = !!contextOptions?.commentOptions;
  const currentProject = useRecoilValue(currentProjectAtom);
  const { data: projects = [] } = useGetAllProjectsMinimal([
    "projectsAllMinimal",
  ]);
  const allCommands_ = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity -- frecency scores are intentionally computed against the render-time clock; memo deps control recompute
    const now = Date.now();
    const layoutCommandName =
      boardLayout === "table" ? "Switch to board layout" : "Switch to table layout";
    const emptyColumnsCommandName =
      getActiveEmptySectionSettingFromProject(currentProject) === "Hidden"
        ? "Show empty board columns"
        : "Hide empty board columns";
    const scoreCommand = (command: ICommandList) => {
      const usage = frequentlyUsed[command.key];
      return getHTCFrecencyScore(usage?.frequency, usage?.lastUsedAt, now);
    };
    const availableProjects: IProject[] = Array.isArray(projects)
      ? projects
      : [];
    const boardCommands: ICommandList[] = availableProjects
      .filter((project) => project.id !== currentProject?.id)
      .slice(0, 50)
      .map((project) => ({
        key: `gotoBoard-${project.id}`,
        name: `Go to board: ${project.title}`,
        payload: String(project.id),
        commandMode: CommandMode.GoToBoard,
        keywords: `${project.title} board project go open switch`,
      }));
    let scopeCommand: ICommandList | undefined;
    if (commandScopePickerEnabled && onMyTasks && myTasksViewsEnabled && myTasksFilterParityEnabled) {
      scopeCommand = {
        key: "myTasksScope",
        name: "Scope",
        // Keep the board row's mobile icon; selection is handled by key below.
        commandMode: CommandMode.GoToBoard,
        keywords: "scope boards project select filter my tasks",
      };
    }
    if (scopeCommand) boardCommands.unshift(scopeCommand);
    // HTPR-6160: the inbox sorts by recency, so the noisiest tickets are invisible
    // until you scroll. These rank by pile size instead. Own group: every group's
    // commandLists get frecency-sorted below, and brand-new keys score 0.
    const inboxClusterCommands: ICommandList[] = inboxClusterEnabled
      ? (contextOptions?.inboxClusters ?? []).map((cluster: InboxCluster) => ({
          key: `${INBOX_CLUSTER_COMMAND_KEY_PREFIX}${cluster.notificationId}`,
          name: inboxClusterCommandName(cluster),
          payload: cluster.notificationId,
          commandMode: CommandMode.ArchiveInboxCluster,
          keywords: `inbox archive cluster clear notifications ${cluster.ticketNumber}`,
        }))
      : [];
    const registryGroups = getCommands({
      context: "Others",
      ...contextOptions,
      appShellRailOn,
      agentChatOn: onAgentChat,
      projectOptions: {
        stalenessEnabled: !!currentProject?.stalenessEnabled,
        stalenessViewEnabled: getActiveStalenessFromProject(currentProject),
        autoArchiveEnabled: currentProject?.autoArchiveAfterDays != null,
      },
    }).map((group) => ({
      ...group,
      commandLists: group.commandLists
        .filter(
          (command) =>
            (command.commandMode !== CommandMode.ManageTeamAIAPIKeys ||
              showByokApiKeys) &&
            (command.key !== "settingsCalendarKeepTasksUpdated" || googleCalendarSettingsEnabled) &&
            (command.key !== "settingsTaskPageSuggestDescriptionsFromTaskTitles" || autoTaskDescriptionsEnabled) &&
            (command.commandMode !== CommandMode.CopyViewURL ||
              copyCurrentUrlEnabled) &&
            isTicketPrefixCommandVisible(command) &&
            (command.commandMode !== CommandMode.ToggleBoardTimeTracking ||
              !!currentProject) &&
            (command.commandMode !== CommandMode.ConfigureTableColumns ||
              boardLayout === "table" ||
              (onMyTasks && myTasksViewsEnabled && myTasksTableColumnsEnabled)) &&
            (![
              CommandMode.ToggleCalendarWeekends,
              CommandMode.CalendarWeekStartsMonday,
              CommandMode.CalendarWeekStartsSunday,
            ].includes(command.commandMode) ||
              onCalendar)
        )
        .map((command) => {
          if (command.commandMode === CommandMode.ToggleBoardLayout) {
            return { ...command, name: layoutCommandName };
          }
          if (command.commandMode === CommandMode.ToggleEmptyColumns) {
            return { ...command, name: emptyColumnsCommandName };
          }
          if (command.commandMode === CommandMode.ToggleBoardTimeTracking) {
            return {
              ...command,
              name: currentProject?.timeTrackingEnabled
                ? "Turn off time tracking for this board"
                : "Turn on time tracking for this board",
            };
          }
          if (command.commandMode === CommandMode.ToggleCalendarWeekends) {
            return {
              ...command,
              name: calendarSettings.showWeekends
                ? "Hide weekends"
                : "Show weekends",
            };
          }
          return command;
        }),
    }));
    registryGroups.find((group) => group.group === "Board")?.commandLists.push({
      key: "toggleTableTitleWrap",
      name: "Toggle title wrap (table view)",
      commandMode: CommandMode.Command,
      keywords: "table title wrap truncate multiline single line",
    });
    // Comment context puts both Comment and Task groups ahead of the board list
    const boardsInsertIndex = contextOptions?.commentOptions ? 2 : 1;
    const commandGroups = [
      ...registryGroups.slice(0, boardsInsertIndex),
      ...(boardCommands.length > 0
        ? [{ group: "Boards", commandLists: boardCommands }]
        : []),
      ...registryGroups.slice(boardsInsertIndex),
    ].map((group) => ({
      ...group,
      commandLists:
        commentLongPressEnabled && pinCommentActions && group.group === "Comment"
          ? group.commandLists
          : [...group.commandLists].sort(
              (left, right) => scoreCommand(right) - scoreCommand(left)
            ),
    }));
    // Appended, and added after the per-group frecency sort so the piles keep
    // size order. Position is only visible on an empty query, and the group is
    // dropped from that list below: a typed query goes through filterData, which
    // flattens every group and re-ranks by match score, so this never jumps a
    // destructive command ahead of a better match.
    if (inboxClusterCommands.length > 0) {
      commandGroups.push({
        group: INBOX_CLUSTER_COMMAND_GROUP,
        commandLists: inboxClusterCommands,
      });
    }
    if (contextOptions?.context === "Task") {
      const taskGroups = getMobileCommandGroups(commandGroups, isMobile);
      return commentLongPressEnabled && pinCommentActions
        ? pinCommentGroupFirst(taskGroups)
        : taskGroups;
    }

    const canonicalCommands = new Map(
      commandGroups
        .flatMap((group) => group.commandLists)
        // Frequently used is built from this map and leads the untyped palette,
        // so an archive command remembered from an earlier use must not be able
        // to become the blank-Ctrl+K Enter target.
        .filter((command) => !isInboxClusterCommandKey(command.key))
        .map((command) => [command.key, command])
    );
    const topCommands = Object.entries(frequentlyUsed)
      .filter(([key]) => canonicalCommands.has(key))
      .sort(
        (left, right) =>
          getHTCFrecencyScore(right[1].frequency, right[1].lastUsedAt, now)
          - getHTCFrecencyScore(left[1].frequency, left[1].lastUsedAt, now)
      )
      .slice(0, 5)
      .map(([key, command]) => ({
        ...canonicalCommands.get(key)!,
        frequency: command.frequency,
        lastUsedAt: command.lastUsedAt,
      }));
    const getStartedCommands = [
      "createTask",
      "createTaskWithAiWriter",
      "inviteBoard",
      "createBoard",
      "addColumn",
    ].flatMap((key) => {
      const command = canonicalCommands.get(key);
      return command ? [command] : [];
    });

    const rankedCommandGroups = topCommands.length > 0
      ? [{ group: "Frequently used", commandLists: topCommands }, ...commandGroups]
      : getStartedCommands.length > 0
        ? [{ group: "Get started", commandLists: getStartedCommands }, ...commandGroups]
        : commandGroups;

    const mobileGroups = getMobileCommandGroups(rankedCommandGroups, isMobile);
    // HTPR-6861: the open page's own actions lead the palette on phones.
    const rankedGroups = mobilePageBackRowEnabled && pageActions
      ? [{
          group: `This page (Version ${pageActions.version})`,
          commandLists: [{
            key: "deletePage",
            name: "Delete page",
            commandMode: CommandMode.Command,
            keywords: "delete remove archive page",
          }],
        }, ...mobileGroups]
      : mobileGroups;
    return commentLongPressEnabled && pinCommentActions
      ? pinCommentGroupFirst(rankedGroups)
      : rankedGroups;
  }, [
    appShellRailOn,
    boardLayout,
    calendarSettings.showWeekends,
    contextOptions,
    getCommands,
    commentLongPressEnabled,
    pinCommentActions,
    pageActions,
    copyCurrentUrlEnabled,
    googleCalendarSettingsEnabled,
    autoTaskDescriptionsEnabled,
    currentProject,
    inboxClusterEnabled,
    frequentlyUsed,
    isMobile,
    onAgentChat,
    onCalendar,
    onMyTasks,
    myTasksViewsEnabled,
    commandScopePickerEnabled,
    myTasksFilterParityEnabled,
    myTasksTableColumnsEnabled,
    projects,
    showByokApiKeys,
    isTicketPrefixCommandVisible,
  ])

  const emptyQueryCommands = useMemo(() => {
    // Archiving is destructive and the first group is default-highlighted, so an
    // untyped Ctrl+K plus Enter must not wipe a ticket's pile. Type toward it.
    const withoutClusters = allCommands_.filter(
      (group) => group.group !== INBOX_CLUSTER_COMMAND_GROUP,
    );
    if (scope !== "board") return withoutClusters;
    return getBoardMenuCommands(withoutClusters, boardLayout);
  }, [allCommands_, scope, boardLayout]);

  const {
    keyword,
    onKeyChange,
    selectedCommand,
    filterCommands,
    handleCommandSelect, hoveredGroup, setHoveredGroupIndex, setCurrentCommandIndex,
    setSelectedCommand,
  } = useHTC(allCommands_, emptyQueryCommands, !isMobile);
  const hoveredCommand = useRef<CommandIdentity | null>(null);
  // const blurTimeout = useRef<NodeJS.Timeout | null>(null);
  const debounceTimeout = useRef<NodeJS.Timeout | null>(null);
  const commandRef = useRef<HTMLDivElement>(null);
  const lastgClick = useRef<number | null>(null);

  const [modal, setModal] = useState<boolean>(isOpen);
  // console.log("🚀 ~ Commands ~ modal:", modal)
  const [first, setfirst] = useState(false);

  const setInputRef = useCallback(
    (input: HTMLInputElement | null) => {
      inputRef.current = input;
      if (!input || !isMobile) return;
      // The palette lives in a bottom sheet (react-modal-sheet). While the sheet
      // plays its enter animation the input is not yet focusable, so a single
      // focus() during the opening commit (or one frame later) silently no-ops
      // (verified on prod: the input never gains focus, so the mobile keyboard
      // never opens and the keyboard-aware sheet never lifts, reading as "stuck
      // at the bottom"). Re-focus every frame until it takes; the earliest
      // frames are still inside the iOS user-activation window that pops the
      // keyboard. Stops the moment focus lands or the input unmounts.
      let tries = 0;
      const focusUntilLanded = () => {
        const el = inputRef.current;
        if (!el || document.activeElement === el) return;
        el.focus({ preventScroll: true });
        if (++tries < 30) requestAnimationFrame(focusUntilLanded);
      };
      focusUntilLanded();
    },
    [isMobile]
  );

  useEffect(() => {
    if (!isMobile) inputRef.current?.focus();
    endTour()
  }, []);
  const handleKeyDown = (e: KeyboardEvent) => {
    if (isCompose) return;
    if (e.key === "Tab" || e.key === "Escape") {
      e.preventDefault();
      return;
    }

    const selectedPosition = findCommandPosition(
      filterCommands,
      selectedCommand,
      hoveredGroup,
    );
    if (!selectedPosition) return;

    const {
      groupIndex: selectedGroupIndex,
      commandIndex: selectedCommandIndex,
    } = selectedPosition;
    const selectedGroup = filterCommands[selectedGroupIndex];

    if (e.key === "j" || e.key === "ArrowDown") {
      if (selectedCommandIndex < selectedGroup.commandLists.length - 1) {
        handleCommandSelect(selectedGroupIndex, selectedCommandIndex + 1);
      } else if (selectedGroupIndex < filterCommands.length - 1) {
        handleCommandSelect(selectedGroupIndex + 1, 0);
      }
    }

    if (e.key === "k" || e.key === "ArrowUp") {
      if (selectedCommandIndex > 0) {
        handleCommandSelect(selectedGroupIndex, selectedCommandIndex - 1);
      } else if (selectedGroupIndex > 0) {
        const previousGroup = filterCommands[selectedGroupIndex - 1];
        handleCommandSelect(
          selectedGroupIndex - 1,
          previousGroup.commandLists.length - 1
        );
      }
    }
  };

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    document.activeElement,
    lastgClick.current,
    selectedCommand,
    filterCommands,
    hoveredGroup,
    isCompose,
  ]);

  const handleMouseEnter = (
    command: ICommandList,
    index: number,
    groupIndex: number,
  ) => {
    hoveredCommand.current = { key: command.key, name: command.name };
    setCurrentCommandIndex(index);
    setHoveredGroupIndex(groupIndex);
    setSelectedCommand(command);
  };

  const handleMouseLeave = () => {
    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
      debounceTimeout.current = null;
    }

    debounceTimeout.current = setTimeout(() => {
      if (hoveredCommand.current && commandRef.current) {
        (commandRef.current as HTMLDivElement)?.blur();
        hoveredCommand.current = null;
      }
    }, 100);
  };

  const handleMouseMove = () => {
    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
      debounceTimeout.current = null;
    }

    if (!hoveredCommand.current) return;

    const position = findCommandPosition(
      filterCommands,
      hoveredCommand.current,
      hoveredGroup,
    );
    if (!position) {
      hoveredCommand.current = null;
      setSelectedCommand(null);
      return;
    }

    setCurrentCommandIndex(position.commandIndex);
    setHoveredGroupIndex(position.groupIndex);
    setSelectedCommand(position.command);
  };

  useEffect(() => {
    return () => {
      // Clear the debounceTimeout when the component unmounts
      if (debounceTimeout.current) {
        clearTimeout(debounceTimeout.current);
      }
    };
  }, []);
    
    function updateCommandFrequency(command: ICommandList) {
      if (writing) return;
      if (!findCommandPosition(filterCommands, command)) return;
      if (isDemo) return callback()
      if(isInteractive) return callback(command)
      setFrequentlyUsed((previousUsage) =>
        recordHTCCommandUsage(previousUsage, command)
      );
      (document.activeElement as HTMLElement).blur();
      if (mobilePageBackRowEnabled && command.key === "deletePage") {
        if (!pageActions) return;
        resetShowCommands();
        void pageActions.onDelete();
        return;
      }
      if (command.key === "myTasksScope") {
        resetShowCommands();
        if (onMyTasks && commandScopePickerEnabled) window.dispatchEvent(new Event("my-tasks-scope-picker"));
        return;
      }
      if (composeEnabled && command.commandMode === CommandMode.CreateTaskWithAiWriter) {
        setShowCommands((previous) => ({ ...previous, paletteTab: "compose" }));
        return;
      }
      if (command.key === "toggleTableTitleWrap") {
        setTableTitleWrap((prev) => !prev);
        resetShowCommands();
        return;
      }
        setTimeout(() => {
          handleAction&&handleAction(
                    command.commandMode,
                    command.payload ?? command.name
                  );
                }, 1);
    }

  const toggle = () => {
    if (writing) return;
    setModal(!modal);
    resetShowCommands()
    callback && callback()
  };

  useEffect(() => {
    if (!composeEnabled) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      toggle();
    };
    document.addEventListener("keydown", close, true);
    return () => document.removeEventListener("keydown", close, true);
  }, [composeEnabled, writing]);
  useEffect(() => {
    if (composeEnabled && !isCompose) inputRef.current?.focus();
  }, [composeEnabled, isCompose]);

  const modeSwitch = composeTaskWriterEnabled && !isDemo && !isInteractive ? (
    <div className="absolute -top-12 left-0 flex w-full justify-center">
      <SettingsScopeTabs
        tabs={[{ id: "search", label: "Search" }, { id: "compose", label: "Compose" }]}
        activeId={isCompose ? "compose" : "search"}
        onSelect={(paletteTab) => setShowCommands((previous) => ({ ...previous, paletteTab: paletteTab as "search" | "compose" }))}
        ariaLabel="Commands mode"
        disabled={writing}
        buttonClassName="rounded-[4px]"
        className="flex-none rounded-[5px] bg-modalBackground p-1"
      />
    </div>
  ) : null;
  const compose = composeEnabled ? <ComposeTaskWriter active={isCompose} onBusyChange={setWriting} onCreated={resetShowCommands} /> : null;

  const searchInput = (
    <div className="flex items-center gap-2.5 rounded-[4px] px-4 ring-1 ring-inset ring-hypertasks-purple">
      <Search strokeWidth={1.75} size={16} className="shrink-0 text-text-light-gray" />
      <ModalInput
        ref={setInputRef}
        autoFocus={!isMobile}
        id="htc-mobile-search"
        placeholder={isDemo ? "Press Enter to select" : "Type a command or search..."}
        onChange={onKeyChange}
        value={keyword}
        onKeyDown={(e) => {
          if (e.key === "Enter" && selectedCommand) {
            updateCommandFrequency(selectedCommand);
          }
        }}
        className="px-0"
        {...(composeEnabled ? { onBlur: undefined } : {})}
      />
    </div>
  );

  const commandGroups = (
    <CommandGroups
      handleMouseMove={handleMouseMove}
      filterCommands={commandScopePickerEnabled ? filterCommands : filterCommands.map((filteredGroup) => ({
        ...filteredGroup,
        commandLists: filteredGroup.commandLists.filter((command) => command.key !== "myTasksScope"),
      }))}
      selectedCommand={selectedCommand}
      handleMouseLeave={handleMouseLeave}
      handleMouseEnter={handleMouseEnter}
      commandRef={commandRef}
      onClickHandler={updateCommandFrequency}
      isMobile={isMobile}
    />
  );

  if (isMobile) {
    return (
      <MobileBottomSheet
        isOpen={modal}
        onClose={toggle}
        ariaLabel="Command center"
        aboveSlot={modeSwitch}
        fullHeight={!isCompose}
        keyboardAware
        bottomSlot={isCompose ? undefined : searchInput}
      >
        {compose}
        {!isCompose && (commentLongPressEnabled ? (
          <div data-htpr-6514-comment-long-press="">{commandGroups}</div>
        ) : (
          commandGroups
        ))}
      </MobileBottomSheet>
    );
  }

  return (
      <ModalContainerCustom
        fade={isDemo ? true : false}
        id="htc"
        isOpen={modal}
        onOpened={() => { setfirst(true); }}
        toggle={toggle}
        autoFocus={false}
        backdrop={isInteractive?false:true}
        keyboard={false}
        className={`paletteModalSizing sm:max-h-fit sm:top-[24%] sm:min-w-[560px] ${styles.links_modal} ${isInteractive ? "relative group" : ""}`}
        // The palette is centred by auto margins inside a viewport-wide fixed box, so with
        // the AI chat panel open it centred on the window and ran underneath the panel
        // (159px of overlap on a 914px-wide window). Padding the box by the panel width
        // makes it centre on the space actually available. The variable is published by
        // AI_Chat_Sidebar and is 0px whenever the panel is closed or on mobile.
        modalClassName="pr-[var(--ht-ai-sidebar-width,0px)]"
        contentClassName={composeTaskWriterEnabled && !isDemo && !isInteractive ? "rounded-[5px] overflow-visible" : "rounded-[5px] overflow-hidden"}
      >
        {isInteractive && (
          <TutorialTooltip
            text="Type 'Add board column' or you can use arrow keys for selection."
            top={85}
            left={-200}
            className="w-[189px]"
          />
        )}

        {modeSwitch}
        <ModalBody className="  p-0 rounded-[5px]">
          {compose}
          {!isCompose && <>
          <div className="flex items-center gap-2.5 border-b border-light-black-border-1 px-4">
            <Search strokeWidth={1.75} size={13} className="shrink-0 text-text-light-gray" />
            <ModalInput
               ref={setInputRef}
               autoFocus
               id="htc"
               placeholder={isDemo ? "Press Enter to select" : "Type a command or search..."}
               onChange={onKeyChange}
               value={keyword}
               onKeyDown={(e) => {
                 if (e.key === "Enter" && selectedCommand) {
                   updateCommandFrequency(selectedCommand)

                 }
               }}
               className="px-0"
               {...(composeEnabled ? { onBlur: undefined } : {})}
            />
          </div>
          {mobilePageBackRowEnabled ? (
            <div data-htpr-6861-page-actions="">
              {commentLongPressEnabled ? (
                <div data-htpr-6514-comment-long-press="">{commandGroups}</div>
              ) : (
                commandGroups
              )}
            </div>
          ) : commentLongPressEnabled ? (
            <div data-htpr-6514-comment-long-press="">{commandGroups}</div>
          ) : (
            commandGroups
          )}
          <ModalHintBar />
          {cmdkVersionEnabled && (
            <div data-cmdk-version className="px-4 pb-2 text-micro text-text-light-gray">
              v {buildId}{buildTimeLabel && ` · ${buildTimeLabel}`}
            </div>
          )}
          </>}
        </ModalBody>
      </ModalContainerCustom>
  );
};

export default Commands;
