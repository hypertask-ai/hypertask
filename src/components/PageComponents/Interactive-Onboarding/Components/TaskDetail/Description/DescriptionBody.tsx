import React from "react";
import InnerHTMLDescription from "@/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/InnerHtmlDescription";
import DescriptionTopRow from "./DescriptionTopRow";
import { useTutorialContext } from "@/lib/contexts/Interactive-Onboarding/TutorialGlobalProvider";
import { InteractiveTiptap } from "../Tiptap/InteractiveTipTap";
import TutorialTooltip from "../../TutorialTip";

interface IProp {
  creatorImg?: string;
  creatorName?: string;
  content?: string;
}

const DescriptionBody = ({ creatorName, creatorImg, content }: IProp) => {
  const { activeScene, descriptionEditor, description } = useTutorialContext();
  return (
    <div
      id="descriptionContainerInteractiveId"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      className="relative"
    >
      {/**-----------------------------------DESCRIPTION TOP ROW */}
      <DescriptionTopRow
        name={creatorName ?? "John Doe"}
        pfp={
          creatorImg ??
          "https://lh3.googleusercontent.com/a/ACg8ocLjk2g39zEaOcRwhBu_j9_g3Je7JC4mhU4Req_v3-8WOKwA8qqn=s576-c-no"
        }
        isUploadingDescription={undefined}
      />

      {/**----------------------------------INNERHTML DESCRIPTION */}

      {[30, 31].includes(activeScene.index) ? (
        <>
          {activeScene.index === 31 && (
            <TutorialTooltip
              text="You can write a prompt eg. 'Update the cookie modal'. The AI knows your board's context!"
              top={90}
              left={-195}
              className="w-[171px]"
            />
          )}
          <InteractiveTiptap type="description" editor={descriptionEditor} />
        </>
      ) : (
        <InnerHTMLDescription
          id="description"
          key="description"
          attachmentsFromProps={[]}
          allowQuote={false}
          descriptionText={
            activeScene.index > 31 ? description : content ?? undefined
          }
        />
      )}
    </div>
  );
};

export default DescriptionBody;
