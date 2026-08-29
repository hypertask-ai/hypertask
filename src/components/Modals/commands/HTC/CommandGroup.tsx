import { useEffect, useState } from "react";
import CommandList from "./CommandList";
import { CommandGroupsProps } from "./HTCTypes";

// Groups rendered on the first paint. Enough to fill the visible area on both
// the desktop palette (max-h-[364px]) and the mobile sheet; the rest arrive a
// frame later, below the fold.
const INITIAL_GROUPS = 3;

const CommandGroups: React.FC<CommandGroupsProps> = ({onClickHandler, filterCommands, selectedCommand, handleMouseMove, handleMouseLeave, handleMouseEnter, commandRef, isMobile = false }) => {
    // ponytail: the empty-query palette is 13 groups / ~730 DOM nodes, and it is
    // rebuilt from scratch on EVERY open, because <Commands> unmounts on close.
    // Measured on live prod (iPhone viewport, unthrottled CPU): ~250ms of
    // main-thread long tasks per open, and near-identical on the 2nd and 3rd
    // open — so this is not a one-time warmup cost, it is the full-list render
    // itself. On a throttled phone that is seconds, every time (HTPR-4515).
    // Typing is already cheap (~64ms; the list filters down to ~90 nodes), so
    // only the initial render needs help.
    //
    // Render the above-the-fold groups synchronously and let the remainder in
    // once the browser has painted. `showAll` latches on, so filtering — which
    // happens after that first frame — always renders the complete result set.
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

    // Keyboard selection indexes into the full list held by useHTC, not this
    // slice, so a deferred group is only absent from the DOM for one frame —
    // and the initially selected command lives in the first group, which is
    // always rendered.
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
