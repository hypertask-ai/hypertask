import {
  ModalContainerCustom,
  ModalHeaderComp,
  ModalInput,
  ModalListContainer,
  ModalRowElementContainer,
} from "@/components/Common/CommonModalComponents";
import useHypertasksRecoilStates from "@/hooks/RecoilRoot/useHypertasksRecoilStates";
import useHandleKeydownBasic from "@/hooks/General/useHandleKeydownBasic";
import useHandleMouseGlobal from "@/hooks/General/useHandleMouse";
import { getCommentOptions } from "@/lib/constants/constants";
import taskDetailConfig from "@/lib/configs/taskDetail.config";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import {
  IAttachment,
  IComment,
  ICommentOption,
  TCommentOptionType,
} from "@/models/model";
import { idToDeleteCommentAtom } from "@/store";
import { ViewVisibility } from "@prisma/client";
import React, { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Link, Pencil, Plus, Reply, SmilePlus } from "lucide-react";



import { ModalBody } from "reactstrap";
import { useRecoilState } from "@/lib/state";
const prefixId = "label-htc-option-";

interface IOptionsModal {
  toggleEmojiPicker: (commentIndex: number) => void;
  replyToCommentHandler: (currentIndex: number) => string | undefined;
  editCommentHandler: (currentIndex: number) => void;
  commentIndex: number;
  comment: IComment;
  isCurrentUserCreator: boolean;
  toggleDeleteModal: (val: boolean) => void;
  toggle: (commentIndex: number) => void;
  handleStarComment: (commentId: string, type: ViewVisibility) => Promise<void>;
  pinned: boolean;
  starred: boolean;
}

