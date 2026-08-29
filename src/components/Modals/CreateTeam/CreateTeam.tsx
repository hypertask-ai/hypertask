import { ModalContainerCustom, ModalHeaderComp, ModalInput, ModalRowElementContainer } from "@/components/Common/CommonModalComponents";
import { ChangeEvent, useEffect, useState } from "react";

type Props = {
    createBoard: (mode: string, title: string, teamId: string | null, googleAccountId: string | null, teamTitle?: string) => void;
}

const CreateTeam = (props: Props) => {
    const { createBoard } = props
    const [title, setTitle] = useState('')
    const [currentScreen, setCurrentScreen] = useState<"Create Team" | "Creating Team">("Create Team")

    const onKeyChange = (e: ChangeEvent<HTMLInputElement>) => {
        setTitle(e.target.value);
    }

    const createTeamHandler = () => {
        if (title === "") return
        setCurrentScreen("Creating Team")
        createBoard("CreateTeamBoard", title, null, null, title)

    }

    const handleKeyDown = (e: KeyboardEvent) => {

        // if (e.key === 'Enter' && filteredTeams.length > 0) {
        //     console.log("i had submitted bro this is dangerous")
        //     // createBoard(title, selectedTeam.id, selectedTeam.googleAccountId)
        // }
        if (e.key === "Tab") {
            e.preventDefault()
            return
        }

    }

    useEffect(() => {

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [title]);

    return (
        <ModalContainerCustom
            fade={false}
            show={true}
            isOpen={true}
            shouldCloseOnClickOutside={true}
            id="addColumnModal"
            // className="p-0 customshadow-4 rounded-[4px] w-[680px] max-h-[400px] bg-[#4E5663] "
        >

            <ModalHeaderComp className="px-[20px]" header={currentScreen === "Create Team" ? "Give your team a name" : "Creating your team!"} />

            {/* ======================================== SCREEN TYPES ================================= */}

            {currentScreen === "Create Team" ? (
                // ---------------------- CREATE TEAM ----------------
                <div className="p-0 rounded-[4px]">
                    <ModalInput

                        onChange={onKeyChange}
                        value={title}
                        placeholder="Team name"
                        onKeyDown={(e: any) => {
                            if (e.key === 'Enter') {
                                createTeamHandler()
                            }
                        }}
                    />
                    {
                        title.length > 0 &&
                        <ModalRowElementContainer
                            id={`create-team`}
                            onClick={createTeamHandler}
                            isSelected={true}
                        >
                            <span>
                                Create Team &quot;{title}&quot;
                            </span>
                        </ModalRowElementContainer>
                      
                    }
                </div>
            ) : (
                <></>
            )}
        </ModalContainerCustom>
    );

}

export default CreateTeam;