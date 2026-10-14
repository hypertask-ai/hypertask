
import { thumbsUpEmoji } from "@/lib/constants/constants";
import { descriptionContainerId } from "@/lib/constants/TaskDetail";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { currentUserAtom } from "@/store";
import axios from "axios";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6962_KEEP_ASSIGNEE_FLAG } from "@/lib/flags/keys";
import { preserveTaskAssigneesChangedDuringFetch } from "@/lib/realtime/taskDetailRefresh";
import { useEffect, useMemo, useState } from "react";
import { useRecoilState } from "@/lib/state";
import { useDeviceContext } from "@/lib/contexts/deviceContext";

const useDescriptionReactions = ()=>{
    const keepAssignee = useFlag(HTPR_6962_KEEP_ASSIGNEE_FLAG);
    const [showEmojiPickerDescription,setShowEmojiPickerDescription ] = useState<boolean>(false)
    const {currentTask, parsedTask:parsed_task, setCurrentTask, focusOn}= useTaskContext()
    const [currentUser, _setCurrentUser] = useRecoilState(currentUserAtom);
    const isApple = useDeviceContext()
    const _parsedTask = useMemo(()=>JSON.parse(parsed_task),[parsed_task])
    const handleClickOutside = (event: any) => {
        setShowEmojiPickerDescription(false)        
  };
  
    const toggleEmojiPickerDescription = () => {
      setShowEmojiPickerDescription(prev=>!prev)
    };
  
        const emojiClickHandlerDescriptionr = async (emojiData: any) => {
          setShowEmojiPickerDescription(false)
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
            
            setCurrentTask(current => preserveTaskAssigneesChangedDuringFetch(
              current, updatedTask, currentTask.assignees, keepAssignee,
            ));
          }          
          focusOn(descriptionContainerId)
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
                  return;
                }
              }
        if (
            e.keyCode === 82 &&
            document.activeElement?.id === descriptionContainerId &&
            !cmdControl
        ) {
            e.preventDefault();
            setShowEmojiPickerDescription(true)
        }

    }
        useEffect(() => {
            document.addEventListener("keydown", handleKeyDown);
        
            return () => {
              document.removeEventListener("keydown", handleKeyDown);
            };
          }, [handleKeyDown]);
        
    return {showEmojiPickerDescription,setShowEmojiPickerDescription, handleClickOutside, toggleEmojiPickerDescription, emojiClickHandlerDescriptionr}
  }


export default useDescriptionReactions
