import type { Editor } from "@tiptap/react";
import React, { useContext, useRef, useState } from "react";
import toast from "react-hot-toast";
import AILogo from "@/assets/AILogo.png";
import { UndoToaster } from "@/components/undoToast";
import AIEnhanceActionButton from "@/components/RTE/Components/AIEnhanceActionButton";
import { tiptapForwardSlashRoute } from "@/lib/constants/APIRouteConstants";
import { currentProjectAtom } from "@/store";
import { useRecoilValue } from "@/lib/state";
import { MobileViewContext } from "@/lib/contexts/mobileContext";

interface IProps {
  editor: Editor | null;
}
const ImproveButton = ({ editor }: IProps) => {
  const isMobile = useContext(MobileViewContext);
  const [disable, setDisable] = useState<boolean>(false);
  const isImproving = useRef(false);
  const currentProject = useRecoilValue(currentProjectAtom);
  const onClick = async () => {
    if (isImproving.current) return;

    try {
      isImproving.current = true;
      setDisable(true);
      if (!editor) return;
      const previousContent = editor.getHTML();
      editor.commands.selectAll();
      editor.chain().focus().run();
      const contentToFix = editor.getHTML();

      await toast.promise(
        (async () => {
          const response = await fetch(tiptapForwardSlashRoute, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              content: contentToFix,
              command: "ImproveReadability",
              projectId: currentProject?.id,
            }),
          });

          if (!response.ok) {
            const payload = await response.json().catch(() => null);
            const message =
              typeof payload?.error === "string"
                ? payload.error
                : "Unable to improve this text. Please try again.";
            throw new Error(message);
          }

          const data = await response.json();
          const fixedContent = data.corrected_html;

          if (!fixedContent || typeof fixedContent !== "string") {
            throw new Error("AI returned no improved text. Please try again.");
          }

          editor.commands.setContent(fixedContent);
          UndoToaster(
            "Improved. Undo?",
            previousContent,
            async (dataBefore, toastId) => {
              editor.commands.setContent(dataBefore);
              editor.commands.focus("end");
              toast.dismiss(toastId);
            },
            isMobile
          );
          return true;
        })().catch((error) => {
          console.log("🚀 ~ error:", error);
          throw error;
        }),
        {
          loading: "Improving Readability",
          success: () => {
            editor.commands.focus("end");
            return "Content Readability Improved";
          },
          error: "Failed to improve readability",
        },
        {
          loading: {
            duration: Infinity,
          },
          success: {
            duration: 3000,
          },
          error: {
            duration: 3000,
          },
        }
      );
    } catch (error) {
      console.log("🚀 ~ command: ~ error:", error);
      return false;
    } finally {
      isImproving.current = false;
      setDisable(false);
    }
  };
  return (
    <AIEnhanceActionButton
      label="Improve with AI"
      onTouchEnd={onClick}
      onClick={onClick}
      disabled={disable}
      loading={disable}
    />
  );
};

export default ImproveButton;
