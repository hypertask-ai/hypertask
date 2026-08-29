import { ILabel } from "@/models/model";
import {  currentProjectAtom, currentUserAtom } from "@/store";
import {  useRef, useState } from "react";
import { Filter, Search, Settings, Sparkles } from "lucide-react";
import { ModalBody, ModalFooter } from "reactstrap";
import { useRecoilState } from "@/lib/state";
import { useQueryClient } from "@tanstack/react-query";
import { projectLabelsPrefix, useGetAllProjectLabels } from "@/hooks/MultiPages/useGetAllProjectLabels";
import EditSingleLabel from "./EditSingleLabel";
import useFilters from "@/hooks/Homepage/Filters/useFilters";
import { getActiveColumnsViewFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { getProtectedSmartLabelIds } from "@/lib/smartSplits";
import globalAPIHandlers from "@/utils/api/global";
import ConfirmModal from "../Common Modals/ConfirmActionModal";
import { ModalContainerCustom, ModalHeaderComp } from "@/components/Common/CommonModalComponents";
import TaskLabelComponent from "../CreateLabel/TaskLabelComponent";
type Props = {
    // updateColumn: (arg:any) => void,
    onClose :()=>void
// 
}

const ManageLabels = ({onClose}: Props) => {
  const queryClient = useQueryClient();   
// 
    // const {updateColumn, launchProps} = props
    const [currentProject, _] = useRecoilState(currentProjectAtom)
    const [currentUser] = useRecoilState(currentUserAtom)
    const [modal] = useState<boolean>(true);
    const [editMode, setEditMode] = useState<boolean>(false);
    const [selectedLabel, setSelectedLabel] = useState<ILabel>();
    const [selectedLabelIds, setSelectedLabelIds] = useState<Set<string>>(() => new Set());
    const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
    const [deleting, setDeleting] = useState<boolean>(false);
    const [searchTerm, setSearchTerm] = useState<string>("");
    const [sortMode, setSortMode] = useState<"alphabetical" | "most" | "fewest">("alphabetical");
    const searchInputRef = useRef<HTMLInputElement>(null);
    const {data:labelsFromTQ} = useGetAllProjectLabels(currentProject?.id)
    const labels: ILabel[] = Array.isArray(labelsFromTQ) ? labelsFromTQ : [];
    const projectSavedViews = currentProject?.project_view?.allViews;
    const savedViewsMetadataReady = Array.isArray(projectSavedViews);
    const protectedSmartLabelIds = getProtectedSmartLabelIds(
      savedViewsMetadataReady ? projectSavedViews : undefined,
      labels
    );
    const { addFilter } = useFilters();

    const SelectScreens =(label:ILabel)=>{
      setEditMode(true)
      setSelectedLabel(label)
    }

    const viewOnBoard = async (label: ILabel) => {
      if (!currentProject) return;
      const activeColumns = getActiveColumnsViewFromProject(currentProject);
      const visibleColumns = (activeColumns?.length
        ? activeColumns
        : currentProject.section ?? currentProject.sections ?? []
      ).map(
        (section) => ({ ...section, visibility: true })
      );
      await addFilter("Labels", label, visibleColumns);
      onClose();
    };

    const onEditClose = (refresh?:boolean)=>{
      if (refresh) {
        queryClient.refetchQueries({queryKey:[projectLabelsPrefix, currentProject?.id]})
        queryClient.refetchQueries({queryKey:["inbox"]})

      }
      setEditMode(false)
      setSelectedLabel(undefined)
    }

    // Filter labels based on search term
    const filteredLabels = labels.filter((label: ILabel) =>
      label.value.toLowerCase().includes(searchTerm.toLowerCase())
    ) || [];
    if (sortMode !== "alphabetical") {
      filteredLabels.sort((a: ILabel, b: ILabel) => {
        const countDifference = (a._count?.task ?? 0) - (b._count?.task ?? 0);
        return (sortMode === "most" ? -countDifference : countDifference) ||
          a.value.localeCompare(b.value);
      });
    }
    const hasVisibleUnusedLabels = filteredLabels.some((label: ILabel) =>
      !protectedSmartLabelIds.has(label.id) && (label._count?.task ?? 0) === 0
    );
    const editableFilteredLabels = filteredLabels.filter(
      (label: ILabel) => !protectedSmartLabelIds.has(label.id)
    );
    const allVisibleSelected = editableFilteredLabels.length > 0 &&
      editableFilteredLabels.every((label: ILabel) => selectedLabelIds.has(label.id));
    const someVisibleSelected = editableFilteredLabels.some((label: ILabel) =>
      selectedLabelIds.has(label.id)
    );
    const selectedLabelCount = selectedLabelIds.size;
    const selectedLabelText = `${selectedLabelCount} ${selectedLabelCount === 1 ? "tag" : "tags"}`;

    const toggleLabelSelection = (labelId: string) => {
      setSelectedLabelIds((current) => {
        const next = new Set(current);
        if (next.has(labelId)) next.delete(labelId);
        else next.add(labelId);
        return next;
      });
    };

    const toggleAllVisible = () => {
      setSelectedLabelIds((current) => {
        const next = new Set(current);
        editableFilteredLabels.forEach((label: ILabel) => {
          if (allVisibleSelected) next.delete(label.id);
          else next.add(label.id);
        });
        return next;
      });
    };

    const selectUnusedVisible = () => {
      setSelectedLabelIds((current) => {
        const next = new Set(current);
        filteredLabels.forEach((label: ILabel) => {
          if (!protectedSmartLabelIds.has(label.id) && (label._count?.task ?? 0) === 0) next.add(label.id);
        });
        return next;
      });
    };

    const deleteSelectedLabels = async () => {
      setDeleting(true);
      setShowDeleteConfirm(false);
      try {
        const deletableIds = new Set(
          labels
            .filter((label: ILabel) => !protectedSmartLabelIds.has(label.id) && selectedLabelIds.has(label.id))
            .map((label: ILabel) => label.id)
        );
        for (const labelId of deletableIds) {
          await globalAPIHandlers.deleteLabelAPI(labelId, currentProject?.id, currentUser?.id);
        }
        await queryClient.refetchQueries({queryKey:[projectLabelsPrefix, currentProject?.id]});
        await queryClient.refetchQueries({queryKey:["projectsAll"]});
        setSelectedLabelIds(new Set());
      } finally {
        setDeleting(false);
      }
    };

      return (
        <div>
          {
            !editMode?

            <ModalContainerCustom
              // onKeyDown={handleKeyDown} 
              isOpen={modal}  
              fade={false}
              // toggle={handleToggle}
              toggle={onClose}
              onOpened={() => searchInputRef.current?.focus()}
              show={true}
              // onOpened={()=>getCurrentProjectSections()}  
              autoFocus={false}
              id="manage-tags-modal"
              className="paletteModalSizing sm:min-w-[560px] sm:top-[24%] max-h-[400px]">
              <ModalHeaderComp header="Manage Tags" />
              <ModalBody className="bg-modalBackground px-4 text-dense">
                
                {/* Search Bar */}
                <div className="relative bg-transparent mb-2 ">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search strokeWidth={1.75} className="h-4 w-4 text-gray-400" />
                  </div>
                  <input
                    ref={searchInputRef}
                    type="text"
                    autoComplete="off"
                    data-1p-ignore
                    data-lpignore="true"
                    data-form-type="other"
                    placeholder="Search tags..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="block h-[44px] w-full rounded-sm bg-hoverCardBackground py-2 pl-10 pr-3 text-content font-normal leading-5 placeholder:text-text-light-gray outline-none"
                  />
                </div>
                <div className="max-h-[364px] overflow-y-scroll">
                  <div className="mx-1.5 flex h-[36px] items-center justify-between gap-3 rounded-sm px-3 text-dense text-text-light-gray">
                    <label className="flex cursor-pointer items-center gap-3">
                      <input
                        ref={(checkbox) => {
                          if (checkbox) checkbox.indeterminate = someVisibleSelected && !allVisibleSelected;
                        }}
                        type="checkbox"
                        aria-label="Select all visible tags"
                        checked={allVisibleSelected}
                        disabled={editableFilteredLabels.length === 0 || deleting}
                        onChange={toggleAllVisible}
                        className="h-4 w-4 shrink-0 cursor-pointer accent-hypertasks-purple disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      <span>Select all</span>
                    </label>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        disabled={deleting || !hasVisibleUnusedLabels}
                        onClick={selectUnusedVisible}
                        className="text-text-light-gray hover:text-white-black disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Select 0 tickets
                      </button>
                      <select
                        aria-label="Sort tags"
                        value={sortMode}
                        onChange={(event) => setSortMode(event.target.value as typeof sortMode)}
                        className="rounded-sm bg-hoverCardBackground px-2 py-1 text-content text-text-light-gray outline-none"
                      >
                        <option value="alphabetical">Alphabetical</option>
                        <option value="most">Most tickets</option>
                        <option value="fewest">Fewest tickets</option>
                      </select>
                    </div>
                  </div>
                  {filteredLabels.length > 0 ? filteredLabels.map((label:ILabel)=>
                    
                    <div className="mx-1.5 flex h-[36px] items-center justify-between rounded-sm px-3 text-dense"
                      key={label.id}>
                        <div className="flex min-w-0 items-center gap-3">
                          <input
                            type="checkbox"
                            aria-label={`Select ${label.value}`}
                            checked={selectedLabelIds.has(label.id)}
                            disabled={deleting || protectedSmartLabelIds.has(label.id)}
                            title={protectedSmartLabelIds.has(label.id) ? "Manage smart splits in Manage views" : undefined}
                            onChange={() => toggleLabelSelection(label.id)}
                            className="h-4 w-4 shrink-0 cursor-pointer accent-hypertasks-purple disabled:cursor-not-allowed disabled:opacity-50"
                          />
                          <span className="flex min-w-0 items-center gap-2">
                            <TaskLabelComponent labelValue={label.value} nowrap />
                            {label.ai_prompt ? (
                              <Sparkles
                                size={14}
                                strokeWidth={1.75}
                                className="shrink-0 text-hypertasks-ai-purple"
                                aria-label="Smart label"
                              />
                            ) : null}
                            <span className="text-text-light-gray">
                              {label._count?.task ?? 0} {(label._count?.task ?? 0) === 1 ? "ticket" : "tickets"}
                              {(label._count?.archived ?? 0) > 0 && ` · ${label._count?.archived} archived`}
                            </span>
                          </span>
                        </div>
                            <div className="flex shrink-0 gap-4 items-center">
                                <Filter
                                  size={16}
                                  strokeWidth={1.75}
                                  className="cursor-pointer"
                                  onClick={() => viewOnBoard(label)}
                                />
                                {!protectedSmartLabelIds.has(label.id) && (
                                  <Settings size={16} strokeWidth={1.75} className="cursor-pointer" onClick={()=>SelectScreens(label)}/>
                                )}
                            </div>
                                
                    </div>
                  )
                  :
                  <>
                    {searchTerm ? `No tags found matching "${searchTerm}"` : "No tags to manage!"}
                  </>
                }
                </div>
                
                  
                
                  
              </ModalBody>
              {selectedLabelCount > 0 && (
                <ModalFooter className="flex justify-between border-t border-border-light-gray-thin bg-modalBackground px-4 py-3">
                  <span className="text-content text-text-light-gray">{selectedLabelText} selected</span>
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={() => setShowDeleteConfirm(true)}
                    className="inline-flex h-[28px] cursor-pointer items-center justify-center gap-2 rounded-sm border-0 bg-transparent px-3 text-dense font-medium text-red-400 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {deleting && (
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />
                    )}
                    Delete {selectedLabelText}
                  </button>
                </ModalFooter>
              )}
              {showDeleteConfirm && (
                <ConfirmModal
                  header={`Delete ${selectedLabelText}?`}
                  content={`Deleting ${selectedLabelText} is permanent. The tags will be removed from every ticket using them.`}
                  confirmButtonContent={`Delete ${selectedLabelText}`}
                  onConfirm={() => void deleteSelectedLabels()}
                  onCancel={() => {
                    setShowDeleteConfirm(false);
                    searchInputRef.current?.focus();
                  }}
                  onTaskPage
                  customClassName="sm:min-w-[500px] xs:max-h-[600px] z-[90000000] relative sm:top-[10px]"
                />
              )}
            </ModalContainerCustom>

            :
            selectedLabel&& <EditSingleLabel label={selectedLabel} onClose={onEditClose}/>
          }
        </div>
    )
}

export default ManageLabels;
