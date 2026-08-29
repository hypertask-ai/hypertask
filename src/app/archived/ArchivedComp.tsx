/* eslint-disable @next/next/no-img-element */
"use client"

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import {
    archiveBoardScopeAtom,
    appShellRailAtom,
    showCommandsAtom,
} from "@/store";
import type { ArchiveBoardScope } from "@/store";
import { ITask, IUser } from "@/models/model";
import { parseCookies } from "nookies";
import { FiChevronDown, FiSearch, FiX } from "react-icons/fi";
import dynamic from "next/dynamic";
import { useGetAllInboxArchives, useArchivedInboxMeta } from "@/hooks/Archived/useGetAllInboxArchives";
import { useArchivedTasksMeta, useGetAllArchivedTasks } from "@/hooks/Archived/useArchives";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import useHypertasksRecoilStates from "@/hooks/RecoilRoot/useHypertasksRecoilStates";
import { ArchivedMeta } from "@/utils/api/archived.ts";
import { useArchivedRealtime } from "@/hooks/realtime/useArchivedRealtime";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import AppShellRail from "@/components/PageComponents/Kanban/HeaderComponents/AppShellRail";
import { APP_SHELL_RAIL_OFFSET } from "@/lib/constants/appShellRail";

const ArchivedTasksContainer = dynamic(()=>import("./ArchivedTasksComp"))
const ArchivedNotificationsContainer = dynamic(()=>import("./ArchivedInboxComp"))
const HypertasksCommands = dynamic(() => import("@/components/commands"),{ssr:false});

const tabs=[
    {
        prev:null,
        curr:"Tasks Archive",
        next:"Inbox Archive"
    },
    {
        prev:"Tasks Archive",
        curr:"Inbox Archive",
        next:"Tasks Archive"
    }
]

const boardScopes: { label: string; value: ArchiveBoardScope }[] = [
    { label: "Active boards", value: "active" },
    { label: "All boards", value: "all" },
    { label: "Archived boards", value: "archived" },
];

type ArchiveTab = (typeof tabs)[number];

const parseInitialTasks = (archived: string): ITask[] => {
    if (!archived) return [];

    try {
        return JSON.parse(archived);
    } catch {
        return [];
    }
};

const getCurrentUser = (currentUser: IUser): IUser | null => {
    if (currentUser) return currentUser;

    try {
        const cookies = parseCookies();
        return JSON.parse(cookies.nookies_user);
    } catch {
        return null;
    }
};

const useDebouncedValue = <T,>(value: T, ms: number): T => {
    const [debouncedValue, setDebouncedValue] = useState(value);

    useEffect(() => {
        const timeout = setTimeout(() => setDebouncedValue(value), ms);
        return () => clearTimeout(timeout);
    }, [value, ms]);

    return debouncedValue;
};

