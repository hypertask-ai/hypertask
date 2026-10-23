import { ModalContainerCustom, ModalHeaderComp, ModalInput } from '@/components/Common/CommonModalComponents';
import { useGetAllProjectsMinimal } from '@/hooks/MultiPages/useGetAllProjectsMinimal';
import useHandleMouseGlobal from '@/hooks/General/useHandleMouse';
import { IProject } from '@/models/model';
import { inViewObjectAtom } from '@/store';
import { returnActiveOrDefaultColumnSections } from '@/utils/helperFunctions/multiPages';
import axios from 'axios';
import { useFormik } from 'formik';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { EyeOff } from "lucide-react";
import { ModalBody } from 'reactstrap';
import { useRecoilState } from '@/lib/state';
import { moveTaskToDifferentBoardAPI } from '@/lib/constants/APIRouteConstants';
import { useFlag } from '@/hooks/useFlag';
import { HTPR_7053_COMPOSE_BOARD_CHIP_FLAG } from '@/lib/flags/keys';

interface ICreateTask {
    projectId: number;
    sectionId: number
}
interface IScreens {
    value: 0 | 1 | 2,
    next: 1 | 2 | null,
    prev: 0 | 1 | null,
    title: "Select Board" | "Select Column"
    callback?: (callbackData: number | string) => void;
    data: any[] | [] | undefined
}

type IProps = {
    closeHTC: () => void;
    onSelectBoard?: (boardId: number) => void;
    boards?: IProject[];
}
const MoveTaskGlobal = (props: IProps) => {
    const boardChipEnabled = useFlag(HTPR_7053_COMPOSE_BOARD_CHIP_FLAG);
    const composeBoardPicker = boardChipEnabled && Boolean(props.onSelectBoard);
    const projects = useGetAllProjectsMinimal(["projectsAllMinimal"], undefined, { enabled: !composeBoardPicker });
    const data = composeBoardPicker ? props.boards : projects.data;
    const isLoading = composeBoardPicker ? !props.boards : projects.isLoading;
    const [inViewObject, __] = useRecoilState(inViewObjectAtom);

    const router = useRouter()
    const pathname = usePathname()
    const [currentScreen, setCurrentScreen] = useState<IScreens>({
        value: 0,
        next: 1,
        prev: null,
        title: "Select Board",
        data: undefined,
    });

    const [modal, ___] = useState<boolean>(true);
    const [keyboardControls, enableKeyboardControls] = useState<boolean>(false)

    const [redirectingToTask, setRedirectingToTask] = useState<boolean>(false);

    const formik = useFormik({
        initialValues: {
            projectId: 0,
            sectionId: 0
        },

        onSubmit: (values) => {
            handleFormSubmit(values);
        },
    });
    console.log("🚀 ~ handleFormSubmit ~ body.formik.values:", formik.values)

    const onOpenHandler = async () => {
        enableKeyboardControls(true)
    }
    const handleToggle = () => {
        props.closeHTC()
    }
    const handleFormSubmit = async (values: ICreateTask) => {
        try {
            console.log('Submitting...', values);
            setRedirectingToTask(true)
            const body = {
                sectionId: formik.values.sectionId,
                projectId: formik.values.projectId,
                id: inViewObject.taskId,
                currentProjectId: inViewObject.taskProjectId
            }
            const response = await axios.post(moveTaskToDifferentBoardAPI, body)
            console.log("🚀 ~ file: index.tsx:60 ~ handleFormSubmit ~ response:", response)

            if (response.status === 200) {
                console.log('Submission successful!');
                if (pathname?.startsWith('/detail')) {
                    router.replace(`/detail/project-${formik.values.projectId}/${response.data.uniqueIndex}`)
                } else {
                    router.push(`/detail/project-${formik.values.projectId}/${response.data.uniqueIndex}`)
                }
            }
        } catch (error) {
            console.error('Submission failed:', error);
        } finally {
            props.closeHTC()

        }
    };

    useEffect(() => {
        setCurrentScreen({
            value: 0,
            next: 1,
            prev: null,
            title: "Select Board",
            data: data
        })
    }, [data])

    const handleCallBackFromScreens = (currentScreenValue: number, nextScreenValue: number | null, callbackIndexorString: string | number) => {

        if (composeBoardPicker && currentScreenValue === 0) {
            const board = data?.[callbackIndexorString as number];
            if (board) props.onSelectBoard?.(board.id);
            return;
        }
        if (currentScreenValue === 0) {
            formik.setValues({
                ...formik.values,
                projectId: data[callbackIndexorString].id
            })
            setCurrentScreen({
                ...currentScreen,
                value: 1,
                next: 2,
                prev: 0,
                title: "Select Column",
                data: returnActiveOrDefaultColumnSections(data[callbackIndexorString])??[]
            })
        }
        else if (currentScreenValue === 1) {
            formik.setValues({
                ...formik.values,
                sectionId: callbackIndexorString as number
            }).then(() => {
                formik.submitForm()
            })
        }

    }

    return (
        <ModalContainerCustom
            fade={false}
            id="estimateModal"
            isOpen={modal}
            show={true} onOpened={onOpenHandler}
            autoFocus={false}
            toggle={handleToggle}
            className="paletteModalSizing sm:min-w-[560px] sm:top-[24%] sm:max-h-fit">

            <ModalHeaderComp header={redirectingToTask ? "Redirecting to Task" : currentScreen.title} />
            {
                !isLoading && data && !redirectingToTask &&
                <>
                    <FilterableMenuScreen
                        screenCallback={handleCallBackFromScreens}
                        composeBoardPicker={composeBoardPicker}
                        onClose={props.closeHTC}
                        {...currentScreen}
                    />
                </>

            }

        </ModalContainerCustom>
    );
}

