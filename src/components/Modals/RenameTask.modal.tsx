import {
  ModalContainerCustom,
  ModalHeaderComp,
  ModalInput,
} from "@/components/Common/CommonModalComponents";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { inViewObjectAtom } from "@/store";
import { updateTask } from "@/utils/api/Task Detail";
import { ChangeEvent, useState } from "react";
import { useRecoilValue } from "@/lib/state";

type Props = {
  closeCallback: (title: string) => void;
};

const RenameTaskModal = (props: Props) => {
  const { closeCallback } = props;
  const [title, setTitle] = useState("");
  const inViewObject = useRecoilValue(inViewObjectAtom);
  const currentTitle = inViewObject?.taskTitle ?? "";

  const onKeyChange = (e: ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
  };

  const onSubmit = async () => {
    if (title.length === 0) return;
    try {
      const newTask = {
        title,
        id: inViewObject.taskId,
      };

      updateTask(newTask);
      closeCallback(title);
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <ModalContainerCustom
      fade={false}
      show={true}
      isOpen={true}
      id="rename-task-modal"
      toggle={() => closeCallback(currentTitle)}
      className="paletteModalSizing sm:min-w-[560px] sm:top-[24%]"
    >
      <ModalHeaderComp header={`Rename ${inViewObject.taskTicketNumber ?? ""}`} className="px-[20px]" />

      <ModalInput
        onChange={onKeyChange}
        value={title}
        placeholder={`Rename to...`}
        onKeyDown={(e: any) => {
          if (e.keyCode === KeyCodes.ENTER) {
            onSubmit();
          }
        }}
      />
    </ModalContainerCustom>
  );
};

export default RenameTaskModal;
