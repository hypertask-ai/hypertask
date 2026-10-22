"use client"

import { useFlag } from "@/hooks/useFlag";
import { HTPR_7510_FAVORITES_MENU_CONTRAST_FLAG } from "@/lib/flags/keys";
import { useGetAllTeamsMinimal } from "@/hooks/MultiPages/useGetAllTeamsMinimal";
import { ITeam } from "@/models/model";
import { currentUserAtom } from "@/store";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { ModalBody } from "reactstrap";
import { useRecoilState } from "@/lib/state";
import { useGetAllFavorites } from "@/hooks/MultiPages/useGetAllFavorites";
import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { ModalContainerCustom, ModalHeaderComp } from "@/components/Common/CommonModalComponents";
interface IProps {

    onClose: any;
  }

  
  const ManageFavorites = ({onClose}:IProps) => {
    const favoritesMenuContrast = useFlag(HTPR_7510_FAVORITES_MENU_CONTRAST_FLAG);
    let favoritesMenuBorder = "border-black";
    if (favoritesMenuContrast) {
        favoritesMenuBorder = "border-text-light-gray";
    }
    const isApple = useDeviceContext()
      
    const queryClient = useQueryClient();   
    useEffect(()=>{},[])
    const [currentUser,_] = useRecoilState(currentUserAtom);

    const {data:favoritesTQ}  = useGetAllFavorites(currentUser.UserSettingId)
    const {data:allTeamsTQ} = useGetAllTeamsMinimal(currentUser.id)

    const dropdownRef = useRef<HTMLUListElement>(null)


    const [favorites, setFavorites] = useState(favoritesTQ??[])
    const [modal, setModal] = useState<boolean>(true);
    const [teams, setTeams] = useState<ITeam[]|[]>([])
    const [selectedIndex, setSelectedIndex] = useState<number|null>(null)
    const [dropdownOpen, setDropdownOpen] = useState(false);

    const toggle = () => {
        setModal(false)
        onClose()
      };

    const toggleDropdown=(index:number|null) => {
        console.log("🚀 ~ file: index.tsx:64 ~ toggleDropdown ~ index:", index)
        if (index===selectedIndex){
            setSelectedIndex(null)
            setDropdownOpen((prev)=>!prev)

        }
        else if (index){
            setSelectedIndex(index)
            setDropdownOpen(true)

        }
        else{
            setSelectedIndex(index)
            setDropdownOpen((prev)=>!prev)
        }
        
    }

    const setNewFavorite = async(projectId:number|null, projectTitle?:string,index?:number)=>{
        setDropdownOpen(false)
        setSelectedIndex(null)
        if (projectId){
            const existingIndex = favorites?.findIndex((fav: { index: number }) => fav.index === index);
                
                const body={
                    userSettingId:currentUser.UserSettingId,
                    index:index,
                    projectId:projectId
                }
                console.log("🚀 ~ file: index.tsx:95 ~ setFavorites ~ body:", body)
                if (existingIndex !== -1) {
                  await axios.put("/api/favorites/addEditFavorites",body) 
                  
                } else {
                  await axios.post("/api/favorites/addEditFavorites",body)
                    
                }
                queryClient.refetchQueries({queryKey:["getAllFavorites"]});
              };
              
        

    
    }

    const closeBtn = (
        <X size={18} strokeWidth={1.75} className="close cursor-pointer text-display transition-all " onClick={toggle} />
    );  

    const handleClickOutside = (event: any) => {
        console.log("🚀 ~ file: index.tsx:77 ~ handleClickOutside ~ event.target:", event.target)
    
        if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
            const isInsideDropdown = event.target.closest('.dropdown');    
            console.log("🚀 ~ file: index.tsx:122 ~ handleClickOutside ~ isInsideDropdown:", isInsideDropdown)
            if (!isInsideDropdown) {
                setSelectedIndex(null);
                setDropdownOpen(false);
            }
        }
    };
    

    useEffect(()=>{
        setTeams(allTeamsTQ)
      },[allTeamsTQ])
  
    useEffect(()=>{
        setFavorites(favoritesTQ)
      },[favoritesTQ])
 

      useEffect(() => {
        document.addEventListener("mousedown", handleClickOutside);
    
        return () => {
          document.removeEventListener('mousedown', handleClickOutside);
        };
      }, []);
    
    
 
    return(
        <>
            <ModalContainerCustom
                fade={false}
                isOpen={modal} show={true} 
                toggle={toggle} autoFocus={false}
                id="manage-favorites-modal"
                className="paletteModalSizing sm:min-w-[560px] sm:top-[24%] max-h-[400px]">

                <ModalHeaderComp header="Manage Favorites">{closeBtn}</ModalHeaderComp>
                <ModalBody className="max-h-[364px] overflow-y-scroll bg-modalBackground text-dense scrollbar-thin">
                    
                    <div className="flex-col pl-[8px] gap-2 flex">
                      {Array.from({ length: 10 }, (_, index) => (
                        <>
                        
                            <div className="mx-1.5 flex h-[36px] items-center justify-between rounded-sm px-3 text-dense">

                                <KeyElement
                                    ctrlCmd={!isApple?"ALT":"CTRL"}
                                    index={index}
                                    />

                                <div 
                                    
                                    id="dropdownSelectors"
                                    className={`dropdown border-[1px] ${favoritesMenuBorder} items-center relative flex rounded cursor-pointer`}>
                                    <span
                                        onClick={()=>toggleDropdown(index === 9 ? 0 : index + 1)}
                                        className="min-w-[210px] py-1 px-2 text-start">
                                        {(() => {
                                            const foundFavorite = favorites?.find((fav: { project: any; index: number; }) => fav.index === (index === 9 ? 0 : index + 1));
                                            return foundFavorite ? foundFavorite.project.title : "Select Board";
                                        })()}
                                    </span>
                                    <div 
                                        onClick={()=>toggleDropdown(index === 9 ? 0 : index + 1)}
                                        className={`border-l-[1px]  px-2 py-[2px] h-full grid place-items-center ${favoritesMenuBorder}`}>
                                        <svg className="dropdown" width="15" height="8" viewBox="0 0 15 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M7.5 8L0 0H15L7.5 8Z" fill="currentColor"/>
                                        </svg>
                                    </div>
                                    {
                                        selectedIndex===(index === 9 ? 0 : index + 1)&&dropdownOpen
                                        &&
                                        <TeamsDropDown
                                            setNewFavorite={setNewFavorite}
                                            indexKey={index === 9 ? 0 : index + 1}
                                            teams={teams}
                                            favoritesMenuContrast={favoritesMenuContrast}
                                            dropdownRef={dropdownRef}
                                            />
                                    }

                                </div>
                            </div>
                        </>
                        
                        ))}
                    </div>
                </ModalBody>

            </ModalContainerCustom>
        
        </>
    )
}

