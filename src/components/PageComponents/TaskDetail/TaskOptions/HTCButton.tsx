import React, { useContext } from "react";
import Image from "next/image";
import Tooltip from "@/components/Common/Tooltip";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { useRecoilState } from "@/lib/state";
import { showCommandsAtom } from "@/store";
import { CommandMode } from "@/models/enums";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import useDarkMode from "@/hooks/MultiPages/HTC/useDarkMode";

const HTCButton = ({
  isKanban = false,
  htcButtonCallback,
}: {
  isKanban?: boolean;
  htcButtonCallback?: () => void;
}) => {
  const [_, setShowCommands] = useRecoilState(showCommandsAtom);
  const isMobile = useContext(MobileViewContext);
  const { effectiveTheme } = useDarkMode();
  const isApple = useDeviceContext();

  if (isMobile)
    return (
      <div
        className="relative h-8 w-8 flex items-center justify-center bg-back-button rounded-full group"
        onClick={() =>
          setShowCommands({ show: true, mode: CommandMode.Command })
        }
      >
        <Image src={"/HTCLogoGrayMbl.png"} width={18} height={14} alt="" />
      </div>
    );
  else
    return (
      <div
        className={`relative group ${
          isKanban ? "w-[14px]" : "w-[16px]"
        }  rounded-full cursor-pointer flex items-center justify-center`}
        onClick={(e: any) => {
          e.preventDefault();
          e.stopPropagation();
          if (htcButtonCallback) htcButtonCallback();
          setShowCommands({ show: true, mode: CommandMode.Command });
        }}
      >
        <Image
          src={
            isKanban && effectiveTheme === "dark"
              ? "/loginLogoMain.png"
              : "/HTCLogoGray.png"
          }
          width={16}
          height={16}
          alt=""
        />
        <Tooltip
          left={-235}
          bottom={-45}
          text="Hypertask Command"
          keyCombination={[`${!isApple ? "CTRL" : "CMD"}`, "K"]}
        />
      </div>
    );
};

export default HTCButton;
