import React, { useContext, } from 'react'
import dynamic from 'next/dynamic'

import { MobileViewContext } from '@/lib/contexts/mobileContext';
import CreatedBy from '@/components/PageComponents/TaskDetail/CommentAndDescription/Common/CreatedBy';
import useCurrentUser from '@/hooks/General/useCurrentUserCheckFromCookies';
import { useContextCreateTaskModal } from '@/lib/contexts/Multipages/CreateTaskGloballyContexts/useContextCreateTaskModal';
// import TiptapCreateTaskModal from '@/components/RTE/TiptapCreateTaskModal';
const TiptapCreateTaskModal = dynamic(()=>import("@/components/RTE/TiptapCreateTaskModal"),{ssr:false})

import useClickOutside from '@/hooks/MultiPages/useClickOutside';
import { DIV_ID_CONSTANTS, TOUR_TARGET_CONSTANTS } from '@/lib/configs/general.config';
import BaseCommentAndDescriptionContainer from '@/components/PageComponents/TaskDetail/CommentAndDescription/BaseCommentAndDescriptionContainer';

const DescriptionCreateTaskModal = () => {
    const _mbl = useContext(MobileViewContext);
    const currentUser = useCurrentUser()
    const { currentFocusedElement, editMode, formValues, setEditMode, setCurrentFocusedElement, handleChange } = useContextCreateTaskModal()


    const EscapeHandler = () => {
        setEditMode(null)
        setCurrentFocusedElement("Description")
    }
    // const AISaveHandler = (aiContent: string) => {
    //     console.log("🚀 ~ AISaveHandler ~ aiContent:", aiContent)
    //     handleChange("description", aiContent)
    //     EscapeHandler()

    // }
    const outsideClickHandler = () => {
        if (editMode == "Description") setEditMode(null)
        // focusOn(null)
    }
    useClickOutside(null, outsideClickHandler, DIV_ID_CONSTANTS.descriptionContainerCreateTaskModal);

    if (!currentUser) return <></>
    return (
        <BaseCommentAndDescriptionContainer>
            {/* ======= description =========== */}
            <div
                id={DIV_ID_CONSTANTS.descriptionContainerCreateTaskModal}
                onClick={() => {
                    setEditMode("Description")
                    setCurrentFocusedElement("Description")
                }}
                className={`
                                 ${_mbl ? "py-[10px] my-3 px-[8px]" : "pt-[20px] pb-1 mb-[8px] px-[16px]"}
                                shadow-md rounded-[4px]   w-full bg-comment-description outline-none 
                                ${currentFocusedElement === "Description" ? `shadow-2xl 
                                ${(editMode === "Description" || editMode === "Description-ai")
                            ? `border-l-[#C2CFA5]`
                            : "border-l-selected-item-border"
                        }`
                        : "border-l-transparent"}
                                `}
                style={{ borderLeftWidth: !_mbl ? 4 : 0 }}
            >

                <div className="flex justify-between items-center">
                    <span className='text-meta text-text-light-gray'>

                        <CreatedBy
                            name={currentUser.displayName!}
                            pfp={currentUser.photoURL!}
                            isStacked={false} />

                    </span>

                    {/* The AI trigger used to live here, a 16px "ai" link in the
                        card corner. It is now a labelled control at the front of
                        the action row, where the other actions already are
                        (HTPR-5098). */}

                </div>
                <TiptapCreateTaskModal />
            </div>
        </BaseCommentAndDescriptionContainer>
    )
}

export default DescriptionCreateTaskModal