const TeamsDropDown = (
    {
        dropdownRef,
        favoritesMenuContrast,
        teams,
        indexKey,
        setNewFavorite
    }:{
        dropdownRef:any,
        favoritesMenuContrast:boolean,
        setNewFavorite: (projectId: any, projectTitle?: string, index?: number) => Promise<void>,
        indexKey:number,
        teams:ITeam[]})=>{

            const queryClient = useQueryClient();   

            const [currentUser,_] = useRecoilState(currentUserAtom);

           const reset = async()=>{
                const body={
                    userSettingId:currentUser.UserSettingId,
                    index:indexKey,
                    projectId:-1
                }
                    await axios.put("/api/favorites/addEditFavorites",body) 
                    queryClient.refetchQueries({queryKey:["getAllFavorites"]});
                    setNewFavorite(null, undefined,undefined)
           } 
            

            useEffect(()=>{
                    dropdownRef.current?.scrollIntoView({behavior:"smooth",block:favoritesMenuContrast ? "nearest" : "center",inline:"start"})
                
            },[dropdownRef, favoritesMenuContrast])

    return (
        <ul
            ref={dropdownRef}
            id={"listContainer"}
            style={{
                top: '100%',
                bottom: 'auto' }} 
            className={`dropdown-menu absolute flex max-h-[364px] w-[244px] cursor-auto flex-col overflow-y-scroll rounded-sm bg-modalBackground shadow-customshadow-2 p-4${favoritesMenuContrast ? " text-white-black" : ""}`}>
                <li
                    onClick={reset}
                    className={`cursor-pointer font-medium pb-[1px] mb-[8px] ${favoritesMenuContrast ? "text-white-black hover:bg-hover-active" : ""}`}>
                    Do Nothing
                </li>
            <TeamsRow
                favoritesMenuContrast={favoritesMenuContrast}
                indexKey={indexKey}
                teams={teams}
                setNewFavorite={setNewFavorite}
                />
              

        </ul>
    )
} 

const KeyElement = (
    {
        ctrlCmd,
        index
    }
        :
    {
        ctrlCmd:string,
        index:number
    }
)=>{
    return (
        <div className="flex gap-1 text-micro font-medium text-white-black">
                                    <kbd
                                        className="mx-[1.5px] h-fit rounded-sm bg-label-span px-[5px] py-[2px]"
                                        >
                                        {ctrlCmd}
                                    </kbd>
                                    <kbd
                                        className="mx-[1.5px] h-fit rounded-sm bg-label-span px-[5px] py-[2px]"
                                        >
                                        {index === 9 ? 0 : index + 1}
                                    </kbd>
                                   
                                </div>
    )
}
const TeamsRow = (
    {
        favoritesMenuContrast,
        teams,
        indexKey,
        setNewFavorite
    }:
    {
        favoritesMenuContrast:boolean,
        teams:ITeam[],
        indexKey:number,
        setNewFavorite: (projectId: any, projectTitle?: string, index?: number) => Promise<void>
    }
)=>{
    return(

        <>
            {
            teams?.map((team)=>
                <>
                    <li className="flex flex-col">
                        <span className="text-micro font-semibold uppercase tracking-wider text-text-light-gray">{team.title}</span>
                        <ul className="py-2">
                            {
                                team.projects.map((project)=>
                                <>
                                    <li 
                                        onClick={()=>setNewFavorite(project.id,project.title, indexKey)} 
                                        className={`flex h-[36px] cursor-pointer items-center rounded-sm px-3 text-dense font-medium hover:bg-hover-active${favoritesMenuContrast ? " text-white-black" : ""}`}>
                                        {project.title}
                                    </li>
                                </>
                                )
                            }
                        </ul>
                    </li>
                </>
            )}
        </>
    )
}

export default ManageFavorites;