const Archived = ({
    _archived,
    _currentUser,
}:{
    _archived:string,
    _currentUser:IUser
}) => {
    const currentUser = useMemo(() => getCurrentUser(_currentUser), [_currentUser]);
    const initialTasks = useMemo(() => parseInitialTasks(_archived), [_archived]);
    const searchParams = useSearchParams()
    const router = useRouter();
    const queryClient = useQueryClient();
    const {toggleShowCommands} = useHypertasksRecoilStates()
    const showCommands = useRecoilValue(showCommandsAtom);
    const [boardScope, setBoardScope] = useRecoilState(archiveBoardScopeAtom);
    const [selectedScreen, setSelectedScreen] = useState<ArchiveTab>(
        searchParams?.get("inbox")?tabs[1]:tabs[0]
    )
    const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const debouncedSearch = useDebouncedValue(searchQuery, 250);
    const isApple = useDeviceContext()
    const isMbl = useContext(MobileViewContext);
    const appShellRailOn = useRecoilValue(appShellRailAtom) && !isMbl;

    const inboxQuery = useGetAllInboxArchives(
        undefined,
        selectedProjectId,
        boardScope,
        debouncedSearch
    );
    const tasksQuery = useGetAllArchivedTasks(
        currentUser?.id ?? 0,
        initialTasks,
        selectedProjectId,
        boardScope,
        debouncedSearch
    );
    const {data: tasksMeta} = useArchivedTasksMeta(
        currentUser?.id ?? 0,
        undefined,
        boardScope
    );
    const {data: inboxMeta} = useArchivedInboxMeta(
        undefined,
        boardScope
    );
    useArchivedRealtime(currentUser?.id);

    const inboxFromQuery = useMemo(() => {
        // Prisma `distinct` de-dups within a page, not across pages, so the same
        // (type, taskId) can reappear on a later infinite-scroll page. Collapse
        // duplicates client-side; rows arrive newest-first so we keep the first.
        const flat = inboxQuery.data?.pages.flat() ?? [];
        const seen = new Set<string>();
        return flat.filter((notification: any) => {
            const key = `${notification?.type}-${notification?.taskId}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }, [inboxQuery.data]);
    const tasksFromQuery = useMemo(
        () => tasksQuery.data?.pages.flat() ?? [],
        [tasksQuery.data]
    );

    const selectedMeta =
        selectedScreen.curr === "Tasks Archive" ? tasksMeta : inboxMeta;

    const setArchiveTab = useCallback((tab: ArchiveTab) => {
        setSelectedScreen(tab);
    }, []);

    const handleKeyDown = useCallback(async(e: KeyboardEvent) => {
        var cmdControl = isApple&&e.metaKey || !isApple&&e.ctrlKey;

        if (e.key === "Escape") router.back()
    
          // press k
          if (e.keyCode === 75 && cmdControl) {
            e.preventDefault();
            toggleShowCommands()
        }
        
        if (e.key==="Tab"  &&!e.shiftKey){
            e.preventDefault()
            setArchiveTab(selectedScreen.curr==="Tasks Archive"?tabs[1]:tabs[0])
        }
        else if (e.key==="Tab" && e.shiftKey){
            e.preventDefault()
            setArchiveTab(tabs[0])
        }
    
    }, [isApple, router, selectedScreen.curr, setArchiveTab, toggleShowCommands]);

    useEffect(() => {
        queryClient.refetchQueries({queryKey:["projectsAll"]});
    }, [queryClient]);

    useEffect(() => {
        setSelectedProjectId(null);
    }, [boardScope]);

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

    if (!currentUser) return null;

    const content = (
            <div className='flex items-center justify-center flex-col w-full min-h-screen bg-pageBackground scrollbar-w-[0] '>
                <div className={`global-view-width min-h-screen pt-24 pb-9 lg:pt-9 px-4 md:px-8 lg:px-16 flex flex-col items-start space-y-4 bg-containerBackground`}>

                    <div className="flex w-full items-center justify-between px-6 text-content">
                        <div className="flex gap-5">
                            {tabs.map((tab) =>
                                <span
                                    key={tab.curr}
                                    className={`flex gap-1 items-baseline pb-1 text-subheading border-b-2 ${
                                        selectedScreen.curr===tab.curr
                                            ? "font-bold text-white-black border-selected-item-border"
                                            : "text-text-light-gray border-transparent"
                                    } cursor-pointer`}
                                >

                                    <p
                                        onClick={()=>setArchiveTab(tab)}
                                        className={``}>
                                        {tab.curr}
                                    </p>
                                    <p className='font-normal text-micro'>
                                        {tab.curr==="Tasks Archive"
                                            ? tasksMeta?.total ?? tasksFromQuery.length
                                            : inboxMeta?.total ?? inboxFromQuery.length}
                                    </p>
                                </span>
                            )}
                        </div>
                        <div className="flex gap-3">
                            {boardScopes.map((scope) => (
                                <span
                                    key={scope.value}
                                    className={`text-meta ${
                                        boardScope === scope.value
                                            ? "font-medium text-white-black"
                                            : "text-text-light-gray"
                                    } cursor-pointer`}
                                    onClick={() => setBoardScope(scope.value)}
                                >
                                    {scope.label}
                                </span>
                            ))}
                        </div>
                    </div>

                    <ArchiveFilterBar
                        meta={selectedMeta}
                        selectedProjectId={selectedProjectId}
                        onSelectProject={setSelectedProjectId}
                        search={searchQuery}
                        onSearch={setSearchQuery}
                        searchPlaceholder={
                            selectedScreen.curr === "Tasks Archive"
                                ? "Search archived tasks…"
                                : "Search archived inbox…"
                        }
                    />
                    
                    {selectedScreen.curr==="Tasks Archive"?
                        <ArchivedTasksContainer
                            tasksFromQuery={tasksFromQuery}
                            _currentUser={currentUser}
                            isFetching={tasksQuery.isFetching}
                            isFetchingNextPage={tasksQuery.isFetchingNextPage}
                            hasNextPage={tasksQuery.hasNextPage}
                            fetchNextPage={() => tasksQuery.fetchNextPage()}
                        />
                    :
                        <ArchivedNotificationsContainer
                            isFetching={inboxQuery.isFetching}
                            isFetchingNextPage={inboxQuery.isFetchingNextPage}
                            hasNextPage={inboxQuery.hasNextPage}
                            fetchNextPage={() => inboxQuery.fetchNextPage()}
                            data={inboxFromQuery}
                            _currentUser={currentUser}
                        />
                    }        
                </div>
            </div>
    );

    return (
        <>
            {appShellRailOn && <AppShellRail variant="global" currentUser={currentUser} />}
            {appShellRailOn ? <div className="pl-[var(--app-shell-rail-w,48px)]">{content}</div> : content}
            
            <div onClick={() => router.back()} className='bg-back-button' style={{ cursor: 'pointer', position: 'fixed', zIndex: 100, top: 40, left: appShellRailOn ? APP_SHELL_RAIL_OFFSET : 40, width: 40, height: 40, borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg
                    stroke="currentColor"
                    className='text-white-black'
                    fill="currentColor" strokeWidth="0" viewBox="0 0 448 512" color="white" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg" ><path d="M257.5 445.1l-22.2 22.2c-9.4 9.4-24.6 9.4-33.9 0L7 273c-9.4-9.4-9.4-24.6 0-33.9L201.4 44.7c9.4-9.4 24.6-9.4 33.9 0l22.2 22.2c9.5 9.5 9.3 25-.4 34.3L136.6 216H424c13.3 0 24 10.7 24 24v32c0 13.3-10.7 24-24 24H136.6l120.5 114.8c9.8 9.3 10 24.8.4 34.3z">
                        </path>
                    </svg>
            </div>
                
            {showCommands.show && <HypertasksCommands />}

        </>
    )
}

const ArchiveFilterBar = ({
    meta,
    selectedProjectId,
    onSelectProject,
    search,
    onSearch,
    searchPlaceholder,
}: {
    meta?: ArchivedMeta;
    selectedProjectId: number | null;
    onSelectProject: (projectId: number | null) => void;
    search: string;
    onSearch: (search: string) => void;
    searchPlaceholder: string;
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [projectSearch, setProjectSearch] = useState("");
    const dropdownRef = useRef<HTMLDivElement>(null);
    const projects = meta?.byProject ?? [];
    const selectedProject = projects.find(
        (project) => project.projectId === selectedProjectId
    );
    const normalizedProjectSearch = projectSearch.trim().toLowerCase();
    const filteredProjects = normalizedProjectSearch
        ? projects.filter((project) =>
              project.name.toLowerCase().includes(normalizedProjectSearch)
          )
        : projects;

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(event.target as Node)
            ) {
                setIsOpen(false);
                setProjectSearch("");
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const closeDropdown = () => {
        setIsOpen(false);
        setProjectSearch("");
    };

    const selectProject = (projectId: number | null) => {
        onSelectProject(projectId);
        closeDropdown();
    };

    const handleDropdownKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "Escape" || !isOpen) return;
        event.preventDefault();
        event.stopPropagation();
        closeDropdown();
    };

    const selectedProjectName = selectedProject
        ? selectedProject.name
        : selectedProjectId == null
          ? "All projects"
          : `Project ${selectedProjectId}`;
    const selectedProjectCount = selectedProject
        ? selectedProject.count
        : selectedProjectId == null
          ? meta?.total ?? 0
          : 0;

    return (
        <div className="flex w-full items-center gap-3 px-6">
            <div
                ref={dropdownRef}
                className="relative shrink-0"
                onKeyDown={handleDropdownKeyDown}
            >
                <button
                    type="button"
                    className="flex h-8 cursor-pointer items-center gap-1 rounded-[5px] bg-modalBackground px-3 text-content text-white-black transition-colors hover:bg-active-modal-element"
                    aria-haspopup="listbox"
                    aria-expanded={isOpen}
                    onClick={() => {
                        if (isOpen) {
                            closeDropdown();
                        } else {
                            setIsOpen(true);
                        }
                    }}
                >
                    {selectedProjectName} · {selectedProjectCount}
                    <FiChevronDown aria-hidden="true" size={14} className="text-icon-dark-gray" />
                </button>

                {isOpen && (
                    <div className="absolute left-0 z-50 mt-1 min-w-[280px] max-w-[360px] max-h-[320px] overflow-y-auto overflow-x-hidden rounded-[5px] bg-modalBackground pb-1.5 shadow-customshadow-2">
                        <input
                            autoFocus
                            type="text"
                            autoComplete="off"
                            value={projectSearch}
                            onChange={(event) => setProjectSearch(event.target.value)}
                            placeholder="Find a project…"
                            aria-label="Find a project"
                            className="w-full border-0 bg-transparent px-3 py-2 text-content text-white-black outline-none placeholder:text-text-light-gray"
                        />
                        <button
                            type="button"
                            role="option"
                            aria-selected={selectedProjectId == null}
                            className={`mx-1.5 mt-1.5 flex h-9 w-[calc(100%-12px)] cursor-pointer items-center justify-between gap-4 rounded-sm px-3 text-left text-content text-white-black transition-colors hover:bg-active-modal-element ${
                                selectedProjectId == null
                                    ? "bg-active-modal-element"
                                    : ""
                            }`}
                            onClick={() => selectProject(null)}
                        >
                            <span>All projects</span>
                            <span className="text-text-light-gray">{meta?.total ?? 0}</span>
                        </button>
                        {filteredProjects.map((project) => (
                            <button
                                key={project.projectId}
                                type="button"
                                role="option"
                                aria-selected={selectedProjectId === project.projectId}
                                className={`mx-1.5 flex h-9 w-[calc(100%-12px)] cursor-pointer items-center justify-between gap-4 rounded-sm px-3 text-left text-content text-white-black transition-colors hover:bg-active-modal-element ${
                                    selectedProjectId === project.projectId
                                        ? "bg-active-modal-element"
                                        : ""
                                }`}
                                onClick={() => selectProject(project.projectId)}
                            >
                                <span className="truncate">{project.name}</span>
                                <span className="shrink-0 text-text-light-gray">
                                    {project.count}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[5px] bg-modalBackground px-3">
                <FiSearch aria-hidden="true" size={14} className="shrink-0 text-icon-dark-gray" />
                <input
                    type="text"
                    autoComplete="off"
                    value={search}
                    onChange={(event) => onSearch(event.target.value)}
                    placeholder={searchPlaceholder}
                    aria-label={searchPlaceholder}
                    className="min-w-0 flex-1 border-0 bg-transparent py-1.5 text-content text-white-black outline-none placeholder:text-text-light-gray"
                />
                {search && (
                    <button
                        type="button"
                        className="shrink-0 cursor-pointer text-text-light-gray hover:text-white-black"
                        aria-label="Clear archive search"
                        onClick={() => onSearch("")}
                    >
                        <FiX size={14} />
                    </button>
                )}
            </div>
        </div>
    );
};

export default Archived;