const CommentOptionsModal = ({
  toggleEmojiPicker,
  replyToCommentHandler,
  editCommentHandler,
  comment,
  commentIndex,
  isCurrentUserCreator,
  toggleDeleteModal,
  toggle,
  handleStarComment,
  pinned,
  starred,
}: IOptionsModal) => {
  const isApple = useDeviceContext();
  const options = getCommentOptions(isApple, isCurrentUserCreator, pinned, starred, comment.creatorId)
    
  const { currentTask } = useTaskContext();
  const [keyword, setKeyword] = useState<string>("");
  const { toggleCreateTaskGlobally } = useHypertasksRecoilStates();
  const { setSelectedIndex, selectedIndex, handleKeydown } =
    useHandleKeydownBasic(enterHandler);
  const { handleMouseEnter, handleMouseLeave, handleMouseMove, elRef } =
    useHandleMouseGlobal({ setSelectedIndex });
  const [filteredOptions, setFilteredOptions] =
    useState<ICommentOption[]>(options);
  const [defaultOptions, setDefaultOptions] =
    useState<ICommentOption[]>(options);
  const [idToDelete, setIdToDelete] = useRecoilState<any>(
    idToDeleteCommentAtom
  );

  async function enterHandler(index: number) {
    setIdToDelete(comment?.id);
    if (filteredOptions.length === 0) return;
    else {
      switch (filteredOptions[index].type) {
        case "Copy":
          closeHandler();
          return copyCommentHandler();
        case "Edit":
          closeHandler();
          return editCommentHandler(commentIndex);
        case "React":
          closeHandler();
          return toggleEmojiPicker(commentIndex);
        case "Reply":
          closeHandler();
          return replyToCommentHandler(commentIndex);
        case "New":
          closeHandler();
          return toggleCreateSubTask();
        case "Delete":
          closeHandler();
          return toggleDeleteModal(true);
        case "Star":
          closeHandler();
          return handleStarComment(comment.id, "Private");
        case "Pin":
          closeHandler();
          return handleStarComment(comment.id, "Public");
        default:
          closeHandler();
          return;
      }
    }
  }

  const copyCommentHandler = () => {
    const currentURL = `${process.env.NEXT_PUBLIC_BASEURL}/detail/project-${currentTask?.projectId}/${currentTask?.uniqueIndex}`;
    navigator.clipboard.writeText(currentURL + `#comment-${commentIndex}`);
    toast("Link to this comment copied to clipboard!");
  };

  const processAttachmentsForNewTask = (attachments?: IAttachment[]) => {
    if (!attachments || attachments.length === 0) return [];
    let temp: any[] = [];
    for (const attachment of attachments) {
      temp.push({
        file: {
          name: attachment.fileName,
          size: attachment.fileSize,
          source: attachment.fileSource,
          type: attachment.fileType,
        },
        id: attachment.id,
      });
    }
    console.log("🚀 ~ processAttachmentsForNewTask ~ temp:", temp);
    return temp;
  };

  const toggleCreateSubTask = () => {
    // SECURITY: Use the shared task-detail templates so staging sanitization and the PR's mention/link escaping both apply.
    const linkhtml = taskDetailConfig.urls.templates.commentLink(
      currentTask?.projectId!,
      String(currentTask?.uniqueIndex),
      currentTask?.ticketNumber ?? "",
      commentIndex
    );
    const mentionhtml = taskDetailConfig.urls.templates.mention(
      comment.creator?.displayName ?? "",
      comment.creator?.id!
    );
    const heading = `${mentionhtml} said in ${linkhtml}`;
    toggleCreateTaskGlobally({
      sectionId: currentTask?.sectionId!,
      sectionTitle: currentTask?.section!,
      position: "top",
      prefilledDescription: `<p>${heading}<blockquote>${comment.text}</blockquote></p>`,
      prefilledAttachments: processAttachmentsForNewTask(comment.attachments),
    });
  };

  const handleChange = (e: any) => {
    setKeyword(e.target.value);
    if (e.target.value.length === 0) {
      setFilteredOptions(defaultOptions);
    } else {
      const filtered = filteredOptions.filter((option) =>
        option.title.toLowerCase().includes(keyword.toLowerCase())
      );
      setFilteredOptions(filtered);
    }
    setSelectedIndex(0);
    document
      .getElementById(`${prefixId}${0}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const closeHandler = () => {
    return toggle(commentIndex);
  };

  useEffect(() => {
    const keydown = (e: any) =>
      handleKeydown(
        e,
        filteredOptions?.length ? filteredOptions?.length : 0,
        prefixId,
        closeHandler
      );
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [filteredOptions?.length, handleKeydown]);

  return (
    <ModalContainerCustom
      fade={false}
      show={true}
      isOpen={true}
      id="comment-options-modal"
      toggle={closeHandler}
      shouldCloseOnClickOutside={true}
      className="font-bold sm:max-h-fit"
    >
      <ModalHeaderComp header={"Comment Options"} className="px-[20px]" />
      <ModalBody className="p-0">
        <ModalInput
          onChange={handleChange}
          value={keyword}
          placeholder="Search for an option"
          autofocus={true}
        />
        <ModalListContainer
          handleMouseMove={handleMouseMove}
          id="comment-options-modal-list-container"
          className="sm:max-h-fit"
        >
          {filteredOptions.length > 0 &&
            filteredOptions?.map((item: ICommentOption, index: number) => (
              <ModalRowElementContainer
                key={`el-${index}`}
                onMouseEnter={() => handleMouseEnter(index)}
                handleMouseLeave={handleMouseLeave}
                onClick={() => enterHandler(index)}
                id={`${prefixId}${index}`}
                index={index}
                commandRef={elRef}
                isSelected={selectedIndex === index}
              >
                <CommentOption option={item} />
              </ModalRowElementContainer>
            ))}
        </ModalListContainer>
      </ModalBody>
    </ModalContainerCustom>
  );
};

const CommentOption = ({ option }: { option: ICommentOption }) => {
  return (
    <div className=" w-full flex items-center justify-between">
      <div className="space-x-3 flex items-center">
        <span className="text-white-black font-medium">{option.title}</span>
        <IconForComment type={option.type} />
      </div>
      <div>
        {option.key &&
          option.key?.map((item, index) => (
            <SingleKey
              key={`index-${index}-single-key-comment-options-${item}`}
              item={item}
            />
          ))}
      </div>
    </div>
  );
};

const SingleKey = ({ item }: { item: "CTRL" | string }) => {
  return (
    <kbd className="px-[6px] pt-[1px] text-content mx-[1.5px] rounded-[2px] pb-0 border-gray-200 bg-[#555B64] font-bold dark:border-gray-500">
      {item}
    </kbd>
  );
};

const IconForComment = ({ type }: { type: TCommentOptionType }) => {
  const classname =  "text-content text-white-black"
  switch (type) {
    case "Copy":
      return <Link size={16} strokeWidth={1.75} className={classname} />;
    case "Edit":
      return <Pencil size={16} strokeWidth={1.75} className={classname} />;
    case "React":
      return <SmilePlus size={16} strokeWidth={1.75} className={classname} />;
    case "Reply":
      return <Reply size={16} strokeWidth={1.75} className={classname} />;
    case "New":
      return <Plus size={16} strokeWidth={1.75} className={classname} />;
    default:
      return <></>;
  }
};
export default CommentOptionsModal;
