import { TDefaultEditFocus, TSectionPayload } from "@/models/CreateTaskModalModels/model";
import { CommandMode } from "@/models/enums";
import { showBoardManagerAtom, showCommandsAtom, showCreateTaskModalAtom, showShortcutsAtom, showSidebarAtom } from "@/store";
import { setInLocalStorage } from "@/utils/helperFunctions/helperFunctions";
import { useRecoilState, useResetRecoilState } from "@/lib/state";

const useHypertasksRecoilStates = () => {
    const [_, setShowCommands] = useRecoilState(showCommandsAtom);
    const [showCreateTaskModal, setCreateTaskModal] = useRecoilState(showCreateTaskModalAtom);

    const resetshowSidebar = useResetRecoilState(showSidebarAtom)
    const resetshowBoardManager = useResetRecoilState(showBoardManagerAtom)
    const resetShortcuts = useResetRecoilState(showShortcutsAtom)


    const resetShowCommands = useResetRecoilState(showCommandsAtom)
    const toggleShowCommands =()=> setShowCommands((prev)=>({show:!prev.show, mode:CommandMode.Command}))

    const resetCreateTaskGlobally = useResetRecoilState(showCreateTaskModalAtom)
    const toggleCreateTaskGlobally = (column_payload?:TSectionPayload, defaultEditFocus?:TDefaultEditFocus, duplicate?:any)=>{
        setCreateTaskModal((prev)=>({show:!prev.show,column_payload,defaultEditFocus, duplicate }))
    }

    // ========== closes all major modals 
    const GlobalProvidersEscapeHandler = ()=>{
        setTimeout(() => {
            resetShortcuts();
            resetshowSidebar();
            resetShowCommands();
            resetshowBoardManager();
            // resetCreateTaskGlobally()
            // resetCreateTaskGlobally()
          }, 10);
    }
    return {
        resetShowCommands,
        toggleShowCommands,
        resetCreateTaskGlobally,
        toggleCreateTaskGlobally,
        GlobalProvidersEscapeHandler
        
    }
}

export default useHypertasksRecoilStates