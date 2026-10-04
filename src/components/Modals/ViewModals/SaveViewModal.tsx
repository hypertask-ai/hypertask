import { ModalContainerCustom, ModalHeaderComp, ModalInput, ModalListContainer, ModalRowElementContainer } from "@/components/Common/CommonModalComponents";
import useHandleMouseGlobal from "@/hooks/General/useHandleMouse";
import { useEffect, useRef, useState } from "react";
import useCurrentUser from "@/hooks/General/useCurrentUserCheckFromCookies"
import { TCreate_view_body, TUpdate_view_body } from "@/models/Views/model"
import { buildDefaultTitle, getActiveBoardLayoutPreferenceFromProject, getActiveColumnsViewFromProject, getActiveEmptySectionSettingFromProject, getActiveFiltersFromProject, getActiveSortingModeFromProject, getActiveSortingOrderFromProject, getActiveSortingStackFromProject, getActiveStalenessOverrideFromProject,
    getActiveShowArchivedOverrideFromProject, getActiveSubtaskSettingFromProject, getActiveTableSortFromProject, savedBoardLayoutFromExplicitSurface, waitForBoardViewMutations, } from "@/utils/helperFunctions/Views/ViewsHelperFunctions"
import { IProject, IProjectsAll } from "@/models/model";
import { ModalBody } from "reactstrap";
import useKanbanViews from "@/hooks/Homepage/Views/useKanbanViews";
import useHandleKeydownBasic from "@/hooks/General/useHandleKeydownBasic";
import toast from "react-hot-toast";
import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";

import { useFlag } from "@/hooks/useFlag";
import { HTPR_6930_MY_TASKS_KANBAN_REUSE_FLAG } from "@/lib/flags/keys";

type PersonalOptions = {
    canSaveCurrent: boolean;
    busy: boolean;
    onSaveCurrent: () => void | Promise<void>;
    onCreate: (name: string) => void | Promise<void>;
    onReset: () => void;
};
type TProps = { toggle: () => void } & (
    { project: IProject; personal?: never } |
    { personal: PersonalOptions; project?: never }
);

type BoardProps = {
    toggle: () => void,
    project: IProject
}

type TOption = {
    index: number;
    title: string;
    id: TScreen;
    options?: string[]
}
const Screens: TOption[] = [
    {
        index: 0,
        title: "Save this view",
        id: "SaveThisView",
        options: [
            "Save as current view",
            "Set as default board for everyone",
            "Save as additional view for team",
            "Save as view for me only",
            "Reset View",

        ]

    },
    {
        index: 1,
        title: "Save as new view for team",
        id: "SaveForTeam",
        options: [
            "Save view"
        ]
    },
    {
        index: 2,
        title: "Save as view for me only",
        id: "SaveForMe",
        options: [
            "Save view"
        ]
    },
]
type TScreen = "SaveThisView" | "SaveForTeam" | "SaveForMe"
const SaveViewModal: React.FC<TProps> = (props) => {
    const kanbanReuseEnabled = useFlag(HTPR_6930_MY_TASKS_KANBAN_REUSE_FLAG);
    if (props.personal) {
        if (!kanbanReuseEnabled) return null;
        const personal = props.personal;
        const personalScreens: TOption[] = [
            { index: 0, title: "Save this view", id: "SaveThisView", options: [
                ...(personal.canSaveCurrent ? ["Save to current view"] : []),
                "New personal view",
                "Reset",
            ] },
            { index: 2, title: "New personal view", id: "SaveForMe", options: ["Save view"] },
        ];
        return <SaveViewModalContent toggle={props.toggle} initialScreen={personalScreens[0]} busy={personal.busy}
            onSelect={async (screen, index, name) => {
                if (screen.id === "SaveForMe") {
                    await personal.onCreate(name);
                    props.toggle();
                    return;
                }
                const option = screen.options?.[index];
                if (option === "New personal view") return personalScreens[1];
                if (option === "Save to current view") await personal.onSaveCurrent();
                else if (option === "Reset") personal.onReset();
                props.toggle();
            }} />;
    }
    return <BoardSaveViewModal toggle={props.toggle} project={props.project} />;
};

