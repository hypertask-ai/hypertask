import { ModalContainerCustom, ModalHeaderComp, ModalInput, ModalListContainer, ModalRowElementContainer } from '@/components/Common/CommonModalComponents'
import useKanbanViews from '@/hooks/Homepage/Views/useKanbanViews';
import useHandleKeydownBasic from '@/hooks/General/useHandleKeydownBasic';
import useHandleMouseGlobal from '@/hooks/General/useHandleMouse';
import { IProject, IView } from '@/models/model';
import { deepCopy } from '@/utils/helperFunctions/helperFunctions';
import axios from 'axios';
import React, { useEffect, useMemo, useState } from 'react'
import { Check, LayoutGrid, Lock, Rows3, Settings, UsersRound } from "lucide-react";


import { ModalBody } from 'reactstrap'

interface IViewsForBoard {
    toggle: (switchToManage?: boolean) => void;
    project: IProject
}
const ViewsForBoard: React.FC<IViewsForBoard> = ({ toggle, project }) => {
    const [keyword, setKeyword] = useState("");
    const { setSelectedIndex, selectedIndex, handleKeydown } = useHandleKeydownBasic(enterHandler)
    const { switchViewHandler } = useKanbanViews(project)
    const { handleMouseEnter, handleMouseLeave, handleMouseMove, elRef } = useHandleMouseGlobal({ setSelectedIndex })
    const selectedView = project.project_view?.user_project_views[0]?.appliedView?.id ?? project.project_view?.default_view?.id

    const projectViews = useMemo(() =>
        deepCopy((project.project_view?.allViews ?? []).filter(v => v.id !== project.project_view?.user_project_views[0]?.unsavedView?.id)).sort((a, b) => {
            // Ensure the default view comes first
            if (a.id === project?.project_view?.default_view_id) return -1;
            if (b.id === project?.project_view?.default_view_id) return 1;
            // Ensure the selected view comes second (after the default view)
            if (a.id === selectedView) return -1;
            if (b.id === selectedView) return 1;

            const dateA = new Date(a.ViewLastUsed[0]?.lastUsedAt!).getTime()
            const dateB = new Date(b.ViewLastUsed[0]?.lastUsedAt!).getTime()
            if (dateA > dateB) return -1;  // b comes before a (b is more recent)
            if (dateA < dateB) return 1; // a comes before b (a is more recent)
            // Otherwise, keep the order unchanged
            return 0;
        })
        , [project.project_view?.allViews, project.project_view?.default_view_id, project.project_view?.user_project_views, selectedView])
    const [filteredOptions, setFilteredOptions] = useState(projectViews)

    const handleChange = (e: any) => {
        console.log("🚀 ~ projectViews:", projectViews)

        setKeyword(e.target.value)
        const filteredOptions = keyword.length > 0 ? projectViews?.filter((view) =>
            e.target.value
                ? view.title?.toLowerCase().includes(e.target.value.toLowerCase())
                : true
        ) : projectViews
        console.log("🚀 ~ handleChange ~ filteredOptions:", filteredOptions)
        setFilteredOptions(filteredOptions)
        setSelectedIndex(0)
        document.getElementById(`label-htc-option-${0}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })

    }
    async function enterHandler(index: any) {
        if (filteredOptions) {
            await switchViewHandler(filteredOptions[index])
            return toggle()
        }
    }
    useEffect(() => {
        const keydown = (e: KeyboardEvent) => handleKeydown(e, filteredOptions?.length ? filteredOptions?.length: 0, 'label-htc-option-', toggle)
        document.addEventListener('keydown', keydown);
        return () => document.removeEventListener('keydown', keydown);
    }, [filteredOptions?.length, handleKeydown])

    return (
        <ModalContainerCustom
            fade={false}
            show={true}
            isOpen={true}
            id="viewsForBoardModal"
            toggle={() => toggle()}
            shouldCloseOnClickOutside={true}
            className="paletteModalSizing text-white-black bg-modalBackground rounded-[5px] p-0 assignUserModal absolute right-0 left-0 mx-auto max-h-[400px] sm:min-w-[560px] sm:top-[24%]"
        >

            <ModalHeaderComp header={`Views for ${project.title}`} className="px-[20px]" >
                <div onClick={()=>toggle(true)} className='text-content whitespace-nowrap flex cursor-pointer items-center gap-2'>
                    <span>Manage Views</span>
                    <Settings strokeWidth={1.75} size={14} />
                </div>
            </ModalHeaderComp>
            <ModalBody className="p-0">

                <ModalInput
                    onChange={handleChange}
                    value={keyword}
                    placeholder="Type view name"
                    autofocus={true}
                />

                <ModalListContainer
                    handleMouseMove={handleMouseMove}
                    id="save-view-modal-list-container">

                    {/* ============== MANAGE VIEWs ELEMENT ============ */}
                    {/* <ModalRowElementContainer
                        key={`el-${0}`}
                        onMouseEnter={()=>handleMouseEnter(0)}
                        handleMouseLeave={handleMouseLeave}
                        id={`label-htc-option-${0}`}
                        onClick={() => toggle(true)}
                        index={0} commandRef={elRef} isSelected={selectedIndex === 0}
                    >
                        <div className='flex items-center gap-2'>
                            <span>Manage Views</span>
                            <Settings strokeWidth={1.75} className="text-white-black-inverted" size={12} />
                        </div>

                    </ModalRowElementContainer> */}
                    {/* ============== ALL Project View Elements ============ */}
                    {
                        filteredOptions?.map((view, index) =>
                            <ModalRowElementContainer
                                key={`el-${index}`}
                                onMouseEnter={() => handleMouseEnter(index)}
                                handleMouseLeave={handleMouseLeave}
                                onClick={() => switchViewHandler(view)}
                                id={`label-htc-option-${index}`}
                                index={index} commandRef={elRef} isSelected={selectedIndex === index}
                            >
                                <ViewTitle view={view} project={project} />
                                {
                                    selectedView === view.id && <Check strokeWidth={1.75} size={14} />
                                }
                            </ModalRowElementContainer>
                        )
                    }

                </ModalListContainer>
            </ModalBody>

        </ModalContainerCustom>
    )
}

export default ViewsForBoard

const ViewTitle = ({
    view,
    project
}: {
    view: IView;
    project: IProject
}) => {
    const isDefaultBoard = view.id === project.project_view?.default_view_id
    return (
        <div className='flex items-center gap-2'>
            <span>{isDefaultBoard ? `${project.title} (Default Board)` : view.title}</span>
            {view.board_layout === "Table"
                ? <Rows3 strokeWidth={1.75} size={13} aria-label="Opens as Table" />
                : view.board_layout === "Board"
                    ? <LayoutGrid strokeWidth={1.75} size={13} aria-label="Opens as Board" />
                    : null}
            {
                isDefaultBoard ? <></>
                    :
                    view.visibility === "Private" ?
                        <Lock strokeWidth={1.75} size={12} />
                        :
                        <UsersRound strokeWidth={1.75} size={14} />
            }
        </div>
    )
}
