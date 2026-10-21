import { useState } from "react"


const useHandleKeydownBasic = (enterHandler:any)=>{
    const [selectedIndex, setSelectedIndex] = useState(0);

    const handleKeydown = (e:KeyboardEvent, totalElements:number,prefix:string, toggle?: (switchToManage?: boolean) => void) => {
        if (e.key==="Escape" && toggle){
            e.preventDefault()
            return toggle()
        }
        if (e.key==="Enter"){
            e.preventDefault()
            enterHandler(selectedIndex)
        }
        else if (e.key ==="ArrowDown"){
            if (selectedIndex!==totalElements-1 )setSelectedIndex(prev=>prev+1)
            document.getElementById(`${prefix}${selectedIndex + 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
        else if (e.key ==="ArrowUp"){
            if ( selectedIndex!==0 )setSelectedIndex(prev=>prev-1)
            document.getElementById(`${prefix}${selectedIndex - 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })    
        }
    }
    return {
        setSelectedIndex,
        selectedIndex,
        handleKeydown
    }
}


export default useHandleKeydownBasic