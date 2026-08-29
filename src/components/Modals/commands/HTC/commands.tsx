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
} from "@/store";
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
import {
  getActiveEmptySectionSettingFromProject,
  getActiveStalenessFromProject,
} from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import TutorialTooltip from "@/components/PageComponents/Interactive-Onboarding/Components/TutorialTip";
import { IAllCommands, IProject } from "@/models/model";
import { useTourContext } from "@/lib/contexts/TourContext";
import { getHTCFrecencyScore } from "./htcFrecency";
import { useGetAllProjectsMinimal } from "@/hooks/MultiPages/useGetAllProjectsMinimal";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { MobileBottomSheet } from "@/components/Modals/Sheets";

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
    const registryGroups = getAllCommands({
      context: "Others",
      ...contextOptions,
      appShellRailOn,
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
            (command.commandMode !== CommandMode.ToggleBoardTimeTracking ||
              !!currentProject) &&
            (command.commandMode !== CommandMode.ConfigureTableColumns ||
              boardLayout === "table") &&
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
      commandLists: [...group.commandLists].sort(
        (left, right) => scoreCommand(right) - scoreCommand(left)
      ),
    }));
    if (contextOptions?.context === "Task") {
      return getMobileCommandGroups(commandGroups, isMobile);
    }

    const canonicalCommands = new Map(
      commandGroups
        .flatMap((group) => group.commandLists)
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

    return getMobileCommandGroups(rankedCommandGroups, isMobile);
  }, [
    appShellRailOn,
    boardLayout,
    calendarSettings.showWeekends,
    contextOptions,
    currentProject,
    frequentlyUsed,
    isMobile,
    onCalendar,
    projects,
    showByokApiKeys,
  ])

  const emptyQueryCommands = useMemo(() => {
    if (scope !== "board") return allCommands_;
    return getBoardMenuCommands(allCommands_, boardLayout);
  }, [allCommands_, scope, boardLayout]);

  const {
    keyword,
    onKeyChange,
    selectedCommand,
    filterCommands,
    handleCommandSelect, hoveredGroup, setHoveredGroupIndex, setCurrentCommandIndex, currentCommandIndex,
    setSelectedCommand,
  } = useHTC(allCommands_, emptyQueryCommands);
  const currentHoveredDiv = useRef<number | null>(null);
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
    if (e.key === "Tab" || e.key === "Escape") {
      e.preventDefault();
      return;
    }
    if (e.key === "j" || e.key === "ArrowDown") {
      if (selectedCommand && filterCommands) {

        const currentCommandIndex = filterCommands[
          hoveredGroup
        ].commandLists.findIndex(
          (commandList) => commandList.key === selectedCommand.key
        );

        if (
          currentCommandIndex <
          filterCommands[hoveredGroup].commandLists.length - 1
        ) {
          handleCommandSelect(hoveredGroup, currentCommandIndex + 1);
        } else if (hoveredGroup < filterCommands.length - 1) {
          // If there is no next command in the same group, move to the first command of the next group
          const nextGroup = filterCommands[hoveredGroup + 1];
          handleCommandSelect(hoveredGroup + 1, 0);
        } else {
        }
      }
    }

    if (e.key === "k" || e.key === "ArrowUp") {
      if (selectedCommand && filterCommands) {

        const currentCommandIndex = filterCommands[
          hoveredGroup
        ].commandLists.findIndex(
          (commandList) => commandList.key === selectedCommand.key
        );

        if (currentCommandIndex > 0) {
          // If there is a previous command in the same group, select it
          handleCommandSelect(hoveredGroup, currentCommandIndex - 1);
        } else if (hoveredGroup > 0) {
          // If there is no previous command in the same group, move to the last command of the previous group
          const previousGroup = filterCommands[hoveredGroup - 1];
          handleCommandSelect(
            hoveredGroup - 1,
            previousGroup.commandLists.length - 1
          );
        } else {
        }
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
  ]);

  const handleMouseEnter = (index: number, groupIndex: number) => {
    currentHoveredDiv.current = index;
    setHoveredGroupIndex(groupIndex);
  };

  const handleMouseLeave = () => {
    // Clear any existing debounceTimeout
    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
      debounceTimeout.current = null;
    }

    // Start a new debounceTimeout to remove focus after a short delay (e.g., 100ms)
    debounceTimeout.current = setTimeout(() => {
      if (currentHoveredDiv.current !== null && commandRef.current) {
        (commandRef.current as HTMLDivElement)?.blur();
        currentHoveredDiv.current = null;
      }
    }, 100);
  };

  const handleMouseMove = () => {
    // Clear any existing debounceTimeout
    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
      debounceTimeout.current = null;
    }

    // Set the selectedCommand based on the currentHoveredDiv index
    // Assuming currentHoveredDiv is a ref that holds the index of the currently hovered div
    // and filterCommands is an array of CommandGroup objects
    if (
      currentHoveredDiv.current !== null &&
      currentHoveredDiv.current !== undefined &&
      filterCommands
    ) {
      // Find the group that contains the command at the currentHoveredDiv index

      if (hoveredGroup !== -1) {
        // Assuming you want to set the selectedCommand to the command at the currentHoveredDiv index
        // within the found group
        const commandIndex = filterCommands[
          hoveredGroup
        ].commandLists.findIndex(
          (commandList, index) => index === currentHoveredDiv.current
        );
        if (commandIndex !== -1) {
          setSelectedCommand(
            filterCommands[hoveredGroup].commandLists[commandIndex]
          );
        }
      }
    }
  };

  useEffect(() => {
    return () => {
      // Clear the debounceTimeout when the component unmounts
      if (debounceTimeout.current) {
        clearTimeout(debounceTimeout.current);
      }
    };
  }, []);
    
    // Function to update the command frequency map with the selected command
    function updateCommandFrequency(command: ICommandList) {
      if (isDemo) return callback()
      if(isInteractive) return callback(command)
      //Added this return statement below because Task/Comment Options has dynamic wordings that will make no sense if theyre saved in frequent.
      //ie reply to comment wont make sense in kanban page.
      if(contextOptions?.context !== "Task" && command.key !== "toggleArchivedOnBoard")
        setFrequentlyUsed(prevFrequentlyUsed => {
            // Check if the command already exists in the object
            if (prevFrequentlyUsed.hasOwnProperty(command.key)) {
                // If the command exists, update its frequency
                const updatedCommand = {
                  ...command,
                  frequency: (prevFrequentlyUsed[command.key].frequency || 0) + 1,
                  lastUsedAt: Date.now(),
                  };
                console.log("🚀 ~ updateCommandFrequency ~ updatedCommand:", updatedCommand)
                  // Update the command in the object
                return { ...prevFrequentlyUsed, [command.key]: updatedCommand };
            } else {
                // If the command does not exist, add it with a frequency of 1
                return {
                  ...prevFrequentlyUsed,
                  [command.key]: { ...command, frequency: 1, lastUsedAt: Date.now() },
                };
            }
        });
      (document.activeElement as HTMLElement).blur();
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
    setModal(!modal);
    resetShowCommands()
    callback && callback()
  };

  const searchInput = (
    <div className="flex items-center gap-2.5 border-t border-light-black-border-1 px-4">
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
      />
    </div>
  );

  if (isMobile) {
    return (
      <MobileBottomSheet
        isOpen={modal}
        onClose={toggle}
        ariaLabel="Command center"
        fullHeight
        keyboardAware
        bottomSlot={searchInput}
      >
        <CommandGroups
          handleMouseMove={handleMouseMove}
          filterCommands={filterCommands}
          selectedCommand={selectedCommand}
          handleMouseLeave={handleMouseLeave}
          handleMouseEnter={handleMouseEnter}
          commandRef={commandRef}
          onClickHandler={updateCommandFrequency}
          isMobile
        />
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
        contentClassName="rounded-[5px] overflow-hidden"
      >
        {isInteractive && (
          <TutorialTooltip
            text="Type 'Add board column' or you can use arrow keys for selection."
            top={85}
            left={-200}
            className="w-[189px]"
          />
        )}

        <ModalBody className="  p-0 rounded-[5px]">
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
            />
          </div>
          <CommandGroups
            handleMouseMove={handleMouseMove}
            filterCommands={filterCommands}
            selectedCommand={selectedCommand}
            handleMouseLeave={handleMouseLeave}
            handleMouseEnter={handleMouseEnter}
            commandRef={commandRef}
            onClickHandler={updateCommandFrequency}
          />
          <ModalHintBar />
        </ModalBody>
      </ModalContainerCustom>
  );
};

export default Commands;
