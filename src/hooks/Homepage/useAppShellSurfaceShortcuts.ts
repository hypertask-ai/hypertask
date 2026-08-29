import { useCallback, useContext, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import { IProject } from "@/models/model";
import {
  appShellRailAtom,
  appShellRailExpandedAtom,
  currentProjectAtom,
  showBoardManagerAtom,
  showCommandsAtom,
} from "@/store";
import globalConstants from "@/lib/constants";
import { useProjectQuery } from "@/hooks/General/useProjectQuery";
import { useGlobalUIState } from "@/components/ProviderGlobal/useGlobalUIState";
import { returnIfModalOrInputActive } from "@/utils/helperFunctions/helperFunctions";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import useKanbanViews from "@/hooks/Homepage/Views/useKanbanViews";
import { areGlobalShortcutsEnabled } from "@/lib/keyboard/globalShortcutRoutes";

// Re-exported for existing importers; the value lives in a leaf module so the
// jiti-based tests can load AllCommands/shortcuts without this React graph.
export { RAIL_TOGGLE_KEY } from "@/lib/constants/railToggleKey";
import { RAIL_TOGGLE_KEY } from "@/lib/constants/railToggleKey";

const AI_CHAT_TOGGLE_KEYS: readonly string[] = ["5", "]"];

const useAppShellSurfaceShortcuts = ({
  listen = true,
}: { listen?: boolean } = {}) => {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { goToProjectShortcut } = useProjectQuery();
  const { toggleAIChatInterface } = useGlobalUIState();
  const isMbl = useContext(MobileViewContext);
  const appShellRailOn = useRecoilValue(appShellRailAtom) && !isMbl;
  const showBoardManager = useRecoilValue(showBoardManagerAtom);
  const showCommands = useRecoilValue(showCommandsAtom);
  const currentProject = useRecoilValue(currentProjectAtom);
  const { changeBoardLayout, setBoardLayoutForNavigation } = useKanbanViews(currentProject);
  const [, setRailExpanded] = useRecoilState(appShellRailExpandedAtom);
  const timeTrackingEnabled = !!currentProject?.timeTrackingEnabled;

  const navigateToBoard = useCallback((layout: "board" | "table") => {
    if (pathname?.startsWith("/project")) {
      changeBoardLayout(layout);
      return;
    }
    setBoardLayoutForNavigation(layout);

    const previousBoard = document.cookie
      .split("; ")
      .find((cookie) => cookie.startsWith("previousBoard="))
      ?.split("=")[1];
    const previousProjectId = Number(
      decodeURIComponent(previousBoard ?? "")
        .split("|&|")[0]
        ?.replace("project-", "")
    );
    const projects = queryClient.getQueryData<IProject[]>(["projectsAllMinimal"]);
    const projectId =
      projects?.find((project) => project.id === previousProjectId)?.id ??
      projects?.[0]?.id;

    if (projectId) goToProjectShortcut(projectId, false, false, layout);
    else router.push(`/project?surface=${layout}`);
  }, [changeBoardLayout, goToProjectShortcut, pathname, queryClient, router, setBoardLayoutForNavigation]);

  const navigateToSearch = useCallback(() => {
    if (!pathname?.startsWith("/search")) router.push("/search?searchTerm=");
  }, [pathname, router]);

  useEffect(() => {
    if (!listen || !areGlobalShortcutsEnabled(pathname)) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !appShellRailOn ||
        ![
          "1",
          "2",
          "3",
          "4",
          ...AI_CHAT_TOGGLE_KEYS,
          "6",
          "7",
          RAIL_TOGGLE_KEY,
        ].includes(event.key)
      ) {
        return;
      }

      const target = event.target;
      const isTypingTarget =
        target instanceof HTMLElement &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
          target.isContentEditable);
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        isTypingTarget ||
        showBoardManager ||
        showCommands.show ||
        returnIfModalOrInputActive()
      ) {
        return;
      }

      event.preventDefault();
      if (event.key === "1") router.push("/inbox");
      if (event.key === "2") navigateToBoard("board");
      if (event.key === "3") navigateToBoard("table");
      if (event.key === "4") router.push("/calendar");
      if (AI_CHAT_TOGGLE_KEYS.includes(event.key)) toggleAIChatInterface();
      if (event.key === "6") navigateToSearch();
      if (event.key === "7" && timeTrackingEnabled) router.push(globalConstants.timersRoute);
      if (event.key === RAIL_TOGGLE_KEY) setRailExpanded((prev) => !prev);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    appShellRailOn,
    listen,
    navigateToBoard,
    navigateToSearch,
    pathname,
    router,
    showBoardManager,
    setRailExpanded,
    showCommands.show,
    timeTrackingEnabled,
    toggleAIChatInterface,
  ]);

  return { navigateToBoard, navigateToSearch };
};

export default useAppShellSurfaceShortcuts;
