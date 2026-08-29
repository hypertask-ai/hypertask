import {
  ModalContainerCustom,
  ModalHeaderComp,
  ModalInput,
} from "@/components/Common/CommonModalComponents";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { ChangeEvent, useState } from "react";

type Props = {
  closeCallback: (title: string) => void;
  currentTitle: string;
};

const RenameChatModal = (props: Props) => {
  const { closeCallback, currentTitle } = props;
  const [title, setTitle] = useState("");

  const onKeyChange = (e: ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
  };

  const onSubmit = async () => {
    if (title.length === 0) return closeCallback(currentTitle);
    closeCallback(title);
  };

  return (
    <ModalContainerCustom
      fade={false}
      show={true}
      isOpen={true}
      id="rename-chat-modal"
      toggle={() => closeCallback(currentTitle)}
    >
      <ModalHeaderComp header={`Rename chat`} className="px-[20px]" />

      <ModalInput
        onChange={onKeyChange}
        value={title}
        placeholder={`${currentTitle}`}
        onKeyDown={(e: any) => {
          if (e.keyCode === KeyCodes.ENTER) {
            e.preventDefault();
            e.stopPropagation();
            onSubmit();
          }
        }}
      />
    </ModalContainerCustom>
  );
};

export default RenameChatModal;
