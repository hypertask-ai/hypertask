import { currentProjectAtom } from "@/store";
import { parseCookies } from "nookies";
import { useRecoilState } from "@/lib/state";
import { CommandListProps } from "./HTCTypes";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { ModalRowElementContainer } from "@/components/Common/CommonModalComponents";
import { getCurrentUserFromCookies } from "@/utils/getCurrentUser";
import { MobileCommandIcon } from "./MobileCommandIcon";



const CommandList: React.FC<CommandListProps> = ({ onClickHandler, commandLists, selectedCommand, handleMouseLeave, handleMouseEnter, commandRef, groupIndex, isMobile = false, inline = false }) => {
    const [_currentProject, _] = useRecoilState(currentProjectAtom)


    const currentUser = getCurrentUserFromCookies()

    return (
        <>
            {commandLists.map((command, index) => {
                const isOwner = command.checkOwnerShip && _currentProject?.team?.googleAccount?.userId === currentUser?.id;

                if (isOwner || !command.checkOwnerShip) {
                    return (
                        <li
                            key={command.key}
                            data-command-key={command.key}
                            role={inline ? "option" : undefined}
                            aria-selected={inline ? selectedCommand === command : undefined}
                            ref={commandRef as any}
                            onMouseLeave={handleMouseLeave}
                            onMouseEnter={() => handleMouseEnter(command, index, groupIndex)}
                            className={isMobile
                                ? `flex min-h-[52px] cursor-pointer items-center gap-3 border-b border-light-black-border-1 px-4 text-content transition-colors duration-75 ${selectedCommand===command?"bg-active-modal-element":""}`
                                : `h-[36px] cursor-pointer transition-all gap-3 duration-75 mx-1.5 rounded-sm px-3 text-dense ${selectedCommand===command?"bg-active-modal-element":""}`}
                            id={inline ? `agent-sidebar-command-${command.key}` : `command-${groupIndex}-${index}`}
                            onClick={() => onClickHandler(command)}
                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                        >
                            {isMobile ? <MobileCommandIcon command={command} /> : null}
                            <HTC_Command
                                name={command.name}
                                keyboardCommands={command.keyboard}
                                isNew={command.isNew}
                                isMobile={isMobile}
                            />
                        </li>
                    );
                }

                return null;
            })}
        </>
    );
};

type THTC_Command = {
    name: string;
    keyboardCommands: (string | null)[] | undefined
    isNew?: boolean;
    isMobile?: boolean;
}
const HTC_Command: React.FC<THTC_Command> = ({ name, keyboardCommands, isNew, isMobile = false }) => {
    return (
        <>
            <span className="flex flex-grow items-center" >
                {name}
                {isNew && (
                    <span className="ml-2 rounded-sm bg-hypertasks-purple px-[5px] py-[2px] text-micro font-medium leading-none text-white">
                        New
                    </span>
                )}
            </span>
            {!isMobile && <span className="flex items-center gap-[3px]">
                {
                    keyboardCommands?.map((item) =>
                        <>
                            {
                                !item ?
                                    <span className="px-0.5 text-micro text-text-light-gray">
                                        then
                                    </span>
                                    :
                                    <SingleKey item={item} />
                            }
                        </>
                    )
                }
            </span>}
        </>



    )
}

const SingleKey = (
    {
        item
    }: {
        item: "CTRL" | "ALT" |string
    }
) => {
    const isApple = useDeviceContext()

    return (
        <kbd
            className="rounded-sm bg-label-span px-[5px] py-[2px] font-sans text-micro font-medium leading-none text-white-black"
        >
            {item === "CTRL" ? (isApple ? "CMD" : "CTRL") : 
             item === "ALT" ? (isApple ? "OPT" : "ALT") : 
             item}
        </kbd>
    )
}

export default CommandList
