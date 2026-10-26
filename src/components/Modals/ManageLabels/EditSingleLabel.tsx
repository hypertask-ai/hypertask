import { projectLabelsPrefix } from '@/hooks/MultiPages/useGetAllProjectLabels';
import { ILabel } from '@/models/model'
import { currentProjectAtom, currentUserAtom } from '@/store';
import globalAPIHandlers from '@/utils/api/global';
import { useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react'
import axios from "axios";
import { ArrowLeft, Trash2 } from "lucide-react";
import { ModalBody, ModalFooter } from 'reactstrap'
import ConfirmDialog from '@/components/Modals/Common Modals/ConfirmDialog'
import { useRecoilState } from '@/lib/state';
import { getProjectLabelView } from "@/lib/projectLabelViews";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_8024_PROJECT_TAG_VIEWS_FLAG } from "@/lib/flags/definitions/htpr-8024-project-tag-views";
import { ModalContainerCustom, ModalHeaderComp } from '@/components/Common/CommonModalComponents';

const MAX_AI_PROMPT_LENGTH = 1000;

const EditSingleLabel = (
    {
        label,
        onClose
    }:{
        label:ILabel,
        onClose:(refresh?:boolean)=>void;
    }
) => {
    const [currentProject, __] = useRecoilState(currentProjectAtom);
    const [currentUser, _] = useRecoilState(currentUserAtom)
    const [deleteModal, setDeleteModal] = useState<boolean>(false);
    const [title, setTitle] = useState(label.value??"")
    const legacySmartLabel = Boolean(label.ai_prompt?.trim())
    const [prompt, setPrompt] = useState(label.ai_prompt ?? "")
    const queryClient = useQueryClient();   
    const [confirming, setConfirming] = useState<boolean>(false)
    const [error, setError] = useState("");
    const projectViewsEnabled = useFlag(HTPR_8024_PROJECT_TAG_VIEWS_FLAG);
    const hasProjectView = getProjectLabelView(
        currentProject?.project_view?.allViews ?? [],
        label
    ) !== undefined;

    const onKeyChange = (e:any)=>{
        setTitle(e.target.value)
    }

    const closeBtn = (
        <ArrowLeft size={18} strokeWidth={1.75} className="close cursor-pointer hover:text-heading transition-all " onClick={()=>onClose&&onClose()} />
        );

    const updateLabel = async(projectView = false) =>{
        if (
            !title.trim() ||
            (legacySmartLabel && (!prompt.trim() || prompt.length > MAX_AI_PROMPT_LENGTH))
        ) return
        setConfirming(true)
        setError("");
        try {
            await globalAPIHandlers.updateLabelAPI(
                title.trim(),
                label.id,
                legacySmartLabel ? prompt.trim() : undefined,
                projectView || undefined
            )
            await saveChanges()
        } catch (error) {
            const message = axios.isAxiosError(error) ? error.response?.data?.message : undefined;
            setError(typeof message === "string" ? message : "Could not save tag. Try again.");
            setConfirming(false);
        }
    }

    const saveChanges = async()=>{
        await queryClient.refetchQueries({queryKey:[projectLabelsPrefix, label.projectId]})
        await queryClient.refetchQueries({queryKey:["projectsAll"]})
    
        onClose(true)

    }
    const deleteTag = async() =>{
        setConfirming(true)
        setDeleteModal(false)
        setError("");
        try {
            await globalAPIHandlers.deleteLabelAPI(label.id, currentProject?.id, currentUser?.id)
            await saveChanges()
        } catch (error) {
            const message = axios.isAxiosError(error) ? error.response?.data?.message : undefined;
            setError(typeof message === "string" ? message : "Could not delete tag. Try again.");
            setConfirming(false);
        }
    }

    return (
        <ModalContainerCustom
           toggle={() => onClose(true)}
           isOpen={true}
           fade={false}
           autoFocus={true}
           id="edit-tag-modal"
           className="paletteModalSizing sm:min-w-[560px] sm:top-[24%] max-h-[400px]"
        >
           <ModalHeaderComp header="Edit Tag">{closeBtn}</ModalHeaderComp>
           <ModalBody className="max-h-[364px] overflow-y-scroll bg-modalBackground px-4 text-dense">
             {!confirming ? (
               <div className="px-2 grid">
                 <span className="text-micro font-semibold uppercase tracking-wider text-text-light-gray">Name</span>
                 <input
                   autoFocus
                   autoComplete="off"
                   data-1p-ignore
                   data-lpignore="true"
                   data-form-type="other"
                   style={{ backgroundColor: 'transparent', outline: 'none', margin: '16px 0px' }}
                   placeholder="Enter new tag name"
                   value={title}
                   onChange={onKeyChange}
                   onKeyDown={e => {
                     if (e.key === 'Enter') {
                        updateLabel()
                     }
                   }}
                 />
                 {legacySmartLabel && (
                   <label className="grid border-t border-light-black-border-1 pt-3">
                     <span className="text-micro font-semibold uppercase tracking-wider text-text-light-gray">
                       Matching prompt
                     </span>
                     <textarea
                       value={prompt}
                       maxLength={MAX_AI_PROMPT_LENGTH + 1}
                       onChange={(event) => setPrompt(event.target.value)}
                       placeholder="Describe which tasks belong in this smart label"
                       className="mt-2 min-h-[96px] w-full resize-y bg-transparent text-content font-normal text-white-black outline-none placeholder:text-text-light-gray"
                     />
                     <span className={`mt-2 text-right text-micro ${prompt.length > MAX_AI_PROMPT_LENGTH ? "text-destructive" : "text-text-light-gray"}`}>
                       {prompt.length}/{MAX_AI_PROMPT_LENGTH}
                     </span>
                   </label>
                 )}
               </div>
             ) : 
                <>
                 <div className="gap-1 my-2 grid grid-cols-1 ">
                    <h1 className="text-subheading">
                        Please wait while we confirm the changes...
                    </h1>
                </div>
                
                </>
             }
       
             {error && <p role="alert" className="px-2 text-dense text-destructive">{error}</p>}
             {projectViewsEnabled && !confirming && !legacySmartLabel && (
               <div className="border-t border-light-black-border-1 px-2 py-2">
                 {hasProjectView ? (
                   <p className="text-dense text-text-light-gray">Project view ready. Tag renames update it.</p>
                 ) : (
                   <button
                     type="button"
                     disabled={!title.trim()}
                     className="border-0 bg-transparent p-0 text-dense text-text-light-gray hover:text-white-black disabled:opacity-50"
                     onClick={() => updateLabel(true)}
                   >
                     Create project view
                   </button>
                 )}
               </div>
             )}
             {deleteModal && (
               <ConfirmDialog
                 id="confirm-delete-tag"
                 icon={Trash2}
                 message={<>Delete the tag <strong>{label.value}</strong>? It is removed from every task using it.</>}
                 confirmLabel="Delete tag"
                 onConfirm={deleteTag}
                 onCancel={() => setDeleteModal(false)}
               />
             )}
       
             <ModalFooter className={`${!confirming?"visible":"hidden"} flex items-center justify-between border-t border-light-black-border-1 px-4 py-2`}>
               <button
                 type="button"
                 className="cursor-pointer border-0 bg-transparent p-0 text-dense text-destructive hover:text-destructive/80"
                 onClick={() => setDeleteModal(true)}
               >
                 Delete tag
               </button>

               <button
                 type="button"
                 disabled={!title.trim() || (legacySmartLabel && (!prompt.trim() || prompt.length > MAX_AI_PROMPT_LENGTH))}
                 className="inline-flex h-[28px] cursor-pointer items-center justify-center rounded-sm border-0 bg-label-span px-3 text-dense font-medium text-white-black hover:bg-hover-active disabled:cursor-not-allowed disabled:opacity-50"
                 onClick={() => {
                 updateLabel()
               }}>
                 Save
               </button>
             </ModalFooter>
           </ModalBody>
        </ModalContainerCustom>
       );
       
}

export default EditSingleLabel
