import { ModalContainerCustom, ModalHeaderComp, ModalInput, ModalRowElementContainer } from "@/components/Common/CommonModalComponents";
import { ChangeEvent, useState } from "react";

type Props = {
    updateBoard: (title: string) => void;
}

const EditBoard = (props: Props) => {
    const { updateBoard } = props
    const [title, setTitle] = useState('')

    const onKeyChange = (e: ChangeEvent<HTMLInputElement>) => {
        setTitle(e.target.value);
    }

    const onSubmit = () => {
        if (title.length === 0) return;

        updateBoard(title)
    }

    return (
        <ModalContainerCustom
            fade={false}
            show={true}
            isOpen={true}
            id="addColumnModal"
            className="paletteModalSizing sm:min-w-[560px] sm:top-[24%]"
        >

            <ModalHeaderComp header="Change board name" className="px-[20px]" />

            <div
                className="rounded-[5px] bg-modalBackground p-0"
            >
                <ModalInput
                    onChange={onKeyChange}
                    value={title}
                    placeholder="New board name"
                    onKeyDown={(e: any) => {
                        if (e.key === 'Enter') {
                            onSubmit()
                        }
                    }}
                />
                <ModalRowElementContainer
                    id={`editboard-htc-option-`}
                    isSelected={true}
                >
                    <span>{`Change name to '${title}'`}</span>

                </ModalRowElementContainer>
            </div>

        </ModalContainerCustom>
    )
}

export default EditBoard;