const BoardSaveViewModal = ({ toggle, project }: BoardProps) => {
    const { updateView, resetView, saveAsDefaultHandler} = useKanbanViews(project)
    const queryClient = useQueryClient()
    const getExplicitBoardLayout = () => savedBoardLayoutFromExplicitSurface(
        typeof window === "undefined"
            ? null
            : new URLSearchParams(window.location.search).get("surface"),
    )

    const currentUser = useCurrentUser()
    const getLatestProject = (): IProject => {
        const allData = queryClient.getQueryData<IProjectsAll>(["projectsAll"])
        return allData?.updatedProjects.find((candidate) => candidate.id === project.id) ?? project
    }
    const buildCreateBody = (sourceProject: IProject): TCreate_view_body => {
        const activeTableSort = getActiveTableSortFromProject(sourceProject)
        return {
        setAsDefault: true,
        view_settings: {
            board_sorting_mode: getActiveSortingModeFromProject(sourceProject),
            board_sorting_order: getActiveSortingOrderFromProject(sourceProject),
            board_sorting_stack: getActiveSortingStackFromProject(sourceProject),
            board_filters: getActiveFiltersFromProject(sourceProject),
            board_columns_view: getActiveColumnsViewFromProject(sourceProject),
            board_subtask_setting: getActiveSubtaskSettingFromProject(sourceProject),
            board_empty_sections: getActiveEmptySectionSettingFromProject(sourceProject),
            board_staleness: getActiveStalenessOverrideFromProject(sourceProject),
            board_show_archived: getActiveShowArchivedOverrideFromProject(sourceProject),
            table_sort_column: activeTableSort?.column ?? null,
            table_sort_direction: activeTableSort?.direction ?? null,
            board_layout: getExplicitBoardLayout() ?? getActiveBoardLayoutPreferenceFromProject(sourceProject),
        },
        userId: currentUser?.id ?? 0,
        projectId: sourceProject.id,
        viewTitle: buildDefaultTitle(sourceProject.id),
        visibility: "Public",
        }
    }

    const onSelect = async (currentScreen: TOption, index: number, viewTitle: string) => {
        if (currentScreen.id === "SaveThisView") {
            if (index === 1) {
                await waitForBoardViewMutations(project.id)
                await saveAsDefaultHandler(buildCreateBody(getLatestProject()))
                return toggle()
            } else if (index === 0) {
                await waitForBoardViewMutations(project.id)
                const latestProject = getLatestProject()
                const currentView = latestProject.project_view?.user_project_views[0]?.appliedView
                const latestBody = buildCreateBody(latestProject)
                if (!currentView) {
                    await saveAsDefaultHandler(latestBody)
                    return toggle()
                }
                const body: TUpdate_view_body = {
                    projectId: latestProject.id,
                    view_settings: latestBody.view_settings,
                    viewId: currentView.id
                }
                await updateView(body)
                return toggle()
            } else if (index === 4) {
                await waitForBoardViewMutations(project.id)
                await resetView("ResetCurrent")
                return toggle()
            }
            return Screens[index - 1]
        }
        await waitForBoardViewMutations(project.id)
        await saveAsDefaultHandler({ ...buildCreateBody(getLatestProject()), setAsDefault: false, visibility: currentScreen.id === "SaveForTeam" ? "Public" : "Private", viewTitle })
        return toggle()
    }
    return <SaveViewModalContent toggle={toggle} initialScreen={Screens[0]} onSelect={onSelect} />
}

const SaveViewModalContent = ({ toggle, initialScreen, onSelect, busy }: {
    toggle: () => void;
    initialScreen: TOption;
    onSelect: (screen: TOption, index: number, name: string) => Promise<TOption | void>;
    busy?: boolean;
}) => {
    const { setSelectedIndex, selectedIndex, handleKeydown } = useHandleKeydownBasic(enterHandler)
    const { handleMouseEnter, handleMouseLeave, handleMouseMove, elRef } = useHandleMouseGlobal({ setSelectedIndex })
    const [currentScreen, setCurrentScreen] = useState<TOption>(initialScreen)
    const [viewTitle, setViewTitle] = useState("")
    const pending = useRef(false)

    async function enterHandler(index: number) {
        if (busy || (busy !== undefined && pending.current)) return
        const name = viewTitle.trim()
        if (currentScreen.index !== 0 && !name) return toast.error("Give your view a name first")
        pending.current = true
        try {
            const nextScreen = await onSelect(currentScreen, index, name)
            if (nextScreen) setCurrentScreen(nextScreen)
        } catch (error) {
            toast.error(
                axios.isAxiosError(error) && typeof error.response?.data?.message === "string"
                    ? error.response.data.message
                    : "Could not save the view"
            )
        } finally {
            pending.current = false
        }
    }

    const handleChange = (e: any) => {
        const value = e.target.value;
        setViewTitle(value)
    }

    useEffect(() => {
        setSelectedIndex(0)
        setViewTitle("")
    }, [currentScreen])

    useEffect(() => {
        const keydown = (e: KeyboardEvent) => handleKeydown(e, currentScreen.options?.length ?? 0,'label-htc-option-',toggle)
        document.addEventListener('keydown', keydown);
        return () => document.removeEventListener('keydown', keydown);
    }, [currentScreen.options?.length, handleKeydown,toggle])

    return (
        <ModalContainerCustom
            fade={false}
            show={true}
            isOpen={true}
            shouldCloseOnClickOutside={true}
            id="addColumnModal"
            toggle={toggle}
            className="font-bold"
        >

            <ModalHeaderComp header={currentScreen.title} className="px-[20px]" />
            <ModalBody className="p-0">
                {
                    currentScreen.index !== 0 &&
                    <ModalInput
                        onChange={handleChange}
                        value={viewTitle}
                        placeholder="Name your view"
                        autofocus={true}
                    />
                }
                <ModalListContainer
                    className="max-h-[400px]"
                    handleMouseMove={handleMouseMove}
                    id="save-view-modal-list-container">
                    {
                        currentScreen.options?.map((option, index) =>

                            <ModalRowElementContainer
                                key={index}
                                onMouseEnter={()=>handleMouseEnter(index)}
                                handleMouseLeave={handleMouseLeave}
                                onClick={() => enterHandler(index)}
                                id={`label-htc-option-${index}`}
                                index={index} commandRef={elRef} isSelected={selectedIndex === index}
                            >
                                <span>{option}</span>
                            </ModalRowElementContainer>
                        )
                    }
                </ModalListContainer>
            </ModalBody>

        </ModalContainerCustom>
    )
}

export default SaveViewModal;
