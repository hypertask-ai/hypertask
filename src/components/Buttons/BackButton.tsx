import { useRouter } from "next/navigation";
import { FC, useContext } from "react";
import { ArrowLeft } from "lucide-react";
import Tooltip from "../Common/Tooltip";
import GoBackLogo from "@/assets/gobackicon.svg";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import Image from "next/image";
import { cn } from "@/utils/undoActions/helperFuncs";
import { useRecoilValue } from "@/lib/state";
import { appShellRailAtom } from "@/store";
import { APP_SHELL_RAIL_OFFSET } from "@/lib/constants/appShellRail";

interface BackButtonProps {
  left?: number | string; // The '?' makes 'left' optional,
  right?: number;
  top?: number;
  goBackHandler?: any;
  className?: string;
}
const BackButton: FC<BackButtonProps> = ({
  left: leftProp = 40,
  top = 40,
  goBackHandler,
  className,
}) => {
  const _mbl = useContext(MobileViewContext);
  const appShellRailOn = useRecoilValue(appShellRailAtom);
  // The rail widens when expanded, so track its live width rather than a
  // fixed offset that leaves this button buried underneath it.
  const left = appShellRailOn ? APP_SHELL_RAIL_OFFSET : leftProp;

  const router = useRouter();
  return !_mbl ? (
    <div
      className={
        appShellRailOn
          ? "group text-text-light-gray shadow-none hover:text-white-black"
          : "group bg-back-button text-white-black"
      }
      onClick={() => router.back()}
      style={{
        cursor: "pointer",
        position: "fixed",
        zIndex: 100,
        top,
        left,
        width: 40,
        height: 40,
        borderRadius: 20,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <ArrowLeft size={18} strokeWidth={1.75} fill="none" />
      <Tooltip left={45} bottom={2} text="Back" keyCombination={["ESC"]} />
    </div>
  ) : (
    <div
      onClick={() => router.back()}
      className={cn(`fixed z-[101] bottom-[110px] right-4 rounded-[20px] justify-center md:hidden cursor-pointer shadow-customshadow-2 flex w-fit px-3 py-[2px] h-fit gap-2 items-center bg-modalBackground text-[#8E9093]`)}
    >
      <Image src={GoBackLogo} alt="icon" width={28} height={28} />
      <span>Back</span>
    </div>
  );
};

export default BackButton;
