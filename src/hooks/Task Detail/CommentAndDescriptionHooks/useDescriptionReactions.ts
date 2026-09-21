/* eslint-disable react-hooks/exhaustive-deps */
import { thumbsUpEmoji } from "@/lib/constants/constants";
import { descriptionContainerId } from "@/lib/constants/TaskDetail";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { currentUserAtom } from "@/store";
import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { useRecoilState } from "@/lib/state";
import { useDeviceContext } from "@/lib/contexts/deviceContext";

const useDescriptionReactions = ()=>{
    const [showEmojiPickerDescription,setShowEmojiPickerDescription ] = useState<boolean>(false)
    const {currentTask, parsedTask:parsed_task, setCurrentTask, focusOn}= useTaskContext()
    const [currentUser, _setCurrentUser] = useRecoilState(currentUserAtom);
    const isApple = useDeviceContext()
    const _parsedTask = useMemo(()=>JSON.parse(parsed_task),[parsed_task])
    const handleClickOutside = (event: any) => {
      // const emojiWrapper = document.querySelector('.EmojiPickerReact')
  
      // const emojiWrapperClick = !!emojiWrapper?.contains(event.target)
      // if (!emojiWrapperClick) {
        setShowEmojiPickerDescription(false)        
      // }
  };
  
    const toggleEmojiPickerDescription = () => {
      setShowEmojiPickerDescription(prev=>!prev)
    };
  
        // ------------------ onEmojiClick Handler
        const emojiClickHandlerDescriptionr = async (emojiData: any) => {
      
          // console.log("🚀 ~ emojiClickHandlerDescriptionr ~ emojiData:", emojiData)
          setShowEmojiPickerDescription(false)
          // if (!_mbl) returnFocusToComment()
          // let commentId_=commentId?commentId:comments[parseInt(currentId.split("-")[1])].id
          const response = await axios.post("/api/tasks/reactToDescription",{
            descriptionId:_parsedTask.description_.id,
            taskId:currentTask?.id,
            userId:currentUser.id,
            unified:emojiData.unified,
            emoji:emojiData.emoji??emojiData.native,
            names:emojiData.keywords??[],
            
          })
          if (currentTask){
            const updatedTask = {
              ...currentTask,
              description_: {
                ...currentTask?.description_,
                reactions: response.data
              }
            }; 
            
            // console.log("🚀 ~ emojiClickHandlerDescriptionr ~ updatedTask:", updatedTask)
            setCurrentTask(updatedTask);
          }          
          focusOn(descriptionContainerId)
          // updateCommentsOnReaction(response,parseInt(commentId_.toString()),emojiData)
          
        }
    const handleKeyDown = (e:any)=>{
        const isInputFocused = [
            "input",
            "textarea",
            "textbox",
            "ProseMirror",
          ].includes((document.activeElement as HTMLElement)?.tagName?.toLowerCase());
          const classNamesToReturnFrom = [
            "modal-open",
            "ProseMirror ProseMirror-focused",
            undefined,
          ];
          var cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);
      
          if (
            document.querySelector(".modal") ||
            document.getElementById("carousel-container") ||
            document?.activeElement?.role === "dialog" ||
            document?.activeElement?.id === "modalButtons" ||
            document.activeElement?.tagName === "INPUT" ||
            document.activeElement?.id === "htc" ||
            classNamesToReturnFrom.includes(document?.activeElement?.className) ||
            document.activeElement?.id === "boardManager"
          )
            return;

            if (e.key === "Escape" ) {
                if (showEmojiPickerDescription) {
                  setShowEmojiPickerDescription(false);
                  return; // keep focus at the comment it was at
                }
              }
         // -------------- [r] for reactions
        if (
            e.keyCode === 82 &&
            document.activeElement?.id === descriptionContainerId &&
            !cmdControl
        ) {
            // console.log("🚀 ~ handleKeyDown ~ e.key:", e.key)
            e.preventDefault();
            setShowEmojiPickerDescription(true)
            // document.getElementById(`comment-${currentIndex}`)?.scrollIntoView({behavior:"smooth",block:"center"})
        }

    }
        useEffect(() => {
            // Add event listeners when the component mounts
            document.addEventListener("keydown", handleKeyDown);
        
            // Remove event listeners when the component unmounts
            return () => {
              document.removeEventListener("keydown", handleKeyDown);
            };
          }, [handleKeyDown]);
        
    return {showEmojiPickerDescription,setShowEmojiPickerDescription, handleClickOutside, toggleEmojiPickerDescription, emojiClickHandlerDescriptionr}
  }


export default useDescriptionReactions
