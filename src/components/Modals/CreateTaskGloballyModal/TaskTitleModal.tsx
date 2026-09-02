import { MobileViewContext } from '@/lib/contexts/mobileContext';
import React, { useCallback, useContext, useEffect, useRef, useState } from 'react'
import useSetStickyHeight from '@/hooks/Task Detail/useSetStickyHeight';
import { useContextCreateTaskModal } from '@/lib/contexts/Multipages/CreateTaskGloballyContexts/useContextCreateTaskModal';
import useClickOutside from '@/hooks/MultiPages/useClickOutside';
import useAutosizeTextArea from '@/hooks/General/useAutosizeTextarea';
import { useDeviceContext } from '@/lib/contexts/deviceContext';
import { DIV_ID_CONSTANTS } from '@/lib/configs/general.config';
import { useTourContext } from '@/lib/tours/context/TourContext';
import { X } from 'lucide-react';
import { AudioButton } from '@/components/RTE/Components/AudioButton';

const TaskTitleModal = () => {
    const _mbl = useContext(MobileViewContext);
    const { dynamicElementRef } = useSetStickyHeight()
    const textAreaRef = useRef<HTMLTextAreaElement>(null);
    const isApple = useDeviceContext()
    const { endTour } = useTourContext();
    const { currentFocusedElement, editMode, setEditMode, formValues, handleChange, appendDictationToTitle, dictationCoordinator, setCurrentFocusedElement, focusOn, isRecording, toggleRecording, closeHandler, isGeneratingTitle, titleGenerationError } = useContextCreateTaskModal()
    useAutosizeTextArea(textAreaRef.current, formValues.title);
    const outsideClickHandler = () => {
        if (editMode!=="title") return
        setEditMode(null)
        // focusOn(null)
    }
    useClickOutside(null, outsideClickHandler, 'title-input-container-create-task-modal');

    const handleKeyDown = useCallback((e:any)=>{
        var cmdControl = isApple && e.metaKey || !isApple && e.ctrlKey;

        if (editMode!=="title") return
        if (e.key === "Tab") {
            e.preventDefault();
            setEditMode("Description");
            setCurrentFocusedElement("Description");
            // document.getElementById("title-input")?.blur()
            }
        if (e.key === "Escape") {
            console.log("🚀 ~ TaskTitleModal ~ e:", e.key)
            setEditMode(null);
            setTimeout(() => {
                document.getElementById(DIV_ID_CONSTANTS.titleInputModal)?.blur()
                // setCurrentFocusedElement("Title");
            }, 10);
        }
        // [cmd/ctrl][j]
        if (e.keyCode === 74 && cmdControl) {
            e.preventDefault()
            endTour()
            console.log("🚀 ~ TaskTitleModal ~ endTour is not working");
            setEditMode("Description-ai")
            setCurrentFocusedElement("Description")
            return true
        }

        // [Audio button] cmd/ctrl + shift + d
        if (e.shiftKey && cmdControl && e.keyCode === 68) {
            e.preventDefault();
            if (isRecording) return;
            setEditMode("Description")
            setCurrentFocusedElement("Description")
            let elementId = "create-task-modal-audio-button"
            document.getElementById(elementId)?.click();
        }

        // [Audio button with improve] cmd/ctrl + shift + f (for improving)
        if (e.shiftKey && cmdControl && e.keyCode === 70) {
            e.preventDefault();
            if (isRecording) return;
            setEditMode("Description")
            setCurrentFocusedElement("Description")
            let elementId = "create-task-modal-audio-button-improve"
            document.getElementById(elementId)?.click();
        }

        // [Audio button] alt+v
        if (e.altKey && e.keyCode === 86) {
            e.preventDefault();
            if (isRecording) return;
            setEditMode("Description")
            setCurrentFocusedElement("Description")
            document.getElementById("create-task-modal" + "-" + "audio-button")?.click();
        }
        // note to self. NEVER FUCKING ADD A SET TIMEOUT HERE AGAIN IT'LL FUCK U UP. hours wasted = 2
    },[editMode, setCurrentFocusedElement, setEditMode])
    useEffect(() => {
        
        document.addEventListener('keydown', handleKeyDown);

        // Remove event listeners when the component unmounts
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        }
    }, [handleKeyDown])

    useEffect(()=>{
        if(currentFocusedElement==="Title"){
            setEditMode("title")
            document.getElementById(DIV_ID_CONSTANTS.titleInputModal)?.focus()
        }
    },[currentFocusedElement])
    
    return (
        <>
            <div
                id="title-input-container-create-task-modal"
                ref={dynamicElementRef}
                className={`flex flex-col sm:sticky text-white-black  
                        z-50 pt-9  top-0 bg-inherit  w-[100%]
                        m-0
                        ${_mbl ? "items-start  sticky top-0 border-b  border-light-black-border-1" : "items-baseline pb-[16px]"}
                        pb-3
                        `}
            >
                <div className={`
                                    flex   xs:mx-0  pb-[8px] justify-between w-full
                                    
                                    `}>
                    <div
                        className="flex items-center gap-2 xs:px-[18px] sm:pl-[20px] sm:pr-0 "
                        tabIndex={0}
                        id="title"
                        style={{ flex: 1 }}
                    >
                        {/* {
                            editMode==="title"? */}

                                <textarea
                                    className={
                                        // ponytail: focus shown with a bottom rule, not a full input box (Superhuman-style)
                                        `px-0 border-0 border-b-2 rounded-none
                                        ${currentFocusedElement === "Title" ? "border-gray-300 dark:border-gray-600" : "border-transparent"}
                                    `
                                    }
                                    rows={1}
                                    ref={textAreaRef}
                                    autoFocus
                                    placeholder='Enter task title here'
                                    disabled={isGeneratingTitle}
                                    aria-busy={isGeneratingTitle}
                                    onClick={()=>{
                                        setEditMode("title")
                                        setCurrentFocusedElement("Title")
                                    }}
                                    tabIndex={0}
                                    id={DIV_ID_CONSTANTS.titleInputModal}
                                    autoComplete='off'
                                    value={isGeneratingTitle ? "Generating…" : (formValues.title ?? "")}
                                    onFocus={(e) => {
                                        // Use setTimeout to delay selectionStart adjustment slightly
                                        setTimeout(() => {
                                            e.target.selectionStart = e.target.value.length;
                                        }, 0);
                                        // setEditMode("title")

                                    }}
                                    onChange={(e) => {
                                        handleChange("title", e.target.value);
                                    }}

                                    style={{
                                        resize: "none",
                                        background: "transparent",
                                        fontSize: !_mbl ? 24 : 18,
                                        width: "100%",
                                        outline: "none",
                                        fontWeight:700 }}
                            
                                />
                                {_mbl && (
                                    <AudioButton
                                        callbackHandler={appendDictationToTitle}
                                        editor={null}
                                        id="create-task-title-audio-button"
                                        toggleRecording={toggleRecording}
                                        globalRecording={isRecording}
                                        dictationCoordinator={dictationCoordinator}
                                        disabled={isGeneratingTitle}
                                        ariaLabel="Dictate task title"
                                        mobilePresentation="prominent"
                                        className="h-11 w-11 shrink-0 justify-center"
                                        wrapperClassName="shrink-0"
                                    />
                                )}
                                {/* :
                                <span
                                onClick={()=>{
                                    setEditMode("title")
                                    setCurrentFocusedElement("Title")
                                }}
                                style={{
                                    resize: "none",
                                    background: "transparent",
                                    fontSize: !_mbl ? 24 : 18,
                                    width: "100%",
                                    outline: "none" }}
                                className={
                                    `p-2 border-thin rounded-sm
                                    ${currentFocusedElement === "Title" ? "  border-gray-400":"border-transparent"} 
                                `
                                }
                                    >{formValues.title}</span>
                        } */}
                    </div>
                    {/* Mobile exit. The sheet is full screen, so there is no
                        backdrop to tap; without this the only way out was a
                        reload (HTPR-5518). It sits in the sticky title row,
                        clear of the AI writer's send button that got the old
                        bottom-right Back pill removed (HTPR-5147). */}
                    {_mbl && (
                        <button
                            type="button"
                            data-mobile-new-task-close
                            aria-label="Close new task"
                            onClick={() => closeHandler(false)}
                            className="mr-[18px] flex h-11 w-11 shrink-0 items-center justify-center text-icon-dark-gray"
                        >
                            <X size={18} strokeWidth={1.75} />
                        </button>
                    )}
                </div>
                {titleGenerationError && (
                    <p className="px-[18px] text-sm text-red-500 sm:px-[20px]" role="alert">
                        {titleGenerationError}
                    </p>
                )}

            </div>

        </>

    )
}

export default TaskTitleModal
