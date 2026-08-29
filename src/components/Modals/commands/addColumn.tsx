import { ModalContainerCustom, ModalHeaderComp, ModalInput } from "@/components/Common/CommonModalComponents";
import type { ISection } from "@/models/model";
import { revealBoardColumnAfterRender } from "@/utils/helperFunctions/Views/scrollBoardColumnIntoView";
import { ChangeEvent, useRef, useState } from "react";

type Props = {
    createColumn: (title: string, ranking: string | undefined) => Promise<ISection | undefined>;
    toggleModal: () => void;
}

const AddColumn = (props: Props) => {
    const { createColumn, toggleModal } = props

    const [title, setTitle] = useState('')
    const submitting = useRef(false)

    const onKeyChange = (e: ChangeEvent<HTMLInputElement>) => {
        setTitle(e.target.value);
    }

    // HTPR-5527: this used to read every section first just to compute the new
    // column's rank, off an endpoint that answers 200 with an error body. A bad
    // read left Enter doing nothing at all. The server appends the column after
    // the last section when no rank is given, so there is nothing to fetch.
    const onSubmit = () => {
        const trimmed = title.trim()
        if (trimmed.length === 0 || submitting.current) return;
        submitting.current = true
        void createColumn(trimmed, undefined)
            .then((createdSection) => {
                if (createdSection?.id !== undefined) {
                    revealBoardColumnAfterRender(createdSection.id);
                }
            })
            .catch(() => {
                submitting.current = false;
            })
    }

    return (
        <ModalContainerCustom
            fade={false}
            show={true}
            isOpen={true}
            id="addColumnModal"
            toggle={() => toggleModal()}
            className="paletteModalSizing sm:min-w-[560px] sm:top-[24%]"
        >

            <ModalHeaderComp header="Add Column" className="px-[20px]" />

            <ModalInput
                onChange={onKeyChange}
                value={title}
                placeholder="Column name"
                onKeyDown={(e: any) => {
                    if (e.key === 'Enter') {
                        e.preventDefault()
                        onSubmit()
                    }
                }}
            />
        </ModalContainerCustom >
    )
}

export default AddColumn;
