import Tooltip from "@/components/Common/Tooltip";
import useCopyURL from "@/hooks/General/useCopyURL";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import React, { useContext } from "react";
import { Link } from "lucide-react";

interface IProps {
  uniqueId: number | undefined;
  projectId: number | undefined;
  title: string;
  ticketNumber: string;
}
const CopyTaskButton = ({
  uniqueId,
  projectId,
  title,
  ticketNumber,
}: IProps) => {
  const _mbl = useContext(MobileViewContext);
  const isApple = useDeviceContext();
  const { copyTaskFormattedURL } = useCopyURL();

  const handleCopyTask = () =>
    copyTaskFormattedURL(title, ticketNumber, uniqueId, projectId);

  return _mbl ? (
    <div
      tabIndex={0}
      id="copy-task-url-button"
      className="h-8 w-8 flex items-center justify-center bg-back-button rounded-full group"
    >
      <button tabIndex={-1} onClick={handleCopyTask}>
        <Link className={`stroke-[4px]`} size={22} color={"#8E9093"}  strokeWidth={1.75}/>
      </button>
    </div>
  ) : (
    <div
      tabIndex={0}
      id="copy-task-title-and-url-button"
      className="relative group h-[20px]"
    >
      <button tabIndex={-1} onClick={handleCopyTask}>
        <Link
          color={"#696b6e"}
          className={`transition-colors stroke-[4px] dark:stroke-[2px] duration-75 hover:text-[#8E9093]`}
          size={20}
         strokeWidth={1.75}/>
      </button>
      <Tooltip
        left={-74}
        bottom={-40}
        text={"Copy Title and URL of task"}
        keyCombination={[`${!isApple ? "CTRL" : "CMD"}`, ","]}
      />
    </div>
  );
};

export default CopyTaskButton;
