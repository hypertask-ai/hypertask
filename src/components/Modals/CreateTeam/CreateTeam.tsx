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
        >

            <ModalHeaderComp className="px-[20px]" header={currentScreen === "Create Team" ? "Give your team a name" : "Creating your team!"} />


            {currentScreen === "Create Team" ? (
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