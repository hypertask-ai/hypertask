import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { useRef, useState } from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useContext } from "react";
import { currentProjectAtom, currentUserAtom } from "@/store";
import { useRecoilState } from "@/lib/state";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import useAutosizeTextArea from "@/hooks/General/useAutosizeTextarea";
const SharedTaskTitle = () => {
  const { parsedTask: parsed_task } = useTaskContext();
  const _parsedTask = JSON.parse(parsed_task);
  const _mbl = useContext(MobileViewContext);
  const [__, _setCurrentUser] = useRecoilState(currentUserAtom);
  const [_currentProject, _] = useRecoilState(currentProjectAtom);
  const isApple = useDeviceContext();
  const [value, ___] = useState<string>(_parsedTask.title.trim());
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  useAutosizeTextArea(textAreaRef.current, value);

  return (
    <div
      className="flex items-center gap-2 relative group"
      tabIndex={0}
      id="title"
      style={{ flex: 1 }}
    >
      <textarea
        ref={textAreaRef}
        tabIndex={0}
        id="title-input"
        value={value ?? ""}
        onFocus={(e) => {
          e.target.selectionStart = e.target.value.length;
        }}
        readOnly
        className="font-bold"
        style={{
          resize: "none",
          background: "transparent",
          fontSize: !_mbl ? 24 : 18,
          width: "100%",
          outline: "none" }}
      />
    </div>
  );
};

export default SharedTaskTitle;
