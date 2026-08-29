import { ModalContainerCustom, ModalHeaderComp, ModalInput, ModalListContainer, ModalRowElementContainer } from "@/components/Common/CommonModalComponents";
import useKanbanViews from "@/hooks/Homepage/Views/useKanbanViews";

import { currentProjectAtom } from "@/store";
import styles from '@/styles/linksModal.module.scss'
import { getActiveSortingModeFromProject, getActiveSortingOrderFromProject, getActiveSortingStackFromProject, MAX_SORT_LEVELS } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import type { SortingMode, SortingOrder } from "@prisma/client";
import { ChangeEvent, Fragment, useEffect, useRef, useState } from "react";
import { ArrowDownNarrowWide, ArrowDownWideNarrow, Check, X } from "lucide-react";
import { ModalBody } from "reactstrap";
import { useRecoilState } from "@/lib/state";
import { sortingModeLabel, TBoardSortingLevel } from "@/models/Views/model";

type Props = {
    closeHandler: (refresh?: boolean) => void;
    sort?: TBoardSortingLevel | null;
    onSortChange?: (sort: TBoardSortingLevel | null) => void | Promise<void>;
    maxLevels?: number;
}

const ascendingSortingModes = new Set<SortingMode>([
    "DueDate",
    "CreatedAt",
    "Assignee",
    "Title",
    "TicketNumber",
])