export default MoveTaskGlobal;


interface FilterableMenuScreenProps {
    screenCallback: (currentScreenValue: number, nextScreenValue: number | null, indexOfSelectedRow: string | number) => void;
    composeBoardPicker?: boolean;
    onClose?: () => void;
}

const FilterableMenuScreen: React.FC<FilterableMenuScreenProps & IScreens> = ({ title, data, value, next, prev, screenCallback, composeBoardPicker = false, onClose }) => {
    const boardChipEnabled = useFlag(HTPR_7053_COMPOSE_BOARD_CHIP_FLAG);
    const composePicker = boardChipEnabled && composeBoardPicker;

    const [keyword, setKeyword] = useState<string>("");
    const [selectedIndex, setSelectedIndex] = useState<number>(0)
    const [filteredData, setFilteredData] = useState<typeof data>([])
    const currentHoveredDiv = useRef<number | null>(null);
    const teamRef = useRef<HTMLDivElement>(null);
    const debounceTimeout = useRef<NodeJS.Timeout | null>(null);

    const handleKeyDown = (e: KeyboardEvent) => {
        if (composePicker) {
            if (e.isComposing) return;
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopImmediatePropagation();
                onClose?.();
                return;
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                e.stopImmediatePropagation();
                setSelectedIndex(index => Math.max(0, Math.min((filteredData?.length ?? 0) - 1, index + (e.key === "ArrowDown" ? 1 : -1))));
                return;
            }
            if (e.key === "j" || e.key === "k") return;
            if (e.key === "Enter") {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (!filteredData?.[selectedIndex]) return;
            }
        }
        if (e.key === "Tab") {
            e.preventDefault()
            return
        }
        else if (e.key === "Enter" && data) {
            if (value === 0 && filteredData) {
                setKeyword("")
                const indexof = data.findIndex(item => item.id === filteredData[selectedIndex].id)
                console.log("🚀 ~ file: index.tsx:204 ~ handleKeyDown ~ indexof:", indexof)
                if (indexof > -1) submitForCallback(indexof)
            }
            else if (value === 1 && filteredData && filteredData[selectedIndex]) {
                setKeyword("")
                submitForCallback(filteredData[selectedIndex].id)
            }
            else if (value === 2 && keyword.length > 0) {
                submitForCallback(keyword)
                setKeyword("")
            }

        }
        else if (e.key === "j" || e.key === "ArrowDown") {
            if (data) {
                if (selectedIndex === -1 || selectedIndex === (data.length - 1)) {
                } else {
                    setSelectedIndex(prev => prev + 1)
                    document.getElementById(`command-${selectedIndex + 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }
            }

        }

        else if (e.key === "k" || e.key === "ArrowUp") {
            if (data) {
                if (selectedIndex <= 0) {
                } else {
                    setSelectedIndex(prev => prev - 1)
                    document.getElementById(`command-${selectedIndex - 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }
            }

        }
    }

    const submitForCallback = (callbackData: any, findIndex?: boolean) => {
        if (data && findIndex && filteredData && value === 0) {
            const indexof = data.findIndex(item => item.id === filteredData[callbackData].id)
            if (indexof > -1) screenCallback(value, next, indexof)
        }
        else screenCallback(value, next, callbackData)
    }
    const { handleMouseEnter, handleMouseLeave, handleMouseMove, elRef } = useHandleMouseGlobal({ setSelectedIndex })

    useEffect(() => {
        return () => {
            if (debounceTimeout.current) {
                clearTimeout(debounceTimeout.current);
            }

        };

    }, []);

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown, composePicker);
        return () => document.removeEventListener('keydown', handleKeyDown, composePicker);
    }, [document.activeElement, keyword, selectedIndex, filteredData, value, composePicker, onClose]);

    useEffect(() => {
        if (composePicker) document.getElementById(`command-${selectedIndex}`)?.scrollIntoView({ block: 'nearest' });
    }, [composePicker, selectedIndex]);


    const handleKeyWordChange = (e: any) => {
        setKeyword(e.target.value)
        const keyInput = e.target.value;
        if (data && value !== 2) {
            const filteredData_ =
                keyInput.length > 0
                    ? data.filter((item) =>
                        value === 0
                            ? item.title
                                .toLowerCase()
                                .trim()
                                .includes(keyInput.toLocaleLowerCase().trim())
                            : item.section_title
                                .toLowerCase()
                                .trim()
                                .includes(keyInput.toLocaleLowerCase().trim())
                    )
                    : data;
            setFilteredData(filteredData_);
            setSelectedIndex(0);
            document
                .getElementById(`command-0`)
                ?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
    };

    useEffect(() => {
        document.getElementById(`command-0`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        document.getElementById(`input-addTask`)?.focus()
        data && setFilteredData([...data])
        setSelectedIndex(0)
    }, [data])
    return (
        <>
            <ModalBody className='text-white-black p-0 rounded-b-[4px]  '>
                <ModalInput
                    id='input-addTask'
                    onChange={handleKeyWordChange}
                    value={keyword}
                    placeholder={"Search"}
                />
                {
                    value !== 2 && filteredData && filteredData.length > 0 &&
                    <div
                        onMouseMove={handleMouseMove}
                        className="max-h-[364px] overflow-y-scroll scrollbar-none">
                        {
                            filteredData?.map((item, index) => {
                                return (
                                    <div

                                        onClick={() => submitForCallback(value === 0 ? index : item.id, value === 0 ? true : false)}
                                        onMouseLeave={handleMouseLeave}
                                        onMouseEnter={() => handleMouseEnter(index)}
                                        className={`mx-1.5 flex h-[36px] cursor-pointer items-center rounded-sm px-3 text-dense text-white-black transition-all duration-75 ${selectedIndex === index ? "bg-active-modal-element" : "transparent"}`}
                                        id={`command-${index}`}
                                        key={item.id}
                                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span>
                                            {value === 0 ? item.title : item.section_title}
                                        </span>
                                        {item?.visibility === false && <EyeOff size={16} strokeWidth={1.75} />}
                                    </div>
                                )
                            })
                        }
                    </div>

                }
            </ModalBody>
        </>
    )
}
