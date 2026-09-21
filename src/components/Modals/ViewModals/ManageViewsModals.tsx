import { ILabel, IView } from "@/models/model";
import { appShellRailAtom, currentProjectAtom, currentUserAtom, hiddenViewTabIdsAtom, showEmptyViewTabsAtom } from "@/store";
import { ChangeEvent, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Eye, EyeOff, GripVertical, LayoutGrid, Lock, Rows3, Settings, Sparkles, Trash2, UsersRound, X } from "lucide-react";
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";



import { ModalBody, ModalFooter, ModalHeader } from "reactstrap";
import { useRecoilState, useRecoilValue } from "@/lib/state";

import { ModalContainerCustom, ModalInput } from "@/components/Common/CommonModalComponents";
import ConfirmDialog from "@/components/Modals/Common Modals/ConfirmDialog";

import useKanbanViews from "@/hooks/Homepage/Views/useKanbanViews";
import useRenderedViews from "@/hooks/Homepage/Views/useRenderedViews";
import useViewOrderActions from "@/hooks/Homepage/Views/useViewOrderActions";
import toast from "react-hot-toast";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { asViewOrder, sortViewsByOrder } from "@/utils/helperFunctions/Views/ViewOrderHelperFunctions";
import { BUILTIN_VIEWS, isBuiltinView, viewTabPreferenceKey, type BoardView } from "@/lib/constants/builtinViews";
import { useGetAllProjectLabels } from "@/hooks/MultiPages/useGetAllProjectLabels";
import { getSmartSplitLabel } from "@/lib/smartSplits";
import SmartSplitModal from "./SmartSplitModal";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { TSavedBoardLayout } from "@/models/Views/model";
import { getViewFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { replaceProjectViewForCurrentBoard } from "@/utils/helperFunctions/Views/ProjectViewState";
type Props = {
    toggle: () => void | Promise<void>
}

const ManageViews: React.FC<Props> = ({ toggle }) => {

    const isMbl = useContext(MobileViewContext)
    const queryClient = useQueryClient()
    const router = useRouter()
    const appShellRailOn = useRecoilValue(appShellRailAtom) && !isMbl
    const [title, setTitle] = useState('')
    const [updating, setUpdating] = useState<boolean>(false)
    const [currentProject, setCurrentProject] = useRecoilState(currentProjectAtom)
    const currentUser = useRecoilValue(currentUserAtom)
    const [showEmptyViewTabs, setShowEmptyViewTabs] = useRecoilState(showEmptyViewTabsAtom)
    const [hiddenViewTabIds, setHiddenViewTabIds] = useRecoilState(hiddenViewTabIdsAtom)
    const [orderUpdating, setOrderUpdating] = useState(false)
    const [editMode, setEditMode] = useState<boolean>(false);
    const [editView, setEditView] = useState<IView | null>(null);
    const [layoutPreference, setLayoutPreference] = useState<TSavedBoardLayout | null>(null)
    const [shouldShowDeleteModal, setDeleteModal] = useState<boolean>(false);
    const [displayedViews, setDisplayedViews] = useState<BoardView[]>([])
    const [viewSearch, setViewSearch] = useState("")
    const [inlineRename, setInlineRename] = useState<{ viewId: string; title: string } | null>(null)
    const [smartSplitToEdit, setSmartSplitToEdit] = useState<{ view: IView; label: ILabel } | null>(null)
    const cancelInlineRenameRef = useRef(false)
    const {
        data: projectLabelsFromTQ,
        isFetched: labelsFetched,
        isError: labelsFailed,
    } = useGetAllProjectLabels(currentProject?.id)
    const projectLabels: ILabel[] = Array.isArray(projectLabelsFromTQ) ? projectLabelsFromTQ : []
    const smartSplitMetadataReady = labelsFetched && !labelsFailed
    const smartSplitMetadataLoading = !labelsFetched && !labelsFailed

    const { applyBoardLayoutPreference, deleteView, renameView, updateViewLayout } = useKanbanViews(currentProject)
    const { views, orderedViews, renderedViews, viewTaskCounts } = useRenderedViews(currentProject)
    const pillViewIds = useMemo(() => new Set(views.map((view) => view.id)), [views])
    const renderedViewIds = useMemo(() => new Set(renderedViews.map((view) => view.id)), [renderedViews])
    const { resetMyViewOrder, saveMyViewOrder, saveProjectDefault } = useViewOrderActions(currentProject?.id)
    const projectDefaultOrder = asViewOrder(currentProject?.project_view?.default_view_order)
    const canSetProjectDefault = Boolean(
        currentProject && currentUser && (
            Number(currentProject.ownerId) === Number(currentUser.id) ||
            currentProject.members?.some((member) =>
                member.userId === currentUser.id &&
                member.status === "Accepted" &&
                member.role === "Admin"
            )
        )
    )

    useEffect(()=>{
        setDisplayedViews(orderedViews)
    },[orderedViews])

    // ================ drag-to-reorder handlers ================
    const handleDragEnd = (result: DropResult) => {
        if (!result.destination || result.source.index === result.destination.index || !currentProject) return

        const defaultViewId = currentProject.project_view?.default_view_id
        const defaultView = displayedViews.find((view) => view.id === defaultViewId)
        const reorderableViews = displayedViews.filter((view) => view.id !== defaultViewId)
        const [moved] = reorderableViews.splice(result.source.index, 1)
        if (!moved) return

        reorderableViews.splice(result.destination.index, 0, moved)
        const reordered = defaultView ? [defaultView, ...reorderableViews] : reorderableViews
        const newOrderedIds = reordered.map((view) => view.id)
        setDisplayedViews(reordered)
        void saveMyViewOrder(newOrderedIds)
    }

    const sortAlphabetically = async () => {
        if (!currentProject) return
        const defaultViewId = currentProject.project_view?.default_view_id
        const defaultView = displayedViews.find((view) => view.id === defaultViewId)
        const alphabetical = displayedViews
            .filter((view) => view.id !== defaultViewId)
            .sort((a, b) => (a.title ?? "").localeCompare(b.title ?? "", undefined, { sensitivity: "base" }))
        const ordered = defaultView ? [defaultView, ...alphabetical] : alphabetical
        setDisplayedViews(ordered)
        setOrderUpdating(true)
        const saved = await saveMyViewOrder(ordered.map((view) => view.id))
        setOrderUpdating(false)
        if (saved) toast.success("Views sorted alphabetically")
    }

    const resetToProjectDefault = async () => {
        if (!currentProject) return
        const { allViews = [], default_view_id, user_project_views } = currentProject.project_view ?? {}
        const unsavedViewId = user_project_views?.[0]?.unsavedView?.id
        const resetViews = sortViewsByOrder<BoardView>(
            [...allViews.filter((view) => view.id !== unsavedViewId), ...BUILTIN_VIEWS],
            projectDefaultOrder,
            default_view_id
        )
        setDisplayedViews(resetViews)
        setOrderUpdating(true)
        const reset = await resetMyViewOrder(
            resetViews.map((view) => view.id),
            projectDefaultOrder !== undefined
        )
        setOrderUpdating(false)
        if (reset) toast.success("View order reset to default")
    }

    const setCurrentOrderAsProjectDefault = async () => {
        if (!currentProject?.project_view || !canSetProjectDefault) return
        setOrderUpdating(true)
        const defaultOrder = await saveProjectDefault(displayedViews.map((view) => view.id))
        setOrderUpdating(false)
        if (!defaultOrder) return
        setCurrentProject((project) => project?.project_view ? {
            ...project,
            project_view: { ...project.project_view, default_view_order: defaultOrder },
        } : project)
        toast.success("Default view order updated")
    }

    const onKeyChange = (e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value);

    const renameSelectedView = async (view: IView, nextTitle: string) => {
        if (!currentProject) return
        if (updating) {
            toast("Please wait for the previous action to be completed!")
            return false
        }
        try {
            setUpdating(true)
            await renameView(view.id, nextTitle, currentProject.id)
            setDisplayedViews((views) => views.map((item) => (
                item.id === view.id ? { ...item, title: nextTitle } : item
            )))
            return true
        } catch (error) {
            console.log("🚀 ~ renameSelectedView ~ error:", error)
            toast.error("Error renaming view");
            return false
        } finally {
            setUpdating(false)
        }
    }

    const deleteSelectedView = async (view: IView) => {
        if (!currentProject) return false
        if (updating) {
            toast("Please wait for the previous action to be completed!")
            return false
        }
        try {
            setUpdating(true)
            const updatedProjectView = await deleteView(view.id, currentProject.id)
            setCurrentProject((project) =>
                replaceProjectViewForCurrentBoard(
                    project,
                    currentProject.id,
                    updatedProjectView,
                )
            )
            setDisplayedViews((views) => views.filter((item) => item.id !== view.id))
            return true
        } catch (error) {
            console.log("🚀 ~ deleteSelectedView ~ error:", error)
            toast.error("Error deleting view");
            return false
        } finally {
            setUpdating(false)
        }
    }

    const onSubmit = async () => {
        if (title.length < 2 || !editView) return;
        if (!currentProject) return
        const nameChanged = title !== editView.title
        if (nameChanged && !(await renameSelectedView(editView, title))) return
        if (layoutPreference !== (editView.board_layout ?? null)) {
            await updateViewLayout(currentProject.id, editView.id, layoutPreference)
            const activeSavedView = getViewFromProject(currentProject)?.view
            if (activeSavedView?.id === editView.id) {
                applyBoardLayoutPreference(layoutPreference)
            }
            setDisplayedViews((views) => views.map((view) => (
                view.id === editView.id && !isBuiltinView(view)
                    ? { ...view, board_layout: layoutPreference }
                    : view
            )))
        }
        goBack()
    }

    const commitInlineRename = async (view: IView) => {
        if (!inlineRename || inlineRename.viewId !== view.id) return
        const nextTitle = inlineRename.title
        if (nextTitle.length < 2) {
            toast.error("View name must be at least 2 characters")
            return
        }
        if (nextTitle === view.title) {
            setInlineRename(null)
            return
        }
        const renamed = await renameSelectedView(view, nextTitle)
        if (renamed) setInlineRename(null)
    }

    const toggleViewTabVisibility = (viewId: string) => {
        const key = viewTabPreferenceKey(currentProject?.id, viewId)
        setHiddenViewTabIds((prev) => ({ ...prev, [key]: !prev[key] }))
    }

    const toggleEdit = (view: IView) => {
        setEditMode(true)
        setEditView(view)
        setInlineRename(null)
        cancelInlineRenameRef.current = false
    }

    // GO BACK HANDLER
    const goBack = () => {
        setEditMode(false)
        setEditView(null);
        setDeleteModal(false)
    }

    // OPEN EDIT COLUMN VIEW
    const openEditView = (view: IView) => {
        if (smartSplitMetadataLoading) {
            toast.error("Smart split details are still loading")
            return
        }
        const smartLabel = smartSplitMetadataReady
            ? getSmartSplitLabel(view, projectLabels, displayedViews)
            : null
        if (smartLabel) {
            setSmartSplitToEdit({ view, label: smartLabel })
            return
        }
        toggleEdit(view)
        setTitle(view.title)
        setLayoutPreference(view.board_layout ?? null)
    }

    // CONFIRM DELETE
    const confirmDelete = async () => {
        if (!editView) return
        const deleted = await deleteSelectedView(editView)
        if (deleted) goBack()
    }

    const closeBtn = editMode
        ? <ArrowLeft size={18} strokeWidth={1.75} className="close cursor-pointer hover:text-heading transition-all" onClick={goBack} />
        : <X size={18} strokeWidth={1.75} className="close cursor-pointer hover:text-heading transition-all" onClick={toggle} />
    const isEditingDefaultView = editView?.id === currentProject?.project_view?.default_view_id
    if (smartSplitToEdit && currentProject) {
        return (
            <SmartSplitModal
                projectId={currentProject.id}
                view={smartSplitToEdit.view}
                label={smartSplitToEdit.label}
                onClose={async (refresh) => {
                    if (!refresh) {
                        setSmartSplitToEdit(null)
                        return
                    }
                    await queryClient.refetchQueries({ queryKey: ["projectsAll"] })
                    router.refresh()
                    await toggle()
                }}
            />
        )
    }

    return (
        <ModalContainerCustom
            fade={false}
            // this is dirty, but i have 100 other tasks to get to
            toggle={()=>{
                if (!shouldShowDeleteModal)toggle()
            }}
            show={true}
            isOpen={true}
            id="manage-views-modal-container"
            className="paletteModalSizing text-white-black bg-modalBackground rounded-[5px] p-0 assignUserModal absolute right-0 left-0 mx-auto max-h-[400px] sm:min-w-[560px] sm:top-[24%]"
        >
            <ModalHeader
                close={closeBtn}
                className="h-[48px] rounded-none border-b-0 bg-modalBackground px-4 text-emphasis font-medium [&>*:first-child]:w-full"
            >
                <div className="flex gap-3 justify-between items-center">
                    <span>{!editMode ? "Manage views" : "Edit view"}</span>
                </div>
            </ModalHeader>
            <ModalBody className="max-h-[364px] overflow-y-scroll bg-modalBackground text-dense">

                {
                    !editMode ?
                        <>
                            {appShellRailOn && (
                                <div className="mx-1.5 flex h-[36px] items-center justify-between rounded-sm px-3 text-dense">
                                    <span>Show views with 0 tasks</span>
                                    <div
                                        role="switch"
                                        aria-checked={showEmptyViewTabs}
                                        onClick={() => setShowEmptyViewTabs((prev) => !prev)}
                                        className={`relative h-[18px] w-[32px] cursor-pointer rounded-full transition-colors ${showEmptyViewTabs ? "bg-active-elementBg" : "bg-hover-active"}`}
                                    >
                                        <div className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white-black transition-transform ${showEmptyViewTabs ? "translate-x-[16px]" : "translate-x-[2px]"}`} />
                                    </div>
                                </div>
                            )}
                            <ModalInput
                                value={viewSearch}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setViewSearch(e.target.value)}
                                placeholder="Search views"
                            />
                            <div className="mx-1.5 flex flex-wrap items-center gap-1 px-2 py-1">
                                <button
                                    type="button"
                                    disabled={orderUpdating || displayedViews.length === 0}
                                    onClick={() => { void sortAlphabetically() }}
                                    className="rounded-[4px] px-2 py-1 text-meta text-text-light-gray transition hover:bg-hover-active hover:text-white-black disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Sort A→Z
                                </button>
                                <button
                                    type="button"
                                    disabled={orderUpdating || displayedViews.length === 0}
                                    onClick={() => { void resetToProjectDefault() }}
                                    className="rounded-[4px] px-2 py-1 text-meta text-text-light-gray transition hover:bg-hover-active hover:text-white-black disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Reset to default
                                </button>
                                {canSetProjectDefault && (
                                    <button
                                        type="button"
                                        disabled={orderUpdating || displayedViews.length === 0}
                                        onClick={() => { void setCurrentOrderAsProjectDefault() }}
                                        className="rounded-[4px] px-2 py-1 text-meta text-text-light-gray transition hover:bg-hover-active hover:text-white-black disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        Set current order as default for everyone
                                    </button>
                                )}
                            </div>
                            {displayedViews.length === 0 ? (
                                <div className="text-center py-2 px-4">
                                    <p className="mb-2 text-white-black">
                                        There are no views present.
                                    </p>
                                    <p className="text-meta text-text-light-gray">
                                        To create a view, configure your board (filters, columns, sorting) and click &quot;Save View&quot; in the header (Shift+V).
                                    </p>
                                </div>
                            ) : (
                                <DragDropContext onDragEnd={handleDragEnd}>
                                    <Droppable droppableId={`manage-views-${currentProject?.id}`} direction="vertical">
                                        {(droppableProvided) => {
                                            const defaultViewId = currentProject?.project_view?.default_view_id
                                            const query = viewSearch.trim().toLowerCase()
                                            const matches = (view: BoardView) => !query || (view.id === defaultViewId ? currentProject?.title : view.title)?.toLowerCase().includes(query)
                                            const defaultView = displayedViews.find((view) => view.id === defaultViewId && matches(view))
                                            const reorderableViews = displayedViews.filter((view) => view.id !== defaultViewId && matches(view))
                                            const isHiddenByEmpty = (view: BoardView) => (
                                                !showEmptyViewTabs && pillViewIds.has(view.id) && !renderedViewIds.has(view.id)
                                            )
                                            const viewMeta = (view: BoardView) => {
                                                const count = viewTaskCounts.get(view.id) ?? 0
                                                return (
                                                    <>
                                                        <span className="text-micro text-text-light-gray">{count}</span>
                                                        {isHiddenByEmpty(view) && (
                                                            <span className="text-micro text-text-light-gray">hidden — no tasks</span>
                                                        )}
                                                    </>
                                                )
                                            }
                                            const smartLabelFor = (view: BoardView) => (
                                                isBuiltinView(view) ? null : getSmartSplitLabel(view, projectLabels, displayedViews)
                                            )
                                            const viewActions = (view: BoardView) => (
                                                <div className="flex gap-4 items-center">
                                                    {hiddenViewTabIds[viewTabPreferenceKey(currentProject?.id, view.id)]
                                                        ? <span title="Hidden from view tabs -- click to show"><EyeOff size={16} strokeWidth={1.75} className="cursor-pointer hover:text-subheading transition-all text-text-light-gray" onClick={() => toggleViewTabVisibility(view.id)} /></span>
                                                        : <span title="Shown in view tabs -- click to hide"><Eye size={16} strokeWidth={1.75} className="cursor-pointer hover:text-subheading transition-all" onClick={() => toggleViewTabVisibility(view.id)} /></span>
                                                    }
                                                    {/* Built-ins are code, not rows: they can be reordered and hidden, never renamed or deleted. */}
                                                    {!isBuiltinView(view) && (
                                                        <button
                                                            type="button"
                                                            aria-label={`Settings for ${view.title?.trim() || "untitled view"}`}
                                                            title="View settings"
                                                            disabled={smartSplitMetadataLoading}
                                                            className="rounded-sm transition-all hover:text-subheading focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white-black disabled:cursor-wait disabled:opacity-50"
                                                            onClick={() => openEditView(view)}
                                                        >
                                                            <Settings size={16} strokeWidth={1.75} aria-hidden />
                                                        </button>
                                                    )}
                                                </div>
                                            )

                                            return (
                                                <div {...droppableProvided.droppableProps} ref={droppableProvided.innerRef}>
                                                    {defaultView && (
                                                        <div className="mx-1.5 flex h-[36px] items-center justify-between rounded-sm px-3 text-dense" key={defaultView.id}>
                                                            <div className="flex items-center gap-2">
                                                                <span>{currentProject?.title ?? defaultView.title}</span>
                                                                {smartLabelFor(defaultView) && (
                                                                    <Sparkles size={14} strokeWidth={1.75} className="text-hypertasks-ai-purple" aria-label="Smart split" />
                                                                )}
                                                                {!isBuiltinView(defaultView) && defaultView.board_layout && (
                                                                    <span
                                                                        className="text-text-light-gray"
                                                                        title={`Opens as ${defaultView.board_layout}`}
                                                                        aria-label={`Opens as ${defaultView.board_layout}`}
                                                                    >
                                                                        {defaultView.board_layout === "Table"
                                                                            ? <Rows3 size={13} strokeWidth={1.75} />
                                                                            : <LayoutGrid size={13} strokeWidth={1.75} />}
                                                                    </span>
                                                                )}
                                                                {viewMeta(defaultView)}
                                                            </div>
                                                            {!isBuiltinView(defaultView) && (
                                                                <button
                                                                    type="button"
                                                                    aria-label={`Settings for ${currentProject?.title ?? defaultView.title ?? "untitled view"}`}
                                                                    title="View settings"
                                                                    disabled={smartSplitMetadataLoading}
                                                                    className="rounded-sm transition-all hover:text-subheading focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white-black disabled:cursor-wait disabled:opacity-50"
                                                                    onClick={() => openEditView(defaultView)}
                                                                >
                                                                    <Settings size={16} strokeWidth={1.75} aria-hidden />
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                    {reorderableViews.map((view: BoardView, index: number) => (
                                                        <Draggable
                                                            key={view.id}
                                                            draggableId={`manage-view-${view.id}`}
                                                            index={index}
                                                            isDragDisabled={!!query}
                                                            disableInteractiveElementBlocking
                                                        >
                                                            {(draggableProvided) => (
                                                                <div
                                                                    ref={draggableProvided.innerRef}
                                                                    {...draggableProvided.draggableProps}
                                                                    {...draggableProvided.dragHandleProps}
                                                                    className="mx-1.5 flex h-[36px] cursor-grab items-center justify-between rounded-sm px-3 text-dense"
                                                                >
                                                                    <div className={isHiddenByEmpty(view) ? "flex items-center gap-2 opacity-40" : "flex items-center gap-2"}>
                                                                        <GripVertical size={14} strokeWidth={1.75} className="text-text-light-gray" />
                                                                        {isBuiltinView(view) ? (
                                                                            <span title="Built-in view">{view.title}</span>
                                                                        ) : smartSplitMetadataLoading ? (
                                                                            <span title="Loading smart split details">{view.title?.trim() || "Untitled view"}</span>
                                                                        ) : smartLabelFor(view) ? (
                                                                            <span>{view.title?.trim() || "Untitled view"}</span>
                                                                        ) : inlineRename?.viewId === view.id ? (
                                                                            <input
                                                                                autoFocus
                                                                                autoComplete="off"
                                                                                data-1p-ignore
                                                                                data-lpignore="true"
                                                                                data-form-type="other"
                                                                                aria-label={`Rename ${view.title}`}
                                                                                className="min-w-0 bg-transparent outline-none"
                                                                                value={inlineRename.title}
                                                                                disabled={updating}
                                                                                onMouseDown={(event) => event.stopPropagation()}
                                                                                onChange={(event) => setInlineRename({ viewId: view.id, title: event.target.value })}
                                                                                onBlur={() => {
                                                                                    if (cancelInlineRenameRef.current) {
                                                                                        cancelInlineRenameRef.current = false
                                                                                        return
                                                                                    }
                                                                                    void commitInlineRename(view)
                                                                                }}
                                                                                onKeyDown={(event) => {
                                                                                    event.stopPropagation()
                                                                                    if (event.key === "Enter") {
                                                                                        event.preventDefault()
                                                                                        event.currentTarget.blur()
                                                                                    } else if (event.key === "Escape") {
                                                                                        event.preventDefault()
                                                                                        cancelInlineRenameRef.current = true
                                                                                        setInlineRename(null)
                                                                                    }
                                                                                }}
                                                                            />
                                                                        ) : (
                                                                            <span
                                                                                role="button"
                                                                                tabIndex={0}
                                                                                title="Click to rename"
                                                                                className="cursor-text"
                                                                                onClick={() => {
                                                                                    cancelInlineRenameRef.current = false
                                                                                    setInlineRename({ viewId: view.id, title: view.title })
                                                                                }}
                                                                                onKeyDown={(event) => {
                                                                                    if (event.key === "Enter") {
                                                                                        event.preventDefault()
                                                                                        cancelInlineRenameRef.current = false
                                                                                        setInlineRename({ viewId: view.id, title: view.title })
                                                                                    }
                                                                                }}
                                                                            >
                                                                                {view.title?.trim() || "Untitled view"}
                                                                            </span>
                                                                        )}
                                                                        {smartLabelFor(view) && (
                                                                            <Sparkles size={14} strokeWidth={1.75} className="text-hypertasks-ai-purple" aria-label="Smart split" />
                                                                        )}
                                                                        {!isBuiltinView(view) && (
                                                                            <span title={view.visibility === "Private" ? "Private view" : "Team view"} className="text-text-light-gray">
                                                                                {view.visibility === "Private"
                                                                                    ? <Lock size={12} strokeWidth={1.75} />
                                                                                    : <UsersRound size={13} strokeWidth={1.75} />}
                                                                            </span>
                                                                        )}
                                                                        {!isBuiltinView(view) && view.board_layout && (
                                                                            <span
                                                                                className="text-text-light-gray"
                                                                                title={`Opens as ${view.board_layout}`}
                                                                                aria-label={`Opens as ${view.board_layout}`}
                                                                            >
                                                                                {view.board_layout === "Table"
                                                                                    ? <Rows3 size={13} strokeWidth={1.75} />
                                                                                    : <LayoutGrid size={13} strokeWidth={1.75} />}
                                                                            </span>
                                                                        )}
                                                                        {viewMeta(view)}
                                                                    </div>
                                                                    <div className={isHiddenByEmpty(view) ? "opacity-40" : undefined}>
                                                                        {viewActions(view)}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </Draggable>
                                                    ))}
                                                    {droppableProvided.placeholder}
                                                </div>
                                            )
                                        }}
                                    </Droppable>
                                </DragDropContext>
                            )}

                        </>
                        :
                        <>
                            <div className="px-2 grid">
                                <span className="text-micro font-semibold uppercase tracking-wider text-text-light-gray">
                                    Name
                                </span>
                                <input
                                    autoFocus
                                    autoComplete="off"
                                    data-1p-ignore
                                    data-lpignore="true"
                                    data-form-type="other"
                                    className="h-[44px] bg-transparent text-content font-normal outline-none"
                                    placeholder="Enter new view name"
                                    value={title}
                                    onChange={onKeyChange}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                            void onSubmit()
                                        } else if (e.key === 'Escape') {
                                            e.preventDefault()
                                            e.stopPropagation()
                                            goBack()
                                        }
                                    }}
                                />
                            </div>

                            <fieldset className="mx-2 mb-3 border-0 p-0">
                                <legend className="mb-2 text-micro font-semibold uppercase tracking-wider text-text-light-gray">
                                    Open layout
                                </legend>
                                <div className="grid grid-cols-3 gap-1 rounded-[5px] bg-hover-active p-1" role="radiogroup" aria-label="Open layout">
                                    {([
                                        { value: null, label: "Browser" },
                                        { value: "Board", label: "Board" },
                                        { value: "Table", label: "Table" },
                                    ] as const).map((option) => (
                                        <button
                                            key={option.label}
                                            type="button"
                                            role="radio"
                                            aria-checked={layoutPreference === option.value}
                                            onClick={() => setLayoutPreference(option.value)}
                                            className={`rounded-[4px] px-2 py-1.5 text-dense transition ${
                                                layoutPreference === option.value
                                                    ? "bg-modalBackground text-white-black shadow-sm"
                                                    : "text-text-light-gray hover:text-white-black"
                                            }`}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                                <p className="mt-1.5 text-micro text-text-light-gray">
                                    Browser inherits your last Board or Table choice on this device.
                                </p>
                            </fieldset>

                            {/* --------------- DELETE CONFIRM MODAL ------------------- */}
                            {shouldShowDeleteModal && !isEditingDefaultView &&
                                <ConfirmDialog
                                    id="confirm-delete-view"
                                    icon={Trash2}
                                    message="Delete this view? That cannot be undone."
                                    confirmLabel="Delete view"
                                    onConfirm={confirmDelete}
                                    onCancel={() => setDeleteModal(false)}
                                />
                            }

                            {/* ------------------ MODAL FOOTER ----------------- */}
                            <ModalFooter className="flex justify-between px-2 border-black" >
                                {!isEditingDefaultView ? (
                                    <button
                                        type="button"
                                        className="cursor-pointer border-0 bg-transparent p-0 text-dense text-red-400 hover:text-red-300"
                                        onClick={() => setDeleteModal(true)}
                                    >
                                        DELETE VIEW
                                    </button>
                                ) : <span />}

                                <div className="inline-flex h-[28px] cursor-pointer items-center justify-center rounded-sm px-3 text-dense font-medium bg-label-span text-white-black hover:bg-hover-active border-0" onClick={() => {
                                    void onSubmit()
                                }}
                                >
                                    SAVE
                                </div>
                            </ModalFooter>
                        </>
                }

            </ModalBody>
        </ModalContainerCustom>
    )
}

export default ManageViews;