const BoardPriorityMode = (props: Props) => {
    const [_currentProject, __] = useRecoilState(currentProjectAtom)
    const { setBoardSortingViewAndReturn } = useKanbanViews(_currentProject)
    const { closeHandler, onSortChange, sort, maxLevels = MAX_SORT_LEVELS } = props
    const isControlled = onSortChange !== undefined

    // ---------------- refs
    const currentHoveredDiv = useRef<number | null>(null);
    const teamRef = useRef<HTMLDivElement>(null);
    const debounceTimeout = useRef<NodeJS.Timeout | null>(null);
    // Serializes the view writes. Add/remove/direction each fire their own request, and two in
    // flight at once can land out of order, leaving the board on an older level set than the
    // popover shows. Chaining keeps click order, so the last click is the last write.
    const writeQueue = useRef<Promise<unknown>>(Promise.resolve());
    const activeSortingView = sort?.mode ?? getActiveSortingModeFromProject(_currentProject)
    const activeSortingOrder = sort?.order ?? getActiveSortingOrderFromProject(_currentProject)

    // ---------------- state handlers
    const [keyboardControls, enableKeyboardControls] = useState<boolean>(false)
    const [keyword, setKeyword] = useState('');
    const [loading, setLoading] = useState<boolean>(false);
    const [modal, _] = useState<boolean>(true);
    const [levels, setLevels] = useState<TBoardSortingLevel[]>(
        isControlled
            ? sort ? [sort] : []
            : activeSortingView === "Manual"
            ? []
            : [{ mode: activeSortingView, order: activeSortingOrder }, ...getActiveSortingStackFromProject(_currentProject)]
    );
    const [selectedPriority, setSelectedPriority] = useState<SortingMode>();
    const priorityModes: SortingMode[] = ["UpdatedAt", "Priority", "DueDate", "Size", "Assignee", "Title", "TicketNumber", "TimeInColumn", "TimeOnBoard", "TimeWithoutComment", "CreatedAt", "SectionChangedAt", "LastCommentAt", "Manual"]
    const [filteredPriorities, setFilteredPriorities] = useState<SortingMode[]>(priorityModes);

    const onKeyChange = (e: ChangeEvent<HTMLInputElement>) => {

        setKeyword(e.target.value);
    }
    const handleToggle = () => {
        // setModal(!modal)
        closeHandler()

    }

    const persistLevels = async (nextLevels: TBoardSortingLevel[], closeAfter = false) => {
        setLevels(nextLevels)
        if (isControlled) {
            await onSortChange?.(nextLevels[0] ?? null)
            if (closeAfter) closeHandler(true)
            return
        }
        if (!_currentProject) return
        const [primary, ...stack] = nextLevels
        writeQueue.current = writeQueue.current
            .catch(() => {})
            .then(() =>
                setBoardSortingViewAndReturn(
                    _currentProject,
                    primary?.mode ?? "Manual",
                    primary?.order ?? activeSortingOrder,
                    stack
                )
            )
        await writeQueue.current
        if (closeAfter) closeHandler(true)
    }

    const handleSortOrder = (index: number, order: SortingOrder) => {
        const nextLevels = levels.map((level, levelIndex) =>
            levelIndex === index ? { ...level, order } : level
        )
        persistLevels(nextLevels)
    }

    const removeLevel = (index: number) => {
        persistLevels(levels.filter((_, levelIndex) => levelIndex !== index))
    }

    // -------------------- ON MODAL LOAD
    const onOpenHandler = async () => {
        // setLoading(true)
        enableKeyboardControls(true) // force focus on input field  
    }

    // ==================== set priority api handler
    const setPriorirty = async (sorting_mode: SortingMode) => {
        try {
            if (sorting_mode === "Manual") {
                await persistLevels([], true)
                return
            }
            if (levels.length === maxLevels || levels.some((level) => level.mode === sorting_mode)) return
            const sorting_order: SortingOrder = ascendingSortingModes.has(sorting_mode)
                ? "Ascending"
                : "Descending"
            // Stay open after adding a level: stacking is the point, and closing would force a
            // reopen for every tie-breaker. Manual (above) is terminal, so it still closes.
            setKeyword('')
            await persistLevels(
                [...levels, { mode: sorting_mode, order: sorting_order }],
                maxLevels === 1
            )
        } catch (error) {
            console.log("🚀 ~ setPriorirty ~ error:", error)

        }
    }

    // ================================ handle key down
    const handleKeyDown = (e: KeyboardEvent) => {
        const index = filteredPriorities.findIndex(item => item === selectedPriority)

        // if (e.key === 'Enter' && filteredPriorities.length > 0) {
        //     console.log("i had submitted bro this is dangerous")
        //     // createBoard(title, selectedPriority.id, selectedPriority.googleAccountId)
        // }
        if (e.key === "Tab") {
            e.preventDefault()
            if (!levels.length) return
            const lastIndex = levels.length - 1
            handleSortOrder(
                lastIndex,
                levels[lastIndex].order === "Ascending" ? "Descending" : "Ascending"
            )
            return
        }
        if (e.key === "Enter") {
            // set the priority.
            // send true to the closhandler
            if (selectedPriority) setPriorirty(selectedPriority)
        }
        if (e.key === "j" || e.key === "ArrowDown") {
            if (selectedPriority) {
                if (index === -1 || index === (filteredPriorities.length - 1)) {
                    // setSelectedPriority(filteredPriorities[0])
                    // document.getElementById(`inbox-${_notifications[0].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                } else {
                    setSelectedPriority(filteredPriorities[index + 1])
                    scrollToRow(index+1)
                    // document.getElementById(`command-${index + 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }

            }
        }

        if(e.key === "ArrowLeft"){
            e.preventDefault()
            const lastIndex = levels.length - 1
            if(lastIndex >= 0 && levels[lastIndex].order === "Descending") handleSortOrder(lastIndex, "Ascending")
        }

        if(e.key === "ArrowRight"){
            e.preventDefault()
            const lastIndex = levels.length - 1
            if(lastIndex >= 0 && levels[lastIndex].order === "Ascending") handleSortOrder(lastIndex, "Descending")
        }

        if (e.key === "k" || e.key === "ArrowUp") {
            if (selectedPriority) {
                if (index <= 0) {
                    // setSelectedInbox(_notifications[_notifications.length - 1])
                    // document.getElementById(`inbox-${_notifications[_notifications.length - 1].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                } else {
                    setSelectedPriority(filteredPriorities[index - 1])
                    scrollToRow(index-1)
                    // document.getElementById(`command-${index - 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }

            }
        }
    }

    const scrollToRow = (index: number) =>
        document
          .getElementById(`priority_mode:${index}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });

    const handleMouseLeave = () => {
        // Clear any existing debounceTimeout
        if (debounceTimeout.current) {
            clearTimeout(debounceTimeout.current);
            debounceTimeout.current = null;
        }

        // Start a new debounceTimeout to remove focus after a short delay (e.g., 100ms)
        debounceTimeout.current = setTimeout(() => {
            if (currentHoveredDiv.current !== null && teamRef.current) {
                (teamRef.current as HTMLDivElement)?.blur();
                currentHoveredDiv.current = null;
            }
        }, 100);
    };

    useEffect(() => {
        return () => {
            // Clear the debounceTimeout when the component unmounts
            if (debounceTimeout.current) {
                clearTimeout(debounceTimeout.current);
            }

        };

    }, []);

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [document.activeElement, keyword, selectedPriority, filteredPriorities, levels]);

    useEffect(() => {
        // console.log("🚀 ~ useEffect ~ filteredPriorities_:")
        const filteredPriorities_ = priorityModes.filter((priority) =>
            (priority === "Manual" || !levels.some((level) => level.mode === priority)) &&
            (levels.length < maxLevels || priority === "Manual") &&
            (keyword.length === 0 || sortingModeLabel(priority).toLowerCase().indexOf(keyword.toLowerCase()) > -1)
        )
        setFilteredPriorities(filteredPriorities_)
        setSelectedPriority(filteredPriorities_[0])
        document.getElementById(`priority_mode:0`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })

    }, [keyword, levels])

    return (
        <ModalContainerCustom
            fade={false}
            id="priorityModal"
            isOpen={modal}
            show={true} onOpened={onOpenHandler}
            autoFocus={false}
            toggle={handleToggle}
            className={`paletteModalSizing ${styles.links_modal} sm:min-w-[560px] sm:top-[24%] sm:max-h-[450px]`}>
            <ModalHeaderComp header={loading ? "Sorting! Please wait." : `Sort`} >
                {levels.length > 0 && (
                    <span className="whitespace-nowrap text-meta font-normal text-text-light-gray">
                        {levels.length} of {maxLevels} levels
                    </span>
                )}
            </ModalHeaderComp>

            <ModalBody className='  p-0 rounded-b-[4px]  '>
                {
                    loading
                        ?
                        <></>
                        :

                        <>
                            {levels.length > 0 && (
                                <ModalListContainer id="active-sort-levels">
                                    {levels.map((level, index) => (
                                        <Fragment key={level.mode}>
                                            <ModalRowElementContainer
                                                onClick={() => {}}
                                                isSelected={false}
                                                className="cursor-default"
                                            >
                                                <div className="flex flex-grow items-center space-x-4">
                                                    <span className="text-micro text-[#C2CFA5]">{index + 1}</span>
                                                    <p className="font-medium">{sortingModeLabel(level.mode)}</p>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <ToggleSortingOrder
                                                        selectedOption={level.order}
                                                        handleSortOrder={(order) => handleSortOrder(index, order)}
                                                    />
                                                    <button
                                                        type="button"
                                                        aria-label={`Remove ${sortingModeLabel(level.mode)} sort`}
                                                        onClick={(event) => {
                                                            event.stopPropagation()
                                                            removeLevel(index)
                                                        }}
                                                        className="text-text-light-gray"
                                                    >
                                                        <X size={14} strokeWidth={1.75} />
                                                    </button>
                                                </div>
                                            </ModalRowElementContainer>
                                            {index < levels.length - 1 && (
                                                <li className="pl-[41px] text-micro text-text-light-gray">then</li>
                                            )}
                                        </Fragment>
                                    ))}
                                </ModalListContainer>
                            )}
                            <div className="border-b border-light-black-border-1">
                                <ModalInput
                                    onChange={onKeyChange}
                                    value={keyword}
                                    placeholder={levels.length > 0 ? "Add another sort…" : "How do you want to sort?"}
                                />
                            </div>
                            <ModalListContainer
                                id="users-list"
                                className="max-h-[364px]"
                            >
                                {
                                    levels.length === maxLevels && (
                                        <li className="px-[18px] py-2 text-meta font-normal text-text-light-gray">
                                            Remove a level to add another.
                                        </li>
                                    )
                                }
                                {
                                    filteredPriorities
                                        .map((priority, index: number) => (
                                            <ModalRowElementContainer
                                                id={`priority_mode:${index}`}
                                                key={`priority_mode:${priority}`}
                                                onMouseLeave={handleMouseLeave}
                                                onMouseEnter={() => setSelectedPriority(priority)}
                                                onClick={() => { setPriorirty(priority) }}
                                                isSelected={selectedPriority === priority}
                                            >
                                                <div className="flex-grow flex space-x-4 items-center">

                                                <p className="font-medium">
                                                  {sortingModeLabel(priority)}
                                                </p>
                                                </div>
                                                {
                                                    (levels.length === 0 && priority === "Manual") ? <Check size={16} strokeWidth={1.75} /> : null
                                                }
                                            </ModalRowElementContainer>
                                           
                                        ))
                                }
                            </ModalListContainer>

                        </>
                }

            </ModalBody>
        </ModalContainerCustom>
    )
}

const ToggleSortingOrder = ({
    selectedOption,
    handleSortOrder,
  }: {
    selectedOption: SortingOrder;
    handleSortOrder: (order: SortingOrder) => void;
  }) => {
    return (
      <div
        className="flex gap-2 text-meta cursor-pointer items-center text-white-black"
        onClick={() =>
          handleSortOrder(
            selectedOption === "Ascending" ? "Descending" : "Ascending"
          )
        }
      >
        <span>{selectedOption === "Ascending" ? "Ascending" : "Descending"}</span>
        {selectedOption === "Ascending" ? (
          <ArrowDownNarrowWide strokeWidth={1.75} size={14} />
        ) : (
          <ArrowDownWideNarrow strokeWidth={1.75} size={14} />
        )}
      </div>
    );
  };

export default BoardPriorityMode;
