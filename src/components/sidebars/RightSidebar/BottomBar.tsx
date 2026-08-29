import Image from "next/image"
import { Settings } from "lucide-react"
import { useSidebarContext } from "@/lib/contexts/Sidebars/SidebarProvider";
import commandImageDark from "@/assets/rightSidebarHTCLogoDarkMode.svg"
import logo from '@/assets/RightSidebarLogo.webp'
import Link from "next/link";
import useDarkMode from "@/hooks/MultiPages/HTC/useDarkMode";
import { appShellRailAtom } from "@/store";
import { useRecoilValue } from "@/lib/state";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useContext } from "react";

const BottomBarInSidebar = ()=>{
    const {_appHandler} = useSidebarContext()
    const { effectiveTheme } = useDarkMode()
    const isMbl = useContext(MobileViewContext)
    const appShellRailOn = useRecoilValue(appShellRailAtom)

    if (appShellRailOn && !isMbl) return null

    return(

        <div className="flex flex-col gap-6 text-white-black text-content">
            <div className="flex items-center gap-2">
             <Link
                className="cursor-pointer text-start "
                href={`https://hypertask.ai/terms`}
                target="_blank"
            >
                Terms
            </Link>
            <span className="font-bold">•</span>
            <Link
                className="cursor-pointer w-full text-start "
                href={`https://hypertask.ai/privacy`}
                target="_blank"
            >
                Privacy
            </Link>

            </div>
            <div className="flex items-center justify-between ">
                {/* <img src={logo.src} alt="logo" /> */}

                <Image
                    src={effectiveTheme ?(effectiveTheme!=="dark"? commandImageDark:logo):logo}
                    // className="my-4 px-6 h-[28px] w-auto "
                    // style={{ objectFit: "contain" }}
                    alt=""

                />
                <div
                    
                    id="gear"
                    className="bottom-right"
                >
                    <button
                    onClick={_appHandler}
                    className="">
                    <Settings className="text-white-black" size={25} strokeWidth={1.75} />
                    </button>
                </div>
            </div>
        </div>
        
    )
}

export default BottomBarInSidebar
