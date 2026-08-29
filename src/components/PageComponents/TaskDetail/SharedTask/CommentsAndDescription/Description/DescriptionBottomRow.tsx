import styles from "@/styles/tiptap.module.scss";
import { currentUserAtom } from "@/store";
import { useRecoilState } from "@/lib/state";
import { useContext, useMemo } from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { SmilePlus } from "lucide-react";
import { useDescriptionAndCommentsContext } from "@/lib/contexts/TaskDetail/DescriptionProvider";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { ITask } from "@/models/model";
import Tooltip from "@/components/Common/Tooltip";
import DescriptionEmojiComponent from "../../../CommentAndDescription/DescriptionContainer/BottomRow/DescriptionEmojiComponent";
import DescriptionEmojiButton from "../../../CommentAndDescription/DescriptionContainer/TopRow/DescriptionEmojiButton";

const SharedDescriptionReactions = () => {
  const { emojiFinder } = useDescriptionAndCommentsContext();
  const { currentTask, parsedTask: parsed_task, editMode } = useTaskContext();
  const _parsedTask: ITask = useMemo(
    () => JSON.parse(parsed_task),
    [parsed_task]
  );

  const _mbl = useContext(MobileViewContext);
  const [currentUser, _setCurrentUser] = useRecoilState(currentUserAtom);

  // ============================== MOBILE
  if (_mbl && editMode !== "description") {
    return (
      <div
        className={`flex items-center gap-1 flex-wrap ${styles.unstacked_grid_row3}`}
      >
        {currentTask?.description_?.reactions?.map(
          (reaction, index) => (
            <>
              <DescriptionEmojiComponent
                descriptionId={_parsedTask?.description_.id}
                currentUser={currentUser}
                initialCount={reaction.count}
                reaction={reaction}
                emojiClickHandler={() => {}}
                emojiFinder={emojiFinder}
              />
            </>
          )

          // eslint-disable-next-line react/jsx-key
        )}

        <DescriptionEmojiButton
          showEmojiPickerDescription={false}
          handleClickOutside={() => {}}
          emojiClickHandler={() => {}}
          toggleEmojiPicker={() => {}}
        />
      </div>
    );
  }

  // ============================ DESKTOP
  else
    return (
      <div className={`flex items-baseline gap-1 mr-1 mt-3`}>
        {currentTask?.description_?.reactions?.map(
          (reaction, index) => (
            <>
              <DescriptionEmojiComponent
                descriptionId={currentTask?.description_.id}
                currentUser={currentUser}
                initialCount={reaction.count}
                reaction={reaction}
                emojiClickHandler={() => {}}
                emojiFinder={emojiFinder}
              />
            </>
          )

          // eslint-disable-next-line react/jsx-key
        )}
        {currentTask?.description_?.reactions &&
          currentTask?.description_?.reactions.length > 0 && (
            <div className="relative  group flex">
              <SmilePlus size={14} className="cursor-pointer text-white-black  ml-1 rounded-lg  "  strokeWidth={1.75}/>
              <Tooltip
                left={0}
                bottom={-40}
                keyCombination={["R"]}
                text={"Add Reaction"}
              />
            </div>
          )}
      </div>
    );
};

export default SharedDescriptionReactions;
