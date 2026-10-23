import { useEffect, useState } from "react";
import CommandList from "./CommandList";
import { CommandGroupsProps } from "./HTCTypes";

const INITIAL_GROUPS = 3;

const CommandGroups: React.FC<CommandGroupsProps> = ({onClickHandler, filterCommands, selectedCommand, handleMouseMove, handleMouseLeave, handleMouseEnter, commandRef, isMobile = false }) => {
    const [showAll, setShowAll] = useState(false);

    useEffect(() => {
        if (showAll) return;
        if (typeof requestIdleCallback === "function") {
            const id = requestIdleCallback(() => setShowAll(true), { timeout: 200 });
            return () => cancelIdleCallback(id);
        }
        const id = setTimeout(() => setShowAll(true), 0);
        return () => clearTimeout(id);
    }, [showAll]);

    const visibleGroups = showAll ? filterCommands : filterCommands?.slice(0, INITIAL_GROUPS);

    return (
        <div onMouseMove={handleMouseMove} className={isMobile ? "bg-inherit pb-1.5" : "max-h-[364px] bg-inherit overflow-y-scroll no-scrollbar pb-1.5"}>
            {visibleGroups?.map((group, groupIndex) => (
                <div key={groupIndex}>
                    <h3 className="px-4 pt-2.5 pb-1 text-text-light-gray font-semibold text-micro uppercase tracking-wider">{group.group}</h3>
                    <CommandList
                        groupIndex={groupIndex}
                        commandLists={group.commandLists}
                        selectedCommand={selectedCommand}
                        handleMouseLeave={handleMouseLeave}
                        handleMouseEnter={handleMouseEnter}
                        commandRef={commandRef}
                        onClickHandler={onClickHandler}
                        isMobile={isMobile}
                    />
                </div>
            ))}
        </div>
    );
};

export default CommandGroups
